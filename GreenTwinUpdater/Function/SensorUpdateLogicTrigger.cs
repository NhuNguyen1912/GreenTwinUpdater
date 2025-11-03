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
        private readonly DigitalTwinsClient _adtClient;
        private const double TEMP_TOLERANCE = 1.0;

        public SensorUpdateLogicTrigger(ILoggerFactory loggerFactory, DigitalTwinsClient adtClient)
        {
            _logger = loggerFactory.CreateLogger<SensorUpdateLogicTrigger>();
            _adtClient = adtClient;
            _logger.LogInformation("LogicTrigger (Function 2) instance created.");
        }

        [Function("SensorUpdateLogicTrigger")]
        public async Task RunAsync(
            [ServiceBusTrigger("monitoringeventgridmessages", Connection = "ServiceBusConnection")]
            ServiceBusReceivedMessage message)
        {
            string messageBody = "(unable to read body)";
            string? sensorId = null;

            try
            {
                messageBody = message.Body.ToString();
                using JsonDocument jsonDoc = JsonDocument.Parse(messageBody);
                JsonElement root = jsonDoc.RootElement;

                sensorId = root.GetProperty("subject").GetString()!;
                _logger.LogInformation("LogicTrigger: Received event from Sensor '{SensorId}'", sensorId);

                JsonElement patch = root.GetProperty("data").GetProperty("data").GetProperty("patch")[0];
                string op = patch.GetProperty("op").GetString()!;
                string path = patch.GetProperty("path").GetString()!;
                JsonElement valueElement = patch.GetProperty("value");

                if (op != "replace" && op != "add")
                {
                    _logger.LogInformation("Skipping operation '{Op}' for {SensorId}", op, sensorId);
                    return;
                }

                // 2. TÌM PHÒNG (ROOM) QUẢN LÝ SENSOR NÀY
                string roomId = await FindParentRoomAsync(sensorId); 
                if (string.IsNullOrEmpty(roomId))
                {
                    _logger.LogWarning("Sensor {SensorId} is not attached to any room ('hasDevice'). Skipping logic.", sensorId);
                    return;
                }

                // 3. KIỂM TRA ƯU TIÊN 1: MANUAL OVERRIDE
                var roomTwinResponse = await _adtClient.GetDigitalTwinAsync<BasicDigitalTwin>(roomId);
                BasicDigitalTwin roomTwin = roomTwinResponse.Value;

                if (roomTwin.Contents.TryGetValue("overrideUntil", out var overrideUntilProp) &&
                    overrideUntilProp != null &&
                    overrideUntilProp is JsonElement overrideElem)
                {
                    if (overrideElem.ValueKind != JsonValueKind.Null &&
                        overrideElem.TryGetDateTimeOffset(out DateTimeOffset overrideTime) &&
                        overrideTime > DateTimeOffset.UtcNow)
                    {
                        _logger.LogWarning("Room {RoomId} is in Manual Override. Skipping logic for {SensorId}.", roomId, sensorId);
                        return;
                    }
                }

                bool scheduleOrMotionActive = true;

                // 5. XỬ LÝ LOGIC THEO TỪNG LOẠI SENSOR

                // --- A. LOGIC KHI CÓ CHUYỂN ĐỘNG (MOTION) ---
                if (path == "/motionDetected" && valueElement.ValueKind == JsonValueKind.True)
                {
                    _logger.LogWarning("LOGIC: Motion detected in Room {RoomId}.", roomId);

                    if (scheduleOrMotionActive)
                    {
                        await SafeSendPatchAsync(roomId, "LightSwitch", "/on", true, "hasDevice", null);
                        await SafeSendPatchAsync(roomId, "ACUnit", "/mode", "Auto", "hasDevice", "Off");
                    }

                    string metricsId = await FindRelatedTwinAsync(roomId, "hasMetrics");
                    if (!string.IsNullOrEmpty(metricsId))
                    {
                        // Hàm này không cần tên quan hệ, nó cập nhật trực tiếp metricsId
                        await SafeSendPatchAsync(metricsId, null, "/lastSeen", DateTime.UtcNow);
                    }
                    else
                    {
                        _logger.LogWarning("Room {RoomId} is missing 'hasMetrics' relationship. Cannot update lastSeen.", roomId);
                    }
                }

                // --- B. LOGIC KHI NHIỆT ĐỘ THAY ĐỔI (TEMPERATURE) ---
                if (path == "/temperature" && valueElement.ValueKind == JsonValueKind.Number)
                {
                    double currentTemp = valueElement.GetDouble();
                    _logger.LogInformation("LOGIC: Temperature changed in Room {RoomId}: {Temp}C", roomId, currentTemp);

                    if (scheduleOrMotionActive)
                    {
                        await HandleTemperatureChangeAsync(roomId, currentTemp, roomTwin);
                    }
                    else
                    {
                        _logger.LogInformation("LOGIC: Room {RoomId} is vacant. Turning AC Off.", roomId);
                        await SafeSendPatchAsync(roomId, "ACUnit", "/mode", "Off", "hasDevice", null);
                    }
                }
            }
            catch (JsonException jsonEx)
            {
                _logger.LogError(jsonEx, "JSON Parsing error in LogicTrigger. Body: {Body}", messageBody);
            }
            catch (RequestFailedException adtEx)
            {
                _logger.LogError(adtEx, "ADT API error in LogicTrigger for Sensor {SensorId}. Status: {Status}", sensorId ?? "unknown", adtEx.Status);
                if (adtEx.Status >= 500 || adtEx.Status == 429) { throw; }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error in LogicTrigger. Sensor: {SensorId}", sensorId ?? "unknown");
                throw;
            }
        }

        private async Task HandleTemperatureChangeAsync(string roomId, double currentTemp, BasicDigitalTwin roomTwin)
        {
            double targetTemp = 24.0;

            if (roomTwin.Contents.TryGetValue("targetTemp", out var targetTempProp) &&
                targetTempProp != null &&
                targetTempProp is JsonElement tempElem &&
                tempElem.ValueKind == JsonValueKind.Number)
            {
                targetTemp = tempElem.GetDouble();
            }

            double delta = currentTemp - targetTemp;

            if (Math.Abs(delta) <= TEMP_TOLERANCE)
            {
                _logger.LogInformation("LOGIC: Temp delta ({Delta}) for {RoomId} is within tolerance. No change.", Math.Round(delta, 2), roomId);
                return;
            }

            if (delta > TEMP_TOLERANCE)
            {
                _logger.LogWarning("LOGIC: Room {RoomId} is HOT ({Temp}C vs Target {Target}C). Turning AC to 'Cool'.", roomId, currentTemp, targetTemp);

                // SỬA 1: Gửi giá trị "cool" (viết thường) để khớp với DTDL Enum
                // ĐÃ SỬA LỖI: "ACA001" -> "ACUnit"
                await SafeSendPatchAsync(roomId, "ACUnit", "/mode", "cool", "hasDevice", null);

                // SỬA 2: Gửi đến đường dẫn "/targetTemperature" (thay vì "/setpoint")
                // ĐÃ SỬA LỖI: "ACA001" -> "ACUnit"
                await SafeSendPatchAsync(roomId, "ACUnit", "/targetTemperature", targetTemp, "hasDevice", null);
            }
            else if (delta < -TEMP_TOLERANCE)
            {
                _logger.LogWarning("LOGIC: Room {RoomId} is COLD ({Temp}C vs Target {Target}C). Turning AC to 'Off'.", roomId, currentTemp, targetTemp);

                // Gửi giá trị "fan" (hoặc "off" nếu bạn định nghĩa nó trong Enum)
                // ĐÃ SỬA LỖI: "ACA001" -> "ACUnit"
                await SafeSendPatchAsync(roomId, "ACUnit", "/mode", "fan", "hasDevice", null);
            }
        }

        private async Task<string> FindParentRoomAsync(string sensorId)
        {
            string query = $"SELECT Room.$dtId FROM DIGITALTWINS Room JOIN Sensor RELATED Room.hasDevice WHERE Sensor.$dtId = '{sensorId}'";

            await foreach (Page<JsonElement> resultPage in _adtClient.QueryAsync<JsonElement>(query).AsPages())
            {
                foreach (JsonElement twinData in resultPage.Values)
                {
                    if (twinData.TryGetProperty("$dtId", out JsonElement dtId))
                    {
                        return dtId.GetString()!;
                    }
                }
            }
            return string.Empty;
        }

        private async Task<string> FindRelatedTwinAsync(string sourceId, string relationshipName)
        {
            // Hàm này không có lỗi, nó dùng 'relationshipName' làm biến
            string query = $"SELECT Target.$dtId FROM DIGITALTWINS Source JOIN Target RELATED Source.{relationshipName} WHERE Source.$dtId = '{sourceId}'";

            await foreach (Page<JsonElement> resultPage in _adtClient.QueryAsync<JsonElement>(query).AsPages())
            {
                foreach (JsonElement twinData in resultPage.Values)
                {
                    if (twinData.TryGetProperty("$dtId", out JsonElement dtId))
                    {
                        return dtId.GetString()!;
                    }
                }
            }
            return string.Empty;
        }

        private async Task SafeSendPatchAsync(string targetTwinId, string? actuatorModelName, string propertyPath, object value, string? relationshipName = null, string? onlyIfModeIs = null)
        {
            string finalTwinId = targetTwinId;

            if (relationshipName != null && actuatorModelName != null)
            {
                // SỬA LỖI TRUY VẤN: Đổi 'Room.controls' thành 'Room.{relationshipName}'
                string query = $"SELECT Actuator.$dtId, Actuator FROM DIGITALTWINS Room JOIN Actuator RELATED Room.{relationshipName} WHERE Room.$dtId = '{targetTwinId}' AND IS_OF_MODEL(Actuator, 'dtmi:com:smartbuilding:{actuatorModelName};1')";

                await foreach (Page<JsonElement> resultPage in _adtClient.QueryAsync<JsonElement>(query).AsPages())
                {
                    foreach (JsonElement twinData in resultPage.Values)
                    {
                        if (twinData.TryGetProperty("$dtId", out JsonElement dtId))
                        {
                            finalTwinId = dtId.GetString()!;

                            if (onlyIfModeIs != null)
                            {
                                var actuatorTwin = twinData.GetProperty("Actuator");
                                if (actuatorTwin.TryGetProperty("mode", out var modeProp) && modeProp.GetString() != onlyIfModeIs)
                                {
                                    _logger.LogInformation("Skipping command for {ActuatorId}: Mode is not '{Mode}'", finalTwinId, onlyIfModeIs);
                                    continue;
                                }
                            }
                            break;
                        }
                    }
                    if (finalTwinId != targetTwinId) break;
                }

                if (finalTwinId == targetTwinId && actuatorModelName != null)
                {
                    _logger.LogError("Could not find actuator '{ModelName}' related to {TwinId} via '{RelName}'", actuatorModelName, targetTwinId, relationshipName);
                    return;
                }
            }

            try
            {
                var patch = new JsonPatchDocument();
                patch.AppendReplace(propertyPath, value);
                _logger.LogInformation("Sending 'Replace' command to {TwinId}: {Path} = {Value}", finalTwinId, propertyPath, value);
                await _adtClient.UpdateDigitalTwinAsync(finalTwinId, patch);
            }
            catch (RequestFailedException ex) when (ex.Status == 400)
            {
                _logger.LogWarning("'Replace' failed for {TwinId} (trying 'Add')...", finalTwinId);
                var addPatch = new JsonPatchDocument();
                addPatch.AppendAdd(propertyPath, value);
                await _adtClient.UpdateDigitalTwinAsync(finalTwinId, addPatch);
            }
        }
    }
}