using System;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using Azure.Messaging.EventGrid;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace GreenTwinUpdater.Function
{
    public class AdtToCentralTrigger
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adtClient;
        private readonly IoTCentralClient _iotCentralClient;

        public AdtToCentralTrigger(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<AdtToCentralTrigger>();
            
            string adtUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
            // Kiểm tra null để tránh lỗi khởi động nếu quên cấu hình
            if (string.IsNullOrEmpty(adtUrl)) throw new Exception("Missing ADT_SERVICE_URL");
            
            _adtClient = new DigitalTwinsClient(new Uri(adtUrl), new DefaultAzureCredential());
            _iotCentralClient = new IoTCentralClient(); 
        }

        [Function("AdtToCentralTrigger")]
        public async Task Run([EventGridTrigger] EventGridEvent eventGridEvent)
        {
            // 1. Chỉ xử lý sự kiện Twin Update
            if (eventGridEvent.EventType != "Microsoft.DigitalTwins.Twin.Update") return;

            // 2. Lấy Twin ID
            string twinId = eventGridEvent.Subject.Replace("twins/", "");
            _logger.LogInformation($"Twin {twinId} updated.");

            try
            {
                // 3. Lấy thông tin Twin mới nhất
                var twinResponse = await _adtClient.GetDigitalTwinAsync<BasicDigitalTwin>(twinId);
                var twin = twinResponse.Value;
                string modelId = twin.Metadata.ModelId;

                // 4. Phân loại Model
                // Lưu ý: Kiểm tra chuỗi bắt đầu để bao gồm cả version (VD: ACUnit;1, ACUnit;2)
                if (modelId.Contains("dtmi:com:smartbuilding:ACUnit"))
                {
                    await SyncAC(twin);
                }
                else if (modelId.Contains("dtmi:com:smartbuilding:LightSwitch"))
                {
                    await SyncLight(twin);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, $"Failed to sync twin {twinId}");
            }
        }

        private async Task SyncAC(BasicDigitalTwin twin)
        {
            // SỬA LẠI CÁCH GỌI HÀM:
            // Dùng GetVal cho kiểu số/bool
            bool? power = GetVal<bool>(twin, "powerState");
            double? targetTemp = GetVal<double>(twin, "setpointTemperature");
            
            // Dùng GetStr cho kiểu chuỗi (String)
            string mode = GetStr(twin, "mode");
            string fan = GetStr(twin, "fanSpeed");

            await _iotCentralClient.UpdateAcAsync(
                deviceId: twin.Id,
                powerState: power,
                mode: mode,
                fanSpeed: fan,
                setpointTemperature: targetTemp
            );
            _logger.LogInformation($"Synced AC {twin.Id} to Central.");
        }

        private async Task SyncLight(BasicDigitalTwin twin)
        {
            bool? power = GetVal<bool>(twin, "powerState");
            int? brightness = GetVal<int>(twin, "brightness");

            await _iotCentralClient.UpdateLightAsync(
                deviceId: twin.Id,
                powerState: power,
                brightness: brightness
            );
            _logger.LogInformation($"Synced Light {twin.Id} to Central.");
        }

        // =========================================================
        // 👇 ĐÃ SỬA TÊN HÀM ĐỂ TRÁNH TRÙNG LẶP (CS0111) 👇
        // =========================================================

        // 1. Hàm đọc giá trị kiểu Value Type (int, bool, double...)
        private T? GetVal<T>(BasicDigitalTwin twin, string key) where T : struct
        {
            if (twin.Contents.TryGetValue(key, out var obj))
            {
                if (obj is JsonElement je)
                {
                    if (typeof(T) == typeof(bool) && je.ValueKind == JsonValueKind.True) return (T)(object)true;
                    if (typeof(T) == typeof(bool) && je.ValueKind == JsonValueKind.False) return (T)(object)false;
                    
                    if (typeof(T) == typeof(int) && je.TryGetInt32(out var i)) return (T)(object)i;
                    if (typeof(T) == typeof(double) && je.TryGetDouble(out var d)) return (T)(object)d;
                }
            }
            return null;
        }
        
        // 2. Hàm đọc giá trị kiểu Chuỗi (String) - Đổi tên thành GetStr
        private string GetStr(BasicDigitalTwin twin, string key)
        {
             if (twin.Contents.TryGetValue(key, out var obj) && obj is JsonElement je)
             {
                 return je.ValueKind == JsonValueKind.String ? je.GetString() : null;
             }
             return null;
        }
    }
}