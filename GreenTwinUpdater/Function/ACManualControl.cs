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
    public class ACManualControl
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adt;
        private readonly IoTCentralClient? _iotc;

        public ACManualControl(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<ACManualControl>();

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

        public class AcControlRequest
        {
            public bool? PowerState { get; set; }
            public string? Mode { get; set; }
            public string? FanSpeed { get; set; }
            public double? TargetTemperature { get; set; }
            public string? User { get; set; }
            public int? DurationMinutes { get; set; }
        }

        [Function("ACManualControl")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "rooms/{roomId}/devices/{deviceId}/ac-control")]
            HttpRequestData req,
            string roomId,
            string deviceId)
        {
            string bodyString = await req.ReadAsStringAsync();
            var payload = JsonSerializer.Deserialize<AcControlRequest>(bodyString, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (payload == null) return req.CreateResponse(HttpStatusCode.BadRequest);

            // 1. Tính toán thời gian hết hạn (UTC)
            int duration = payload.DurationMinutes is > 0 ? payload.DurationMinutes.Value : 60;
            var nowUtc = DateTimeOffset.UtcNow;
            var expiresOnUtc = nowUtc.AddMinutes(duration);
            string user = string.IsNullOrEmpty(payload.User) ? "GreenTwinUI" : payload.User;

            _logger.LogInformation("🕹️ ACManualControl: Room={room}, Dev={dev}, User={user}, Duration={min}m", 
                roomId, deviceId, user, duration);

            // A. Cập nhật Device Twin (Light)
            var acPatch = new JsonPatchDocument();
            bool hasAcOps = false;

            if (payload.PowerState.HasValue) { acPatch.AppendReplace("/powerState", payload.PowerState.Value); hasAcOps = true; }
            if (!string.IsNullOrEmpty(payload.Mode)) { acPatch.AppendReplace("/mode", payload.Mode); hasAcOps = true; }
            if (!string.IsNullOrEmpty(payload.FanSpeed)) { acPatch.AppendReplace("/fanSpeed", payload.FanSpeed); hasAcOps = true; }
            if (payload.TargetTemperature.HasValue) { acPatch.AppendReplace("/setpointTemperature", payload.TargetTemperature.Value); hasAcOps = true; }

            if (hasAcOps)
            {
                try
                {
                    await _adt.UpdateDigitalTwinAsync(deviceId, acPatch);
                    _logger.LogInformation("✅ ADT Device updated");
                }
                catch (Exception ex) { _logger.LogError(ex, "❌ ADT Device update failed"); }
            }

            // B. Cập nhật Room Policy (Override Flag)
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
                await _iotc.UpdateAcAsync(deviceId, payload.PowerState, payload.Mode, payload.FanSpeed, payload.TargetTemperature);
            }

            // D. Trả về state mới
            var state = await BuildAcStateAsync(roomId, deviceId);
            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(state);
            return res;
        }

        [Function("GetAcState")]
        public async Task<HttpResponseData> GetAcState(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "rooms/{roomId}/devices/{deviceId}/ac-state")]
            HttpRequestData req, string roomId, string deviceId)
        {
            try
            {
                var state = await BuildAcStateAsync(roomId, deviceId);
                var res = req.CreateResponse(HttpStatusCode.OK);
                await res.WriteAsJsonAsync(state);
                return res;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "GetAcState failed");
                return req.CreateResponse(HttpStatusCode.InternalServerError);
            }
        }

        // --- HELPERS ---

        // FIX: Hàm lấy TimeZone an toàn cho cả Windows và Linux
        private static TimeZoneInfo GetVietnamTimeZone()
        {
            try { return TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"); } // Linux/macOS
            catch { return TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time"); } // Windows
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

        private async Task<object> BuildAcStateAsync(string roomId, string deviceId)
        {
            // FIX: Dùng hàm helper an toàn
            var tz = GetVietnamTimeZone();
            
            var acResp = await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(deviceId);
            var roomResp = await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(roomId);
            
            var ac = acResp.Value;
            var room = roomResp.Value;

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
            {
                overrideActive = false;
            }

            string expiresLocalFormatted = "";
            if (expiresOn.HasValue)
            {
                expiresLocalFormatted = TimeZoneInfo.ConvertTime(expiresOn.Value, tz).ToString("HH:mm dd/MM/yyyy");
            }

            var c = ac.Contents;
            return new
            {
                roomId,
                deviceId,
                powerState = c.TryGetValue("powerState", out var p) && p is JsonElement pe && pe.GetBoolean(),
                mode = c.TryGetValue("mode", out var m) ? m.ToString() : "cool",
                fanSpeed = c.TryGetValue("fanSpeed", out var f) ? f.ToString() : "auto",
                targetTemperature = c.TryGetValue("setpointTemperature", out var t) && t is JsonElement te ? te.GetDouble() : 24,
                currentTemperature = c.TryGetValue("currentTemperature", out var ct) && ct is JsonElement cte ? cte.GetDouble() : 0,
                
                overrideActive,
                overrideExpiresOnLocalFormatted = expiresLocalFormatted,
                lastUpdatedBy,
                controlMode = overrideActive ? "manual-override" : "auto-schedule"
            };
        }
    }
}