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

        public ACManualControl(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<ACManualControl>();

            var adtUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
            if (string.IsNullOrWhiteSpace(adtUrl))
                throw new InvalidOperationException("Missing ADT_SERVICE_URL.");

            _adt = new DigitalTwinsClient(new Uri(adtUrl), new DefaultAzureCredential());
        }

        // Body gửi từ UI
        public class AcControlRequest
        {
            public bool? PowerState { get; set; }
            public string? Mode { get; set; }              // cool / eco
            public string? FanSpeed { get; set; }          // auto / low / medium / high
            public double? TargetTemperature { get; set; } // °C
            public string? User { get; set; }              // "Bang" / "UI" ...
        }

        [Function("ACManualControl")]
        public async Task<HttpResponseData> Run(
            [HttpTrigger(
                AuthorizationLevel.Function,
                "post",
                Route = "rooms/{roomId}/devices/{deviceId}/ac-control")]
            HttpRequestData req,
            string roomId,
            string deviceId)
        {
            _logger.LogInformation("ACManualControl called for room {roomId}, device {deviceId}",
                roomId, deviceId);

            // Đọc body JSON
            string bodyString = await req.ReadAsStringAsync();
            var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

            AcControlRequest? payload;
            try
            {
                payload = JsonSerializer.Deserialize<AcControlRequest>(bodyString, options);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to deserialize AC control payload. Body: {body}", bodyString);
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Invalid JSON body");
                return bad;
            }

            if (payload == null)
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("Missing payload");
                return bad;
            }

            // 1️⃣ Patch AC twin
            var acPatch = new JsonPatchDocument();
            bool hasAcOps = false;

            if (payload.PowerState.HasValue)
            {
                acPatch.AppendReplace("/powerState", payload.PowerState.Value);
                hasAcOps = true;
            }

            if (!string.IsNullOrEmpty(payload.Mode))
            {
                acPatch.AppendReplace("/mode", payload.Mode);
                hasAcOps = true;
            }

            if (!string.IsNullOrEmpty(payload.FanSpeed))
            {
                acPatch.AppendReplace("/fanSpeed", payload.FanSpeed);
                hasAcOps = true;
            }

            if (payload.TargetTemperature.HasValue)
            {
                acPatch.AppendReplace("/setpointTemperature", payload.TargetTemperature.Value);
                hasAcOps = true;
            }

            if (hasAcOps)
            {
                try
                {
                    await _adt.UpdateDigitalTwinAsync(deviceId, acPatch);
                    _logger.LogInformation("Patched AC twin {deviceId}.", deviceId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to patch AC twin {deviceId}", deviceId);
                    var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                    await err.WriteStringAsync("Failed to patch AC twin");
                    return err;
                }
            }

            // 2️⃣ Bật override cho room.policy trong 60 phút
            var expiresOn = DateTime.UtcNow.AddMinutes(60);

            var policyPatch = new JsonPatchDocument();
            policyPatch.AppendReplace("/policy/overrideActive", true);
            policyPatch.AppendReplace("/policy/overrideExpiresOn", expiresOn);
            policyPatch.AppendReplace("/policy/lastUpdatedBy",
                string.IsNullOrEmpty(payload.User) ? "GreenTwinUI" : payload.User);

            try
            {
                await _adt.UpdateDigitalTwinAsync(roomId, policyPatch);
                _logger.LogInformation("Set overrideActive for room {roomId} until {expiresOn:o}",
                    roomId, expiresOn);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to patch policy for room {roomId}", roomId);
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteStringAsync("Failed to patch room policy");
                return err;
            }

            // 3️⃣ Trả OK
            var ok = req.CreateResponse(HttpStatusCode.OK);
            await ok.WriteStringAsync($"OK – override until {expiresOn:o}");
            return ok;
        }
    }
}
