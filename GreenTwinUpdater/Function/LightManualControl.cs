using System;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Azure;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace GreenTwinUpdater.Function
{
    public class LightManualControl
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adt;
        private readonly IoTCentralClient? _iotc;

        public LightManualControl(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<LightManualControl>();

            var adtUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
            if (string.IsNullOrWhiteSpace(adtUrl))
                throw new InvalidOperationException("Missing ADT_SERVICE_URL.");

            _adt = new DigitalTwinsClient(new Uri(adtUrl), new DefaultAzureCredential());

            try
            {
                _iotc = new IoTCentralClient();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "IoTCentralClient init failed. Skipping IoTC updates.");
                _iotc = null;
            }
        }

        public class LightControlRequest
        {
            public bool? PowerState { get; set; }
            public int? Brightness { get; set; }
            public string? User { get; set; }
            public int? DurationMinutes { get; set; }
        }

        // 1. API POST: Điều khiển đèn
        [Function("LightManualControl")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "rooms/{roomId}/devices/{deviceId}/light-control")]
            HttpRequestData req,
            string roomId,
            string deviceId)
        {
            string bodyString = await req.ReadAsStringAsync();
            var payload = JsonSerializer.Deserialize<LightControlRequest>(bodyString, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (payload == null) return req.CreateResponse(HttpStatusCode.BadRequest);

            // Tính thời gian override
            int duration = payload.DurationMinutes is > 0 ? payload.DurationMinutes.Value : 60;
            var nowUtc = DateTimeOffset.UtcNow;
            var expiresOnUtc = nowUtc.AddMinutes(duration);
            string user = string.IsNullOrEmpty(payload.User) ? "GreenTwinUI" : payload.User;

            _logger.LogInformation("💡 LightControl: Room={room}, Dev={dev}, User={user}, Duration={min}m", roomId, deviceId, user, duration);

            // A. Cập nhật Device Twin (Light)
            var devicePatch = new JsonPatchDocument();
            bool hasDeviceOps = false; // Flag to track operations

            if (payload.PowerState.HasValue) 
            {
                devicePatch.AppendReplace("/powerState", payload.PowerState.Value);
                hasDeviceOps = true;
            }
            if (payload.Brightness.HasValue) 
            {
                devicePatch.AppendReplace("/brightness", payload.Brightness.Value);
                hasDeviceOps = true;
            }

            if (hasDeviceOps)
            {
                try
                {
                    await _adt.UpdateDigitalTwinAsync(deviceId, devicePatch);
                    _logger.LogInformation("✅ ADT Light updated");
                }
                catch (Exception ex) { _logger.LogError(ex, "❌ ADT Light update failed"); }
            }

            // B. Cập nhật Room Policy (Override Flag)
            // Logic Upsert an toàn cho Component Policy
            try
            {
                var ops = new[]
                {
                    (path: "/overrideActive", value: (object)true),
                    (path: "/overrideExpiresOn", value: (object)expiresOnUtc),
                    (path: "/lastUpdatedBy", value: (object)user)
                };
                await UpsertComponentPropsAsync(roomId, "policy", ops);
                _logger.LogInformation("✅ ADT Policy Override set until {expires}", expiresOnUtc);
            }
            catch (Exception ex) { _logger.LogError(ex, "❌ ADT Policy update failed"); }

            // C. Sync sang IoT Central
            if (_iotc != null)
            {
                await _iotc.UpdateLightAsync(deviceId, payload.PowerState, payload.Brightness);
            }

            // D. Trả về state mới
            var state = await BuildLightStateAsync(roomId, deviceId);
            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(state);
            return res;
        }

        // 2. API GET: Lấy trạng thái đèn
        [Function("GetLightState")]
        public async Task<HttpResponseData> GetLightState(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "rooms/{roomId}/devices/{deviceId}/light-state")]
            HttpRequestData req, string roomId, string deviceId)
        {
            try
            {
                var state = await BuildLightStateAsync(roomId, deviceId);
                var res = req.CreateResponse(HttpStatusCode.OK);
                await res.WriteAsJsonAsync(state);
                return res;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "GetLightState failed");
                return req.CreateResponse(HttpStatusCode.InternalServerError);
            }
        }

        // Helpers
        private async Task<object> BuildLightStateAsync(string roomId, string deviceId)
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time");

            var light = (await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(deviceId)).Value;
            var room = (await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(roomId)).Value;

            // Parse Policy
            bool overrideActive = false;
            DateTimeOffset? expiresOn = null;
            string lastUpdatedBy = "";

            if (room.Contents.TryGetValue("policy", out var pObj) && pObj is JsonElement pEl)
            {
                if (pEl.TryGetProperty("overrideActive", out var oa)) overrideActive = oa.ValueKind == JsonValueKind.True;
                if (pEl.TryGetProperty("overrideExpiresOn", out var exp) && exp.TryGetDateTimeOffset(out var dt)) expiresOn = dt;
                if (pEl.TryGetProperty("lastUpdatedBy", out var lb)) lastUpdatedBy = lb.GetString() ?? "";
            }

            if (overrideActive && expiresOn.HasValue && expiresOn.Value <= DateTimeOffset.UtcNow)
                overrideActive = false;

            string expiresLocalFormatted = expiresOn.HasValue
                ? TimeZoneInfo.ConvertTime(expiresOn.Value, tz).ToString("HH:mm dd/MM/yyyy")
                : "";

            // Parse Light Props
            var c = light.Contents;
            return new
            {
                roomId,
                deviceId,
                powerState = c.TryGetValue("powerState", out var p) && p is JsonElement pe && pe.GetBoolean(),
                brightness = c.TryGetValue("brightness", out var b) && b is JsonElement be && be.TryGetInt32(out var bi) ? bi : 0,
                
                overrideActive,
                overrideExpiresOnLocalFormatted = expiresLocalFormatted,
                lastUpdatedBy,
                controlMode = overrideActive ? "manual-override" : "auto-schedule"
            };
        }

        private async Task UpsertComponentPropsAsync(string twinId, string componentName, (string path, object value)[] ops)
        {
            foreach (var op in ops)
            {
                var patch = new JsonPatchDocument();
                patch.AppendReplace(op.path, op.value);
                try { await _adt.UpdateComponentAsync(twinId, componentName, patch); }
                catch (RequestFailedException ex) when (ex.Status == 400)
                {
                    var add = new JsonPatchDocument();
                    add.AppendAdd(op.path, op.value);
                    await _adt.UpdateComponentAsync(twinId, componentName, add);
                }
            }
        }
    }
}