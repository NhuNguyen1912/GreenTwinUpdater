using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace GreenTwinUpdater.Function
{
    /// <summary>
    /// Client đơn giản để PATCH properties lên IoT Central
    /// bằng API token (SharedAccessSignature).
    /// Dùng cho cả LightSwitch và ACUnit.
    /// </summary>
    public class IoTCentralClient
    {
        private static readonly HttpClient _httpClient = new HttpClient();

        private readonly string _appSubdomain;
        private readonly string _apiToken;

        public IoTCentralClient()
        {
            _appSubdomain =
                Environment.GetEnvironmentVariable("IOTC_APP_SUBDOMAIN")
                ?? throw new InvalidOperationException("Missing IOTC_APP_SUBDOMAIN.");
            _apiToken =
                Environment.GetEnvironmentVariable("IOTC_API_TOKEN")
                ?? throw new InvalidOperationException("Missing IOTC_API_TOKEN.");
        }

        /// <summary>
        /// Gửi PATCH properties thô lên IoT Central.
        /// </summary>
        private async Task PatchDevicePropertiesAsync(string deviceId, IDictionary<string, object> properties)
        {
            if (properties == null || properties.Count == 0)
                return;

            var url =
                $"https://{_appSubdomain}.azureiotcentral.com/api/devices/{deviceId}/properties?api-version=2022-07-31";

            var req = new HttpRequestMessage(HttpMethod.Patch, url);

            // IOTC_API_TOKEN = nguyên chuỗi "SharedAccessSignature sr=..."
            req.Headers.TryAddWithoutValidation("Authorization", _apiToken);

            string json = JsonSerializer.Serialize(properties);
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");

            var resp = await _httpClient.SendAsync(req);
            var respBody = await resp.Content.ReadAsStringAsync();

            if (!resp.IsSuccessStatusCode)
            {
                throw new Exception($"IoT Central error {resp.StatusCode}: {respBody}");
            }
        }

        /// <summary>
        /// Cập nhật LightSwitch: powerState + brightness.
        /// </summary>
        public Task UpdateLightAsync(
            string deviceId,
            bool? powerState = null,
            int? brightness = null)
        {
            var body = new Dictionary<string, object>();

            if (powerState.HasValue)
                body["powerState"] = powerState.Value;

            if (brightness.HasValue)
                body["brightness"] = brightness.Value;

            return PatchDevicePropertiesAsync(deviceId, body);
        }

        /// <summary>
        /// Cập nhật ACUnit: powerState, mode, fanSpeed, setpointTemperature.
        /// </summary>
        public Task UpdateAcAsync(
            string deviceId,
            bool? powerState = null,
            string? mode = null,
            string? fanSpeed = null,
            double? setpointTemperature = null)
        {
            var body = new Dictionary<string, object>();

            if (powerState.HasValue)
                body["powerState"] = powerState.Value;

            if (!string.IsNullOrWhiteSpace(mode))
                body["mode"] = mode;

            if (!string.IsNullOrWhiteSpace(fanSpeed))
                body["fanSpeed"] = fanSpeed;

            if (setpointTemperature.HasValue)
                body["setpointTemperature"] = setpointTemperature.Value;

            return PatchDevicePropertiesAsync(deviceId, body);
        }
    }
}
