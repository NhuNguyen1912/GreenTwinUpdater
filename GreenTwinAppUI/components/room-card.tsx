"use client"

import { Droplets, ThermometerSun, Zap } from "lucide-react"
import type { Room } from "@/lib/api"

interface RoomCardProps {
  room: Room
  onClick: () => void
}

export default function RoomCard({ room, onClick }: RoomCardProps) {
  const isActive = room.inClass

  const tempText =
    room.currentTemperature != null ? `${room.currentTemperature.toFixed(1)}°C` : "--"

  const luxText =
    room.currentIlluminance != null ? `${room.currentIlluminance.toFixed(0)} lx` : "--"

  const energyText =
    room.currentEnergyKWh != null ? `${room.currentEnergyKWh.toFixed(2)} kWh` : "--"

  return (
    <button
      onClick={onClick}
      className="bg-white rounded-2xl p-5 w-full text-left hover:shadow-md transition-all border border-gray-100 hover:border-green-200"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-2.5 h-2.5 rounded-full ${
              isActive ? "bg-green-500 shadow-sm shadow-green-500/50" : "bg-gray-300"
            }`}
          />
          <div>
            <h3 className="font-bold text-gray-900 text-lg">{room.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {room.building} • {room.description ?? ""}
            </p>
          </div>
        </div>
      </div>

      {isActive ? (
        <div className="px-3 py-2 bg-green-50 rounded-lg mb-4">
          <p className="text-xs font-medium text-green-700">In class now</p>
          <p className="text-xs text-green-600 mt-0.5 truncate">
            {room.courseName ?? "Current class"}{" "}
            {room.lecturerName ? `• ${room.lecturerName}` : ""}
          </p>
        </div>
      ) : (
        <div className="px-3 py-2 bg-gray-50 rounded-lg mb-4">
          <p className="text-xs font-medium text-gray-700">No active class</p>
          <p className="text-xs text-gray-600 mt-0.5">
            Next class at {room.nextClass ?? "--"}
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <div className="flex justify-center mb-1">
            <ThermometerSun size={18} className="text-gray-400" />
          </div>
          <p className="text-xs font-semibold text-gray-900">{tempText}</p>
          <p className="text-[11px] text-gray-500">Temp</p>
        </div>

        <div className="text-center">
          <div className="flex justify-center mb-1">
            <Droplets size={18} className="text-gray-400" />
          </div>
          <p className="text-xs font-semibold text-gray-900">{luxText}</p>
          <p className="text-[11px] text-gray-500">Lux</p>
        </div>

        <div className="text-center">
          <div className="flex justify-center mb-1">
            <Zap size={18} className="text-gray-400" />
          </div>
          <p className="text-xs font-semibold text-gray-900">{energyText}</p>
          <p className="text-[11px] text-gray-500">kWh</p>
        </div>
      </div>
    </button>
  )
}
