"use client"

import { useState, useEffect } from "react"
import { getRooms, type Room } from "@/lib/api"
import BuildingScene from "@/components/3d/building-scene"
import RoomDetailModal from "@/components/room-detail-rechart" 
import { Box, RefreshCcw } from "lucide-react"

export default function View3DTab() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)

  // Tách hàm fetch để dùng lại cho nút Refresh
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

  useEffect(() => {
    fetchData()
    // Tự động cập nhật mỗi 5 giây
    const interval = setInterval(fetchData, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="px-4 pt-6 pb-20 h-[calc(100vh-80px)] flex flex-col">
      <div className="flex-none mb-4 flex justify-between items-end">
        <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Box className="text-emerald-600" /> 
                3D Campus Digital Twin
            </h1>
            <p className="text-sm text-gray-500">Interactive 3D view of smart classrooms</p>
        </div>
        {/* Nút Refresh thủ công (tiện lợi khi demo) */}
        <button 
            onClick={() => { setLoading(true); fetchData(); }} 
            className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
            title="Reload Data"
        >
            <RefreshCcw size={18} />
        </button>
      </div>

      <div className="flex-1 min-h-0 border border-gray-200 rounded-2xl overflow-hidden shadow-sm bg-gray-50 relative">
        {loading && rooms.length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-400 bg-gray-50 flex-col gap-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
                Loading 3D Model...
            </div>
        ) : (
            <BuildingScene 
                rooms={rooms} 
                onSelectRoom={(room) => setSelectedRoom(room)} 
            />
        )}
      </div>

      {/* Gọi Component RoomDetailModal từ file rechart của bạn */}
      {selectedRoom && (
        <RoomDetailModal 
            room={selectedRoom} 
            onClose={() => setSelectedRoom(null)} 
        />
      )}
    </div>
  )
}