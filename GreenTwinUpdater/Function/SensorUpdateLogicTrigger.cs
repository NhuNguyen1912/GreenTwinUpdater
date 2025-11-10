using System;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using Azure.DigitalTwins.Core;
using Azure.Messaging.ServiceBus;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace GreenTwinUpdater
{
    public class SensorUpdateLogicTrigger
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adt;

        public SensorUpdateLogicTrigger(ILoggerFactory loggerFactory, DigitalTwinsClient adtClient)
        {
            _logger = loggerFactory.CreateLogger<SensorUpdateLogicTrigger>();
            _adt = adtClient; // DI ở Program.cs
        }

        [Function("SensorUpdateLogicTrigger")]
        public async Task RunAsync(
            [ServiceBusTrigger("monitoringeventgridmessages", Connection = "ServiceBusConnection")]
            ServiceBusReceivedMessage message)
        {
            string body = "(unparsed)";
            try
            {
                body = message.Body.ToString();
                using var doc = JsonDocument.Parse(body);
                var root = doc.RootElement;

                var data = root.TryGetProperty("data", out var dataEl) ? dataEl : root;

                JsonElement patchParent;
                if (data.TryGetProperty("data", out var inner) && inner.TryGetProperty("patch", out var p1))
                    patchParent = p1;
                else if (data.TryGetProperty("patch", out var p2))
                    patchParent = p2;
                else
                {
                    _logger.LogDebug("No patch array in event. Body: {Body}", body);
                    return;
                }

                if (patchParent.ValueKind != JsonValueKind.Array || patchParent.GetArrayLength() == 0)
                    return;

                if (!root.TryGetProperty("subject", out var subjectEl) || subjectEl.ValueKind != JsonValueKind.String)
                {
                    _logger.LogDebug("Missing subject (sensor twin id). Body: {Body}", body);
                    return;
                }
                string sensorId = subjectEl.GetString()!;
                _logger.LogInformation("Event from sensor {Sensor}", sensorId);

                // Tìm Room cha qua hasDevice (version-agnostic)
                string roomId = await FindParentRoomAsync(sensorId);
                if (string.IsNullOrEmpty(roomId))
                {
                    _logger.LogWarning("Sensor {Sensor} chưa gắn vào Room qua 'hasDevice'.", sensorId);
                    return;
                }

                bool writeLastMotion = false;
                DateTime lastMotionUtc = DateTime.UtcNow;
                bool writeTemperature = false;
                double tempValue = 0;

                foreach (var patch in patchParent.EnumerateArray())
                {
                    if (!patch.TryGetProperty("op", out var opEl) ||
                        !patch.TryGetProperty("path", out var pathEl) ||
                        !patch.TryGetProperty("value", out var valEl))
                        continue;

                    var op = opEl.GetString();
                    if (op is not ("add" or "replace")) continue;

                    var path = pathEl.GetString() ?? "";
                    if (path.Equals("/motion", StringComparison.OrdinalIgnoreCase))
                    {
                        if (valEl.ValueKind == JsonValueKind.True)
                        {
                            writeLastMotion = true; // chỉ khi motion=true
                        }
                    }
                    else if (path.Equals("/temperature", StringComparison.OrdinalIgnoreCase))
                    {
                        if (valEl.ValueKind == JsonValueKind.Number)
                        {
                            writeTemperature = true;
                            tempValue = valEl.GetDouble();
                        }
                    }
                }

                if (writeLastMotion)
                {
                    await UpsertComponentPropsAsync(
                        roomId, "metrics",
                        ("/lastMotionUtc", lastMotionUtc)
                    );
                    _logger.LogInformation("Updated metrics.lastMotionUtc for {Room}", roomId);
                }

                if (writeTemperature)
                {
                    await UpsertComponentPropsAsync(
                        roomId, "metrics",
                        ("/currentTemperature", tempValue)
                    );
                    _logger.LogInformation("Updated metrics.currentTemperature={Temp} for {Room}", tempValue, roomId);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SensorUpdateLogicTrigger error. Body: {Body}", body);
                throw;
            }
        }

        private async Task<string> FindParentRoomAsync(string deviceTwinId)
        {
            const string roomBase = "dtmi:com:smartbuilding:Room;";
            string query = $@"
                SELECT room
                FROM DIGITALTWINS room
                WHERE room.$metadata.$model LIKE '{roomBase}%'
                JOIN rel RELATED room.hasDevice
                WHERE rel.$targetId = '{deviceTwinId}'
            ";

            await foreach (var twin in _adt.QueryAsync<BasicDigitalTwin>(query))
                return twin.Id;

            return string.Empty;
        }

        // ---- Helpers: Upsert từng property (Replace rồi fallback Add nếu 400) ----
        private async Task UpsertComponentPropsAsync(string twinId, string component, params (string path, object value)[] ops)
        {
            foreach (var (path, value) in ops)
            {
                var patch = new JsonPatchDocument();
                patch.AppendReplace(path, value);
                try
                {
                    await _adt.UpdateComponentAsync(twinId, component, patch);
                }
                catch (RequestFailedException ex) when (ex.Status == 400)
                {
                    var add = new JsonPatchDocument();
                    add.AppendAdd(path, value);
                    await _adt.UpdateComponentAsync(twinId, component, add);
                }
            }
        }
    }
}