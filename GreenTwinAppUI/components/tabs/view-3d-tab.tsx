"use client"

import { useState, useEffect } from "react"
import { getRooms, type Room } from "@/lib/api"
import BuildingScene from "@/components/3d/building-scene"
import RoomDetailModal from "@/components/room-detail-modal"
import { Box } from "lucide-react"

export default function View3DTab() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await getRooms()
        setRooms(data)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    
    fetchData()
    // Cập nhật realtime mỗi 5 giây để đổi màu phòng nếu có người vào
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="px-4 pt-6 pb-20 h-[calc(100vh-80px)] flex flex-col">
      <div className="flex-none mb-4">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Box className="text-emerald-600" /> 
            3D Campus Digital Twin
        </h1>
        <p className="text-sm text-gray-500">Interactive 3D view of smart classrooms</p>
      </div>

      <div className="flex-1 min-h-0 border border-gray-200 rounded-2xl overflow-hidden">
        {loading ? (
            <div className="flex h-full items-center justify-center text-gray-400 bg-gray-50">
                Loading 3D Model...
            </div>
        ) : (
            <BuildingScene rooms={rooms} onSelectRoom={setSelectedRoom} />
        )}
      </div>

      {selectedRoom && (
        <RoomDetailModal room={selectedRoom} onClose={() => setSelectedRoom(null)} />
      )}
    </div>
  )
}