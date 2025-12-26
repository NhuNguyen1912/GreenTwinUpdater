using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using Azure.DigitalTwins.Core;
using Azure.Messaging.ServiceBus;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace GreenTwinUpdater.Function
{
    public class IoTCentralTrigger
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _client;

        // Vẫn giữ nguyên: Cho phép 'powerState' và 'brightness'
        private static readonly HashSet<string> BlockedActuatorProps = new(StringComparer.OrdinalIgnoreCase)
        {
            // "powerState",
            "mode",
            "fanSpeed",
            // "brightness"
        };

        // Whitelist cho sensor theo model name
        // QUAN TRỌNG: Nếu model của EdgeA001 của bạn (ví dụ 'EdgeDevice') CÓ thuộc tính bạn muốn patch,
        // bạn phải thêm nó vào đây.
        // Ví dụ: ["EdgeDevice"] = new(StringComparer.OrdinalIgnoreCase) { "someProperty" },
        private static readonly Dictionary<string, HashSet<string>> AllowedSensorPropsByModelName =
            new(StringComparer.OrdinalIgnoreCase)
            {
                ["TemperatureSensor"] = new(StringComparer.OrdinalIgnoreCase) { "temperature" },
                ["HumiditySensor"] = new(StringComparer.OrdinalIgnoreCase) { "currentHumidity" },
                ["LightSensor"] = new(StringComparer.OrdinalIgnoreCase) { "illuminance" },
                ["MotionSensor"] = new(StringComparer.OrdinalIgnoreCase) { "motion" },
                ["EnergyMeter"] = new(StringComparer.OrdinalIgnoreCase) { "currentPowerW", "currentEnergyKWh" },
            };

        private static readonly HashSet<string> ActuatorModelNames = new(StringComparer.OrdinalIgnoreCase)
        { "ACUnit", "LightSwitch" };

        public IoTCentralTrigger(ILoggerFactory loggerFactory, DigitalTwinsClient adtClient)
        {
            _logger = loggerFactory.CreateLogger<IoTCentralTrigger>();
            _client = adtClient;
        }

        [Function("IoTCentralTrigger")]
        public async Task RunAsync(
            [ServiceBusTrigger("iots-telemetry", Connection = "ServiceBusConnection")]
            ServiceBusReceivedMessage message)
        {
            string messageBody = "(unreadable)";
            string? twinId = null;
            string modelName = "unknown"; // Dùng cho log lỗi

            try
            {
                messageBody = message.Body?.ToString() ?? string.Empty;
                using var doc = JsonDocument.Parse(messageBody);
                var root = doc.RootElement;

                // 1 deviceId
                if (!root.TryGetProperty("deviceId", out var deviceIdEl) ||
                    deviceIdEl.ValueKind != JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(deviceIdEl.GetString()))
                {
                    _logger.LogWarning("Skip msg {Seq}: missing deviceId", message.SequenceNumber);
                    return;
                }
                twinId = deviceIdEl.GetString()!.Trim();

                // 2️ Model
                string? modelId = await TryGetModelIdAsync(twinId);
                if (modelId is null)
                {
                    _logger.LogWarning("Skip msg {Seq}: twin '{Twin}' not found in ADT", message.SequenceNumber, twinId);
                    return;
                }
                modelName = GetDtmiModelName(modelId); // Gán modelName
                bool isActuator = ActuatorModelNames.Contains(modelName);

                // 3️ Chuẩn hóa messageType
                string rawType = root.TryGetProperty("messageType", out var mtEl) && mtEl.ValueKind == JsonValueKind.String
                    ? mtEl.GetString()!
                    : InferMessageType(root);
                var norm = NormalizeType(rawType);

                var patch = new JsonPatchDocument();
                int added = 0;
                JsonElement dataObject = default;
                bool hasTelemetryObj = false;

                // Trường hợp 1: Telemetry (Dạng Object)
                if (norm == NormalizedType.Telemetry)
                {
                    if (!root.TryGetProperty("telemetry", out dataObject) || dataObject.ValueKind != JsonValueKind.Object)
                    {
                        _logger.LogWarning("Skip telemetry msg {Seq}: no 'telemetry' object", message.SequenceNumber);
                        return;
                    }

                    foreach (var prop in dataObject.EnumerateObject())
                    {
                        string name = prop.Name;
                        if (isActuator) { continue; } // Bỏ qua reported của actuator

                        // Whitelist check
                        if (AllowedSensorPropsByModelName.TryGetValue(modelName, out var allow) &&
                            !allow.Contains(name))
                        {
                            _logger.LogDebug("Skip key '{Key}' for sensor model {Model}", name, modelName);
                            continue;
                        }
                        if (!TryExtractValue(prop.Value, out var value) || value is null) continue;
                        patch.AppendReplace($"/{name}", value);
                        added++;
                    }
                }
                // Trường hợp 2: Reported (Dạng Object)
                else if (norm == NormalizedType.PropReported &&
                         root.TryGetProperty("properties", out dataObject) &&
                         dataObject.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in dataObject.EnumerateObject())
                    {
                        string name = prop.Name;
                        if (isActuator) { continue; } // Bỏ qua reported của actuator

                        // Whitelist check
                        if (AllowedSensorPropsByModelName.TryGetValue(modelName, out var allow) &&
                            !allow.Contains(name))
                        {
                            _logger.LogDebug("Skip key '{Key}' for sensor model {Model}", name, modelName);
                            continue;
                        }
                        if (!TryExtractValue(prop.Value, out var value) || value is null) continue;
                        patch.AppendReplace($"/{name}", value);
                        added++;
                    }
                }
                // Trường hợp 3: Desired/Cloud HOẶC Reported (Dạng Array)
                else if ((norm == NormalizedType.PropDesired || norm == NormalizedType.PropReported) &&
                         root.TryGetProperty("properties", out var propsArr) && propsArr.ValueKind == JsonValueKind.Array)
                {
                    bool isDesiredSide = (norm == NormalizedType.PropDesired);

                    foreach (var item in propsArr.EnumerateArray())
                    {
                        if (item.ValueKind != JsonValueKind.Object) continue;
                        if (!item.TryGetProperty("name", out var nameEl) || nameEl.ValueKind != JsonValueKind.String) continue;
                        if (!item.TryGetProperty("value", out var valEl)) continue;

                        string name = nameEl.GetString()!;

                        // *** BẢN SỬA LỖI CHO EdgeA001: Thêm Whitelist check ***
                        if (!isActuator) // Nếu là Sensor (hoặc Edge)
                        {
                            // Nếu là 'desired' thì bỏ qua
                            if (isDesiredSide) continue;

                            // Nếu là 'reported' thì kiểm tra whitelist
                            if (!AllowedSensorPropsByModelName.TryGetValue(modelName, out var allow) ||
                                !allow.Contains(name))
                            {
                                _logger.LogDebug("Skip key '{Key}' (from Array) for sensor model {Model}", name, modelName);
                                continue; // Bỏ qua (ví dụ: ipAddress, firmwareVersion)
                            }
                        }
                        // *** HẾT BẢN SỬA ***

                        // Logic chặn Actuator (Chỉ chặn nếu là Desired)
                        if (isActuator && isDesiredSide && BlockedActuatorProps.Contains(name))
                        {
                            _logger.LogDebug("Blocked actuator key '{Key}' (desired/cloud) for {Twin}", name, twinId);
                            continue;
                        }

                        if (!TryExtractValue(valEl, out var value) || value is null) continue;

                        string adtPath = $"/{name}";
                        patch.AppendReplace(adtPath, value);
                        added++;
                    }
                }
                else
                {
                    _logger.LogWarning("Skip msg {Seq}: Cannot locate payload object or array (type={Type})",
                        message.SequenceNumber, rawType);
                    return;
                }

                // 6️ Gửi patch
                if (added == 0)
                {
                    _logger.LogInformation("No applicable keys to patch for twin {Twin} (model {Model}, type {Type})",
                        twinId, modelName, rawType);
                    return;
                }

                await _client.UpdateDigitalTwinAsync(twinId, patch);
                _logger.LogInformation("Patched {Count} key(s) on twin {Twin} (model {Model}) from {Type}",
                    added, twinId, modelName, rawType);
                await UpdateParentRoomMetricsAsync(deviceTwinId: twinId, sensorModelName: modelName, telemetryObj: dataObject);

            }
            catch (RequestFailedException adtEx)
            {
                _logger.LogError(adtEx,
                    "ADT API error (Status {Status}, Code {Code}) for twin {Twin} (model {Model})",
                    adtEx.Status, adtEx.ErrorCode ?? "N/A", twinId ?? "N/A", modelName); // Thêm modelName vào log lỗi
                if (adtEx.Status == 429 || adtEx.Status >= 500) throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Unexpected error on SB msg {Seq}, twin {Twin} (model {Model}). Body: {Body}",
                    message.SequenceNumber, twinId ?? "N/A", modelName, messageBody);
                throw;
            }
        }

        // ====================== Helpers (Không thay đổi) ======================

        private async Task<string?> TryGetModelIdAsync(string twinId)
        {
            try
            {
                var twin = await _client.GetDigitalTwinAsync<BasicDigitalTwin>(twinId);
                return twin?.Value?.Metadata?.ModelId;
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                return null;
            }
        }

        private static string GetDtmiModelName(string modelId)
        {
            var semi = modelId.IndexOf(';');
            var noVersion = semi >= 0 ? modelId[..semi] : modelId;
            var lastColon = noVersion.LastIndexOf(':');
            return (lastColon >= 0 && lastColon < noVersion.Length - 1)
                ? noVersion[(lastColon + 1)..]
                : noVersion;
        }

        private static string InferMessageType(JsonElement root)
        {
            if (root.TryGetProperty("telemetry", out var t) && t.ValueKind == JsonValueKind.Object)
                return "telemetry";
            if (root.TryGetProperty("properties", out var p) && (p.ValueKind == JsonValueKind.Object || p.ValueKind == JsonValueKind.Array))
                return "propertyChange";
            return "unknown";
        }

        private enum NormalizedType { Unknown, Telemetry, PropReported, PropDesired }

        private static NormalizedType NormalizeType(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return NormalizedType.Unknown;
            var s = raw.Trim().ToLowerInvariant();

            if (s == "telemetry" || s.EndsWith(":telemetry"))
                return NormalizedType.Telemetry;

            // Kiểm tra "reported" trước "desired"
            if (s.Contains("reported") && s.Contains("property"))
                return NormalizedType.PropReported;
            if (s == "property" || s == "devicepropertiesreported" || s == "devicepropertyreportedchange")
                return NormalizedType.PropReported;

            // Kiểm tra "desired" sau
            if (s.Contains("desired") && s.Contains("property"))
                return NormalizedType.PropDesired;
            if (s.Contains("cloudproperty") || s == "devicepropertydesiredchange")
                return NormalizedType.PropDesired;

            return NormalizedType.Unknown;
        }

        private static bool TryExtractValue(JsonElement el, out object? value)
        {
            value = null;
            switch (el.ValueKind)
            {
                case JsonValueKind.True: value = true; return true;
                case JsonValueKind.False: value = false; return true;
                case JsonValueKind.String: value = el.GetString(); return true;
                case JsonValueKind.Number:
                    if (el.TryGetInt64(out var i64)) { value = i64; return true; }
                    if (el.TryGetDouble(out var d)) { value = d; return true; }
                    return false;
                case JsonValueKind.Object:
                    if (el.TryGetProperty("reported", out var rep) && rep.ValueKind == JsonValueKind.Object &&
                        rep.TryGetProperty("value", out var repVal) && TryExtractValue(repVal, out value)) return true;
                    if (el.TryGetProperty("desired", out var des) && des.ValueKind == JsonValueKind.Object &&
                        des.TryGetProperty("value", out var desVal) && TryExtractValue(desVal, out value)) return true;
                    if (el.TryGetProperty("value", out var v) && TryExtractValue(v, out value)) return true;
                    return false;
                default:
                    return false;
            }
        }

        private async Task UpdateParentRoomMetricsAsync(string deviceTwinId, string sensorModelName, JsonElement telemetryObj)
        {
            // 1) Tìm room cha qua quan hệ hasDevice
            var roomIds = await FindParentRoomsByDeviceAsync(deviceTwinId);
            if (roomIds.Count == 0) return;

            // 2) Build patch cho Room.metrics
            var roomPatch = new JsonPatchDocument();
            int added = 0;

            // Map telemetry -> metrics
            // Lưu ý: tên property metrics phải đúng với DTDL RoomMetrics của bạn: metrics.currentTemperature/currentHumidity/...
            if (sensorModelName.Equals("TemperatureSensor", StringComparison.OrdinalIgnoreCase)
                && telemetryObj.TryGetProperty("temperature", out var tEl)
                && TryExtractValue(tEl, out var tVal) && tVal is not null)
            {
                roomPatch.AppendReplace("/metrics/currentTemperature", tVal);
                added++;
            }

            if (sensorModelName.Equals("HumiditySensor", StringComparison.OrdinalIgnoreCase)
                && telemetryObj.TryGetProperty("currentHumidity", out var hEl)
                && TryExtractValue(hEl, out var hVal) && hVal is not null)
            {
                roomPatch.AppendReplace("/metrics/currentHumidity", hVal);
                added++;
            }

            if (sensorModelName.Equals("LightSensor", StringComparison.OrdinalIgnoreCase)
                && telemetryObj.TryGetProperty("illuminance", out var lEl)
                && TryExtractValue(lEl, out var lVal) && lVal is not null)
            {
                // Nếu DTDL của bạn dùng currentLux thì đổi path thành /metrics/currentLux
                roomPatch.AppendReplace("/metrics/currentIlluminance", lVal);
                added++;
            }

            if (sensorModelName.Equals("EnergyMeter", StringComparison.OrdinalIgnoreCase))
            {
                if (telemetryObj.TryGetProperty("currentPowerW", out var pEl)
                    && TryExtractValue(pEl, out var pVal) && pVal is not null)
                {
                    roomPatch.AppendReplace("/metrics/currentPowerW", pVal);
                    added++;
                }

                if (telemetryObj.TryGetProperty("currentEnergyKWh", out var eEl)
                    && TryExtractValue(eEl, out var eVal) && eVal is not null)
                {
                    roomPatch.AppendReplace("/metrics/currentEnergyKWh", eVal);
                    added++;
                }
            }

            if (sensorModelName.Equals("MotionSensor", StringComparison.OrdinalIgnoreCase)
                && telemetryObj.TryGetProperty("motion", out var mEl)
                && TryExtractValue(mEl, out var mVal) && mVal is bool motion && motion)
            {
                roomPatch.AppendReplace("/metrics/lastMotionUtc", DateTime.UtcNow.ToString("O"));
                added++;
            }

            if (added == 0) return;

            // 3) Patch tất cả room cha (thường chỉ 1)
            foreach (var roomId in roomIds)
            {
                await _client.UpdateDigitalTwinAsync(roomId, roomPatch);
            }
        }

        private async Task<List<string>> FindParentRoomsByDeviceAsync(string deviceTwinId)
        {
            // Room -> hasDevice -> Device
            // Query tìm roomId có relationship hasDevice tới deviceTwinId
            string q = $"SELECT room.$dtId FROM DIGITALTWINS room " +
                       $"JOIN dev RELATED room.hasDevice " +
                       $"WHERE dev.$dtId = '{deviceTwinId.Replace("'", "''")}'";

            var results = new List<string>();

            await foreach (var row in _client.QueryAsync<JsonElement>(q))
            {
                if (row.TryGetProperty("$dtId", out var idEl) && idEl.ValueKind == JsonValueKind.String)
                    results.Add(idEl.GetString()!);
            }
            return results;
        }

    }
}