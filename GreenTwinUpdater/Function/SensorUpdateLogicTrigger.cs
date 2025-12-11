using System;
using System.Collections.Generic;
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

                // 1) Lấy block data (Event Grid style)
                var data = root.TryGetProperty("data", out var dataEl) ? dataEl : root;

                // 2) Lấy mảng patch (data.data.patch hoặc data.patch)
                if (!TryGetPatchArray(data, out var patchArray))
                {
                    _logger.LogDebug("No patch array in event. Body: {Body}", body);
                    return;
                }

                if (patchArray.ValueKind != JsonValueKind.Array || patchArray.GetArrayLength() == 0)
                {
                    _logger.LogDebug("Empty patch array. Body: {Body}", body);
                    return;
                }

                // 3) Lấy sensor twin id từ subject
                if (!root.TryGetProperty("subject", out var subjectEl) ||
                    subjectEl.ValueKind != JsonValueKind.String)
                {
                    _logger.LogDebug("Missing subject (sensor twin id). Body: {Body}", body);
                    return;
                }

                string sensorId = subjectEl.GetString()!.Trim();
                _logger.LogInformation("Event from sensor Test 2 '{Sensor}' (Length={Length})", sensorId, sensorId.Length);


                // 4) Tìm Room cha qua quan hệ hasDevice (Room;* => version-agnostic)
                string roomId = await FindParentRoomAsync(sensorId);
                if (string.IsNullOrEmpty(roomId))
                {
                    _logger.LogWarning("Sensor {Sensor} chưa gắn vào Room qua 'hasDevice'.", sensorId);
                    return;
                }

                // 5) Dò patch để xem có cập nhật gì liên quan
                bool shouldUpdateLastMotion = false;
                bool shouldUpdateTemp = false;
                bool shouldUpdateLux = false;

                double tempValue = 0;
                double luxValue = 0;

                bool shouldUpdateHumidity = false;
                bool shouldUpdatePower = false;
                bool shouldUpdateEnergy = false;

                double humidityValue = 0;
                double powerValue = 0;
                double energyValue = 0;

                foreach (var patch in patchArray.EnumerateArray())
                {
                    if (!patch.TryGetProperty("op", out var opEl) ||
                        !patch.TryGetProperty("path", out var pathEl) ||
                        !patch.TryGetProperty("value", out var valEl))
                    {
                        continue;
                    }

                    var op = opEl.GetString();
                    if (op is not ("add" or "replace"))
                        continue;

                    var path = pathEl.GetString() ?? string.Empty;

                    // Chuẩn hoá so sánh path
                    if (path.Equals("/motion", StringComparison.OrdinalIgnoreCase))
                    {
                        // Chỉ khi motion = true mới cập nhật lastMotionUtc
                        if (valEl.ValueKind == JsonValueKind.True)
                        {
                            shouldUpdateLastMotion = true;
                        }
                    }
                    else if (path.Equals("/temperature", StringComparison.OrdinalIgnoreCase))
                    {
                        if (valEl.ValueKind == JsonValueKind.Number)
                        {
                            shouldUpdateTemp = true;
                            tempValue = valEl.GetDouble();
                        }
                    }
                    else if (path.Equals("/illuminance", StringComparison.OrdinalIgnoreCase))
                    {
                        if (valEl.ValueKind == JsonValueKind.Number)
                        {
                            shouldUpdateLux = true;
                            luxValue = valEl.GetDouble();
                        }
                    }
                    else if (path.Equals("/currentHumidity", StringComparison.OrdinalIgnoreCase))
                    {
                        if (valEl.ValueKind == JsonValueKind.Number)
                        {
                            shouldUpdateHumidity = true;
                            humidityValue = valEl.GetDouble();
                        }
                    }
                    else if (path.Equals("/currentPowerW", StringComparison.OrdinalIgnoreCase))
                    {
                        if (valEl.ValueKind == JsonValueKind.Number)
                        {
                            shouldUpdatePower = true;
                            powerValue = valEl.GetDouble();
                        }
                    }
                    else if (path.Equals("/currentEnergyKWh", StringComparison.OrdinalIgnoreCase))
                    {
                        if (valEl.ValueKind == JsonValueKind.Number)
                        {
                            shouldUpdateEnergy = true;
                            energyValue = valEl.GetDouble();
                        }
                    }

                }

                if (!shouldUpdateLastMotion &&
    !shouldUpdateTemp &&
    !shouldUpdateLux &&
    !shouldUpdateHumidity &&
    !shouldUpdatePower &&
    !shouldUpdateEnergy)
                {
                    _logger.LogInformation("No relevant patch operations for sensor {Sensor}", sensorId);
                    return;
                }

                // 6) Build list property cần upsert vào Room.metrics
                var ops = new List<(string path, object value)>();

                if (shouldUpdateLastMotion)
                {
                    ops.Add(("/lastMotionUtc", DateTime.UtcNow));
                }

                if (shouldUpdateTemp)
                {
                    ops.Add(("/currentTemperature", tempValue));
                }

                if (shouldUpdateLux)
                {
                    ops.Add(("/currentIlluminance", luxValue));
                }
                if (shouldUpdateHumidity)
                {
                    ops.Add(("/currentHumidity", humidityValue));
                }

                if (shouldUpdatePower)
                {
                    ops.Add(("/currentPowerW", powerValue));
                }

                if (shouldUpdateEnergy)
                {
                    ops.Add(("/currentEnergyKWh", energyValue));
                }


                // 7) Upsert vào component metrics
                await UpsertComponentPropsAsync(roomId, "metrics", ops.ToArray());

                _logger.LogInformation(
                    "Updated metrics for Room {Room}. lastMotion={Motion}, currentTemperature={Temp}, currentIlluminance={Lux}",
                    roomId,
                    shouldUpdateLastMotion,
                    shouldUpdateTemp ? tempValue : (double?)null,
                    shouldUpdateLux ? luxValue : (double?)null
                );
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "SensorUpdateLogicTrigger error. Body: {Body}", body);
                throw;
            }
        }

        // ----------------- Helpers -----------------

        private static bool TryGetPatchArray(JsonElement data, out JsonElement patchArray)
        {
            // Kiểu event hiện tại: data.data.patch[] hoặc data.patch[]
            if (data.TryGetProperty("data", out var inner) &&
                inner.TryGetProperty("patch", out var p1))
            {
                patchArray = p1;
                return true;
            }

            if (data.TryGetProperty("patch", out var p2))
            {
                patchArray = p2;
                return true;
            }

            patchArray = default;
            return false;
        }

        private async Task<string> FindParentRoomAsync(string deviceTwinId)
        {
            var cleanId = deviceTwinId.Trim();

            // Chỉ query ra đúng $dtId của room để tránh bug deserialize
            string query =
                "SELECT room.$dtId AS roomId " +
                "FROM DIGITALTWINS room " +
                "JOIN device RELATED room.hasDevice " +
                $"WHERE device.$dtId = '{cleanId}'";

            _logger.LogInformation(
                "FindParentRoomAsync: looking for device '{DeviceId}' with query: {Query}",
                cleanId,
                query
            );

            try
            {
                await foreach (var item in _adt.QueryAsync<RoomIdResult>(query))
                {
                    if (!string.IsNullOrEmpty(item.roomId))
                    {
                        _logger.LogInformation(
                            "FindParentRoomAsync: found Room {RoomId} for device {DeviceId}",
                            item.roomId,
                            cleanId
                        );
                        return item.roomId;
                    }
                }

                _logger.LogWarning("FindParentRoomAsync: no Room found for device {DeviceId}", cleanId);
            }
            catch (RequestFailedException ex)
            {
                _logger.LogError(
                    ex,
                    "FindParentRoomAsync query failed for sensor {SensorId}. Query: {Query}",
                    cleanId,
                    query
                );
            }

            return string.Empty;
        }


        private class RoomIdResult
        {
            public string roomId { get; set; }
        }




        /// <summary>
        /// Upsert từng property trong component:
        /// - Try Replace
        /// - Nếu 400 (property chưa tồn tại) thì Add
        /// </summary>
        private async Task UpsertComponentPropsAsync(
            string twinId,
            string component,
            params (string path, object value)[] ops)
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
