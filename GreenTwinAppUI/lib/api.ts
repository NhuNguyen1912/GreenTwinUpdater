// lib/api.ts

// ---------- Types ----------

export type Room = {
  id: string;
  name: string;
  building: string;
  floor: string;
  inClass: boolean;

  description?: string;
  courseName?: string;
  lecturerName?: string;
  nextClass?: string;

  currentTemperature?: number;
  targetTemperature?: number;
  currentIlluminance?: number;
  targetLux?: number;
  currentEnergyKWh?: number;
};

export type Schedule = {
  id: string;
  roomId: string;
  roomName: string;
  courseName: string;
  lecturer: string;
  weekdays: string[];
  startTime: string;
  endTime: string;
};

export type Device = {
  id: string;
  name: string;
  type: string;      // "ac" | "light" | "sensor" | "energy" | ...
  roomId: string;
  roomName: string;
  status: string;    // "online" | "offline" | ...
};

// ---------- Constants (API base & keys) ----------

const BASE_URL =
  "https://greentwiniotcentraltrigger-ezgmgugyb9fkfwem.japaneast-01.azurewebsites.net/api";

const ROOMS_KEY =
  "XcGh9Rjnkz-NiNrgK6_qD4_slZugmc38Qob2svJAcFEJAzFuoBUalg==";

const DEVICES_KEY =
  "uKQLG3SulECzSU_jJPLsNBoVPG889Qy5IaaxNmiJ5G9QAzFuPH_SrQ==";

const AC_CONTROL_KEY =
  "bQAT_PQdIK8_JdHjU6tb1XvNt6-NQ77MnXYtMztVqdCYAzFuGFUySQ=="; // key của ACManualControl

// ---------- API calls ----------

// Lấy danh sách phòng từ Function GetRooms
export async function getRooms(): Promise<Room[]> {
  const res = await fetch(`${BASE_URL}/rooms?code=${ROOMS_KEY}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("Failed to load rooms", res.status, await res.text());
    throw new Error("Failed to load rooms");
  }

  return res.json();
}

// Tạm thời schedule vẫn là fake local (mock)
export async function getSchedules(): Promise<Schedule[]> {
  await new Promise((res) => setTimeout(res, 300));

  return [
    {
      id: "1",
      roomId: "RoomA001",
      roomName: "Room A001",
      courseName: "IoT Systems",
      lecturer: "Dr. Smith",
      weekdays: ["MON", "WED", "FRI"],
      startTime: "09:00",
      endTime: "11:00",
    },
    {
      id: "2",
      roomId: "RoomA002",
      roomName: "Room A002",
      courseName: "Advanced Python",
      lecturer: "Prof. Brown",
      weekdays: ["TUE", "THU"],
      startTime: "13:30",
      endTime: "15:00",
    },
  ];
}

// Lấy danh sách thiết bị trong 1 room từ Function GetDevicesForRoom
export async function getDevicesForRoom(roomId: string): Promise<Device[]> {
  const res = await fetch(
    `${BASE_URL}/rooms/${encodeURIComponent(roomId)}/devices?code=${DEVICES_KEY}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    console.error("Failed to load devices", res.status, await res.text());
    throw new Error("Failed to load devices");
  }

  return res.json();
}

// Payload gửi lên ACManualControl
export type UpdateAcPayload = {
  powerState?: boolean;
  mode?: string;
  fanSpeed?: string;
  targetTemperature?: number;
  user?: string; // ví dụ "Bang"
};

// Gửi lệnh điều khiển AC + bật manual override 60 phút
export async function updateAcSettings(
  roomId: string,
  deviceId: string,
  payload: UpdateAcPayload
): Promise<string> {
  const res = await fetch(
    `${BASE_URL}/rooms/${encodeURIComponent(
      roomId
    )}/devices/${encodeURIComponent(
      deviceId
    )}/ac-control?code=${AC_CONTROL_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    console.error("Failed to update AC", res.status, await res.text());
    throw new Error("Failed to update AC");
  }

  // Function trả về string (OK – override until ...), đọc text là đủ
  return res.text().catch(() => "");
}
