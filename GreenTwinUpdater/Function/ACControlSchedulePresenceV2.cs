using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Azure;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace GreenTwinUpdater.Function
{
    public class ACControlSchedulePresenceV2
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adt;

        public ACControlSchedulePresenceV2(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<ACControlSchedulePresenceV2>();

            var adtUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
            if (string.IsNullOrWhiteSpace(adtUrl))
                throw new InvalidOperationException("Missing ADT_SERVICE_URL.");

            _adt = new DigitalTwinsClient(new Uri(adtUrl), new DefaultAzureCredential());
        }

        [Function("ACControlSchedulePresenceV2")]
        public async Task RunAsync([TimerTrigger("0 * * * * *")] TimerInfo timer, FunctionContext ctx, CancellationToken ct = default)
        {
            var nowUtc = DateTimeOffset.UtcNow;

            // Mặc định Windows time zone; thử Linux/macOS
            TimeZoneInfo tz;
            try { tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh"); }
            catch { tz = TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time"); }

            var nowLocal = TimeZoneInfo.ConvertTime(nowUtc, tz);
            string weekdayToken = nowLocal.DayOfWeek switch
            {
                DayOfWeek.Monday => "MON",
                DayOfWeek.Tuesday => "TUE",
                DayOfWeek.Wednesday => "WED",
                DayOfWeek.Thursday => "THU",
                DayOfWeek.Friday => "FRI",
                DayOfWeek.Saturday => "SAT",
                DayOfWeek.Sunday => "SUN",
                _ => "MON"
            };

            _logger.LogInformation("=== ACControlSchedulePresenceV2 @ {local}", nowLocal);

            // 1) Truy vấn CHỈ lấy $dtId, hỗ trợ Room;3 (và giữ ;2, ;1 để tương thích)
            string qRooms =
                "SELECT t.$dtId AS twinId FROM DIGITALTWINS t " +
                "WHERE IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;3') " +
                "   OR IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;2') " +
                "   OR IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;1')";

            // 2) Duyệt kết quả dạng JsonElement, rút twinId rồi GetDigitalTwin
            await foreach (var row in _adt.QueryAsync<System.Text.Json.JsonElement>(qRooms, ct))
            {
                try
                {
                    if (!row.TryGetProperty("twinId", out var idProp)) continue;
                    var twinId = idProp.GetString();
                    if (string.IsNullOrWhiteSpace(twinId)) continue;

                    var roomResp = await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(twinId!, ct);
                    var room = roomResp.Value;

                    _logger.LogInformation("--- Room: {id}", room.Id);
                    await ProcessRoomAsync(room, nowUtc, nowLocal, tz, weekdayToken, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing a room row from query.");
                }
            }


            _logger.LogInformation("=== Done");
        }

        private async Task ProcessRoomAsync(
            BasicDigitalTwin room,
            DateTimeOffset nowUtc, DateTimeOffset nowLocal, TimeZoneInfo tz, string weekdayToken,
            CancellationToken ct)
        {
            _logger.LogInformation("--- Room: {id}", room.Id);

            // Đọc component policy & metrics (nằm trong Contents dạng JsonElement)
            var policyComp = TryGetComponent(room, "policy");
            var metricsComp = TryGetComponent(room, "metrics");

            bool scheduleEnabled = policyComp.TryGetBool("scheduleEnabled");
            bool allowManualOverride = policyComp.TryGetBool("allowManualOverride");
            bool overrideActive = policyComp.TryGetBool("overrideActive");
            var overrideExpiresOn = policyComp.TryGetDateTimeOffset("overrideExpiresOn");
            int presenceTimeoutMinutes = policyComp.TryGetInt("presenceTimeoutMinutes") ?? 0;

            var lastMotionUtc = metricsComp.TryGetDateTimeOffset("lastMotionUtc");

            // Ưu tiên override
            if (allowManualOverride && overrideActive && overrideExpiresOn.HasValue && nowUtc < overrideExpiresOn.Value)
            {
                _logger.LogInformation("Room {id}: manual override active until {exp}. Skip.", room.Id, overrideExpiresOn);
                return;
            }

            // Tìm schedule active qua relationship hasSchedule
            var activeSchedule = await FindActiveScheduleViaRelationsAsync(room.Id, weekdayToken, nowLocal, ct);

            bool withinSchedule = scheduleEnabled && activeSchedule.within;
            TimeSpan? grace = presenceTimeoutMinutes > 0 ? TimeSpan.FromMinutes(presenceTimeoutMinutes) : (TimeSpan?)null;

            // motionRecent = có motion trong vòng presenceTimeoutMinutes qua metrics.lastMotionUtc
            bool motionRecent = false;
            if (lastMotionUtc.HasValue && grace.HasValue)
            {
                var lastMotionLocal = TimeZoneInfo.ConvertTime(lastMotionUtc.Value, tz);
                motionRecent = (nowLocal - lastMotionLocal) < grace.Value;
            }

            bool shouldPowerOn = false;

            if (withinSchedule)
            {
                // Grace đầu giờ: bật ngay cả khi chưa có motion
                bool withinStartGrace = false;
                if (grace.HasValue && activeSchedule.startLocal.HasValue)
                {
                    var s = activeSchedule.startLocal.Value;
                    withinStartGrace = nowLocal >= s && (nowLocal - s) < grace.Value;
                }

                if (withinStartGrace)
                    shouldPowerOn = true;
                else
                    shouldPowerOn = motionRecent; // qua grace → cần motion gần đây
            }
            else
            {
                shouldPowerOn = false;
            }

            // Lấy AC của phòng qua quan hệ hasDevice
            var acTwins = await GetDevicesViaRelationsAsync(
                room.Id,
                new[] { "dtmi:com:smartbuilding:ACUnit;2", "dtmi:com:smartbuilding:ACUnit;1" },
                ct);

            foreach (var ac in acTwins)
            {
                bool currentPower = GetBool(ac.Contents, "powerState") ?? false;
                if (currentPower != shouldPowerOn)
                {
                    _logger.LogInformation("Room {room} / AC {ac}: power {old} -> {nw}",
                        room.Id, ac.Id, currentPower, shouldPowerOn);

                    var patch = new JsonPatchDocument();
                    patch.AppendReplace("/powerState", shouldPowerOn); // <= dùng AppendReplace (đúng SDK)

                    try
                    {
                        await _adt.UpdateDigitalTwinAsync(ac.Id, patch, cancellationToken: ct);
                    }
                    catch (RequestFailedException ex) when (ex.Status == 412)
                    {
                        _logger.LogWarning("ETag conflict when patching {ac}: {msg}", ac.Id, ex.Message);
                    }
                }
            }
        }

        private async Task<(bool within, DateTimeOffset? startLocal, DateTimeOffset? endLocal)>
            FindActiveScheduleViaRelationsAsync(string roomId, string weekdayToken, DateTimeOffset nowLocal, CancellationToken ct)
        {
            // Đọc quan hệ hasSchedule
            var active = (within: false, startLocal: (DateTimeOffset?)null, endLocal: (DateTimeOffset?)null);

            await foreach (var rel in _adt.GetRelationshipsAsync<BasicRelationship>(roomId, "hasSchedule", ct))
            {
                var schedId = rel.TargetId;
                try
                {
                    var resp = await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(schedId, ct);
                    var s = resp.Value;

                    bool isEnabled = GetBool(s.Contents, "isEnabled") ?? false;
                    if (!isEnabled) continue;

                    string wd = GetString(s.Contents, "weekdays") ?? "";
                    if (!string.Equals(wd, weekdayToken, StringComparison.OrdinalIgnoreCase)) continue;

                    // startTime / endTime là DTDL 'time' (chuỗi "HH:MM:SS")
                    var startTs = GetTimeAsTimeSpan(s.Contents, "startTime");
                    var endTs = GetTimeAsTimeSpan(s.Contents, "endTime");
                    if (!startTs.HasValue || !endTs.HasValue) continue;

                    var startLocal = new DateTimeOffset(
                        nowLocal.Year, nowLocal.Month, nowLocal.Day,
                        startTs.Value.Hours, startTs.Value.Minutes, startTs.Value.Seconds, nowLocal.Offset);

                    var endLocal = new DateTimeOffset(
                        nowLocal.Year, nowLocal.Month, nowLocal.Day,
                        endTs.Value.Hours, endTs.Value.Minutes, endTs.Value.Seconds, nowLocal.Offset);

                    bool within = nowLocal >= startLocal && nowLocal < endLocal;
                    if (within)
                        return (true, startLocal, endLocal);
                }
                catch { /* ignore schedule lỗi đơn lẻ */ }
            }

            return active;
        }

        private async Task<List<BasicDigitalTwin>> GetDevicesViaRelationsAsync(
            string roomId,
            IEnumerable<string> modelIds,
            CancellationToken ct)
        {
            var list = new List<BasicDigitalTwin>();

            await foreach (var rel in _adt.GetRelationshipsAsync<BasicRelationship>(roomId, "hasDevice", ct))
            {
                var devId = rel.TargetId;
                try
                {
                    var resp = await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(devId, ct);
                    var dev = resp.Value;

                    // Lọc theo model
                    string? model = dev.Metadata?.ModelId;
                    if (model != null && modelIds.Contains(model))
                        list.Add(dev);
                }
                catch { /* bỏ qua twin lỗi đơn lẻ */ }
            }

            return list;
        }

        // ------------ Helpers: Component ------------
        private static ComponentReader TryGetComponent(BasicDigitalTwin twin, string name)
        {
            if (twin.Contents != null &&
                twin.Contents.TryGetValue(name, out var obj) &&
                obj is JsonElement el && el.ValueKind == JsonValueKind.Object)
            {
                return new ComponentReader(el);
            }
            return new ComponentReader(null);
        }

        private readonly struct ComponentReader
        {
            private readonly JsonElement? _el;
            public ComponentReader(JsonElement? el) { _el = el; }

            public bool TryGetBool(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v))
                {
                    if (v.ValueKind == JsonValueKind.True || v.ValueKind == JsonValueKind.False)
                        return v.GetBoolean();
                }
                return false;
            }

            public int? TryGetInt(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number)
                    if (v.TryGetInt32(out var i)) return i;
                return null;
            }

            public DateTimeOffset? TryGetDateTimeOffset(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String)
                {
                    if (DateTimeOffset.TryParse(v.GetString(), out var dt)) return dt;
                }
                return null;
            }
        }

        // ------------ Helpers: IDictionary<string, object> ------------
        private static string? GetString(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is string s) return s;
            if (obj is JsonElement el && el.ValueKind == JsonValueKind.String) return el.GetString();
            return null;
        }

        private static bool? GetBool(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is bool b) return b;
            if (obj is JsonElement el)
            {
                if (el.ValueKind == JsonValueKind.True || el.ValueKind == JsonValueKind.False)
                    return el.GetBoolean();
            }
            return null;
        }

        private static int? GetInt(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is int i) return i;
            if (obj is JsonElement el && el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var ii)) return ii;
            return null;
        }

        private static DateTimeOffset? GetDateTimeOffset(IDictionary<string, object>? dict, string key)
        {
            var s = GetString(dict, key);
            if (s != null && DateTimeOffset.TryParse(s, out var dt)) return dt;
            return null;
        }

        private static TimeSpan? GetTimeAsTimeSpan(IDictionary<string, object>? dict, string key)
        {
            var s = GetString(dict, key);
            if (s != null && TimeSpan.TryParse(s, out var ts)) return ts;
            return null;
        }
    }
}
