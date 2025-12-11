"use client"

import { useState, useEffect } from "react"
import HomeTab from "@/components/tabs/home-tab"
import RoomsTab from "@/components/tabs/rooms-tab"
import ScheduleTab from "@/components/tabs/schedule-tab"
import { Home, Building2, Calendar, Box } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import { useRouter } from "next/navigation"
import View3DTab from "@/components/tabs/view-3d-tab"

export default function GreenTwinApp() {
  const { isAuthenticated, user, logout } = useAuth() // <-- Lấy user
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<"home" | "rooms" | "schedule" | "3d">("home")

  // Check login
  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login")
    }
  }, [isAuthenticated, router])

  if (!isAuthenticated) return null; // Tránh render nội dung khi chưa check xong

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex-1 overflow-y-auto pb-20">
        {activeTab === "home" && <HomeTab />}
        {activeTab === "rooms" && <RoomsTab />}
        {activeTab === "schedule" && <ScheduleTab />}
        {activeTab === "3d" && <View3DTab />}
      </div>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 shadow-lg">
        <div className="flex justify-around items-center py-2">
          <button
            onClick={() => setActiveTab("home")}
            className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${
              activeTab === "home" ? "text-green-600 bg-green-50" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Home size={24} strokeWidth={activeTab === "home" ? 2.5 : 2} />
            <span className="text-xs font-medium">Home</span>
          </button>
          <button
            onClick={() => setActiveTab("rooms")}
            className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${
              activeTab === "rooms" ? "text-green-600 bg-green-50" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Building2 size={24} strokeWidth={activeTab === "rooms" ? 2.5 : 2} />
            <span className="text-xs font-medium">Rooms</span>
          </button>
          <button
            onClick={() => setActiveTab("schedule")}
            className={`flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all ${
              activeTab === "schedule" ? "text-green-600 bg-green-50" : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <Calendar size={24} strokeWidth={activeTab === "schedule" ? 2.5 : 2} />
            <span className="text-xs font-medium">Schedule</span>
          </button>
          <button
          onClick={() => setActiveTab("3d")}
          className={`flex flex-col items-center gap-1 px-4 py-2 rounded-xl transition-all ${
            activeTab === "3d" ? "text-green-600 bg-green-50" : "text-gray-600 hover:text-gray-900"
          }`}
        >
          <Box size={24} strokeWidth={activeTab === "3d" ? 2.5 : 2} />
          <span className="text-xs font-medium">3D View</span>
        </button>
        </div>
      </nav>
    </main>
  )
}
