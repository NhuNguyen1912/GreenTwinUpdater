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

export type LightState = {
  roomId: string;
  deviceId: string;
  powerState: boolean;
  brightness: number;

  overrideActive: boolean;
  overrideExpiresOnUtc?: string | null;
  overrideExpiresOnLocal?: string | null;
  overrideExpiresOnLocalFormatted?: string | null;

  controlMode?: "manual-override" | "auto-schedule";
};

export type AcState = {
  roomId: string;
  deviceId: string;

  powerState: boolean;
  mode?: string | null;
  fanSpeed?: string | null;
  targetTemperature?: number | null;
  currentTemperature?: number | null;

  overrideActive: boolean;
  overrideExpiresOnUtc?: string | null;
  overrideExpiresOnLocal?: string | null;
  overrideExpiresOnLocalFormatted?: string | null;

  lastUpdatedBy?: string | null;
  controlMode?: "manual-override" | "auto-schedule";
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

const AC_STATE_KEY = "8d-Vxdj_SdNoek78nrbj3k8s1UWfbKXwt27XjEZxyp7PAzFucjwhVg==";


const LIGHT_CONTROL_KEY =
  "s8nazlhbZ6i5h2WAj2FzPkj0p-H1NtkkrZLHT_h6RAKzAzFunXpung==";

const LIGHT_STATE_KEY =
  "Mk8ouqhlOoqhCxYnIgxF3aVleuQ2TBujU-f-bpG_p1GDAzFuZq9lFA==";

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

export async function getAcState(
  roomId: string,
  deviceId: string
): Promise<AcState> {
  const res = await fetch(
    `${BASE_URL}/rooms/${encodeURIComponent(
      roomId
    )}/devices/${encodeURIComponent(
      deviceId
    )}/ac-state?code=${AC_STATE_KEY}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    const text = await res.text();
    console.error("Failed to load AC state", {
      status: res.status,
      body: text,
    });
    throw new Error(text || "Failed to load AC state");
  }

  return res.json();
}

export type UpdateAcPayload = {
  powerState?: boolean;
  mode?: string;
  fanSpeed?: string;
  targetTemperature?: number;
  user?: string;
  durationMinutes?: number; // <-- Thêm trường này
};

// ... (Các hàm khác giữ nguyên)

export async function updateAcSettings(
  roomId: string,
  deviceId: string,
  payload: UpdateAcPayload
): Promise<AcState> {
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
    const text = await res.text();
    console.error("Failed to update AC detail", {
      status: res.status,
      body: text,
    });
    throw new Error(text || "Failed to update AC");
  }

  return res.json();
}


// ---------- Light control ----------

// Đọc trạng thái Light (kể cả đang auto theo schedule)
export async function getLightState(
  roomId: string,
  deviceId: string
): Promise<LightState> {
  const res = await fetch(
    `${BASE_URL}/rooms/${encodeURIComponent(
      roomId
    )}/devices/${encodeURIComponent(
      deviceId
    )}/light-state?code=${LIGHT_STATE_KEY}`,
    { cache: "no-store" }
  );

  if (!res.ok) {
    console.error("Failed to load light state", res.status, await res.text());
    throw new Error("Failed to load light state");
  }

  return res.json();
}

// Payload điều khiển Light
export type UpdateLightPayload = {
  powerState?: boolean;      // true/false, nếu không gửi sẽ toggle
  brightness?: number;       // 0–100
  durationMinutes?: number;  // override bao nhiêu phút, default 60
};

// Gửi lệnh manual override cho Light
export async function updateLightSettings(
  roomId: string,
  deviceId: string,
  payload: UpdateLightPayload
): Promise<LightState> {
  const res = await fetch(
    `${BASE_URL}/rooms/${encodeURIComponent(
      roomId
    )}/devices/${encodeURIComponent(
      deviceId
    )}/light-control?code=${LIGHT_CONTROL_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

    if (!res.ok) {
    const text = await res.text();
    console.error("Failed to update Light detail", {
      url: res.url,
      status: res.status,
      statusText: res.statusText,
      body: text,
    });
    throw new Error(text || `Failed to update Light (${res.status})`);
  }



  // Function trả về object JSON (roomId, deviceId, powerState, brightness, override...)
  return res.json();
}
