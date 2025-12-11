"use client"

import { Room } from "@/lib/api"
import { 
  Thermometer, 
  Sun, 
  Droplets, 
  Zap, 
  Footprints, 
  Clock, 
  Activity 
} from "lucide-react"

interface MetricsTabProps {
  room: Room
}

export default function MetricsTab({ room }: MetricsTabProps) {
  
  // Helper: Format thời gian từ UTC sang giờ địa phương
  const formatTime = (utcString?: string) => {
    if (!utcString) return "--"
    const date = new Date(utcString)
    return date.toLocaleString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit"
    })
  }

  // Helper: Chọn màu cho trạng thái chuyển động
  const getMotionColor = (detected?: boolean) => {
    return detected ? "text-red-600 bg-red-50" : "text-gray-500 bg-gray-100"
  }

  return (
    <div className="space-y-4 p-1">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        
        {/* 1. Card Nhiệt Độ */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium mb-1">Temperature</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-gray-900">
                {room.currentTemperature ?? "--"}
              </span>
              <span className="text-sm text-gray-500">°C</span>
            </div>
            {room.targetTemperature && (
              <p className="text-xs text-gray-400 mt-1">Target: {room.targetTemperature}°C</p>
            )}
          </div>
          <div className="w-10 h-10 rounded-full bg-orange-50 flex items-center justify-center text-orange-500">
            <Thermometer size={20} />
          </div>
        </div>

        {/* 2. Card Ánh Sáng */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium mb-1">Illuminance</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-gray-900">
                {room.currentIlluminance ?? "--"}
              </span>
              <span className="text-sm text-gray-500">Lux</span>
            </div>
            {room.targetLux && (
              <p className="text-xs text-gray-400 mt-1">Target: {room.targetLux} Lux</p>
            )}
          </div>
          <div className="w-10 h-10 rounded-full bg-yellow-50 flex items-center justify-center text-yellow-500">
            <Sun size={20} />
          </div>
        </div>

        {/* 3. Card Độ Ẩm (MỚI) */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium mb-1">Humidity</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-gray-900">
                {room.currentHumidity ?? "--"}
              </span>
              <span className="text-sm text-gray-500">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">Relative Humidity</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center text-blue-500">
            <Droplets size={20} />
          </div>
        </div>

        {/* 4. Card Năng Lượng & Công Suất (MỚI) */}
        <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-500 font-medium mb-1">Power & Energy</p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold text-gray-900">
                {room.currentPowerW ?? "--"}
              </span>
              <span className="text-sm text-gray-500">W</span>
            </div>
            <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
              <Activity size={12} />
              <span>Total: {room.currentEnergyKWh ?? "--"} kWh</span>
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-green-50 flex items-center justify-center text-green-600">
            <Zap size={20} />
          </div>
        </div>
      </div>

      {/* 5. Card Cảm Biến Chuyển Động (MỚI - Full Width) */}
      <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-gray-500 font-medium">Motion Sensor</p>
            <div className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 ${getMotionColor(room.motionDetected)}`}>
                <Footprints size={12} />
                {room.motionDetected ? "DETECTED" : "NO MOTION"}
            </div>
        </div>
        
        <div className="flex items-center gap-3 text-sm text-gray-600 bg-gray-50 p-3 rounded-xl">
            <Clock size={16} className="text-gray-400" />
            <div className="flex flex-col">
                <span className="text-xs text-gray-400">Last detection time:</span>
                <span className="font-medium">{formatTime(room.lastMotionUtc)}</span>
            </div>
        </div>
      </div>
    </div>
  )
}