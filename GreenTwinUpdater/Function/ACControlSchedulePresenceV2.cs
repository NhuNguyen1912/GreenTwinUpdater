using System;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;
using Azure.DigitalTwins.Core;
using Azure.Identity;
using Azure; // QUAN TRỌNG: Cần cho JsonPatchDocument
using System.Collections.Generic;
using System.Text.Json;
using System.Linq; // Cần cho logic thời gian
using Azure.Messaging.ServiceBus;

namespace GreenTwinUpdater
{
    public class ACControlSchedulePresenceV2
    {
        private readonly ILogger _logger;
        private readonly DigitalTwinsClient _adtClient;

        public ACControlSchedulePresenceV2(ILoggerFactory loggerFactory)
        {
            _logger = loggerFactory.CreateLogger<ACControlSchedulePresenceV2>();
            var adtServiceUrl = Environment.GetEnvironmentVariable("ADT_SERVICE_URL") ?? throw new InvalidOperationException("ADT_SERVICE_URL not set");
            _adtClient = new DigitalTwinsClient(new Uri(adtServiceUrl), new DefaultAzureCredential());
        }

        [Function("ACControlSchedulePresenceV2")]
        public async Task Run([TimerTrigger("0 * * * * *")] TimerInfo myTimer)
        {
            _logger.LogInformation($"ACControlSchedulePresenceV2 triggered at: {DateTime.UtcNow}");

            try // Thêm khối try...catch để bắt lỗi (ví dụ: lỗi xác thực)
            {
                await foreach (BasicDigitalTwin room in _adtClient.QueryAsync<BasicDigitalTwin>(
                    "SELECT * FROM DIGITALTWINS WHERE IS_OF_MODEL('dtmi:com:smartbuilding:Room;2')"))
                {
                    string roomId = room.Id;
                    _logger.LogInformation($"--- Checking Room: {roomId} ---");

                    string? acId = null;
                    string? scheduleId = null;
                    string? motionSensorId = null;

                    await foreach (BasicRelationship rel in _adtClient.GetRelationshipsAsync<BasicRelationship>(roomId))
                    {
                        if (rel.Name == "hasDevice")
                        {
                            // ĐÃ SỬA: Khớp với ID twin của bạn "ACA..."
                            if (rel.TargetId.StartsWith("ACA")) acId = rel.TargetId;
                            // ĐÃ SỬA: Khớp với ID twin của bạn "Motion..."
                            if (rel.TargetId.StartsWith("Motion")) motionSensorId = rel.TargetId;
                        }
                        else if (rel.Name == "hasSchedule")
                        {
                            scheduleId = rel.TargetId;
                        }
                    }

                    if (acId == null || scheduleId == null || motionSensorId == null)
                    {
                        _logger.LogWarning("Missing AC ({AcId}), schedule ({ScheduleId}), or motion sensor ({MotionSensorId}) for room {RoomId}. Skipping.", acId, scheduleId, motionSensorId, roomId);
                        continue;
                    }

                    // ĐÃ SỬA: Lấy "policy" một cách an toàn (dùng TryGetValue)
                    var policy = await _adtClient.GetComponentAsync<BasicDigitalTwin>(roomId, "policy");
                    var policyContents = policy.Value.Contents;

                    bool allowManualOverride = policyContents.TryGetValue("allowManualOverride", out var amo) && amo is JsonElement amoElem ? amoElem.GetBoolean() : false;
                    bool overrideActive = policyContents.TryGetValue("overrideActive", out var oa) && oa is JsonElement oaElem ? oaElem.GetBoolean() : false;
                    string overrideExpiresStr = policyContents.TryGetValue("overrideExpiresOn", out var oes) && oes is JsonElement oesElem ? oesElem.GetString() ?? string.Empty : string.Empty;
                    bool scheduleEnabled = policyContents.TryGetValue("scheduleEnabled", out var se) && se is JsonElement seElem ? seElem.GetBoolean() : true;
                    int presenceTimeoutMinutes = policyContents.TryGetValue("presenceTimeoutMinutes", out var ptm) && ptm is JsonElement ptmElem ? ptmElem.GetInt32() : 5;


                    if (allowManualOverride && overrideActive && DateTime.TryParse(overrideExpiresStr, out DateTime overrideExpiresOn) && DateTime.UtcNow < overrideExpiresOn)
                    {
                        _logger.LogInformation("Override active. Skipping automatic control for room {RoomId}.", roomId);
                        continue;
                    }
                    
                    // --- BẮT ĐẦU LOGIC THỜI GIAN ĐÃ SỬA ---

                    // 1. LẤY LOGIC LỊCH (SCHEDULE) - AN TOÀN
                    var schedule = await _adtClient.GetDigitalTwinAsync<BasicDigitalTwin>(scheduleId);
                    var scheduleContents = schedule.Value.Contents;

                    bool isEnabled = scheduleContents.TryGetValue("isEnabled", out var ie) && ie is JsonElement ieElem ? ieElem.GetBoolean() : true;
                    string startTimeStr = scheduleContents.TryGetValue("startTime", out var st) && st is JsonElement stElem ? stElem.GetString() ?? "00:00:00" : "00:00:00";
                    string endTimeStr = scheduleContents.TryGetValue("endTime", out var et) && et is JsonElement etElem ? etElem.GetString() ?? "00:00:00" : "00:00:00";

                    // Lấy ngày trong tuần TỪ CHUỖI ĐƠN (Enum DTDL v1)
                    string scheduleDayStr = scheduleContents.TryGetValue("weekdays", out var wd) && wd is JsonElement wdElem
                        ? wdElem.GetString() ?? string.Empty
                        : string.Empty; // Giá trị sẽ là "MON", "TUE", v.v.


                    // 2. LẤY TRẠNG THÁI CẢM BIẾN VÀ AC (AN TOÀN)
                    var motionSensor = await _adtClient.GetDigitalTwinAsync<BasicDigitalTwin>(motionSensorId);
                    bool motion = motionSensor.Value.Contents.TryGetValue("motion", out var m) && m is JsonElement mElem ? mElem.GetBoolean() : false;

                    var ac = await _adtClient.GetDigitalTwinAsync<BasicDigitalTwin>(acId);
                    bool powerState = ac.Value.Contents.TryGetValue("powerState", out var ps) && ps is JsonElement psElem ? psElem.GetBoolean() : false;


                    // 3. LOGIC XỬ LÝ MÚI GIỜ VÀ THỜI GIAN
                    TimeZoneInfo vietnamZone;
                    try
                    {
                        // "SE Asia Standard Time" là ID chuẩn của Windows cho giờ +07 (Bangkok, Hanoi, Jakarta)
                        vietnamZone = TimeZoneInfo.FindSystemTimeZoneById("SE Asia Standard Time");
                    }
                    catch (TimeZoneNotFoundException)
                    {
                        // Nếu chạy trên Linux, ID có thể khác
                        vietnamZone = TimeZoneInfo.FindSystemTimeZoneById("Asia/Ho_Chi_Minh");
                    }
                    
                    DateTime nowLocal = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, vietnamZone);

                    TimeOnly startTime = TimeOnly.Parse(startTimeStr);
                    TimeOnly endTime = TimeOnly.Parse(endTimeStr);
                    TimeOnly nowTime = TimeOnly.FromDateTime(nowLocal);

                    _logger.LogInformation("--- Debug Info for Room {RoomId} ---", roomId);
                    _logger.LogInformation("Current Local Time (+07): {NowLocal} (Day: {Day})", nowLocal, nowLocal.DayOfWeek);
                    _logger.LogInformation("Schedule Day (from Enum): {Day}", scheduleDayStr);
                    _logger.LogInformation("Checking Time: {StartTime} - {EndTime}", startTime, endTime);
                    _logger.LogInformation("Motion: {Motion}, AC Power: {PowerState}", motion, powerState);

                    // 4. KHỐI IF/ELSE LOGIC (QUAN TRỌNG)
                    // Chuyển đổi chuỗi "MON" -> DayOfWeek.Monday
                    DayOfWeek scheduleDayEnum;
                    switch (scheduleDayStr.ToUpper())
                    {
                        case "MON": scheduleDayEnum = DayOfWeek.Monday; break;
                        case "TUE": scheduleDayEnum = DayOfWeek.Tuesday; break;
                        case "WED": scheduleDayEnum = DayOfWeek.Wednesday; break;
                        case "THU": scheduleDayEnum = DayOfWeek.Thursday; break;
                        case "FRI": scheduleDayEnum = DayOfWeek.Friday; break;
                        case "SAT": scheduleDayEnum = DayOfWeek.Saturday; break;
                        case "SUN": scheduleDayEnum = DayOfWeek.Sunday; break;
                        default:
                            scheduleDayEnum = (DayOfWeek)(-1); // Đặt giá trị không hợp lệ
                            _logger.LogWarning("Invalid or missing 'weekdays' property: {DayStr}", scheduleDayStr);
                            break;
                    }

                    bool isScheduleDay = (scheduleDayEnum == nowLocal.DayOfWeek);
                    bool isScheduleTime = (nowTime >= startTime && nowTime <= endTime);

                    if (scheduleEnabled && isEnabled && isScheduleDay && isScheduleTime)
                    {
                        _logger.LogInformation("Logic: Within schedule (Đang trong giờ làm việc).");
                        if (motion && !powerState)
                        {
                            await UpdateACPowerState(acId, true);
                            _logger.LogInformation("Turning ON AC for room: {RoomId}", roomId);
                        }
                        else if (!motion && powerState)
                        {
                            await UpdateACPowerState(acId, false);
                            _logger.LogInformation("Turning OFF AC due to no motion in room: {RoomId}", roomId);
                        }
                    }
                    else if (isScheduleDay && nowTime > endTime && powerState) // Chỉ tắt nếu HÔM NAY là ngày làm việc nhưng ĐÃ HẾT GIỜ
                    {
                        _logger.LogInformation("Logic: Outside schedule (End of day).");
                        await UpdateACPowerState(acId, false);
                        _logger.LogInformation("Turning OFF AC after end of schedule in room: {RoomId}", roomId);
                    }
                    else
                    {
                        _logger.LogInformation("Logic: Not a schedule day or outside schedule time. No action taken.");
                    }
                    // --- KẾT THÚC LOGIC THỜI GIAN ---

                }
            }
            catch (Exception ex) // Bắt lỗi (ví dụ: lỗi xác thực hết hạn)
            {
                // Nếu có lỗi, nó sẽ được log ra đây thay vì crash
                _logger.LogError(ex, "An error occurred while processing rooms. Error: {Message}", ex.Message);
            }
        }

        private async Task UpdateACPowerState(string acId, bool state)
        {
            try
            {
                var updateOps = new JsonPatchDocument();
                updateOps.AppendReplace("/powerState", state);
                await _adtClient.UpdateDigitalTwinAsync(acId, updateOps);
                _logger.LogInformation("Successfully updated powerState to {State} for AC {AcId}", state, acId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to update AC {AcId}", acId);
            }
        }
    }
}