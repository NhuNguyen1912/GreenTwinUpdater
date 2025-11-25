"use client"

import { ThermometerSun, Sun } from "lucide-react"
import type { Room } from "@/lib/api"

interface MetricsTabProps {
  room: Room
}

export default function MetricsTab({ room }: MetricsTabProps) {
  const currentTemp = room.currentTemperature ?? null
  const targetTemp = room.targetTemperature ?? null

  const currentLux = room.currentIlluminance ?? null
  const targetLux = room.targetLux ?? null

  const tempDiff =
    currentTemp != null && targetTemp != null ? currentTemp - targetTemp : null

  return (
    <div className="space-y-4">
      {/* Temperature card */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
            <ThermometerSun size={20} className="text-orange-600" />
          </div>
          <h3 className="font-semibold text-gray-900">Temperature</h3>
        </div>

        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-sm text-gray-600 mb-1">Current</p>
            <p className="text-4xl font-bold text-gray-900">
              {currentTemp != null ? currentTemp.toFixed(1) : "--"}
              <span className="text-2xl">°C</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 mb-1">Target</p>
            <p className="text-3xl font-bold text-green-600">
              {targetTemp != null ? targetTemp.toFixed(1) : "--"}
              <span className="text-xl">°C</span>
            </p>
          </div>
        </div>

        <p className="text-sm text-gray-600">
          {tempDiff == null
            ? "No comparison available"
            : tempDiff > 0
            ? `${tempDiff.toFixed(1)}°C above target`
            : tempDiff < 0
            ? `${Math.abs(tempDiff).toFixed(1)}°C below target`
            : "At target temperature"}
        </p>
      </div>

      {/* Illuminance card */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-yellow-50 flex items-center justify-center">
            <Sun size={20} className="text-yellow-600" />
          </div>
          <h3 className="font-semibold text-gray-900">Illuminance</h3>
        </div>

        <div className="flex items-end justify-between mb-4">
          <div>
            <p className="text-sm text-gray-600 mb-1">Current</p>
            <p className="text-3xl font-bold text-gray-900">
              {currentLux != null ? currentLux.toFixed(0) : "--"}
              <span className="text-lg"> lux</span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-gray-600 mb-1">Target</p>
            <p className="text-2xl font-bold text-green-600">
              {targetLux != null ? targetLux.toFixed(0) : "--"}
              <span className="text-lg"> lux</span>
            </p>
          </div>
        </div>

        {currentLux != null && targetLux != null && (
          <div
            className={`inline-block px-3 py-1.5 rounded-lg text-xs font-medium ${
              currentLux >= targetLux
                ? "bg-green-50 text-green-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {currentLux >= targetLux ? "Comfortable" : "Below target"}
          </div>
        )}

        {(currentLux == null || targetLux == null) && (
          <p className="text-xs text-gray-400">No lux target configured</p>
        )}
      </div>
    </div>
  )
}
