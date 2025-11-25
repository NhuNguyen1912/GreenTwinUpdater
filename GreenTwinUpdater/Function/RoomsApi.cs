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
    public class RoomsApi
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adt;

        public RoomsApi(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<RoomsApi>();

            var adtUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
            if (string.IsNullOrWhiteSpace(adtUrl))
                throw new InvalidOperationException("Missing ADT_SERVICE_URL.");

            _adt = new DigitalTwinsClient(new Uri(adtUrl), new DefaultAzureCredential());
        }

        // GET /api/rooms
        [Function("GetRooms")]
        public async Task<HttpResponseData> GetRooms(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "rooms")]
            HttpRequestData req,
            FunctionContext ctx,
            CancellationToken ct)
        {
            var rooms = new List<object>();

            // 🔹 ĐÚNG model version: Room;5
            string query =
                "SELECT * FROM DIGITALTWINS room " +
                "WHERE IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;5')";

            await foreach (BasicDigitalTwin twin in _adt.QueryAsync<BasicDigitalTwin>(query, cancellationToken: ct))
            {
                var contents = twin.Contents;

                // ----- ĐỌC THUỘC TÍNH TOP-LEVEL CỦA ROOM -----
                // Space;1 thường có "name", Room;5 có "roomNumber"
                string name =
                    GetString(contents, "name") ??
                    GetString(contents, "roomNumber") ??
                    twin.Id;

                string building = GetString(contents, "building") ?? "Unknown";
                string floor = GetString(contents, "floor") ?? "1";

                double? targetTemp = GetDouble(contents, "targetTemperature");
                double? targetLux = GetDouble(contents, "targetLux");

                // ----- ĐỌC COMPONENT metrics -----
                double? currentTemp = null;
                double? currentLux = null;
                double? energy = null;
                bool inClass = false; // tạm để false, sau này bạn tính theo schedule

                if (contents.TryGetValue("metrics", out var metricsRaw) && metricsRaw is not null)
                {
                    // metrics có thể là JsonElement, hoặc BasicDigitalTwinComponent,
                    // hoặc dictionary => handle cả 3 cho chắc
                    if (metricsRaw is JsonElement je && je.ValueKind == JsonValueKind.Object)
                    {
                        currentTemp = GetDoubleFromJson(je, "currentTemperature");
                        currentLux = GetDoubleFromJson(je, "currentIlluminance");
                        energy = GetDoubleFromJson(je, "currentEnergyKWh");
                    }
                    else if (metricsRaw is IDictionary<string, object> dict)
                    {
                        currentTemp = GetDouble(dict, "currentTemperature");
                        currentLux = GetDouble(dict, "currentIlluminance");
                        energy = GetDouble(dict, "currentEnergyKWh");
                    }
                    else if (metricsRaw is BasicDigitalTwinComponent comp)
                    {
                        currentTemp = GetDouble(comp.Contents, "currentTemperature");
                        currentLux = GetDouble(comp.Contents, "currentIlluminance");
                        energy = GetDouble(comp.Contents, "currentEnergyKWh");
                    }
                }

                rooms.Add(new
                {
                    id = twin.Id,
                    name,
                    building,
                    floor,
                    inClass,
                    currentTemperature = currentTemp,
                    targetTemperature = targetTemp,
                    currentIlluminance = currentLux,
                    targetLux = targetLux,
                    currentEnergyKWh = energy
                });
            }

            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(rooms);
            return res;
        }

        // ---------- HELPERS ----------

        private static string? GetString(IDictionary<string, object> dict, string key)
        {
            return dict.TryGetValue(key, out var value) ? value?.ToString() : null;
        }

        private static bool? GetBool(IDictionary<string, object> dict, string key)
        {
            if (!dict.TryGetValue(key, out var value) || value is null)
                return null;
            if (value is bool b) return b;
            if (bool.TryParse(value.ToString(), out var parsed)) return parsed;
            return null;
        }

        private static double? GetDouble(IDictionary<string, object> dict, string key)
        {
            if (!dict.TryGetValue(key, out var value) || value is null)
                return null;

            if (value is double d) return d;
            if (value is float f) return f;
            if (value is JsonElement je && je.ValueKind == JsonValueKind.Number && je.TryGetDouble(out var jd))
                return jd;
            if (double.TryParse(value.ToString(), out var parsed)) return parsed;

            return null;
        }

        private static double? GetDoubleFromJson(JsonElement obj, string prop)
        {
            if (!obj.TryGetProperty(prop, out var el)) return null;
            if (el.ValueKind != JsonValueKind.Number) return null;
            return el.GetDouble();
        }
    }
}
