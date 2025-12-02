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
  // NEW: Thêm 2 trường hiệu lực
  effectiveFrom?: string; // Format YYYY-MM-DD
  effectiveTo?: string;   // Format YYYY-MM-DD
  enabled?: boolean;
  isException?: boolean
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

// --- ROOM KEYS ---
const ROOMS_KEY =
  "XcGh9Rjnkz-NiNrgK6_qD4_slZugmc38Qob2svJAcFEJAzFuoBUalg==";

const DEVICES_KEY =
  "uKQLG3SulECzSU_jJPLsNBoVPG889Qy5IaaxNmiJ5G9QAzFuPH_SrQ==";

// --- SCHEDULE KEYS (TODO: Hãy điền key thật từ Azure Portal vào đây) ---
const SCHEDULES_KEY = "eSCCmJ4DKYgcmQ0YPab8aDMJ5pWuSJQLO7-n3PnV2i5AAzFuSIAbLg=="; 
const CREATE_SCHED_KEY = "OnmL436GYbEjy9MQ9CCxvK3Bhb0vRmC7_aDn8vYHuvBBAzFuK1NCMw=="; 
const DEL_SCHED_KEY = "Z7O9oOwF5F0YLXg46BvQ_SsVZyjPyVMZqIirU8gsFZhGAzFu0IKyig=="; 

// --- CONTROL KEYS ---
const AC_CONTROL_KEY =
  "bQAT_PQdIK8_JdHjU6tb1XvNt6-NQ77MnXYtMztVqdCYAzFuGFUySQ=="; 

const AC_STATE_KEY = "8d-Vxdj_SdNoek78nrbj3k8s1UWfbKXwt27XjEZxyp7PAzFucjwhVg==";

const LIGHT_CONTROL_KEY =
  "s8nazlhbZ6i5h2WAj2FzPkj0p-H1NtkkrZLHT_h6RAKzAzFunXpung==";

const LIGHT_STATE_KEY =
  "Mk8ouqhlOoqhCxYnIgxF3aVleuQ2TBujU-f-bpG_p1GDAzFuZq9lFA==";

// ---------- API calls ----------

// 1. Lấy danh sách phòng
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

// 2. Lấy danh sách lịch học (API Thật)
export async function getSchedules(): Promise<Schedule[]> {
  // Gọi endpoint GetSchedules
  const res = await fetch(`${BASE_URL}/schedules?code=${SCHEDULES_KEY}`, { 
    cache: "no-store" 
  });

  if (!res.ok) {
    console.error("Failed load schedules", res.status);
    return []; // Trả về rỗng nếu lỗi để không crash UI
  }
  return res.json();
}

// 3. Tạo lịch học mới (API Thật) - Đã cập nhật Payload
export async function createSchedule(
  roomId: string, 
  data: { 
    courseName: string; 
    lecturer: string; 
    weekdays: string[]; 
    startTime: string; 
    endTime: string; 
    // NEW: Thêm 2 trường này vào payload gửi đi
    effectiveFrom: string;
    effectiveTo: string;
  }
): Promise<Schedule> {
  const res = await fetch(
    `${BASE_URL}/rooms/${roomId}/schedules?code=${CREATE_SCHED_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Failed to create schedule");
  }
  return res.json();
}

// 4. Xóa lịch học (API Thật)
export async function deleteSchedule(scheduleId: string): Promise<void> {
  // Encode ID để tránh lỗi URL nếu ID có ký tự đặc biệt
  const encodedId = encodeURIComponent(scheduleId);
  
  const res = await fetch(
    `${BASE_URL}/schedules/${encodedId}?code=${DEL_SCHED_KEY}`,
    { method: "DELETE" }
  );

  if (!res.ok) {
    // Đọc text lỗi từ server để debug
    const errorText = await res.text();
    console.error(`Delete failed (Status: ${res.status}):`, errorText);
    throw new Error(`Failed to delete schedule: ${res.status} ${errorText}`);
  }
}

// 5. Lấy danh sách thiết bị trong 1 room
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

// --- AC Control ---

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
  durationMinutes?: number;
};

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


// --- Light control ---

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

export type UpdateLightPayload = {
  powerState?: boolean;
  brightness?: number;
  durationMinutes?: number;
};

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

  return res.json();
}