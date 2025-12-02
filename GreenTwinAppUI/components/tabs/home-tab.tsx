"use client"

import { useState, useEffect } from "react"
import { User, Zap, Building2, ThermometerSun } from "lucide-react"
import RoomCard from "@/components/room-card"
import RoomDetailModal from "@/components/room-detail-modal"
import { getRooms, type Room } from "@/lib/api"

export default function HomeTab() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await getRooms()
        setRooms(data)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const totalEnergyKWh = rooms.reduce(
    (sum, room) => sum + (room.currentEnergyKWh ?? 0),
    0
  )

  const activeRooms = rooms.filter((r) => r.inClass).length

  const avgTemp =
    rooms.length > 0
      ? rooms.reduce(
          (sum, room) => sum + (room.currentTemperature ?? 0),
          0
        ) / rooms.length
      : 0

  const today = new Date()
  const dateString = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  })

  return (
    <div className="px-4 pt-6 pb-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-1">
              TDTU Campus
          </h1>
          <p className="text-sm text-gray-600">Today, {dateString}</p>
        </div>
        <button className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
          <User size={20} className="text-gray-600" />
        </button>
      </div>

      {/* Overview */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-6">
        <h3 className="text-sm font-semibold text-gray-600 mb-4 uppercase tracking-wide">
          Today&apos;s Overview
        </h3>

        {loading ? (
          <p className="text-sm text-gray-500">Loading summary…</p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mx-auto mb-3">
                <Building2 size={24} className="text-green-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {activeRooms}
              </p>
              <p className="text-xs text-gray-600 mt-1">Rooms in class</p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center mx-auto mb-3">
                <Zap size={24} className="text-amber-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {totalEnergyKWh.toFixed(1)}
              </p>
              <p className="text-xs text-gray-600 mt-1">kWh Today</p>
            </div>

            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mx-auto mb-3">
                <ThermometerSun size={24} className="text-blue-600" />
              </div>
              <p className="text-2xl font-bold text-gray-900">
                {avgTemp.toFixed(1)}°C
              </p>
              <p className="text-xs text-gray-600 mt-1">Avg Temp</p>
            </div>
          </div>
        )}
      </div>

      {/* Room list */}
      <div className="space-y-3 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 px-1">
          Classrooms
        </h2>

        {loading ? (
          <p className="px-1 text-sm text-gray-500">Loading rooms…</p>
        ) : rooms.length > 0 ? (
          rooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              onClick={() => setSelectedRoom(room)}
            />
          ))
        ) : (
          <p className="px-1 text-sm text-gray-500">No rooms available.</p>
        )}
      </div>

      {/* Room Detail Modal */}
      {selectedRoom && (
        <RoomDetailModal
          room={selectedRoom}
          onClose={() => setSelectedRoom(null)}
        />
      )}
    </div>
  )
}
