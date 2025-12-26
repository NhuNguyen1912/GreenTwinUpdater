// File: DeviceSimulator/index.js

// 1. Nạp biến môi trường từ file .env
require('dotenv').config();

// 2. Kiểm tra xem đã tạo file .env chưa
if (!process.env.TEMP_KEY) {
  console.error("LỖI: Không tìm thấy Key trong file .env");
  console.error("Hãy tạo file .env và điền key vào theo hướng dẫn.");
  process.exit(1);
}

// 3. Khai báo thư viện (Giữ nguyên như cũ để không lỗi)
var iotDevice = require('azure-iot-device');
var Client = iotDevice.Client;
var Message = iotDevice.Message;
var MqttProtocol = require('azure-iot-device-mqtt').Mqtt;
var iotSecurity = require('azure-iot-security-symmetric-key');
var SymmetricKeySecurityClient = iotSecurity.SymmetricKeySecurityClient;
var iotProvisioning = require('azure-iot-provisioning-device');
var ProvisioningDeviceClient = iotProvisioning.ProvisioningDeviceClient;
var iotProvisioningMqtt = require('azure-iot-provisioning-device-mqtt');
var ProvisioningTransport = iotProvisioningMqtt.Mqtt;

// =========================================================
// 👇 CẤU HÌNH (LẤY TỪ FILE .ENV) 👇
// =========================================================
var idScope = process.env.ID_SCOPE;
var provisioningHost = "global.azure-devices-provisioning.net";

// Sử dụng biến môi trường thay vì key cứng
var devicesConfig = [
  { id: "TempA001",   key: process.env.TEMP_KEY,   type: "TEMP" },
  { id: "HumA001",    key: process.env.HUM_KEY,    type: "HUM" },
  { id: "LuxA001",    key: process.env.LUX_KEY,    type: "LUX" },
  { id: "MotionA001", key: process.env.MOTION_KEY, type: "MOTION" },
  { id: "EnergyA001", key: process.env.ENERGY_KEY, type: "ENERGY" }
];

// Thời gian gửi: 5 phút/lần (300000 ms)
var INTERVAL_MS = 5 * 60 * 1000; 

// =========================================================
// 🌡️ TRẠNG THÁI MÔ PHỎNG PHÒNG
// =========================================================
var roomState = {
  temp: 27.6,
  humidity: 62.0,
  lux: 200,
  energyKWh: 120.5,
  isOccupied: false,
  isAcOn: false
};

var clients = {};

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function nextTemp(prev) {
  var now = new Date();
  var hour = now.getHours() + now.getMinutes() / 60;
  var base = 27 + 1.2 * Math.sin((2 * Math.PI * hour) / 24);
  var drift = (base - prev) * 0.15;
  var noise = (Math.random() - 0.5) * 0.2; 
  return clamp(prev + drift + noise, 24, 31);
}

// =========================================================
// KẾT NỐI THIẾT BỊ
// =========================================================
async function initDevice(deviceCfg) {
  try {
    var securityClient = new SymmetricKeySecurityClient(deviceCfg.id, deviceCfg.key);
    var provisioningClient = ProvisioningDeviceClient.create(
      provisioningHost,
      idScope,
      new ProvisioningTransport(),
      securityClient
    );

    var result = await provisioningClient.register();
    if (result.status !== "assigned") {
       throw new Error("DPS connection status: " + result.status);
    }
    
    var connStr = 'HostName=' + result.assignedHub + ';DeviceId=' + result.deviceId + ';SharedAccessKey=' + deviceCfg.key;
    var client = Client.fromConnectionString(connStr, MqttProtocol);
    
    await client.open();
    clients[deviceCfg.id] = client;
    console.log(deviceCfg.id + " đã kết nối!");

  } catch (err) {
    console.error("Lỗi kết nối " + deviceCfg.id + ": " + (err.message || err));
  }
}

// =========================================================
// LOGIC GỬI DỮ LIỆU
// =========================================================
async function simulateAndSend() {
  updateRoomPhysics();
  
  // --- TempA001 ---
  if (clients["TempA001"]) {
    var msg = new Message(JSON.stringify({ temperature: roomState.temp }));
    await clients["TempA001"].sendEvent(msg);
  }

  // --- HumA001 ---
  if (clients["HumA001"]) {
    var msg = new Message(JSON.stringify({ currentHumidity: roomState.humidity }));
    await clients["HumA001"].sendEvent(msg);
  }

  // --- LuxA001 ---
  if (clients["LuxA001"]) {
    var msg = new Message(JSON.stringify({ illuminance: roomState.lux }));
    await clients["LuxA001"].sendEvent(msg);
  }

  // --- MotionA001 ---
  if (clients["MotionA001"]) {
    var msg = new Message(JSON.stringify({ motion: roomState.isOccupied }));
    await clients["MotionA001"].sendEvent(msg);
  }

  // --- EnergyA001 ---
  if (clients["EnergyA001"]) {
    var powerW = 100; 
    if (roomState.isOccupied) powerW += 200; 
    if (roomState.isAcOn) powerW += 1500;    

    roomState.energyKWh += (powerW / 1000) * (INTERVAL_MS / 3600000);

    var msg = new Message(JSON.stringify({ 
      currentPowerW: powerW,         
      currentEnergyKWh: parseFloat(roomState.energyKWh.toFixed(3))
    }));
    await clients["EnergyA001"].sendEvent(msg);
  }

  console.log("[" + new Date().toLocaleTimeString() + "] Đã gửi dữ liệu (Temp=" + roomState.temp + ")");
}

function updateRoomPhysics() {
  if (Math.random() < 0.1) roomState.isOccupied = !roomState.isOccupied;
  roomState.lux = roomState.isOccupied ? 500 : 80;
  roomState.temp = parseFloat(nextTemp(roomState.temp).toFixed(2));

  if (roomState.temp > 27.2) roomState.isAcOn = true;
  else if (roomState.temp < 25.0) roomState.isAcOn = false;

  var humDrift = roomState.isAcOn ? -0.6 : +0.2;
  var humNoise = (Math.random() - 0.5) * 0.8;
  roomState.humidity = parseFloat(clamp(roomState.humidity + humDrift + humNoise, 40, 85).toFixed(2));
}

// =========================================================
// MAIN
// =========================================================
async function main() {
  console.log("Đang khởi động...");
  var promises = devicesConfig.map(function(d) { return initDevice(d); });
  await Promise.all(promises);
  
  console.log("------------------------------------------------------");
  simulateAndSend();
  setInterval(simulateAndSend, INTERVAL_MS);
}

main();