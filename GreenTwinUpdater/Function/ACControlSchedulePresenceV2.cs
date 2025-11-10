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

        // Thêm hằng số cho logic mới
        private const double DeltaTempThreshold = 3.0;
        private const string ModeCool = "cool";
        private const string ModeEco = "eco";
        private const string FanAuto = "auto";

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

            _logger.LogInformation("=== ACControlSchedulePresenceV2 @ {local} (Weekday: {wd}) ===", nowLocal, weekdayToken);

            // 1) Truy vấn CHỈ lấy $dtId, hỗ trợ Room;3 (và giữ ;2, ;1 để tương thích)
            string qRooms =
                "SELECT t.$dtId AS twinId FROM DIGITALTWINS t " +
                "WHERE IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;3') " +
                "   OR IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;2') " +
                "   OR IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;1')";

            // 2) Duyệt kết quả dạng JsonElement, rút twinId rồi GetDigitalTwin
            await foreach (var row in _adt.QueryAsync<System.Text.Json.JsonElement>(qRooms, ct))
            {
                string? twinId = null;
                try
                {
                    if (!row.TryGetProperty("twinId", out var idProp)) continue;
                    twinId = idProp.GetString();
                    if (string.IsNullOrWhiteSpace(twinId)) continue;

                    var roomResp = await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(twinId!, ct);
                    var room = roomResp.Value;

                    await ProcessRoomAsync(room, nowUtc, nowLocal, tz, weekdayToken, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Error processing room {twinId}", twinId ?? "N/A");
                }
            }


            _logger.LogInformation("=== ACControlSchedulePresenceV2 Done ===");
        }

        private async Task ProcessRoomAsync(
            BasicDigitalTwin room,
            DateTimeOffset nowUtc, DateTimeOffset nowLocal, TimeZoneInfo tz, string weekdayToken,
            CancellationToken ct)
        {
            _logger.LogInformation("--- Processing Room: {id} ---", room.Id);

            // === 1. Đọc Policy, Metrics và Target Temperature ===

            var policyComp = TryGetComponent(room, "policy");
            var metricsComp = TryGetComponent(room, "metrics");

            // Đọc Policy
            bool scheduleEnabled = policyComp.TryGetBool("scheduleEnabled");
            bool allowManualOverride = policyComp.TryGetBool("allowManualOverride");
            bool overrideActive = policyComp.TryGetBool("overrideActive");
            var overrideExpiresOn = policyComp.TryGetDateTimeOffset("overrideExpiresOn");
            int presenceTimeoutMinutes = policyComp.TryGetInt("presenceTimeoutMinutes") ?? 0;

            // Đọc Metrics
            var lastMotionUtc = metricsComp.TryGetDateTimeOffset("lastMotionUtc");
            double? currentTemp = metricsComp.TryGetDouble("currentTemperature"); // MỚI

            // Đọc Property của Room
            double? targetTemp = GetDouble(room.Contents, "targetTemperature"); // MỚI

            _logger.LogInformation(
                "Room {id}: Policy(Schedule={sch}, Override={ovr}), Metrics(LastMotion={lm}, Temp={curT}°C), Target={tarT}°C",
                room.Id, scheduleEnabled, overrideActive, lastMotionUtc?.ToString("o") ?? "N/A",
                currentTemp?.ToString() ?? "N/A", targetTemp?.ToString() ?? "N/A");

            // === 2. Kiểm tra Manual Override ===
            if (allowManualOverride && overrideActive && overrideExpiresOn.HasValue && nowUtc < overrideExpiresOn.Value)
            {
                _logger.LogInformation("Room {id}: Manual override is ACTIVE until {exp}. Skipping automation.", room.Id, overrideExpiresOn);
                return;
            }

            // === 3. Kiểm tra Lịch học (Schedule) ===
            var activeSchedule = await FindActiveScheduleViaRelationsAsync(room.Id, weekdayToken, nowLocal, ct);
            bool withinSchedule = scheduleEnabled && activeSchedule.within;

            _logger.LogInformation("Room {id}: Schedule check: IsEnabled={sch}, IsActiveNow={actv}", room.Id, scheduleEnabled, activeSchedule.within);

            // === 4. Kiểm tra Sự hiện diện (Presence) ===
            TimeSpan? grace = presenceTimeoutMinutes > 0 ? TimeSpan.FromMinutes(presenceTimeoutMinutes) : (TimeSpan?)null;
            bool motionRecent = false;
            if (lastMotionUtc.HasValue && grace.HasValue)
            {
                var lastMotionLocal = TimeZoneInfo.ConvertTime(lastMotionUtc.Value, tz);
                motionRecent = (nowLocal - lastMotionLocal) < grace.Value;
                _logger.LogInformation("Room {id}: Presence check: LastMotion={lm} (Local), Recent={rec} (Grace={g}m)",
                    room.Id, lastMotionLocal, motionRecent, grace.Value.TotalMinutes);
            }
            else
            {
                 _logger.LogInformation("Room {id}: Presence check: No motion data or grace period defined.", room.Id);
            }

            // === 5. Quyết định Trạng thái mong muốn (Desired State) ===

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
                {
                    shouldPowerOn = true;
                    _logger.LogInformation("Room {id}: Decision: ON (Within schedule start grace period)", room.Id);
                }
                else
                {
                    shouldPowerOn = motionRecent; // qua grace → cần motion gần đây
                    _logger.LogInformation("Room {id}: Decision: ON={on} (Within schedule, based on recent motion)", room.Id, shouldPowerOn);
                }
            }
            else
            {
                shouldPowerOn = false; // Ngoài giờ học -> TẮT
                 _logger.LogInformation("Room {id}: Decision: OFF (Outside active schedule)", room.Id);
            }

            // === 6. TÍNH TOÁN MODE / FAN (LOGIC MỚI) ===
            
            string desiredMode = ModeEco;    // Mặc định
            string desiredFanSpeed = FanAuto; // Luôn là 'auto' theo yêu cầu

            if (shouldPowerOn && currentTemp.HasValue && targetTemp.HasValue)
            {
                double deltaT = currentTemp.Value - targetTemp.Value;
                
                if (deltaT >= DeltaTempThreshold)
                {
                    desiredMode = ModeCool;
                }
                else
                {
                    // Bao gồm |ΔT| < 3 VÀ trường hợp đã quá lạnh (ΔT < 0)
                    desiredMode = ModeEco;
                }

                _logger.LogInformation(
                    "Room {id}: TempLogic: ΔT = (Current {curT} - Target {tarT}) = {delta:F1}°C. DesiredMode={mode}",
                    room.Id, currentTemp.Value, targetTemp.Value, deltaT, desiredMode);
            }
            else if (shouldPowerOn)
            {
                 _logger.LogInformation("Room {id}: TempLogic: Cannot calculate ΔT (missing Temp data). Defaulting to Mode={mode}", room.Id, desiredMode);
            }

            // === 7. Cập nhật các AC Twin ===

            var acTwins = await GetDevicesViaRelationsAsync(
                room.Id,
                new[] { "dtmi:com:smartbuilding:ACUnit;2", "dtmi:com:smartbuilding:ACUnit;1" },
                ct);

            if (acTwins.Count == 0)
            {
                _logger.LogWarning("Room {id}: No ACUnit twins found via 'hasDevice' relationship.", room.Id);
                return;
            }

            foreach (var ac in acTwins)
            {
                var patch = new JsonPatchDocument();
                bool needsPatch = false;

                // 7a. So sánh PowerState
                bool currentPower = GetBool(ac.Contents, "powerState") ?? false;
                if (currentPower != shouldPowerOn)
                {
                    patch.AppendReplace("/powerState", shouldPowerOn);
                    needsPatch = true;
                    _logger.LogInformation("Room {room} / AC {ac}: Power state change: {old} -> {new}",
                        room.Id, ac.Id, currentPower, shouldPowerOn);
                }

                // 7b. So sánh Mode và Fan (CHỈ KHI AC ĐANG/SẼ BẬT)
                if (shouldPowerOn)
                {
                    // So sánh Mode
                    string? currentMode = GetString(ac.Contents, "mode");
                    if (!string.Equals(currentMode, desiredMode, StringComparison.OrdinalIgnoreCase))
                    {
                        patch.AppendReplace("/mode", desiredMode);
                        needsPatch = true;
                        _logger.LogInformation("Room {room} / AC {ac}: Mode change: {old} -> {new}",
                            room.Id, ac.Id, currentMode ?? "N/A", desiredMode);
                    }

                    // So sánh FanSpeed
                    string? currentFan = GetString(ac.Contents, "fanSpeed");
                    if (!string.Equals(currentFan, desiredFanSpeed, StringComparison.OrdinalIgnoreCase))
                    {
                        patch.AppendReplace("/fanSpeed", desiredFanSpeed);
                        needsPatch = true;
                         _logger.LogInformation("Room {room} / AC {ac}: FanSpeed change: {old} -> {new}",
                            room.Id, ac.Id, currentFan ?? "N/A", desiredFanSpeed);
                    }
                }

                // 7c. Gửi Patch nếu cần
                if (needsPatch)
                {
                    try
                    {
                        await _adt.UpdateDigitalTwinAsync(ac.Id, patch, cancellationToken: ct);
                        _logger.LogInformation("Room {room} / AC {ac}: Successfully patched state.", room.Id, ac.Id);
                    }
                    catch (RequestFailedException ex) when (ex.Status == 412) // ETag conflict
                    {
                        _logger.LogWarning("ETag conflict when patching {ac}: {msg}", ac.Id, ex.Message);
                    }
                    catch (Exception ex)
                    {
                         _logger.LogError(ex, "Failed to patch AC {ac} for room {room}", ac.Id, room.Id);
                    }
                }
                else
                {
                     _logger.LogInformation("Room {room} / AC {ac}: State is already correct. No patch needed.", room.Id, ac.Id);
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
                    {
                        _logger.LogInformation("Room {room}: Found active schedule {schedId} ({start} - {end})",
                            roomId, schedId, startLocal.ToString("HH:mm"), endLocal.ToString("HH:mm"));
                        return (true, startLocal, endLocal);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to read or parse schedule twin {schedId} for room {room}", schedId, roomId);
                }
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
                    if (model != null && modelIds.Any(m => model.StartsWith(m, StringComparison.OrdinalIgnoreCase)))
                    {
                        list.Add(dev);
                    }
                }
                catch (RequestFailedException ex) when (ex.Status == 404)
                {
                     _logger.LogWarning("Device {devId} (related to room {room}) not found in ADT.", devId, roomId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to get device {devId} for room {room}", devId, roomId);
                }
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
            // Trả về reader rỗng để tránh lỗi NullReference
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
                    if (v.ValueKind == JsonValueKind.True) return true;
                    if (v.ValueKind == JsonValueKind.False) return false;
                }
                return false;
            }

            public int? TryGetInt(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number)
                    if (v.TryGetInt32(out var i)) return i;
                return null;
            }

            // MỚI: Thêm TryGetDouble
            public double? TryGetDouble(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number)
                    if (v.TryGetDouble(out var d)) return d;
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

        // ------------ Helpers: IDictionary<string, object> (Dùng cho BasicDigitalTwin.Contents) ------------
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
                if (el.ValueKind == JsonValueKind.True) return true;
                if (el.ValueKind == JsonValueKind.False) return false;
            }
            return null;
        }

        private static int? GetInt(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is int i) return i;
            // SDK có thể trả về long (Int64) cho DTDL 'integer'
            if (obj is long l) return (int)l;
            if (obj is JsonElement el && el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var ii)) return ii;
            return null;
        }

        // MỚI: Thêm GetDouble
        private static double? GetDouble(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is double d) return d;
            if (obj is float f) return (double)f;
            if (obj is decimal dec) return (double)dec;
            if (obj is int i) return (double)i;
            if (obj is long l) return (double)l;
            if (obj is JsonElement el && el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var dd)) return dd;
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
            // DTDL 'time' là chuỗi "HH:MM:SS" (hoặc "HH:MM")
            var s = GetString(dict, key);
            if (s != null && TimeSpan.TryParse(s, out var ts)) return ts;
            return null;
        }
    }
}