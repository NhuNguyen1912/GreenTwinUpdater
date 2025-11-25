"use client"

import { useState, useEffect } from "react"
import { Search } from "lucide-react"
import RoomCard from "@/components/room-card"
import RoomDetailModal from "@/components/room-detail-modal"
import { getRooms, type Room } from "@/lib/api"
import DevicesTab from "@/components/detail-tabs/devices-tab"


export default function RoomsTab() {
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [filter, setFilter] = useState<"all" | "active" | "idle">("all")
  const [searchQuery, setSearchQuery] = useState("")

  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const data = await getRooms()
        console.log("Loaded rooms from API:", data) // DEBUG
        setRooms(data)
      } catch (err) {
        console.error("Error loading rooms", err)
        setRooms([])
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const filteredRooms = rooms.filter((room) => {
    const matchesFilter =
      filter === "all" ||
      (filter === "active" && room.inClass) ||
      (filter === "idle" && !room.inClass)

    const q = searchQuery.toLowerCase()
    const matchesSearch =
      room.name.toLowerCase().includes(q) ||
      room.building.toLowerCase().includes(q)

    return matchesFilter && matchesSearch
  })

  if (loading) {
    return (
      <div className="px-4 pt-6 pb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Rooms</h1>
        <div className="p-4 text-sm text-gray-500">Loading rooms…</div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-6 pb-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Rooms</h1>

      {/* Search Bar */}
      <div className="relative mb-4">
        <Search
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          type="text"
          placeholder="Search by room or building..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-12 pr-4 py-3 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-gray-900"
        />
      </div>

      {/* Filter Chips */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter("all")}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            filter === "all"
              ? "bg-green-600 text-white shadow-sm"
              : "bg-white text-gray-700 border border-gray-200 hover:border-gray-300"
          }`}
        >
          All Rooms
        </button>
        <button
          onClick={() => setFilter("active")}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            filter === "active"
              ? "bg-green-600 text-white shadow-sm"
              : "bg-white text-gray-700 border border-gray-200 hover:border-gray-300"
          }`}
        >
          In Class
        </button>
        <button
          onClick={() => setFilter("idle")}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            filter === "idle"
              ? "bg-green-600 text-white shadow-sm"
              : "bg-white text-gray-700 border border-gray-200 hover:border-gray-300"
          }`}
        >
          Idle
        </button>
      </div>

      {/* Room List */}
      {filteredRooms.length > 0 ? (
        <div className="space-y-3">
          {filteredRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              onClick={() => setSelectedRoom(room)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <p className="text-gray-500">No rooms found</p>
        </div>
      )}

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
