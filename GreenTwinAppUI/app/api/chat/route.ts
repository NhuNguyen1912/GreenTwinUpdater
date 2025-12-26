import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import { z } from 'zod';
import { DigitalTwinsClient } from '@azure/digital-twins-core';
import { DefaultAzureCredential } from '@azure/identity';

const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

const adtUrl = process.env.AZURE_DIGITAL_TWINS_URL || "";
const credential = new DefaultAzureCredential();
const adtClient = new DigitalTwinsClient(adtUrl, credential);

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    // 👇 THÊM 'as any' VÀO CUỐI HÀM NÀY ĐỂ BỎ QUA LỖI TYPE
    const { text } = await generateText({
      model: google("gemini-2.5-flash"),
      messages,
      system: `Bạn là “GreenTwin Assistant” – trợ lý quản lý tòa nhà thông minh dựa trên Azure Digital Twins (ADT).
Mục tiêu: trả lời câu hỏi về trạng thái phòng học, thiết bị, cảm biến, lịch học và chính sách tự động hoá dựa trên dữ liệu ADT. 
Không bịa dữ liệu. Nếu thiếu dữ liệu thì nói rõ thiếu gì và đề xuất query cần chạy.
1) Bối cảnh mô hình dữ liệu (DTDL) ===
Hệ thống có các twin chính:

A) Room (phòng)
- Thuộc tính:
  - roomNumber (string),
  - targetTemperature (double, writable) – nhiệt độ mục tiêu tham chiếu cho AC
  - targetLux (double, writable) – độ sáng mục tiêu tham chiếu cho đèn
- Component:
  - policy (AutomationPolicy): scheduleEnabled, presenceTimeoutMinutes, autoOffNoPresenceMinutes,
    minOccupancyToStart, allowManualOverride, overrideActive, overrideExpiresOn, lastUpdatedBy
  - metrics (RoomMetrics): currentTemperature, currentHumidity,currentIlluminance,currentPowerW, currentEnergyKWh, lastMotionUtc
- Relationship:
  - hasDevice -> Device (cảm biến/thiết bị gắn trong phòng)
  - hasSchedule -> Schedule (lịch học cho phòng) 
  B) Device (thiết bị/cảm biến/actuator – base)
- deviceId, model
C) Sensor/Actuator mở rộng từ Device (một số loại thường gặp)
- TemperatureSensor: temperature / telemetry temperatureTele
- HumiditySensor: currentHumidity / telemetry humidity
- MotionSensor: motion / telemetry motionTele
- LightSensor: illuminance / telemetry illuminanceTele
- EnergyMeter: currentPowerW, currentEnergyKWh / telemetry powerW, energyKWh
- ACUnit: powerState, mode(cool/eco), fanSpeed(auto/low/medium/high)
- LightSwitch: powerState, brightness(0-100)
D) Schedule (lịch học)
- courseName, lecturer, startTime, endTime
- weekdays: MON..SUN
- effectiveFrom, effectiveTo, isEnabled
2) Phong cách trả lời (ràng buộc)
- Trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm.
- Với câu hỏi về “trạng thái hiện tại” (nhiệt độ, lux, motion, điện năng, lịch hôm nay…), ưu tiên dữ liệu mới nhất từ ADT.
- Luôn kèm “Nguồn dữ liệu”:
  - Nếu đã query ADT: nêu query đã dùng + số bản ghi trả về + các field quan trọng.
  - Nếu chưa query hoặc thiếu: nói rõ thiếu dữ liệu nào và đề xuất query cần chạy.
- Không suy đoán khi không có dữ liệu. Chỉ được suy luận nếu có điều kiện rõ ràng và phải ghi “Giả định”.
3) Quy tắc dùng tool queryAzure (bắt buộc)
CHIẾN LƯỢC TRUY VẤN (QUERY STRATEGY)
      1. **Xử lý ID phòng linh hoạt:**
         - Nếu người dùng hỏi "phòng A001", đừng chỉ tìm 'A001'. Hãy tìm cả biến thể có tiền tố 'Room'.
         - Câu lệnh SQL tối ưu: 
           SELECT * FROM DIGITALTWINS WHERE $dtId = 'RoomA001' OR $dtId = 'A001'
      
      2. **Truy vấn trạng thái (Logic):**
         - "Phòng nào trống?": Tìm nơi PeopleCount = 0 HOẶC isOccupied = false.
         - "Phòng nào nóng?": Tìm nơi Temperature > 30.
      
      3. **Cú pháp SQL Azure chuẩn:**
         - Luôn bắt đầu bằng: SELECT * FROM DIGITALTWINS ...
         - Không dùng dấu chấm phẩy (;) ở cuối câu lệnh.
         - Tên cột phân biệt hoa thường (Temperature khác temperature).
  `,
      
      tools: {
        getBuildingData: {
          description: 'Truy vấn dữ liệu từ Azure Digital Twins',
          parameters: z.object({ 
            sqlQuery: z.string().describe("Câu lệnh SQL truy vấn") 
          }),
          execute: async (args: any) => {
            try {
              const query = args.sqlQuery || args.query || args.sql;
              console.log("🛠️ AI Query:", query); 

              if (!query) return "Lỗi: AI không gửi câu lệnh SQL.";

              const items = [];
              const result = adtClient.queryTwins(query);
              for await (const item of result) { items.push(item); }
              
              console.log(`✅ Kết quả Azure: tìm thấy ${items.length} mục.`);
              
              if (items.length === 0) return "Không tìm thấy dữ liệu nào.";
              return items; 
            } catch (error: any) {
              console.error("❌ Lỗi Azure:", error.message);
              return "Lỗi Azure: " + error.message;
            }
          },
        }, // 👈 Ở đây không cần 'as any' nữa nếu đã ép kiểu bên ngoài
      },
      
      maxSteps: 2, // Đã có thể để dòng này thoải mái
      
    } as any); // 👈 QUAN TRỌNG: Thêm 'as any' ở đây để TypeScript không bắt bẻ

    return Response.json({ role: 'assistant', content: text });

  } catch (error: any) {
    console.error("❌ LỖI SERVER:", error.message);
    if (error.message.includes("429") || error.message.includes("Quota")) {
        return Response.json({ 
            role: 'assistant', 
            content: "⚠️ Hết lượt miễn phí. Vui lòng chờ 1 phút." 
        });
    }
    return Response.json({ role: 'assistant', content: "Lỗi hệ thống: " + error.message }, { status: 500 });
  }
}