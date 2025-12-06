"use client"

import { 
  Thermometer, 
  Droplets, 
  Sun, 
  Zap, 
  Activity, 
  Clock,
  User
} from "lucide-react"
import type { Room } from "@/lib/api"
import { format } from "date-fns"

// --- Helper Component: Thẻ hiển thị chỉ số (Metric Card) ---
interface MetricCardProps {
  title: string
  value: string | number
  unit?: string
  icon: any
  colorClass: string // Ví dụ: "text-blue-600"
  bgColorClass: string // Ví dụ: "bg-blue-50"
  subValue?: string
}

function MetricCard({ title, value, unit, icon: Icon, colorClass, bgColorClass, subValue }: MetricCardProps) {
  return (
    <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow h-full">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{title}</p>
        <div className={`p-2 rounded-lg ${bgColorClass} ${colorClass}`}>
          <Icon size={18} />
        </div>
      </div>
      
      <div>
        <div className="flex items-baseline gap-1">
          <span className={`text-2xl font-bold ${colorClass}`}>
            {value}
          </span>
          {unit && <span className="text-sm text-gray-500 font-medium">{unit}</span>}
        </div>
        {subValue && (
          <p className="text-xs text-gray-400 mt-1.5 border-t border-gray-50 pt-1.5">
            {subValue}
          </p>
        )}
      </div>
    </div>
  )
}

// --- Main Component ---
interface MetricsTabProps {
  room: Room
}

export default function MetricsTab({ room }: MetricsTabProps) {
  
  // 1. Format thời gian Last Motion
  let lastMotionText = "--";
  if (room.lastMotion) {
    try {
      // Parse string ISO (2025-12-05T08:18...) sang giờ hiển thị
      lastMotionText = format(new Date(room.lastMotion), "HH:mm dd/MM");
    } catch (e) { 
      lastMotionText = room.lastMotion 
    }
  }

  // 2. Logic Occupancy (Dựa vào Motion sensor hoặc inClass)
  const isOccupied = room.isOccupied || room.inClass;

  return (
    <div className="space-y-6">
      
      {/* KHỐI 1: NĂNG LƯỢNG (Energy & Power) */}
      {/* Hiển thị Power (W) và Energy (kWh) từ hình ảnh PZEM-004T */}
      <div>
        <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Zap size={16} className="text-amber-500" />
          Tiêu Thụ Năng Lượng
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <MetricCard 
            title="Công Suất (Power)"
            value={room.currentPowerW?.toFixed(1) ?? "--"}
            unit="W"
            icon={Activity}
            colorClass="text-amber-600"
            bgColorClass="bg-amber-50"
            subValue="Tải tiêu thụ tức thời"
          />
          <MetricCard 
            title="Điện Năng (Energy)"
            value={room.currentEnergyKWh?.toFixed(2) ?? "--"}
            unit="kWh"
            icon={Zap}
            colorClass="text-emerald-600"
            bgColorClass="bg-emerald-50"
            subValue="Tổng điện năng tích lũy"
          />
        </div>
      </div>

      {/* KHỐI 2: MÔI TRƯỜNG (Environment) */}
      {/* Hiển thị Temp, Humidity (từ HumA001), Illuminance */}
      <div>
        <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <Thermometer size={16} className="text-blue-500" />
          Môi Trường
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard 
            title="Nhiệt độ"
            value={room.currentTemperature?.toFixed(1) ?? "--"}
            unit="°C"
            icon={Thermometer}
            colorClass="text-rose-600"
            bgColorClass="bg-rose-50"
            subValue={room.targetTemperature ? `Mục tiêu: ${room.targetTemperature}°C` : "Chưa đặt mục tiêu"}
          />
          <MetricCard 
            title="Độ ẩm"
            value={room.currentHumidity?.toFixed(1) ?? "--"}
            unit="%"
            icon={Droplets}
            colorClass="text-cyan-600"
            bgColorClass="bg-cyan-50"
            subValue="Độ ẩm không khí"
          />
          <MetricCard 
            title="Ánh sáng"
            value={room.currentIlluminance?.toFixed(0) ?? "--"}
            unit="Lux"
            icon={Sun}
            colorClass="text-orange-500"
            bgColorClass="bg-orange-50"
            subValue={room.targetLux ? `Mục tiêu: ${room.targetLux} Lx` : "Chưa đặt mục tiêu"}
          />
        </div>
      </div>

      {/* KHỐI 3: HIỆN DIỆN (Occupancy) */}
      {/* Hiển thị trạng thái MotionA001 */}
      <div>
         <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
          <User size={16} className="text-purple-500" />
          Trạng thái Phòng
        </h3>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${isOccupied ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"}`}>
                    <User size={24} />
                </div>
                <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Cảm biến chuyển động</p>
                    <p className={`text-lg font-bold ${isOccupied ? "text-green-700" : "text-gray-600"}`}>
                        {isOccupied ? "Phát hiện có người" : "Không có người"}
                    </p>
                </div>
            </div>
            
            <div className="text-right">
                <div className="flex items-center justify-end gap-1 text-gray-400 mb-1">
                    <Clock size={14} />
                    <span className="text-xs font-semibold uppercase">Lần cuối phát hiện</span>
                </div>
                <div className="bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 inline-block">
                    <span className="text-sm font-mono text-gray-700 font-medium">
                        {lastMotionText}
                    </span>
                </div>
            </div>
        </div>
      </div>

    </div>
  )
}