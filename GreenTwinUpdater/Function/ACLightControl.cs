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
    public class ACLightControl
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adt;

        private readonly IoTCentralClient _iotc;


        // Hằng số cho AC
        private const double DeltaTempThreshold = 3.0;
        private const string ModeCool = "cool";
        private const string ModeEco = "eco";
        private const string FanAuto = "auto";

        // Hằng số cho Đèn (ĐÃ SỬA)
        private const double LuxHysteresis = 50.0; // Vùng trễ +/- 50 Lux
        private const int BrightnessDim = 20;       // % (Khi trời quá sáng)
        private const int BrightnessDefaultOn = 80; // % (Khi trời vừa đủ)
        private const int BrightnessMax = 100;      // % (Khi trời quá tối)

        // Model IDs
        private static readonly string[] AcUnitModelIds =
            { "dtmi:com:smartbuilding:ACUnit;3", "dtmi:com:smartbuilding:ACUnit;2" };
        private static readonly string[] LightSwitchModelIds =
            { "dtmi:com:smartbuilding:LightSwitch;1" };


        public ACLightControl(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<ACLightControl>();

            var adtUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL");
            if (string.IsNullOrWhiteSpace(adtUrl))
                throw new InvalidOperationException("Missing ADT_SERVICE_URL.");

            _adt = new DigitalTwinsClient(new Uri(adtUrl), new DefaultAzureCredential());

            // Khởi tạo client IoT Central
            _iotc = new IoTCentralClient();
        }



        [Function("ACLightControl")]
        public async Task RunAsync([TimerTrigger("*/30 * * * * *")] TimerInfo timer, FunctionContext ctx, CancellationToken ct = default)
        {
            // --- Phần này giữ nguyên ---
            var nowUtc = DateTimeOffset.UtcNow;

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

            _logger.LogInformation("=== ACLightControl @ {local} (Weekday: {wd}) ===", nowLocal, weekdayToken);

            string qRooms =
                "SELECT t.$dtId AS twinId FROM DIGITALTWINS t " +
                "WHERE IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;5') " +
                "   OR IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;3') " +
                "   OR IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;2') " +
                "   OR IS_OF_MODEL(t, 'dtmi:com:smartbuilding:Room;1')";

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

            _logger.LogInformation("=== ACLightControl Done ===");
        }

        private record CommonRoomState(
            BasicDigitalTwin Room,
            DateTimeOffset NowUtc,
            DateTimeOffset NowLocal,
            // Policy
            bool IsOverrideActive,
            bool ScheduleEnabled,
            int GracePeriodMinutes,
            int AutoOffTimeoutMinutes,
            // Schedule
            bool IsWithinSchedule,
            DateTimeOffset? ScheduleStartLocal,
            // Presence
            bool IsMotionRecent,
            bool IsWithinStartGrace,
            // Metrics
            double? CurrentTemperature,
            double? CurrentIlluminance,
            // Targets
            double? TargetTemperature,
            double? TargetLux
        );

        private async Task ProcessRoomAsync(
            BasicDigitalTwin room,
            DateTimeOffset nowUtc, DateTimeOffset nowLocal, TimeZoneInfo tz, string weekdayToken,
            CancellationToken ct)
        {
            // --- Phần Đọc Dữ liệu và Tính toán Trạng thái Chung giữ nguyên ---
            _logger.LogInformation("--- Processing Room: {id} ---", room.Id);

            var policyComp = TryGetComponent(room, "policy");
            var metricsComp = TryGetComponent(room, "metrics");

            // Policy
            bool scheduleEnabled = policyComp.TryGetBool("scheduleEnabled");
            bool allowManualOverride = policyComp.TryGetBool("allowManualOverride");
            bool overrideActive = policyComp.TryGetBool("overrideActive");
            var overrideExpiresOn = policyComp.TryGetDateTimeOffset("overrideExpiresOn");
            int gracePeriodMinutes = policyComp.TryGetInt("presenceTimeoutMinutes") ?? 0;
            int autoOffTimeoutMinutes = policyComp.TryGetInt("autoOffNoPresenceMinutes") ?? 0;

            // 🔹 Nếu overrideActive = true nhưng đã hết hạn -> clear cờ trong Room.policy
            if (allowManualOverride &&
                overrideActive &&
                overrideExpiresOn.HasValue &&
                nowUtc >= overrideExpiresOn.Value)
            {
                var clearPatch = new JsonPatchDocument();
                clearPatch.AppendReplace("/policy/overrideActive", false);
                clearPatch.AppendRemove("/policy/overrideExpiresOn");

                try
                {
                    await _adt.UpdateDigitalTwinAsync(room.Id, clearPatch, cancellationToken: ct);
                    _logger.LogInformation(
                        "Room {id}: Override expired, cleared overrideActive/overrideExpiresOn.",
                        room.Id);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Room {id}: Failed to clear expired override flags.", room.Id);
                }

                // Cập nhật biến local để logic phía dưới dùng giá trị mới
                overrideActive = false;
                overrideExpiresOn = null;
            }

            // 🔹 Tính trạng thái override hiện tại (chỉ true nếu còn hạn)
            bool isOverrideActive = allowManualOverride &&
                                    overrideActive &&
                                    overrideExpiresOn.HasValue &&
                                    nowUtc < overrideExpiresOn.Value;


            // Metrics
            var lastMotionUtc = metricsComp.TryGetDateTimeOffset("lastMotionUtc");
            double? currentTemp = metricsComp.TryGetDouble("currentTemperature");
            double? currentLux = metricsComp.TryGetDouble("currentIlluminance"); // Cần thêm vào DTDL

            // Room Targets
            double? targetTemp = GetDouble(room.Contents, "targetTemperature");
            double? targetLux = GetDouble(room.Contents, "targetLux");

            var activeSchedule = await FindActiveScheduleViaRelationsAsync(room.Id, weekdayToken, nowLocal, ct);
            bool isWithinSchedule = scheduleEnabled && activeSchedule.within;

            TimeSpan? autoOffTimeout = autoOffTimeoutMinutes > 0 ? TimeSpan.FromMinutes(autoOffTimeoutMinutes) : null;
            bool isMotionRecent = false;
            if (lastMotionUtc.HasValue && autoOffTimeout.HasValue)
            {
                isMotionRecent = (nowLocal - TimeZoneInfo.ConvertTime(lastMotionUtc.Value, tz)) < autoOffTimeout.Value;
            }

            TimeSpan? gracePeriod = gracePeriodMinutes > 0 ? TimeSpan.FromMinutes(gracePeriodMinutes) : null;
            bool isWithinStartGrace = false;
            if (isWithinSchedule && gracePeriod.HasValue && activeSchedule.startLocal.HasValue)
            {
                var s = activeSchedule.startLocal.Value;
                isWithinStartGrace = nowLocal >= s && (nowLocal - s) < gracePeriod.Value;
            }

            var commonState = new CommonRoomState(
                Room: room,
                NowUtc: nowUtc,
                NowLocal: nowLocal,
                IsOverrideActive: isOverrideActive,
                ScheduleEnabled: scheduleEnabled,
                GracePeriodMinutes: gracePeriodMinutes,
                AutoOffTimeoutMinutes: autoOffTimeoutMinutes,
                IsWithinSchedule: isWithinSchedule,
                ScheduleStartLocal: activeSchedule.startLocal,
                IsMotionRecent: isMotionRecent,
                IsWithinStartGrace: isWithinStartGrace,
                CurrentTemperature: currentTemp,
                CurrentIlluminance: currentLux,
                TargetTemperature: targetTemp,
                TargetLux: targetLux
            );

            _logger.LogInformation(
                "Room {id}: State: Override={ovr}, Schedule={sch}, Grace={grace}, Motion={mot} | Temp(Cur:{curT}, Tgt:{tarT}) | Lux(Cur:{curL}, Tgt:{tarL})",
                room.Id, commonState.IsOverrideActive, commonState.IsWithinSchedule, commonState.IsWithinStartGrace, commonState.IsMotionRecent,
                commonState.CurrentTemperature?.ToString("F1") ?? "N/A", commonState.TargetTemperature?.ToString("F1") ?? "N/A",
                commonState.CurrentIlluminance?.ToString("F1") ?? "N/A", commonState.TargetLux?.ToString("F1") ?? "N/A"
            );

            if (commonState.IsOverrideActive)
            {
                _logger.LogInformation("Room {id}: Manual override is ACTIVE. Skipping all automation.", room.Id);
                return;
            }

            // Gọi các hàm con
            await ProcessRoomACAsync(commonState, ct);
            await ProcessRoomLightsAsync(commonState, ct); // ⬅️ SẼ GỌI PHIÊN BẢN MỚI
        }


        /// <summary>
        /// (Hàm logic con AC) - Giữ nguyên, không thay đổi
        /// </summary>
        private async Task ProcessRoomACAsync(CommonRoomState state, CancellationToken ct)
        {
            // 1. Tính trạng thái mong muốn
            bool shouldPowerOn;

            if (state.IsWithinSchedule)
            {
                if (state.IsWithinStartGrace)
                    shouldPowerOn = true;
                else
                    shouldPowerOn = state.IsMotionRecent;
            }
            else
            {
                shouldPowerOn = false;
            }

            string desiredMode = ModeEco;
            string desiredFanSpeed = FanAuto;

            if (shouldPowerOn && state.CurrentTemperature.HasValue && state.TargetTemperature.HasValue)
            {
                double deltaT = state.CurrentTemperature.Value - state.TargetTemperature.Value;
                if (deltaT >= DeltaTempThreshold)
                    desiredMode = ModeCool;
                else
                    desiredMode = ModeEco;
            }

            double? desiredSetpoint = state.TargetTemperature; // để sync sang IoT Central

            // 2. Lấy danh sách AC trong phòng
            var acTwins = await GetDevicesViaRelationsAsync(state.Room.Id, AcUnitModelIds, ct);
            if (acTwins.Count == 0) return;

            foreach (var ac in acTwins)
            {
                var patch = new JsonPatchDocument();
                bool needsPatch = false;

                bool currentPower = GetBool(ac.Contents, "powerState") ?? false;
                if (currentPower != shouldPowerOn)
                {
                    patch.AppendReplace("/powerState", shouldPowerOn);
                    needsPatch = true;
                }

                if (shouldPowerOn)
                {
                    string? currentMode = GetString(ac.Contents, "mode");
                    if (!string.Equals(currentMode, desiredMode, StringComparison.OrdinalIgnoreCase))
                    {
                        patch.AppendReplace("/mode", desiredMode);
                        needsPatch = true;
                    }

                    string? currentFan = GetString(ac.Contents, "fanSpeed");
                    if (!string.Equals(currentFan, desiredFanSpeed, StringComparison.OrdinalIgnoreCase))
                    {
                        patch.AppendReplace("/fanSpeed", desiredFanSpeed);
                        needsPatch = true;
                    }

                    // Nếu có target temperature thì cũng patch vào AC twin (nếu em có property này trong model)
                    if (desiredSetpoint.HasValue)
                    {
                        double? currentSetpoint = GetDouble(ac.Contents, "setpointTemperature");
                        if (!currentSetpoint.HasValue || Math.Abs(currentSetpoint.Value - desiredSetpoint.Value) > 0.01)
                        {
                            patch.AppendReplace("/setpointTemperature", desiredSetpoint.Value);
                            needsPatch = true;
                        }
                    }
                }

                if (needsPatch)
                {
                    try
                    {
                        // 3. Patch lên ADT
                        await _adt.UpdateDigitalTwinAsync(ac.Id, patch, cancellationToken: ct);
                        _logger.LogInformation("Room {room} / AC {ac}: Patched state in ADT.", state.Room.Id, ac.Id);

                        // 4. Sync sang IoT Central
                        try
                        {
                            await _iotc.UpdateAcAsync(
                                deviceId: ac.Id,              // giả định ac.Id = deviceId IoT Central
                                powerState: shouldPowerOn,
                                mode: shouldPowerOn ? desiredMode : null,
                                fanSpeed: shouldPowerOn ? desiredFanSpeed : null,
                                setpointTemperature: desiredSetpoint
                            );

                            _logger.LogInformation(
                                "Room {room} / AC {ac}: Synced to IoT Central (power={p}, mode={m}, fan={f}, setpoint={t})",
                                state.Room.Id, ac.Id, shouldPowerOn, desiredMode, desiredFanSpeed, desiredSetpoint);
                        }
                        catch (Exception exIot)
                        {
                            _logger.LogError(exIot, "Room {room} / AC {ac}: Failed to sync to IoT Central",
                                state.Room.Id, ac.Id);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex, "Failed to patch AC {ac} for room {room}", ac.Id, state.Room.Id);
                    }
                }
            }
        }



        // ==================================================================
        // === LOGIC ĐÈN MỚI BẮT ĐẦU TỪ ĐÂY ===
        // ==================================================================

        /// <summary>
        /// (Hàm logic con Đèn) - ĐÃ SỬA LẠI LOGIC theo yêu cầu của bạn.
        /// </summary>
        private async Task ProcessRoomLightsAsync(CommonRoomState state, CancellationToken ct)
        {
            // Trạng thái mặc định
            bool desiredPower = false;
            int desiredBrightness = 0;

            if (state.IsWithinSchedule)
            {
                // === Ưu tiên #2: Theo Lịch (Schedule) ===

                // 1. Quyết định xem đèn CÓ NÊN BẬT không?
                // Đèn NÊN BẬT nếu: (Đang trong ân hạn) HOẶC (Có chuyển động gần đây)
                bool shouldBeOn = state.IsWithinStartGrace || state.IsMotionRecent;

                if (shouldBeOn)
                {
                    // 2. NẾU NÊN BẬT, BẬT BAO NHIÊU? (Luôn chạy logic Lux)
                    desiredPower = true;
                    desiredBrightness = CalculateDesiredBrightness(state.TargetLux, state.CurrentIlluminance, state.Room.Id);

                    _logger.LogInformation(
                        "Room {room}: Lights Logic (In Schedule, Presence={pre}): Lux {curL} vs Target {tarL} -> Set {br}%",
                        state.Room.Id, state.IsMotionRecent,
                        state.CurrentIlluminance?.ToString("F1") ?? "N/A",
                        state.TargetLux?.ToString("F1") ?? "N/A",
                        desiredBrightness);
                }
                else
                {
                    // TẮT (Vì trong lịch, nhưng đã HẾT ân hạn VÀ KHÔNG có chuyển động)
                    desiredPower = false;
                    _logger.LogInformation("Room {room}: Lights OFF (In Schedule, No Motion Timeout)", state.Room.Id);
                }
            }
            else
            {
                // === Ưu tiên #3: Ngoài Lịch (Motion + Lux) ===
                if (state.IsMotionRecent)
                {
                    // Ngoài giờ, CÓ chuyển động -> Tính toán xem có cần bật không
                    int brightnessForLux = CalculateDesiredBrightness(state.TargetLux, state.CurrentIlluminance, state.Room.Id);

                    // Chỉ bật nếu trời thực sự tối (logic tính toán trả về > mức Dìm sáng)
                    if (brightnessForLux > BrightnessDim)
                    {
                        desiredPower = true;
                        desiredBrightness = brightnessForLux;
                        _logger.LogInformation("Room {room}: Lights ON (Off-Schedule, Motion, Is Dark)", state.Room.Id);
                    }
                    // else: Trời đủ sáng (brightnessForLux <= BrightnessDim) -> không cần bật (desiredPower = false)
                }
                // else: Ngoài giờ, KHÔNG chuyển động -> TẮT (mặc định)
            }


            // === ÁP DỤNG THAY ĐỔI (Code này giữ nguyên) ===
            var lightTwins = await GetDevicesViaRelationsAsync(state.Room.Id, LightSwitchModelIds, ct);
            if (lightTwins.Count == 0) return;

            foreach (var light in lightTwins)
            {
                var patch = new JsonPatchDocument();
                bool needsPatch = false;

                bool currentPower = GetBool(light.Contents, "powerState") ?? false;
                int? currentBrightness = GetInt(light.Contents, "brightness");

                if (currentPower != desiredPower)
                {
                    patch.AppendReplace("/powerState", desiredPower);
                    needsPatch = true;
                    _logger.LogInformation("Room {room} / Light {light}: Power state change: {old} -> {new}",
                        state.Room.Id, light.Id, currentPower, desiredPower);
                }

                // Chỉ cập nhật brightness nếu đèn BẬT và độ sáng bị sai
                if (desiredPower && (!currentBrightness.HasValue || currentBrightness.Value != desiredBrightness))
                {
                    patch.AppendReplace("/brightness", desiredBrightness);
                    needsPatch = true;
                    _logger.LogInformation("Room {room} / Light {light}: Brightness change: {old} -> {new}",
                        state.Room.Id, light.Id, currentBrightness?.ToString() ?? "N/A", desiredBrightness);
                }

                if (needsPatch)
                {
                    try
                    {
                        // 1) Cập nhật ADT
                        await _adt.UpdateDigitalTwinAsync(light.Id, patch, cancellationToken: ct);

                        // 2) Cập nhật IoT Central (deviceId = twinId)
                        try
                        {
                            // Nếu đèn bật thì gửi cả brightness, nếu tắt chỉ cần powerState
                            int? brightnessToSend = desiredPower ? desiredBrightness : (int?)null;

                            await _iotc.UpdateLightAsync(
                                deviceId: light.Id,
                                powerState: desiredPower,
                                brightness: brightnessToSend);

                            _logger.LogInformation(
                                "Synced Light {light} to IoT Central (power={p}, brightness={b})",
                                light.Id, desiredPower, brightnessToSend?.ToString() ?? "null");
                        }
                        catch (Exception exIot)
                        {
                            _logger.LogError(exIot,
                                "Failed to sync Light {light} to IoT Central", light.Id);
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError(ex,
                            "Failed to patch Light {light} for room {room}",
                            light.Id, state.Room.Id);
                    }
                }

            }
        }

        /// <summary>
        /// (Hàm phụ MỚI) Tính toán độ sáng mong muốn dựa trên Lux.
        /// </summary>
        private int CalculateDesiredBrightness(double? targetLux, double? currentLux, string roomId)
        {
            // Nếu không có dữ liệu Lux, bật mặc định
            if (!targetLux.HasValue || !currentLux.HasValue)
            {
                _logger.LogInformation("Room {room}: Lux logic skipped (missing data), using default brightness.", roomId);
                return BrightnessDefaultOn;
            }

            double luxLow = targetLux.Value - LuxHysteresis;
            double luxHigh = targetLux.Value + LuxHysteresis;

            if (currentLux < luxLow)
            {
                // Quá tối -> Bật 100%
                return BrightnessMax;
            }

            if (currentLux > luxHigh)
            {
                // Quá sáng -> Dìm 20%
                return BrightnessDim;
            }

            // Vừa đủ -> Bật 80%
            return BrightnessDefaultOn;
        }


        // ==================================================================
        // CÁC HÀM HELPERS (Giữ nguyên)
        // ==================================================================

        private async Task<(bool within, DateTimeOffset? startLocal, DateTimeOffset? endLocal)>
            FindActiveScheduleViaRelationsAsync(string roomId, string weekdayToken, DateTimeOffset nowLocal, CancellationToken ct)
        {
            // Biến cờ để theo dõi logic
            bool hasRegularSchedule = false;
            bool hasCancellation = false;

            // Lưu lại thời gian của lịch hợp lệ để dùng cho logic ân hạn (Grace Period)
            DateTimeOffset? validStart = null;
            DateTimeOffset? validEnd = null;

            await foreach (var rel in _adt.GetRelationshipsAsync<BasicRelationship>(roomId, "hasSchedule", ct))
            {
                var schedId = rel.TargetId;
                try
                {
                    var resp = await _adt.GetDigitalTwinAsync<BasicDigitalTwin>(schedId, ct);
                    var s = resp.Value;

                    // 1. Kiểm tra Enable
                    bool isEnabled = GetBool(s.Contents, "isEnabled") ?? false;
                    if (!isEnabled) continue;

                    // 2. Kiểm tra Thứ (Weekday)
                    string wd = GetString(s.Contents, "weekdays") ?? "";
                    // Logic: Chuỗi weekdays phải chứa token hôm nay (VD: "MON,WED" chứa "MON")
                    if (!wd.Contains(weekdayToken, StringComparison.OrdinalIgnoreCase)) continue;

                    // 3. Kiểm tra Giờ (Time)
                    var startTs = GetTimeAsTimeSpan(s.Contents, "startTime");
                    var endTs = GetTimeAsTimeSpan(s.Contents, "endTime");
                    if (!startTs.HasValue || !endTs.HasValue) continue;

                    var startLocal = new DateTimeOffset(
                        nowLocal.Year, nowLocal.Month, nowLocal.Day,
                        startTs.Value.Hours, startTs.Value.Minutes, startTs.Value.Seconds, nowLocal.Offset);

                    var endLocal = new DateTimeOffset(
                        nowLocal.Year, nowLocal.Month, nowLocal.Day,
                        endTs.Value.Hours, endTs.Value.Minutes, endTs.Value.Seconds, nowLocal.Offset);

                    // Kiểm tra xem hiện tại có nằm trong khung giờ không
                    bool isTimeMatch = nowLocal >= startLocal && nowLocal < endLocal;
                    if (!isTimeMatch) continue;

                    // 4. MỚI: Kiểm tra Ngày hiệu lực (Effective Date)
                    // Nếu không check cái này, lịch nghỉ ngày mai sẽ làm tắt điện hôm nay!
                    string effFromStr = GetString(s.Contents, "effectiveFrom");
                    string effToStr = GetString(s.Contents, "effectiveTo");

                    if (DateTime.TryParse(effFromStr, out var effFrom))
                    {
                        if (nowLocal.Date < effFrom.Date) continue; // Chưa đến ngày
                    }
                    if (DateTime.TryParse(effToStr, out var effTo))
                    {
                        if (nowLocal.Date > effTo.Date) continue; // Đã quá ngày
                    }

                    // 5. MỚI: Kiểm tra tên môn học xem có phải là "Canceled/Nghỉ" không
                    string courseName = GetString(s.Contents, "courseName") ?? "";
                    bool isCancelSchedule = courseName.Contains("cancel", StringComparison.OrdinalIgnoreCase) ||
                                            courseName.Contains("nghỉ", StringComparison.OrdinalIgnoreCase) ||
                                            courseName.Contains("off", StringComparison.OrdinalIgnoreCase);

                    if (isCancelSchedule)
                    {
                        // Nếu tìm thấy bất kỳ lịch "Hủy" nào đang active -> Đánh dấu ngay
                        hasCancellation = true;
                        // Có thể break luôn nếu muốn ưu tiên tuyệt đối
                    }
                    else
                    {
                        // Đây là lịch học bình thường
                        hasRegularSchedule = true;
                        validStart = startLocal;
                        validEnd = endLocal;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to read schedule {schedId}", schedId);
                }
            }

            // LOGIC QUYẾT ĐỊNH CUỐI CÙNG:
            // Chỉ trả về TRUE nếu: Có lịch thường VÀ KHÔNG CÓ lịch hủy
            if (hasRegularSchedule && !hasCancellation)
            {
                return (true, validStart, validEnd);
            }

            // Trường hợp còn lại (Không có lịch, hoặc Có lịch nhưng bị Hủy) -> Trả về false
            return (false, null, null);
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
                    string? model = dev.Metadata?.ModelId;

                    if (model != null && modelIds.Any(m => model.StartsWith(m.Split(';')[0], StringComparison.OrdinalIgnoreCase)))
                    {
                        list.Add(dev);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Failed to get device {devId} for room {room}", devId, roomId);
                }
            }
            return list;
        }

        // --- Các hàm helpers ComponentReader và GetString, GetBool, GetInt... giữ nguyên ---
        // (Tôi sẽ không chép lại chúng ở đây để tiết kiệm không gian,
        // nhưng bạn phải giữ chúng ở cuối file của mình)

        // ==================================================================
        // CÁC HÀM HELPERS (ĐÃ SỬA LỖI JsonValueCode -> JsonValueKind)
        // ==================================================================

        // ------------ Helpers: Component ------------
        private static ComponentReader TryGetComponent(BasicDigitalTwin twin, string name)
        {
            if (twin.Contents != null &&
                twin.Contents.TryGetValue(name, out var obj) &&
                obj is JsonElement el && el.ValueKind == JsonValueKind.Object) // <- SỬA Ở ĐÂY
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
                    if (v.ValueKind == JsonValueKind.True) return true;   // <- SỬA Ở ĐÂY
                    if (v.ValueKind == JsonValueKind.False) return false; // <- SỬA Ở ĐÂY
                }
                return false;
            }

            public int? TryGetInt(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number) // <- SỬA Ở ĐÂY
                    if (v.TryGetInt32(out var i)) return i;
                return null;
            }

            public double? TryGetDouble(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.Number) // <- SỬA Ở ĐÂY
                    if (v.TryGetDouble(out var d)) return d;
                return null;
            }

            public DateTimeOffset? TryGetDateTimeOffset(string prop)
            {
                if (_el.HasValue && _el.Value.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String) // <- SỬA Ở ĐÂY
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
            if (obj is JsonElement el && el.ValueKind == JsonValueKind.String) return el.GetString(); // <- SỬA Ở ĐÂY
            return null;
        }

        private static bool? GetBool(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is bool b) return b;
            if (obj is JsonElement el)
            {
                if (el.ValueKind == JsonValueKind.True) return true;   // <- SỬA Ở ĐÂY
                if (el.ValueKind == JsonValueKind.False) return false; // <- SỬA Ở ĐÂY
            }
            return null;
        }


        private static int? GetInt(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is int i) return i;
            if (obj is long l) return (int)l;
            if (obj is JsonElement el && el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var ii)) return ii; // <- SỬA Ở ĐÂY
            return null;
        }

        private static double? GetDouble(IDictionary<string, object>? dict, string key)
        {
            if (dict == null) return null;
            if (!dict.TryGetValue(key, out var obj) || obj is null) return null;

            if (obj is double d) return d;
            if (obj is float f) return (double)f;
            if (obj is decimal dec) return (double)dec;
            if (obj is int i) return (double)i;
            if (obj is long l) return (double)l;
            if (obj is JsonElement el && el.ValueKind == JsonValueKind.Number && el.TryGetDouble(out var dd)) return dd; // <- SỬA Ở ĐÂY
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