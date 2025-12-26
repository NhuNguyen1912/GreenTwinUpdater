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

  currentHumidity?: number       
  currentPowerW?: number         
  currentEnergyKWh?: number      
  motionDetected?: boolean       
  lastMotionUtc?: string

  policy?: {
    overrideActive: boolean
    overrideUntil?: string
  }
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
  lastUpdatedBy?: string | null;
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


const BASE_URL = "/api/backend"; // gọi proxy nội bộ


// ---------- API calls ----------

// 1. Lấy danh sách phòng
export async function getRooms(): Promise<Room[]> {
  const res = await fetch(`${BASE_URL}/rooms`, {
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
  const res = await fetch(`${BASE_URL}/schedules`, { 
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
    `${BASE_URL}/rooms/${roomId}/schedules`,
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
    `${BASE_URL}/schedules/${encodedId}`,
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
    `${BASE_URL}/rooms/${encodeURIComponent(roomId)}/devices`,
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
    )}/ac-state`,
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
    )}/ac-control`,
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
    )}/light-state`,
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
  user?: string;
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
    )}/light-control`,
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