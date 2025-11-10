using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using Azure.Messaging.ServiceBus;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace GreenTwinUpdater.Function
{
    public class IoTCentralTrigger
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _client;

        // Khóa điều khiển cần CHẶN trên actuator (áp dụng cho mọi version)
        private static readonly HashSet<string> BlockedActuatorProps = new(StringComparer.OrdinalIgnoreCase)
        { "powerState", "mode", "fanSpeed", "brightness" };

        // Whitelist keys cho từng loại SENSOR theo TÊN MODEL (không version)
        // => Khi bạn tăng version ;2 ;3..., code vẫn hoạt động nếu tên property không đổi.
        private static readonly Dictionary<string, HashSet<string>> AllowedSensorPropsByModelName =
            new(StringComparer.OrdinalIgnoreCase)
            {
                // TemperatureSensor;*  → cho phép "temperature"
                ["TemperatureSensor"] = new(StringComparer.OrdinalIgnoreCase) { "temperature" },

                // HumiditySensor;* → "currentHumidity"
                ["HumiditySensor"]   = new(StringComparer.OrdinalIgnoreCase) { "currentHumidity" },

                // LightSensor;* → "illuminance"
                ["LightSensor"]      = new(StringComparer.OrdinalIgnoreCase) { "illuminance" },

                // MotionSensor;* → "motion"
                ["MotionSensor"]     = new(StringComparer.OrdinalIgnoreCase) { "motion" },

                // EnergyMeter;* → "currentPowerW", "currentEnergyKWh"
                ["EnergyMeter"]      = new(StringComparer.OrdinalIgnoreCase) { "currentPowerW", "currentEnergyKWh" },
            };

        // Tập model tên (không version) coi là ACTUATOR
        private static readonly HashSet<string> ActuatorModelNames = new(StringComparer.OrdinalIgnoreCase)
        { "ACUnit", "LightSwitch" };

        public IoTCentralTrigger(ILoggerFactory loggerFactory, DigitalTwinsClient adtClient)
        {
            _logger = loggerFactory.CreateLogger<IoTCentralTrigger>();
            _client = adtClient;
        }

        [Function("IoTCentralTrigger")]
        public async Task RunAsync(
            [ServiceBusTrigger("iotcentral", Connection = "ServiceBusConnection")]
            ServiceBusReceivedMessage message)
        {
            string messageBody = "(unreadable)";
            string? twinId = null;

            try
            {
                messageBody = message.Body?.ToString() ?? "";
                using var doc = JsonDocument.Parse(messageBody);
                var root = doc.RootElement;

                // 1) Lấy device/twin id
                if (!root.TryGetProperty("deviceId", out var deviceIdEl) ||
                    deviceIdEl.ValueKind != JsonValueKind.String ||
                    string.IsNullOrWhiteSpace(deviceIdEl.GetString()))
                {
                    _logger.LogWarning("Skip msg {Seq}: missing deviceId", message.SequenceNumber);
                    return;
                }
                twinId = deviceIdEl.GetString()!.Trim();

                // 2) Lấy $model của twin và chuẩn hóa về TÊN MODEL (không version)
                string? modelId = await TryGetModelIdAsync(twinId);
                if (modelId == null)
                {
                    _logger.LogWarning("Skip msg {Seq}: twin '{Twin}' not found in ADT", message.SequenceNumber, twinId);
                    return;
                }

                string modelName = GetDtmiModelName(modelId); // ví dụ: "ACUnit", "TemperatureSensor"
                bool isActuator = ActuatorModelNames.Contains(modelName);

                // 3) Xác định messageType + payload cần đọc
                string messageType = root.TryGetProperty("messageType", out var mtEl) && mtEl.ValueKind == JsonValueKind.String
                    ? mtEl.GetString()!
                    : InferMessageType(root);

                JsonElement dataObject;
                if (messageType.Equals("telemetry", StringComparison.OrdinalIgnoreCase))
                {
                    if (!root.TryGetProperty("telemetry", out dataObject) || dataObject.ValueKind != JsonValueKind.Object)
                    {
                        _logger.LogWarning("Skip telemetry msg {Seq}: no 'telemetry' object", message.SequenceNumber);
                        return;
                    }
                }
                else if (messageType.Equals("propertyChange", StringComparison.OrdinalIgnoreCase)
                      || messageType.Equals("cloudPropertyChange", StringComparison.OrdinalIgnoreCase))
                {
                    if (!root.TryGetProperty("properties", out dataObject) || dataObject.ValueKind != JsonValueKind.Object)
                    {
                        // Một số exporter nhét thẳng vào root → fallback
                        dataObject = root;
                    }
                }
                else
                {
                    // Fallback: tìm object đầu tiên
                    if (!TryFindFirstObject(root, out dataObject))
                    {
                        _logger.LogWarning("Skip msg {Seq}: unknown payload shape", message.SequenceNumber);
                        return;
                    }
                }

                // 4) Lọc & patch
                var patch = new JsonPatchDocument();
                int added = 0;

                foreach (var prop in dataObject.EnumerateObject())
                {
                    var name = prop.Name;

                    // 4.a) Nếu là ACTUATOR → chặn keys điều khiển
                    if (isActuator && BlockedActuatorProps.Contains(name))
                    {
                        _logger.LogDebug("Blocked actuator key '{Key}' for twin {Twin}", name, twinId);
                        continue;
                    }

                    // 4.b) Nếu là SENSOR → chỉ nhận keys trong whitelist theo TÊN MODEL
                    if (!isActuator)
                    {
                        if (AllowedSensorPropsByModelName.TryGetValue(modelName, out var allowed) && !allowed.Contains(name))
                        {
                            _logger.LogDebug("Skip key '{Key}' for sensor model {Model}", name, modelName);
                            continue;
                        }
                    }

                    // 4.c) Chuẩn hóa value (Number/String/Bool). Bỏ qua kiểu khác.
                    object? value = prop.Value.ValueKind switch
                    {
                        JsonValueKind.Number => TryGetNumber(prop.Value),
                        JsonValueKind.String => prop.Value.GetString(),
                        JsonValueKind.True => true,
                        JsonValueKind.False => false,
                        _ => null
                    };
                    if (value is null) continue;

                    patch.AppendReplace($"/{name}", value);
                    added++;
                }

                if (added == 0)
                {
                    _logger.LogInformation("No applicable keys to patch for twin {Twin} (modelName {Model})", twinId, modelName);
                    return;
                }

                await _client.UpdateDigitalTwinAsync(twinId, patch);
                _logger.LogInformation("Patched {Count} key(s) on twin {Twin} (modelName {Model}) from {Type}", added, twinId, modelName, messageType);
            }
            catch (RequestFailedException adtEx)
            {
                _logger.LogError(adtEx, "ADT API error (Status {Status}, Code {Code}) for twin {Twin}", adtEx.Status, adtEx.ErrorCode ?? "N/A", twinId ?? "N/A");
                if (adtEx.Status == 429 || adtEx.Status >= 500) throw; // cho SB retry
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Unexpected error on SB msg {Seq}, twin {Twin}. Body: {Body}", message.SequenceNumber, twinId ?? "N/A", messageBody);
                throw;
            }
        }

        // ===== Helpers =====

        private async Task<string?> TryGetModelIdAsync(string twinId)
        {
            try
            {
                var twin = await _client.GetDigitalTwinAsync<BasicDigitalTwin>(twinId);
                return twin?.Value?.Metadata?.ModelId; // vd: "dtmi:com:smartbuilding:ACUnit;2"
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                return null;
            }
        }

        // Trả về tên model KHÔNG version từ DTMI
        // "dtmi:com:smartbuilding:ACUnit;2" → "ACUnit"
        // "dtmi:org:x:devices:TemperatureSensor;3" → "TemperatureSensor"
        private static string GetDtmiModelName(string modelId)
        {
            // Bỏ phần ;version nếu có
            var semi = modelId.IndexOf(';');
            var noVersion = semi >= 0 ? modelId.Substring(0, semi) : modelId;

            // Lấy phần sau dấu ":" cuối cùng
            var lastColon = noVersion.LastIndexOf(':');
            if (lastColon >= 0 && lastColon < noVersion.Length - 1)
                return noVersion.Substring(lastColon + 1);

            // Fallback: nếu format lạ, trả về toàn bộ (ít gặp)
            return noVersion;
        }

        private static object? TryGetNumber(JsonElement el)
        {
            if (el.TryGetInt64(out var i64)) return i64;
            if (el.TryGetDouble(out var d)) return d;
            return null;
        }

        private static string InferMessageType(JsonElement root)
        {
            if (root.TryGetProperty("telemetry", out var tel) && tel.ValueKind == JsonValueKind.Object) return "telemetry";
            if (root.TryGetProperty("properties", out var props) && props.ValueKind == JsonValueKind.Object) return "propertyChange";
            return "unknown";
        }

        private static bool TryFindFirstObject(JsonElement root, out JsonElement obj)
        {
            foreach (var p in root.EnumerateObject())
            {
                if (p.Value.ValueKind == JsonValueKind.Object)
                {
                    obj = p.Value;
                    return true;
                }
            }
            obj = default;
            return false;
        }
    }
}