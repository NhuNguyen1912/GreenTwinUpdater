"use client";

import { useState, useEffect } from "react";
import {
  Wind,
  Lightbulb,
  Thermometer,
  Droplets,
  Activity,
  Zap,
} from "lucide-react";
import ACDetailModal from "@/components/device-details/ac-detail-modal";
import LightDetailModal from "@/components/device-details/light-detail-modal";

import type { Room, Device } from "@/lib/api";
import { getDevicesForRoom } from "@/lib/api";

interface DevicesTabProps {
  room: Room;
}

/**
 * Tạm thời Azure trả về device.type khá generic (sensor / device),
 * nên mình thử đoán loại dựa trên type + name để hiển thị icon & group.
 */
function classifyDevice(device: Device): {
  baseType: "ac" | "light" | "sensor" | "other";
  sensorType?: "temperature" | "humidity" | "motion" | "energy" | "other";
} {
  const t = (device.type || "").toLowerCase();
  const n = (device.name || "").toLowerCase();

  // 👉 ƯU TIÊN SENSOR: nếu type hoặc name có chữ "sensor"
  if (t.includes("sensor") || n.includes("sensor")) {
    if (n.includes("temp")) return { baseType: "sensor", sensorType: "temperature" };
    if (n.includes("humid")) return { baseType: "sensor", sensorType: "humidity" };
    if (n.includes("motion") || n.includes("pir"))
      return { baseType: "sensor", sensorType: "motion" };
    if (n.includes("energy") || n.includes("meter"))
      return { baseType: "sensor", sensorType: "energy" };
    if (n.includes("light") || n.includes("lux"))
      return { baseType: "sensor", sensorType: "other" }; // light sensor
    return { baseType: "sensor", sensorType: "other" };
  }

  // Đoán AC từ type/name
  if (t.includes("ac") || t.includes("hvac") || n.includes("ac")) {
    return { baseType: "ac" };
  }

  // Đoán light từ type/name
  if (t.includes("light") || n.includes("light")) {
    return { baseType: "light" };
  }

  return { baseType: "other" };
}


function getDeviceIcon(baseType: string, sensorType?: string) {
  switch (baseType) {
    case "ac":
      return <Wind size={22} />;
    case "light":
      return <Lightbulb size={22} />;
    case "sensor":
      switch (sensorType) {
        case "temperature":
          return <Thermometer size={22} />;
        case "humidity":
          return <Droplets size={22} />;
        case "motion":
          return <Activity size={22} />;
        case "energy":
          return <Zap size={22} />;
        default:
          return <Activity size={22} />;
      }
    default:
      return <Zap size={22} />;
  }
}

function getIconBgColor(baseType: string, sensorType?: string) {
  if (baseType === "ac") return "bg-blue-50 text-blue-600";
  if (baseType === "light") return "bg-yellow-50 text-yellow-600";
  if (baseType === "sensor") {
    switch (sensorType) {
      case "temperature":
        return "bg-orange-50 text-orange-600";
      case "humidity":
        return "bg-cyan-50 text-cyan-600";
      case "motion":
        return "bg-purple-50 text-purple-600";
      case "energy":
        return "bg-amber-50 text-amber-600";
      default:
        return "bg-gray-50 text-gray-600";
    }
  }
  return "bg-gray-50 text-gray-600";
}

export default function DevicesTab({ room }: DevicesTabProps) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  type ClassifiedDevice = Device & {
    baseType: "ac" | "light" | "sensor" | "other";
    sensorType?: "temperature" | "humidity" | "motion" | "energy" | "other";
  };
  const [selectedDevice, setSelectedDevice] = useState<ClassifiedDevice | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const data = await getDevicesForRoom(room.id);

        if (!cancelled) {
          setDevices(data);
        }
      } catch (err) {
        console.error("Failed to load devices", err);
        if (!cancelled) setError("Failed to load devices");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  const enriched = devices.map((d) => {
    const cls = classifyDevice(d);
    return { ...d, ...cls };
  });

  const controllableDevices = enriched.filter(
    (d) => d.baseType === "ac" || d.baseType === "light"
  );
  const sensors = enriched.filter((d) => d.baseType === "sensor");

  if (loading) {
    return <div className="text-sm text-gray-500 px-1 py-4">Loading devices…</div>;
  }

  if (error) {
    return (
      <div className="text-sm text-red-500 px-1 py-4">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Controllable Devices */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 px-1">
          Controllable Devices
        </h3>
        {controllableDevices.length === 0 && (
          <p className="text-xs text-gray-500 px-1">
            No controllable devices detected for this room.
          </p>
        )}
        <div className="space-y-3">
          {controllableDevices.map((device) => (
            <button
              key={device.id}
              onClick={() => setSelectedDevice(device)}
              className="bg-white rounded-2xl p-5 w-full text-left hover:shadow-md transition-all border border-gray-100 hover:border-green-200"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-4 flex-1">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center ${getIconBgColor(
                      device.baseType!,
                      device.sensorType as any
                    )}`}
                  >
                    {getDeviceIcon(device.baseType!, device.sensorType)}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900 mb-1">
                      {device.name}
                    </h4>
                    <p className="text-xs text-gray-500">
                      {device.type} • {device.id}
                    </p>
                  </div>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-medium ${
                    (device.status || "").toLowerCase() === "online"
                      ? "bg-green-50 text-green-700"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {device.status || "unknown"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Sensors */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 px-1">
          Sensors (Read-only)
        </h3>
        {sensors.length === 0 && (
          <p className="text-xs text-gray-500 px-1">
            No sensors detected for this room.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {sensors.map((device) => (
            <div
              key={device.id}
              className="bg-white rounded-2xl p-4 border border-gray-100"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${getIconBgColor(
                    device.baseType!,
                    device.sensorType as any
                  )}`}
                >
                  {getDeviceIcon(device.baseType!, device.sensorType)}
                </div>
                <div>
                  <h4 className="font-semibold text-gray-900 text-sm">
                    {device.name}
                  </h4>
                  <p className="text-xs text-gray-500">{device.type}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Status:{" "}
                <span className="font-medium text-gray-800">
                  {device.status || "unknown"}
                </span>
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Device Detail Modals (chỉ mở nếu sau này có AC / Light thật) */}
      {selectedDevice && selectedDevice.baseType === "ac" && (
        <ACDetailModal
          device={selectedDevice}
          roomId={room.id}
          onClose={() => setSelectedDevice(null)}
        />
      )}
      {selectedDevice && selectedDevice.baseType === "light" && (
        <LightDetailModal
          device={selectedDevice}
          onClose={() => setSelectedDevice(null)}
        />
      )}
    </div>
  );
}
