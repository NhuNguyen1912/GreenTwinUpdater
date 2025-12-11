"use client"

import { useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { OrbitControls, Environment, Text, Grid, Edges, Html } from "@react-three/drei"
import * as THREE from "three"
import { Room } from "@/lib/api"

// --- COMPONENT: MÁY LẠNH (AC UNIT) ---
// Tự động quay cánh quạt khi có điện
function ACUnit({ isOn }: { isOn: boolean }) {
  const fanRef = useRef<THREE.Group>(null)

  // Loop chạy liên tục mỗi khung hình (60fps)
  useFrame((state, delta) => {
    // Nếu đang bật -> Xoay trục Z
    if (isOn && fanRef.current) {
      fanRef.current.rotation.z -= delta * 15 // Tốc độ quay
    }
  })

  return (
    <group position={[0, 0.5, -1.4]}> {/* Gắn lên tường sau */}
      {/* Vỏ máy lạnh */}
      <mesh>
        <boxGeometry args={[1.2, 0.4, 0.4]} />
        <meshStandardMaterial color="white" />
      </mesh>
      
      {/* Cánh quạt (Nằm trong group để xoay) */}
      <group position={[0, 0, 0.21]} ref={fanRef}>
        <mesh>
            <boxGeometry args={[0.9, 0.1, 0.02]} />
            <meshStandardMaterial color={isOn ? "#3b82f6" : "#9ca3af"} /> {/* Xanh nếu bật, Xám nếu tắt */}
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
            <boxGeometry args={[0.9, 0.1, 0.02]} />
            <meshStandardMaterial color={isOn ? "#3b82f6" : "#9ca3af"} />
        </mesh>
      </group>
      
      {/* Đèn LED trạng thái */}
      <mesh position={[0.5, -0.15, 0.21]}>
        <sphereGeometry args={[0.03]} />
        <meshStandardMaterial 
            color={isOn ? "#22c55e" : "#ef4444"} 
            emissive={isOn ? "#22c55e" : "#ef4444"} 
            emissiveIntensity={isOn ? 2 : 0} 
        />
      </mesh>
    </group>
  )
}

// --- COMPONENT: CĂN PHÒNG ---
function RoomBox({ room, index, onClick }: { room: Room, index: number, onClick: (r: Room) => void }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false) // State hover cho tooltip
  
  // 1. Logic màu nền (Priority: InClass > Motion > Empty)
  const baseColor = new THREE.Color(
    room.inClass ? "#ef4444" : room.motionDetected ? "#f97316" : "#22c55e"
  )

  // 2. Logic trạng thái thiết bị & Policy
  const isAcOn = (room.currentPowerW ?? 0) > 10
  const isOverride = room.policy?.overrideActive ?? false 

  // 3. Animation cho phòng (Hiệu ứng Pulse khi có Motion)
  useFrame((state) => {
    if (!meshRef.current) return
    
    // Nếu có người (Motion), làm màu sắc dao động nhẹ theo thời gian
    if (room.motionDetected) {
      const t = state.clock.getElapsedTime()
      const intensity = 0.5 + Math.sin(t * 3) * 0.2 // Dao động từ 0.3 đến 0.7
      
      // Clone material để không ảnh hưởng phòng khác
      if (meshRef.current.material instanceof THREE.MeshStandardMaterial) {
         meshRef.current.material.opacity = 0.8 + Math.sin(t * 3) * 0.1
         meshRef.current.material.emissive.setHex(0xf97316) // Màu cam
         meshRef.current.material.emissiveIntensity = intensity * 0.5
      }
    } else {
        // Reset nếu không có người
        if (meshRef.current.material instanceof THREE.MeshStandardMaterial) {
            meshRef.current.material.emissiveIntensity = 0
        }
    }
  })

  // Xếp vị trí (2 hàng)
  const x = (index % 3) * 4 - 4
  const z = Math.floor(index / 3) * 4 - 2

  return (
    <group position={[x, 1, z]}>
      {/* --- KHỐI HỘP PHÒNG --- */}
      <mesh 
        ref={meshRef}
        onClick={(e) => { e.stopPropagation(); onClick(room) }}
        onPointerOver={() => { document.body.style.cursor = 'pointer'; setHovered(true) }}
        onPointerOut={() => { document.body.style.cursor = 'auto'; setHovered(false) }}
      >
        <boxGeometry args={[3, 2, 3]} />
        <meshStandardMaterial 
          color={baseColor} 
          opacity={0.8} 
          transparent
        />

        {/* --- TÍNH NĂNG MỚI: OUTLINE XANH KHI OVERRIDE --- */}
        {isOverride && (
          <Edges 
            linewidth={4} 
            scale={1.02} 
            threshold={15} 
            color="#3b82f6" // Xanh dương
          />
        )}
      </mesh>

      {/* --- TOOLTIP KHI HOVER --- */}
      {isOverride && hovered && (
        <Html position={[0, 2.5, 0]} center distanceFactor={10} zIndexRange={[100, 0]}>
          <div className="bg-blue-600 text-white text-xs px-2 py-1 rounded shadow-lg whitespace-nowrap border border-blue-400 opacity-90 pointer-events-none font-sans">
            Manual override until {room.policy?.overrideUntil ?? "--:--"}
          </div>
          <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-blue-600 mx-auto opacity-90"></div>
        </Html>
      )}

      {/* Viền trắng mờ (Wireframe) */}
      <mesh>
        <boxGeometry args={[3.05, 2.05, 3.05]} />
        <meshStandardMaterial wireframe color="white" opacity={0.3} transparent />
      </mesh>

      {/* MÁY LẠNH 3D (Đã phục hồi) */}
      <ACUnit isOn={isAcOn} />

      {/* Text Thông số trên nóc */}
      <Text position={[0, 1.5, 0]} fontSize={0.4} color="#1f2937" anchorY="middle" outlineWidth={0.02} outlineColor="white">
        {room.name}
      </Text>
      
      <group position={[0, 1.1, 0]}>
        <Text position={[0, 0, 0]} fontSize={0.25} color="#374151" anchorY="middle">
          {room.currentTemperature ? `${room.currentTemperature}°C` : "--"}
        </Text>
        {room.currentHumidity && (
          <Text position={[0, -0.3, 0]} fontSize={0.2} color="#6b7280" anchorY="middle">
            {`${room.currentHumidity}%`}
          </Text>
        )}
      </group>
    </group>
  )
}

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <planeGeometry args={[50, 50]} />
      <meshStandardMaterial color="#f3f4f6" />
    </mesh>
  )
}

export default function BuildingScene({ rooms, onSelectRoom }: { rooms: Room[], onSelectRoom: (room: Room) => void }) {
  return (
    <div className="w-full h-full bg-gray-50 rounded-2xl overflow-hidden shadow-inner relative">
      <Canvas shadows camera={{ position: [8, 12, 12], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 5]} intensity={1} castShadow />
        <Environment preset="city" />

        <group>
            {rooms.map((room, index) => (
                <RoomBox key={room.id} room={room} index={index} onClick={onSelectRoom} />
            ))}
            <Floor />
            <Grid infiniteGrid fadeDistance={30} fadeStrength={5} sectionColor="#e5e7eb" />
        </group>

        <OrbitControls makeDefault minPolarAngle={0} maxPolarAngle={Math.PI / 2.1} enablePan={true} enableZoom={true} />
      </Canvas>
      
      {/* Legend Override (Đầy đủ chú thích) */}
      <div className="absolute bottom-4 left-4 bg-white/90 p-3 rounded-lg backdrop-blur-sm text-xs space-y-2 shadow-lg border border-gray-100">
        <div className="font-semibold text-gray-700 mb-1">Status & Indicators</div>
        <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500 shadow-sm"></span> In Class
        </div>
        <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-orange-500 shadow-sm animate-pulse"></span> Motion (Pulsing)
        </div>
        <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 flex items-center justify-center text-[8px] text-white">✖</div>
            <span>AC Fan Spinning</span>
        </div>
        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-200">
            <div className="w-3 h-3 border-2 border-blue-500 bg-transparent box-border"></div>
            <span className="text-blue-700 font-medium">Manual Override</span>
        </div>
      </div>
    </div>
  )
}