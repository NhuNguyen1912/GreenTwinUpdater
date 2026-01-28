// File: DeviceSimulator/index.js
require('dotenv').config();

// --- 1. CẤU HÌNH DANH SÁCH THIẾT BỊ ---
// Bạn chỉ cần thêm thiết bị vào danh sách này là xong
var devicesConfig = [
  // == PHÒNG A001 ==
  { id: "TempA001",   key: process.env.TEMP_KEY_A001,   type: "TEMP",   roomId: "A001" },
  { id: "HumA001",    key: process.env.HUM_KEY_A001,    type: "HUM",    roomId: "A001" },
  { id: "LuxA001",    key: process.env.LUX_KEY_A001,    type: "LUX",    roomId: "A001" },
  { id: "MotionA001", key: process.env.MOTION_KEY_A001, type: "MOTION", roomId: "A001" },
  { id: "EnergyA001", key: process.env.ENERGY_KEY_A001, type: "ENERGY", roomId: "A001" },

  // == PHÒNG A002 (Mới) ==
  { id: "TempA002",   key: process.env.TEMP_KEY_A002,   type: "TEMP",   roomId: "A002" },
  { id: "HumA002",    key: process.env.HUM_KEY_A002,    type: "HUM",    roomId: "A002" },
  { id: "LuxA002",    key: process.env.LUX_KEY_A002,    type: "LUX",    roomId: "A002" },
  { id: "MotionA002", key: process.env.MOTION_KEY_A002, type: "MOTION", roomId: "A002" },
  { id: "EnergyA002", key: process.env.ENERGY_KEY_A002, type: "ENERGY", roomId: "A002" },
];

// Kiểm tra key
if (devicesConfig.some(d => !d.key)) {
  console.error("LỖI: Một số thiết bị chưa có Key trong file .env. Vui lòng kiểm tra lại.");
  process.exit(1);
}

// ===========================
// 2) AZURE IOT CENTRAL (DPS)
// ===========================
var iotDevice = require("azure-iot-device");
var Client = iotDevice.Client;
var Message = iotDevice.Message;
var MqttProtocol = require("azure-iot-device-mqtt").Mqtt;

var iotSecurity = require("azure-iot-security-symmetric-key");
var SymmetricKeySecurityClient = iotSecurity.SymmetricKeySecurityClient;

var iotProvisioning = require("azure-iot-provisioning-device");
var ProvisioningDeviceClient = iotProvisioning.ProvisioningDeviceClient;

var iotProvisioningMqtt = require("azure-iot-provisioning-device-mqtt");
var ProvisioningTransport = iotProvisioningMqtt.Mqtt;

var idScope = process.env.ID_SCOPE;
var provisioningHost = "global.azure-devices-provisioning.net";

// Chu kỳ gửi telemetry
var INTERVAL_MS = 5 * 60 * 1000; // 5 phút

// ===========================
// 3) AZURE DIGITAL TWINS (ADT)
// ===========================
const { DigitalTwinsClient } = require("@azure/digital-twins-core");
const { DefaultAzureCredential } = require("@azure/identity");

const ADT_ENDPOINT = process.env.ADT_ENDPOINT;
const adtClient = ADT_ENDPOINT ? new DigitalTwinsClient(ADT_ENDPOINT, new DefaultAzureCredential()) : null;

/**
 * Map phòng -> $dtId actuator trong ADT
 * Bạn đã chốt: ACA001, LightA001
 */
var actuatorTwinMap = {
  A001: { acTwinId: "ACA001", lightTwinId: "LightA001" },

  // Nếu có A002 thì sửa đúng dtId:
  A002: { acTwinId: "ACA002", lightTwinId: "LightA002" }
};

// Cache trạng thái actuator lấy từ ADT
var actuatorStateCache = {};
var ADT_REFRESH_MIN_MS = 10 * 1000; // 10s, tránh gọi ADT quá dày

function getPowerStateFromTwin(twin) {
  // Theo model bạn gửi, property là powerState (boolean) :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}
  return !!(twin && typeof twin.powerState === "boolean" && twin.powerState === true);
}

async function refreshActuatorStateFromADT(roomId) {
  if (!adtClient) return;

  var map = actuatorTwinMap[roomId];
  if (!map) return;

  var now = Date.now();
  var cache = actuatorStateCache[roomId] || { isAcOn: false, isLightOn: false, lastRefreshMs: 0 };

  if (now - cache.lastRefreshMs < ADT_REFRESH_MIN_MS) {
    actuatorStateCache[roomId] = cache;
    return;
  }

  try {
    var [acTwin, lightTwin] = await Promise.all([
      adtClient.getDigitalTwin(map.acTwinId),
      adtClient.getDigitalTwin(map.lightTwinId),
    ]);

    cache.isAcOn = getPowerStateFromTwin(acTwin);
    cache.isLightOn = getPowerStateFromTwin(lightTwin);
    cache.lastRefreshMs = now;

    actuatorStateCache[roomId] = cache;
  } catch (e) {
    console.log(`⚠️ ADT read failed for room ${roomId}: ${e.message}`);
    cache.lastRefreshMs = now; // vẫn cập nhật timestamp để khỏi spam retry
    actuatorStateCache[roomId] = cache;
  }
}

// ===========================
// 4) TRẠNG THÁI PHÒNG (SENSOR)
// ===========================
var roomStates = {}; // { roomId: {temp, humidity, lux, isOccupied, energyKWh} }
var clients = {}; // { deviceId: iotClient }

function initRoomState() {
  return {
    temp: 27.0 + Math.random(),
    humidity: 60.0,
    lux: 200,
    isOccupied: false,
    energyKWh: 100.0,
  };
}

// Utils
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

/**
 * Chỉ mô phỏng môi trường.
 * Không điều khiển AC/Light ở đây.
 */
function updatePhysicsForRoom(state) {
  // occupancy thay đổi ngẫu nhiên
  if (Math.random() < 0.1) state.isOccupied = !state.isOccupied;

  // lux môi trường
  state.lux = state.isOccupied ? 500 : 80;

  // temp dao động theo giờ
  state.temp = parseFloat(nextTemp(state.temp).toFixed(2));

  // humidity drift nhẹ
  var humDrift = state.isOccupied ? +0.2 : -0.1;
  var humNoise = (Math.random() - 0.5) * 0.8;
  state.humidity = parseFloat(clamp(state.humidity + humDrift + humNoise, 40, 85).toFixed(2));
}

// ===========================
// 5) INIT DEVICE DPS
// ===========================
async function initDevice(deviceCfg) {
  try {
    if (!roomStates[deviceCfg.roomId]) roomStates[deviceCfg.roomId] = initRoomState();
    if (!actuatorStateCache[deviceCfg.roomId]) {
      actuatorStateCache[deviceCfg.roomId] = { isAcOn: false, isLightOn: false, lastRefreshMs: 0 };
    }

    var securityClient = new SymmetricKeySecurityClient(deviceCfg.id, deviceCfg.key);
    var provisioningClient = ProvisioningDeviceClient.create(
      provisioningHost,
      idScope,
      new ProvisioningTransport(),
      securityClient
    );

    var result = await provisioningClient.register();
    if (result.status !== "assigned") throw new Error("DPS error: " + result.status);

    var connStr =
      "HostName=" +
      result.assignedHub +
      ";DeviceId=" +
      result.deviceId +
      ";SharedAccessKey=" +
      deviceCfg.key;

    var client = Client.fromConnectionString(connStr, MqttProtocol);
    await client.open();

    clients[deviceCfg.id] = client;
    console.log(`✅ ${deviceCfg.id} (Room ${deviceCfg.roomId}) đã kết nối IoT Hub`);
  } catch (err) {
    console.error(`❌ Lỗi kết nối ${deviceCfg.id}: ${err.message}`);
  }
}

// ===========================
// 6) ENERGY LOGIC (ADT -> POWER)
// ===========================
function computeEnergyPowerW(roomId, isOccupied) {
  var act = actuatorStateCache[roomId] || { isAcOn: false, isLightOn: false };

  // tham số mô phỏng
  var baseW = 60;
  var lightW = act.isLightOn ? 200 : 0;
  var acW = act.isAcOn ? 1500 : 0;

  // có người -> tăng phụ tải nhỏ
  var peopleW = isOccupied ? 80 : 0;

  var noiseW = (Math.random() - 0.5) * 30;

  var powerW = Math.round(baseW + lightW + acW + peopleW + noiseW);
  return Math.max(10, powerW);
}

async function simulateAndSendAll() {
  console.log(`\n[${new Date().toLocaleTimeString()}] --- START CYCLE ---`);

  // 1) Update sensor environment
  for (var roomId in roomStates) {
    updatePhysicsForRoom(roomStates[roomId]);
  }

  // 2) Refresh actuator ON/OFF từ ADT (phục vụ ENERGY)
  var roomIds = Object.keys(roomStates);
  await Promise.all(roomIds.map((r) => refreshActuatorStateFromADT(r)));

  // 3) Send telemetry
  for (var i = 0; i < devicesConfig.length; i++) {
    var dev = devicesConfig[i];
    var client = clients[dev.id];
    var state = roomStates[dev.roomId];
    if (!client || !state) continue;

    var payload = {};

    switch (dev.type) {
      case "TEMP":
        payload = { temperature: state.temp };
        break;

      case "HUM":
        payload = { currentHumidity: state.humidity };
        break;

      case "LUX":
        payload = { illuminance: state.lux };
        break;

      case "MOTION":
        payload = { motion: state.isOccupied };
        break;

      case "ENERGY": {
        var powerW = computeEnergyPowerW(dev.roomId, state.isOccupied);

        // kWh tăng theo chu kỳ
        state.energyKWh += (powerW / 1000) * (INTERVAL_MS / 3600000);

        payload = {
          currentPowerW: powerW,
          currentEnergyKWh: parseFloat(state.energyKWh.toFixed(3)),
        };
        break;
      }
    }

    var msg = new Message(JSON.stringify(payload));
    await client.sendEvent(msg);
    console.log(`📡 [${dev.roomId}] ${dev.id}: ${JSON.stringify(payload)}`);
  }

  // debug cache actuator
  for (var r in actuatorStateCache) {
    var a = actuatorStateCache[r];
    console.log(`🔎 [${r}] ADT -> AC=${a.isAcOn ? "ON" : "OFF"}, Light=${a.isLightOn ? "ON" : "OFF"}`);
  }

  console.log("✅ Cycle done");
}

// ===========================
// MAIN
// ===========================
async function main() {
  console.log("Đang khởi động simulator...");

  if (!process.env.ID_SCOPE) {
    console.error("LỖI: Thiếu ID_SCOPE trong .env");
    process.exit(1);
  }

  if (!ADT_ENDPOINT) {
    console.log("⚠️ Thiếu ADT_ENDPOINT -> ENERGY sẽ coi AC/OFF, Light/OFF.");
  } else {
    console.log("✅ ADT endpoint:", ADT_ENDPOINT);
  }

  // Init devices
  await Promise.all(devicesConfig.map((d) => initDevice(d)));

  console.log("------------------------------------------------------");
  await simulateAndSendAll();
  setInterval(simulateAndSendAll, INTERVAL_MS);
}

main();