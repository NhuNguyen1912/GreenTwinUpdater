"use client";

import { useState, useEffect } from "react";
import { Search, Wind, Lightbulb, Thermometer, Zap } from "lucide-react";
import type { Room, Device } from "@/lib/api";
import { getDevicesForRoom } from "@/lib/api";

type FilterKey = "all" | "ac" | "lights" | "sensors" | "energy";

interface DevicesTabProps {
  room: Room;
}

export default function DevicesTab({ room }: DevicesTabProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) {
          setError("Failed to load devices");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  function getIconForType(deviceType: string) {
    const t = deviceType.toLowerCase();
    if (t.includes("ac") || t.includes("hvac")) return Wind;
    if (t.includes("light")) return Lightbulb;
    if (t.includes("temp") || t.includes("sensor")) return Thermometer;
    if (t.includes("energy") || t.includes("meter")) return Zap;
    return Zap;
  }

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "ac", label: "AC" },
    { key: "lights", label: "Lights" },
    { key: "sensors", label: "Sensors" },
    { key: "energy", label: "Energy" },
  ];

  const filteredDevices = devices.filter((device) => {
    const name = device.name?.toLowerCase() ?? "";
    const type = device.type?.toLowerCase() ?? "";

    const matchesSearch = name.includes(searchQuery.toLowerCase());

    const matchesFilter =
      activeFilter === "all" ||
      (activeFilter === "ac" && type.includes("ac")) ||
      (activeFilter === "lights" && type.includes("light")) ||
      (activeFilter === "sensors" && type.includes("sensor")) ||
      (activeFilter === "energy" &&
        (type.includes("energy") || type.includes("meter")));

    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return (
      <div className="px-4 pt-2 pb-6 text-sm text-gray-500">
        Loading devices…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 pt-2 pb-6 text-sm text-red-500">
        {error}
      </div>
    );
  }

  return (
    <div className="px-4 pt-2 pb-6">
      <div className="mb-6 flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
        <Search size={20} className="text-gray-400" />
        <input
          type="text"
          placeholder="Search devices..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 outline-none text-gray-900"
        />
      </div>

      <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
        {filters.map((filter) => (
          <button
            key={filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`px-4 py-2 rounded-full whitespace-nowrap font-medium text-sm transition-all ${
              activeFilter === filter.key
                ? "bg-emerald-500 text-white shadow-md shadow-emerald-500/30"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 pb-12">
        {filteredDevices.map((device) => {
          const Icon = getIconForType(device.type);

          return (
            <div
              key={device.id}
              className="glass-panel p-5 w-full text-left hover:shadow-md transition-all hover:border-green-300/40 border border-transparent rounded-2xl bg-white"
            >
              <div className="flex items-start gap-4">
                <div className="p-3 bg-emerald-50 rounded-lg text-emerald-600">
                  <Icon size={24} />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900">
                    {device.name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    {device.roomName || room.name}
                  </p>
                </div>

                <div
                  className={`text-xs font-medium px-3 py-1 rounded-full ${
                    device.status?.toLowerCase() === "online"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-gray-100 text-gray-700"
                  }`}
                >
                  {device.status || "unknown"}
                </div>
              </div>
            </div>
          );
        })}

        {filteredDevices.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-6">
            No devices found
          </p>
        )}
      </div>
    </div>
  );
}
