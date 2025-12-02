"use client"

import { useState } from "react"
import { X, Clock, Info } from "lucide-react"
import MetricsTab from "@/components/detail-tabs/metrics-tab"
import DevicesTab from "@/components/detail-tabs/devices-tab"
import ScheduleTabDetail from "@/components/detail-tabs/schedule-tab"
import type { Room } from "@/lib/api"

interface RoomDetailModalProps {
  room: Room
  onClose: () => void
}

export default function RoomDetailModal({ room, onClose }: RoomDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"metrics" | "devices" | "schedule">("metrics")

  const isActive = room.inClass === true

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
      {/* modal container KHÔNG scroll, chỉ chứa flex-col */}
      <div className="w-full max-w-6xl bg-white rounded-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* HEADER – đứng yên trên cùng */}
        <div className="border-b border-gray-200 p-6">
          <div className="flex items-start justify-between mb-4">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isActive
                      ? "bg-green-500 shadow-sm shadow-green-500/50"
                      : "bg-gray-400"
                  }`}
                />
                <h2 className="text-2xl font-bold text-gray-900">
                  {room.name}
                </h2>
              </div>

              <p className="text-sm text-gray-600">
                {room.building} • Floor {room.floor ?? "1"}
              </p>
            </div>

            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
            >
              <X size={24} className="text-gray-700" />
            </button>
          </div>

          {/* CLASS STATUS BOX */}
          {isActive ? (
            <div className="bg-green-50 rounded-xl p-4 border border-green-100">
              <div className="flex items-start gap-3">
                <Clock size={20} className="text-green-600 mt-0.5" />
                <div>
                  <p className="font-semibold text-green-900">In class now</p>

                  {room.courseName && (
                    <p className="text-sm text-green-700 mt-1">
                      {room.courseName}
                      {room.lecturerName ? ` • ${room.lecturerName}` : ""}
                    </p>
                  )}

                  <p className="text-xs text-green-600 mt-1">
                    Time left: --
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <div className="flex items-start gap-3">
                <Info size={20} className="text-gray-500 mt-0.5" />
                <div>
                  <p className="font-semibold text-gray-900">No active class</p>

                  <p className="text-sm text-gray-600 mt-1">
                    Next class at {room.nextClass ?? "--"}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TABS – cũng đứng yên, chỉ content bên dưới scroll */}
        <div className="border-b border-gray-100 px-6 py-3 flex gap-2">
          {(["metrics", "devices", "schedule"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2.5 rounded-xl font-medium text-sm transition-all ${
                activeTab === tab
                  ? "bg-green-600 text-white shadow-sm"
                  : "bg-gray-50 text-gray-700 hover:bg-gray-100"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* TAB CONTENT – CHỈ PHẦN NÀY SCROLL */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 pb-10">
          {activeTab === "metrics" && <MetricsTab room={room} />}
          {activeTab === "devices" && <DevicesTab room={room} />}
          {activeTab === "schedule" && <ScheduleTabDetail room={room} />}
        </div>
      </div>
    </div>
  )
}
