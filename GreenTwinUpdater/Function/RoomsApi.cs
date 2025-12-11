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

            try
            {
                // 1️⃣ Query tất cả Room
                string roomQuery =
                    "SELECT * FROM DIGITALTWINS room WHERE " +
                    "IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;7') OR " +
                    "IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;8') OR " +
                    "IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;9') OR " +
                    "IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;10') OR " +
                    "IS_OF_MODEL(room, 'dtmi:com:smartbuilding:Room;11')";

                await foreach (BasicDigitalTwin twin in _adt.QueryAsync<BasicDigitalTwin>(roomQuery, ct))
                {
                    try
                    {
                        var contents = twin.Contents;

                        // ===== BASIC INFO =====
                        string name =
                            GetString(contents, "name") ??
                            GetString(contents, "roomNumber") ??
                            twin.Id;

                        // ===== FLOOR & BUILDING (SAFE QUERIES) =====
                        string floorName = "Unknown";
                        string buildingName = "Unknown";

                        var floorId = await GetFloorIdOfRoomAsync(twin.Id, ct);
                        if (!string.IsNullOrEmpty(floorId))
                        {
                            floorName = await GetTwinNameAsync(floorId, ct) ?? floorId;

                            var buildingId = await GetBuildingIdOfFloorAsync(floorId, ct);
                            if (!string.IsNullOrEmpty(buildingId))
                            {
                                buildingName = await GetTwinNameAsync(buildingId, ct) ?? buildingId;
                            }
                        }

                        // ===== TARGETS =====
                        double? targetTemp = GetDouble(contents, "targetTemperature");
                        double? targetLux = GetDouble(contents, "targetLux");

                        // ===== METRICS =====
                        double? currentTemp = null;
                        double? currentLux = null;
                        double? currentHumidity = null;
                        double? currentPowerW = null;
                        double? currentEnergyKWh = null;
                        string? lastMotionUtc = null;

                        if (contents.TryGetValue("metrics", out var metricsRaw) && metricsRaw is not null)
                        {
                            if (metricsRaw is JsonElement je && je.ValueKind == JsonValueKind.Object)
                            {
                                currentTemp = GetDoubleFromJson(je, "currentTemperature");
                                currentLux = GetDoubleFromJson(je, "currentIlluminance");
                                currentHumidity = GetDoubleFromJson(je, "currentHumidity");
                                currentPowerW = GetDoubleFromJson(je, "currentPowerW");
                                currentEnergyKWh = GetDoubleFromJson(je, "currentEnergyKWh");
                                lastMotionUtc = GetStringFromJson(je, "lastMotionUtc");
                            }
                            else if (metricsRaw is BasicDigitalTwinComponent comp)
                            {
                                currentTemp = GetDouble(comp.Contents, "currentTemperature");
                                currentLux = GetDouble(comp.Contents, "currentIlluminance");
                                currentHumidity = GetDouble(comp.Contents, "currentHumidity");
                                currentPowerW = GetDouble(comp.Contents, "currentPowerW");
                                currentEnergyKWh = GetDouble(comp.Contents, "currentEnergyKWh");
                                lastMotionUtc = GetString(comp.Contents, "lastMotionUtc");
                            }
                        }

                        // ===== SCHEDULE =====
                        var scheduleStatus = await GetRoomScheduleStatusAsync(twin.Id, ct);

                        // ===== RESPONSE =====
                        rooms.Add(new
                        {
                            id = twin.Id,
                            name,
                            building = buildingName,
                            floor = floorName,

                            targetTemperature = Round(targetTemp),
                            targetLux = Round(targetLux),

                            currentTemperature = Round(currentTemp),
                            currentIlluminance = Round(currentLux),
                            lastMotionUtc,

                            currentHumidity = Round(currentHumidity),
                            currentPowerW = Round(currentPowerW),
                            currentEnergyKWh = Round(currentEnergyKWh),
                            motionDetected = lastMotionUtc != null,

                            inClass = scheduleStatus.InClass,
                            courseName = scheduleStatus.Course,
                            lecturerName = scheduleStatus.Lecturer,
                            nextClass = scheduleStatus.NextClass
                        });
                    }
                    catch (Exception exInner)
                    {
                        _logger.LogError(exInner, "Error processing room {RoomId}", twin.Id);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "CRITICAL ERROR in GetRooms");
                var err = req.CreateResponse(HttpStatusCode.InternalServerError);
                await err.WriteStringAsync(ex.Message);
                return err;
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

            // Xử lý JsonElement (quan trọng khi query trả về)
            if (value is JsonElement je)
            {
                if (je.ValueKind == JsonValueKind.True) return true;
                if (je.ValueKind == JsonValueKind.False) return false;
            }
            if (bool.TryParse(value.ToString(), out var parsed)) return parsed;
            return null;
        }

        private static double? GetDouble(IDictionary<string, object> dict, string key)
        {
            if (!dict.TryGetValue(key, out var value) || value is null) return null;
            if (value is double d) return d;
            if (value is float f) return f;
            if (value is int i) return i;
            if (value is long l) return l; // Power/Energy đôi khi là int/long

            if (value is JsonElement je && je.ValueKind == JsonValueKind.Number)
                return je.TryGetDouble(out var jd) ? jd : null;

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

        // --- Helper tìm kiếm thông minh (Case-Insensitive) ---

        private double? FindValue(IDictionary<string, object> contents, string keyword)
        {
            foreach (var kvp in contents)
            {
                // Nếu tên thuộc tính chứa từ khóa (ví dụ "CurrentHumidity" chứa "humidity")
                if (kvp.Key.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                {
                    // Thử parse giá trị sang double
                    if (kvp.Value is JsonElement je && je.ValueKind == JsonValueKind.Number)
                        return je.GetDouble();

                    if (double.TryParse(kvp.Value?.ToString(), out double val))
                        return val;
                }
            }
            return null;
        }

        private bool? FindBoolValue(IDictionary<string, object> contents, string keyword)
        {
            foreach (var kvp in contents)
            {
                if (kvp.Key.Contains(keyword, StringComparison.OrdinalIgnoreCase))
                {
                    if (kvp.Value is JsonElement je)
                    {
                        if (je.ValueKind == JsonValueKind.True) return true;
                        if (je.ValueKind == JsonValueKind.False) return false;
                    }
                    if (bool.TryParse(kvp.Value?.ToString(), out bool val))
                        return val;
                }
            }
            return null;
        }

        private static double? Round(double? val)
        {
            if (!val.HasValue) return null;
            return Math.Round(val.Value, 1);
        }

        private static string? GetStringFromJson(JsonElement obj, string prop)
        {
            if (!obj.TryGetProperty(prop, out var el)) return null;
            return el.ToString();
        }


        private async Task<(bool InClass, string? Course, string? Lecturer, string? NextClass)> GetRoomScheduleStatusAsync(string roomId, CancellationToken ct)
        {
            string query =
  "SELECT T.$dtId AS sid " +
  "FROM DIGITALTWINS R " +
  "JOIN T RELATED R.hasSchedule " +
  $"WHERE R.$dtId = '{roomId}' " +
  "AND IS_OF_MODEL(T, 'dtmi:com:smartbuilding:Schedule;1') " +
  "AND T.isEnabled = true";

            var scheduleIds = new List<string>();
            await foreach (var row in _adt.QueryAsync<JsonElement>(query, ct))
            {
                if (row.TryGetProperty("sid", out var sidEl))
                {
                    var sid = sidEl.GetString();
                    if (!string.IsNullOrWhiteSpace(sid)) scheduleIds.Add(sid);
                }
            }

            var schedules = new List<BasicDigitalTwin>();
            foreach (var sid in scheduleIds)
            {
                var twin = (await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(sid, ct)).Value;
                schedules.Add(twin);
            }


            // Lấy giờ Việt Nam (UTC+7)
            var nowUtc = DateTimeOffset.UtcNow;
            TimeZoneInfo tz;
            try { tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"); }
            catch { tz = TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time"); }

            var now = TimeZoneInfo.ConvertTime(nowUtc, tz);
            var today = now.Date;

            // 1. Kiểm tra xem CÓ ĐANG HỌC KHÔNG?
            foreach (var s in schedules)
            {
                if (!IsScheduleEffective(s, today)) continue;
                if (!IsScheduleDay(s, now.DayOfWeek)) continue;

                var (start, end) = GetScheduleTime(s, today);
                // Nếu hiện tại nằm trong khung giờ học (có thể +/- 15p nếu muốn logic ân hạn, ở đây lấy chính xác)
                if (now >= start && now < end)
                {
                    string course = GetString(s.Contents, "courseName");
                    string lecturer = GetString(s.Contents, "lecturer");
                    // Nếu lớp bị hủy (tên có chữ Cancel/Nghỉ) -> Không tính là đang học
                    if (course != null && (course.Contains("Nghỉ") || course.Contains("Cancel")))
                    {
                        continue;
                    }
                    return (true, course, lecturer, null);
                }
            }

            // 2. Nếu KHÔNG học, tìm LỚP TIẾP THEO (trong vòng 7 ngày tới)
            // 2. Nếu KHÔNG học, tìm LỚP TIẾP THEO (trong vòng 7 ngày tới)
            for (int i = 0; i < 7; i++)
            {
                var currentDay = today.AddDays(i);

                var candidates = new List<(DateTimeOffset start, string? course, string? lecturer)>();

                foreach (var s in schedules)
                {
                    if (!IsScheduleEffective(s, currentDay)) continue;
                    if (!IsScheduleDay(s, currentDay.DayOfWeek)) continue;

                    var (start, _) = GetScheduleTime(s, currentDay);

                    if (start > now)
                    {
                        candidates.Add((
                            start,
                            GetString(s.Contents, "courseName"),
                            GetString(s.Contents, "lecturer")
                        ));
                    }
                }

                if (candidates.Count > 0)
                {
                    candidates.Sort((a, b) => a.start.CompareTo(b.start));
                    var next = candidates[0];

                    string dayStr = i == 0
                        ? "Hôm nay"
                        : next.start.ToString("dd/MM");

                    return (
                        false,
                        null,
                        null,
                        $"{next.start:HH:mm} ({dayStr}) - {next.course ?? "--"} - {next.lecturer ?? "--"}"
                    );
                }
            }


            return (false, null, null, "--");
        }

        private static bool IsScheduleEffective(BasicDigitalTwin s, DateTime date)
        {
            string fromStr = GetString(s.Contents, "effectiveFrom");
            string toStr = GetString(s.Contents, "effectiveTo");

            if (DateTime.TryParse(fromStr, out var from) && date < from) return false;
            if (DateTime.TryParse(toStr, out var to) && date > to) return false;
            return true;
        }

        private static bool IsScheduleDay(BasicDigitalTwin s, DayOfWeek dow)
        {
            if (!s.Contents.TryGetValue("weekdays", out var v) || v is null) return false;

            string token = dow switch
            {
                DayOfWeek.Monday => "MON",
                DayOfWeek.Tuesday => "TUE",
                DayOfWeek.Wednesday => "WED",
                DayOfWeek.Thursday => "THU",
                DayOfWeek.Friday => "FRI",
                DayOfWeek.Saturday => "SAT",
                DayOfWeek.Sunday => "SUN",
                _ => ""
            };

            // v có thể là string / JsonElement
            if (v is string str)
            {
                // hỗ trợ cả "MON" và "MON,WED,FRI"
                return str.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                          .Any(x => x.Equals(token, StringComparison.OrdinalIgnoreCase));
            }

            if (v is JsonElement je)
            {
                if (je.ValueKind == JsonValueKind.String)
                {
                    var str2 = je.GetString() ?? "";
                    return str2.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                               .Any(x => x.Equals(token, StringComparison.OrdinalIgnoreCase));
                }

                if (je.ValueKind == JsonValueKind.Array)
                {
                    foreach (var item in je.EnumerateArray())
                        if (item.ValueKind == JsonValueKind.String &&
                            string.Equals(item.GetString(), token, StringComparison.OrdinalIgnoreCase))
                            return true;
                }
            }

            return false;
        }

        private static (DateTimeOffset start, DateTimeOffset end) GetScheduleTime(BasicDigitalTwin s, DateTime baseDate)
        {
            // Mặc định múi giờ +7
            TimeSpan offset = TimeSpan.FromHours(7);

            string sStr = GetString(s.Contents, "startTime") ?? "00:00";
            string eStr = GetString(s.Contents, "endTime") ?? "00:00";

            TimeSpan.TryParse(sStr, out var tsStart);
            TimeSpan.TryParse(eStr, out var tsEnd);

            var start = new DateTimeOffset(baseDate.Year, baseDate.Month, baseDate.Day, tsStart.Hours, tsStart.Minutes, 0, offset);
            var end = new DateTimeOffset(baseDate.Year, baseDate.Month, baseDate.Day, tsEnd.Hours, tsEnd.Minutes, 0, offset);

            return (start, end);
        }

        private async Task<string?> GetFloorIdOfRoomAsync(string roomId, CancellationToken ct)
        {
            string q =
                "SELECT f.$dtId AS fid " +
                "FROM DIGITALTWINS f " +
                "JOIN r RELATED f.hasRoom " +
                $"WHERE r.$dtId = '{roomId}'";

            await foreach (var row in _adt.QueryAsync<JsonElement>(q, ct))
            {
                if (row.TryGetProperty("fid", out var el))
                    return el.GetString();
            }
            return null;
        }

        private async Task<string?> GetBuildingIdOfFloorAsync(string floorId, CancellationToken ct)
        {
            string q =
                "SELECT b.$dtId AS bid " +
                "FROM DIGITALTWINS b " +
                "JOIN f RELATED b.hasFloor " +
                $"WHERE f.$dtId = '{floorId}'";

            await foreach (var row in _adt.QueryAsync<JsonElement>(q, ct))
            {
                if (row.TryGetProperty("bid", out var el))
                    return el.GetString();
            }
            return null;
        }

        private async Task<string?> GetTwinNameAsync(string twinId, CancellationToken ct)
        {
            try
            {
                var twin = (await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(twinId, ct)).Value;
                return GetString(twin.Contents, "name");
            }
            catch
            {
                return null;
            }
        }

    }
}