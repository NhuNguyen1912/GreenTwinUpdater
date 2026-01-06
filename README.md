# GREENTWIN - HỆ THỐNG QUẢN LÝ TÒA NHÀ THÔNG MINH

**GreenTwin** là giải pháp quản lý năng lượng và vận hành phòng học thông minh dựa trên nền tảng **Azure Digital Twins**. Hệ thống kết hợp giữa mô phỏng vật lý và bản sao số để cung cấp khả năng giám sát thời gian thực, điều khiển tự động và tối ưu hóa năng lượng cho môi trường giáo dục.

---

## TÍNH NĂNG NỔI BẬT

### 1. Giám sát thời gian thực (Real-time Monitoring)
* **Hiển thị đa chiều:** Cập nhật liên tục các thông số môi trường: Nhiệt độ, Độ ẩm, Ánh sáng, Năng lượng tiêu thụ.
* **Trực quan hóa 3D:** Trạng thái phòng học (Màu sắc, Thông số) trên mô hình 3D thay đổi tức thì theo dữ liệu cảm biến gửi về.

### 2. Mô phỏng & Bản sao số (Simulation & Digital Twin)
* **Ontology chuẩn hóa:** Mô hình hóa ngữ nghĩa **Tòa nhà → Tầng → Phòng → Thiết bị** bằng ngôn ngữ **DTDL**.
* **Device Simulator thông minh:** Hệ thống giả lập cảm biến với thuật toán vật lý, mô phỏng sự biến thiên nhiệt độ tự nhiên và tương quan độ ẩm.

### 3. Tự động hóa thông minh (Smart Automation)
* **Logic Lịch học (Scheduler):** Thiết bị tự động bật khi đến giờ học đã đăng ký.
* **Cơ chế Tiết kiệm năng lượng (Energy Saver):** Tự động gửi lệnh **TẮT TOÀN BỘ** thiết bị sau **15 phút** nếu:
    * Đã kết thúc giờ học.
    * **VÀ** Cảm biến không phát hiện chuyển động trong thời gian dài.

### 4. Phân tích dữ liệu (Analytics)
* Biểu đồ lịch sử tiêu thụ năng lượng giúp nhận diện các khung giờ cao điểm và lãng phí điện năng.

---

## KIẾN TRÚC HỆ THỐNG

Hệ thống hoạt động theo mô hình **Event-Driven Architecture** (Hướng sự kiện) trên nền tảng Microsoft Azure:

1.  **Device Layer:** Các thiết bị ảo (**Node.js**) gửi dữ liệu Telemetry qua giao thức **MQTT**.
2.  **Ingestion:** **Azure IoT Central** tiếp nhận, xác thực thiết bị và định tuyến dữ liệu.
3.  **Messaging:** **Azure Service Bus** đóng vai trò bộ đệm (Message Broker) để điều tiết lưu lượng.
4.  **Processing:** **Azure Functions (.NET 8 Isolated)** xử lý logic nghiệp vụ, cập nhật Digital Twin và thực thi logic tự động hóa.
5.  **Core State:** **Azure Digital Twins** lưu trữ đồ thị tri thức và trạng thái hiện tại (Live Graph).
6.  **Presentation:** **Azure SignalR** đẩy sự kiện thay đổi xuống **Web App (Next.js)**.

---

## 🛠 CÔNG NGHỆ SỬ DỤNG

| Phân lớp | Công nghệ / Dịch vụ |
| :--- | :--- |
| **Cloud Platform** | Microsoft Azure (IoT Central, Digital Twins, Service Bus, Event Grid) |
| **Backend Logic** | **.NET 8** (Azure Functions Isolated Worker) |
| **Simulation** | **Node.js** (v18+), Azure IoT Device SDK |
| **Frontend** | **Next.js** (React), TailwindCSS, Chart.js |
| **Real-time** | Azure SignalR Service |

---

## ⚙️ HƯỚNG DẪN CÀI ĐẶT & TRIỂN KHAI

### 1. Yêu cầu tiên quyết (Prerequisites)
* Node.js (v18 trở lên).
* .NET SDK 8.0.
* Azure CLI.
* Visual Studio Code.

### 2. Khởi chạy Simulator (Mô phỏng thiết bị)

Truy cập thư mục `DeviceSimulator`:
```bash
cd DeviceSimulator
npm install
```

Tạo file `.env` và cấu hình khóa kết nối (Lấy từ Azure IoT Central):
```env
ID_SCOPE=0ne00XXXXXX
# Khóa SAS cho từng thiết bị
TEMP_KEY=...
HUM_KEY=...
LUX_KEY=...
MOTION_KEY=...
ENERGY_KEY=...
```

Chạy chương trình mô phỏng:
```bash
node index.js
```
*Terminal sẽ hiển thị log: `Sending telemetry: Temp=27.5...`*

### 3. Khởi chạy Backend (Azure Functions)

Truy cập thư mục GreenTwinUpdater:
```bash
cd GreenTwinUpdater
```

Cấu hình file `local.settings.json`:
```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "ADT_SERVICE_URL": "https://<your-adt-instance>.api.wcus.digitaltwins.azure.net",
    "ServiceBusConnection": "<your-service-bus-connection-string>",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated"
  }
}
```

Chạy Function App:
```bash
func start
```

### 4. Khởi chạy Frontend (Web App)

Truy cập thư mục `GreenTwinAppUI`:
```bash
cd GreenTwinAppUI
npm install
```

Chạy ứng dụng Web:
```bash
npm run dev
```
Truy cập trình duyệt tại: `http://localhost:3000`

---

##  KỊCH BẢN KIỂM THỬ (TEST SCENARIOS)

Để kiểm chứng hệ thống, vui lòng thực hiện các bước sau:

#### Kịch bản 1: Đồng bộ dữ liệu (Sync)
* **Hành động:** Chạy `node index.js`. Quan sát log nhiệt độ trên Terminal.
* **Kết quả:** Dashboard trên Web App cập nhật số liệu trùng khớp ngay lập tức.

####  Kịch bản 2: Tự động điều khiển (Automation)
* **Hành động:** Khi có lịch học.
* **Kết quả:** Điều hòa và đèn tự động bật và điều chỉnh chế độ cho phù hợp với môi trường mà dữ liệu cảm biến gửi về.

#### Kịch bản 3: Tự động tắt (Timeout 15 phút)
* **Hành động:** Giả lập thời gian hệ thống vượt quá giờ mà không phát hiện chuyển động
* **Kết quả:** Các thiết bị tự động TẮT.

---

## 📂 CẤU TRÚC DỰ ÁN

```
GreenTwin/
├── 📁 GreenTwinUpdater/              # Xử lý Logic (.NET 8 Azure Functions)
├── 📁 DeviceSimulator/      # Giả lập cảm biến (Node.js)
├── 📁 GreenTwinAppUI/             # Giao diện người dùng (Next.js)
└── 📁 MODEL DTDL/                 
```

---

## 👥 THÔNG TIN TÁC GIẢ

* **[DIỆP TRƯƠNG KHÁNH BĂNG]** - MSSV: 52200238
* **[NGUYỄN NGỌC QUỲNH NHƯ]** - MSSV: 52200281
* **Giảng viên hướng dẫn:** **[LÊ VIẾT THANH]**

---
