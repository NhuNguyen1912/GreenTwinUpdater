using System;
using System.Collections.Generic;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure;
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

        // ==========================================
        // 1. GET ROOMS
        // ==========================================
        [Function("GetRooms")]
        public async Task<HttpResponseData> GetRooms(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "rooms")]
            HttpRequestData req,
            FunctionContext ctx,
            CancellationToken ct)
        {
            var rooms = new List<object>();
            string query =
                "SELECT * FROM DIGITALTWINS room " +
                "WHERE IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;5') " +
                "OR IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;4') " +
                "OR IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;3') " +
                "OR IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;2') " +
                "OR IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;1')";

            await foreach (BasicDigitalTwin twin in _adt.QueryAsync<BasicDigitalTwin>(query, cancellationToken: ct))
            {
                var contents = twin.Contents;
                string name = GetString(contents, "name") ?? GetString(contents, "roomNumber") ?? twin.Id;
                string building = GetString(contents, "building") ?? "Unknown";
                string floor = GetString(contents, "floor") ?? "1";

                double? targetTemp = GetDouble(contents, "targetTemperature");
                double? targetLux = GetDouble(contents, "targetLux");
                double? currentTemp = null;
                double? currentLux = null;
                double? energy = null;
                bool inClass = false;

                if (contents.TryGetValue("metrics", out var metricsRaw) && metricsRaw is not null)
                {
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

        // ==========================================
        // 2. CREATE SCHEDULE
        // ==========================================
        [Function("CreateSchedule")]
        public async Task<HttpResponseData> CreateSchedule(
            [HttpTrigger(AuthorizationLevel.Function, "post", Route = "rooms/{roomId}/schedules")]
            HttpRequestData req,
            string roomId)
        {
            _logger.LogInformation("Creating schedule for room {roomId}", roomId);
            string body = await req.ReadAsStringAsync();
            var payload = JsonSerializer.Deserialize<ScheduleRequest>(body, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (payload == null) return req.CreateResponse(HttpStatusCode.BadRequest);

            long timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            string scheduleId = $"Sched_{roomId}_{timestamp}";

            var scheduleTwin = new BasicDigitalTwin
            {
                Id = scheduleId,
                Metadata = { ModelId = "dtmi:com:smartbuilding:Schedule;1" },
                Contents =
                {
                    { "courseName", payload.CourseName },
                    { "lecturer", payload.Lecturer },
                    { "startTime", payload.StartTime },
                    { "endTime", payload.EndTime },
                    { "effectiveFrom", payload.EffectiveFrom },
                    { "effectiveTo", payload.EffectiveTo },
                    { "weekdays", string.Join(",", payload.Weekdays ?? Array.Empty<string>()) },
                    { "isEnabled", true }
                }
            };

            try
            {
                await _adt.CreateOrReplaceDigitalTwinAsync<BasicDigitalTwin>(scheduleId, scheduleTwin);
            }
            catch (RequestFailedException ex)
            {
                _logger.LogError(ex, "Failed to create schedule twin {id}", scheduleId);
                return req.CreateResponse(HttpStatusCode.InternalServerError);
            }

            string relId = $"Rel_{roomId}_{scheduleId}";
            var rel = new BasicRelationship
            {
                TargetId = scheduleId,
                Name = "hasSchedule",
                Id = relId
            };

            try
            {
                await _adt.CreateOrReplaceRelationshipAsync(roomId, relId, rel);
            }
            catch (RequestFailedException ex)
            {
                _logger.LogError(ex, "Failed to create relationship for schedule {id}", scheduleId);
                await _adt.DeleteDigitalTwinAsync(scheduleId);
                return req.CreateResponse(HttpStatusCode.InternalServerError);
            }

            var response = req.CreateResponse(HttpStatusCode.OK);
            await response.WriteAsJsonAsync(new
            {
                id = scheduleId,
                roomId,
                payload.CourseName,
                payload.Lecturer,
                payload.Weekdays,
                payload.StartTime,
                payload.EndTime,
                payload.EffectiveFrom,
                payload.EffectiveTo,
                enabled = true
            });
            return response;
        }

        // ==========================================
        // 3. GET SCHEDULES (Code cũ của bạn + isException)
        // ==========================================
        [Function("GetSchedules")]
        public async Task<HttpResponseData> GetSchedules(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "schedules")]
            HttpRequestData req)
        {
            var list = new List<object>();
            _logger.LogInformation("Getting all schedules...");

            try
            {
                // 1. Lấy tất cả Schedule Twins
                string querySchedule = "SELECT * FROM DIGITALTWINS WHERE IS_OF_MODEL('dtmi:com:smartbuilding:Schedule;1')";

                var schedules = new List<BasicDigitalTwin>();
                await foreach (BasicDigitalTwin s in _adt.QueryAsync<BasicDigitalTwin>(querySchedule))
                {
                    schedules.Add(s);
                }
                _logger.LogInformation($"Found {schedules.Count} schedule twins.");

                // 2. Duyệt qua từng schedule
                foreach (var s in schedules)
                {
                    string roomId = "Unknown";
                    string roomName = "Unknown Room";

                    var parts = s.Id.Split('_');
                    
                    if (parts.Length >= 2)
                    {
                        roomId = parts[1]; // Lấy được "A001" ngay lập tức
                        roomName = roomId; // Tạm thời gán roomName là ID (hoặc query nhẹ nếu cần thiết)
                    }

                    // string queryRoom = $"SELECT r FROM DIGITALTWINS r JOIN s RELATED r.hasSchedule WHERE s.$dtId = '{s.Id}'";

                    // await foreach (BasicDigitalTwin r in _adt.QueryAsync<BasicDigitalTwin>(queryRoom))
                    // {
                    //     roomId = r.Id;
                    //     if (r.Contents.TryGetValue("name", out var n) && n is JsonElement ne) roomName = ne.ToString();
                    //     else if (r.Contents.TryGetValue("roomNumber", out var rn) && rn is JsonElement rne) roomName = rne.ToString();
                    //     else roomName = r.Id;
                    //     break; 
                    // }

                    // Parse dữ liệu (giữ nguyên cách parse của bạn)
                    var contents = s.Contents;
                    string wdRaw = "";
                    if (contents.TryGetValue("weekdays", out var w) && w is JsonElement we) wdRaw = we.ToString();
                    var weekdays = wdRaw.Split(',', StringSplitOptions.RemoveEmptyEntries);

                    string courseName = "";
                    if (contents.TryGetValue("courseName", out var c) && c is JsonElement ce) courseName = ce.ToString();

                    string lecturer = "";
                    if (contents.TryGetValue("lecturer", out var l) && l is JsonElement le) lecturer = le.ToString();

                    string startTime = "";
                    if (contents.TryGetValue("startTime", out var st) && st is JsonElement ste) startTime = ste.ToString();

                    string endTime = "";
                    if (contents.TryGetValue("endTime", out var et) && et is JsonElement ete) endTime = ete.ToString();

                    string effFrom = "";
                    if (contents.TryGetValue("effectiveFrom", out var ef) && ef is JsonElement efe) effFrom = efe.ToString();

                    string effTo = "";
                    if (contents.TryGetValue("effectiveTo", out var eto) && eto is JsonElement etoe) effTo = etoe.ToString();

                    bool enabled = true;
                    if (contents.TryGetValue("isEnabled", out var en) && en is JsonElement ene && ene.ValueKind == JsonValueKind.False) enabled = false;

                    // --- MỚI: Logic tính isException ---
                    bool isException = false;
                    if (!string.IsNullOrEmpty(effFrom) && !string.IsNullOrEmpty(effTo) && effFrom == effTo)
                    {
                        isException = true;
                    }
                    // -----------------------------------

                    list.Add(new
                    {
                        id = s.Id,
                        roomId = roomId,
                        roomName = roomName,
                        courseName,
                        lecturer,
                        startTime,
                        endTime,
                        effectiveFrom = effFrom,
                        effectiveTo = effTo,
                        weekdays,
                        enabled,
                        isException = isException // <-- Thêm thuộc tính này vào kết quả trả về
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Query schedules failed");
                return req.CreateResponse(HttpStatusCode.InternalServerError);
            }

            var res = req.CreateResponse(HttpStatusCode.OK);
            await res.WriteAsJsonAsync(list);
            return res;
        }

        // ==========================================
        // 4. DELETE SCHEDULE (Giữ nguyên logic an toàn)
        // ==========================================
        [Function("DeleteSchedule")]
        public async Task<HttpResponseData> DeleteSchedule(
            [HttpTrigger(AuthorizationLevel.Function, "delete", Route = "schedules/{id}")]
            HttpRequestData req, string id)
        {
            _logger.LogInformation("Request to delete schedule {id}", id);
            try
            {
                AsyncPageable<IncomingRelationship> incomingRels = _adt.GetIncomingRelationshipsAsync(id);
                await foreach (IncomingRelationship incomingRel in incomingRels)
                {
                    await _adt.DeleteRelationshipAsync(incomingRel.SourceId, incomingRel.RelationshipId);
                }
                AsyncPageable<BasicRelationship> outgoingRels = _adt.GetRelationshipsAsync<BasicRelationship>(id);
                await foreach (BasicRelationship outgoingRel in outgoingRels)
                {
                    await _adt.DeleteRelationshipAsync(id, outgoingRel.Id);
                }
                await _adt.DeleteDigitalTwinAsync(id);
                return req.CreateResponse(HttpStatusCode.OK);
            }
            catch (RequestFailedException ex) when (ex.Status == 404)
            {
                return req.CreateResponse(HttpStatusCode.OK);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to delete schedule {id}", id);
                return req.CreateResponse(HttpStatusCode.InternalServerError);
            }
        }

        // ---------- HELPERS ----------
        // (Giữ nguyên các helper cũ để đảm bảo tương thích)

        private static string? GetString(IDictionary<string, object> dict, string key)
        {
            return dict.TryGetValue(key, out var value) ? value?.ToString() : null;
        }

        private static bool? GetBool(IDictionary<string, object> dict, string key)
        {
            if (!dict.TryGetValue(key, out var value) || value is null) return null;
            if (value is bool b) return b;
            if (bool.TryParse(value.ToString(), out var parsed)) return parsed;
            return null;
        }

        private static double? GetDouble(IDictionary<string, object> dict, string key)
        {
            if (!dict.TryGetValue(key, out var value) || value is null) return null;
            if (value is double d) return d;
            if (value is float f) return f;
            if (value is JsonElement je && je.ValueKind == JsonValueKind.Number && je.TryGetDouble(out var jd)) return jd;
            if (double.TryParse(value.ToString(), out var parsed)) return parsed;
            return null;
        }

        private static double? GetDoubleFromJson(JsonElement obj, string prop)
        {
            if (!obj.TryGetProperty(prop, out var el)) return null;
            if (el.ValueKind != JsonValueKind.Number) return null;
            return el.GetDouble();
        }

        // Class DTO cho CreateSchedule Request (Bắt buộc phải có để deserialize input)
        public class ScheduleRequest
        {
            public string CourseName { get; set; }
            public string Lecturer { get; set; }
            public string[] Weekdays { get; set; }
            public string StartTime { get; set; }
            public string EndTime { get; set; }
            public string EffectiveFrom { get; set; }
            public string EffectiveTo { get; set; }
        }
    }
}