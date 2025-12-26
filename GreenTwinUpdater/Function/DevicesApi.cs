using System;
using System.Collections.Generic;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace GreenTwinUpdater.Function
{
    public class DevicesApi
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adt;

        public DevicesApi(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<DevicesApi>();

            var adtUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
            if (string.IsNullOrWhiteSpace(adtUrl))
                throw new InvalidOperationException("Missing ADT_SERVICE_URL.");

            _adt = new DigitalTwinsClient(new Uri(adtUrl), new DefaultAzureCredential());
        }

        // GET /api/rooms/{roomId}/devices
        [Function("GetDevicesForRoom")]
        public async Task<HttpResponseData> GetDevicesForRoom(
            [HttpTrigger(AuthorizationLevel.Function, "get",
                Route = "rooms/{roomId}/devices")]
            HttpRequestData req,
            string roomId,
            FunctionContext ctx,
            CancellationToken ct)
        {
            var log = ctx.GetLogger("GetDevicesForRoom");

            if (string.IsNullOrWhiteSpace(roomId))
            {
                var bad = req.CreateResponse(HttpStatusCode.BadRequest);
                await bad.WriteStringAsync("roomId is required");
                return bad;
            }

            var devices = new List<object>();

            // Lấy sẵn id / modelId / name để JSON gọn, tránh nested object khó parse
            string query = @$"
SELECT
  device.$dtId        AS id,
  device.$metadata.$model AS modelId,
  device.name         AS name
FROM DIGITALTWINS room
JOIN device RELATED room.hasDevice
WHERE room.$dtId = '{roomId}'";

            await foreach (JsonElement row in _adt.QueryAsync<JsonElement>(query, cancellationToken: ct))
            {
                // row kiểu { "id": "...", "modelId": "...", "name": "..." }
                string id = row.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String
                    ? idEl.GetString() ?? string.Empty
                    : string.Empty;

                string modelId = row.TryGetProperty("modelId", out var modelEl) && modelEl.ValueKind == JsonValueKind.String
                    ? modelEl.GetString() ?? string.Empty
                    : string.Empty;

                string name = row.TryGetProperty("name", out var nameEl) && nameEl.ValueKind == JsonValueKind.String
                    ? nameEl.GetString() ?? id
                    : id;

                string type = MapDeviceType(modelId);

                devices.Add(new
                {
                    id,
                    name,
                    type,
                    roomId,
                    roomName = roomId,
                    status = "online"
                });
            }

            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(devices);
            return res;
        }

        private static string MapDeviceType(string modelId)
{
    if (string.IsNullOrEmpty(modelId)) return "device";

    var id = modelId.ToLowerInvariant();

    // Actuators
    if (id.Contains("acunit")) return "ac";
    if (id.Contains("lightswitch")) return "light";

    // Sensors (bao gồm lightsensor)
    if (id.Contains("lightsensor") || id.Contains("lux")) return "sensor";
    if (id.Contains("temperaturesensor") || id.Contains("humiditysensor") || id.Contains("motionsensor"))
        return "sensor";

    if (id.Contains("energymeter")) return "energy";

    return "device";
}

    }
}
