"use client"

import { useRef, useState, useEffect } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { useGLTF, OrbitControls, Environment, Html } from "@react-three/drei"
import * as THREE from "three"
import { easing } from "maath" 
import { Room } from "@/lib/api"

// =====================================================================
// 1. CẤU HÌNH TỌA ĐỘ CAMERA
// =====================================================================
const CAMERA_POSITIONS: Record<string, { position: [number, number, number], target: [number, number, number] }> = {
  "Overview": { 
    position: [20, 20, 20], 
    target: [0, 0, 0] 
  },
  "A001": { 
    position: [-3.26, 2.72, -16.25],
    target: [4.97, 0, 0]
  },
  "A002": { 
    position: [16.89, 2.48, -16.46],
    target: [4.97, 0, 0]
  }
}

// =====================================================================
// 2. COMPONENT ĐIỀU KHIỂN CAMERA BAY
// =====================================================================
function CameraController({ targetRoomId }: { targetRoomId: string | null }) {
  const { camera, controls, gl } = useThree() as any 
  const isAnimating = useRef(false)

  useEffect(() => {
    if (targetRoomId) {
      isAnimating.current = true
    }
  }, [targetRoomId])

  useEffect(() => {
    const stopAnim = () => { isAnimating.current = false }
    gl.domElement.addEventListener('mousedown', stopAnim)
    gl.domElement.addEventListener('wheel', stopAnim)
    gl.domElement.addEventListener('touchstart', stopAnim)

    return () => {
      gl.domElement.removeEventListener('mousedown', stopAnim)
      gl.domElement.removeEventListener('wheel', stopAnim)
      gl.domElement.removeEventListener('touchstart', stopAnim)
    }
  }, [gl])

  useFrame((state, delta) => {
    if (!isAnimating.current) return 

    const key = targetRoomId && CAMERA_POSITIONS[targetRoomId] ? targetRoomId : "Overview"
    const destination = CAMERA_POSITIONS[key]

    const distPos = camera.position.distanceTo(new THREE.Vector3(...destination.position))
    const distTarget = controls.target.distanceTo(new THREE.Vector3(...destination.target))

    if (distPos < 0.1 && distTarget < 0.1) {
      isAnimating.current = false
    }

    easing.damp3(camera.position, destination.position, 0.25, delta)
    if (controls) {
      easing.damp3(controls.target, destination.target, 0.25, delta)
    }
  })

  return null
}

// =====================================================================
// 4. MODEL 3D
// =====================================================================
function Model({ onRoomClick }: { onRoomClick: (id: string) => void }) {
  const { scene } = useGLTF("/classroom_3d.glb") 

  return (
    <primitive 
      object={scene} 
      scale={1} 
      onClick={(e: any) => {
        e.stopPropagation() // Ngăn click xuyên thấu
        
        // Lấy tên Mesh được click
        const meshName = e.object.name 
        console.log("Clicked Mesh:", meshName) 

        // --- LOGIC MAP TÊN MESH VỚI ID PHÒNG ---
        // Bạn cần đảm bảo tên Mesh trong file 3D có chứa chữ A001, A002...
        if (meshName.includes("A001")) onRoomClick("A001")
        else if (meshName.includes("A002")) onRoomClick("A002")
        // else onRoomClick("Overview") // Nếu bấm vào tường/sàn khác thì quay về overview (Tùy chọn)
      }}
      onPointerOver={() => { document.body.style.cursor = 'pointer' }}
      onPointerOut={() => { document.body.style.cursor = 'auto' }}
    />
  )
}

// =====================================================================
// 5. COMPONENT CHÍNH
// =====================================================================
export default function BuildingScene({ rooms, onSelectRoom }: { rooms: Room[], onSelectRoom: (room: Room) => void }) {
  const [activeView, setActiveView] = useState<string | null>("Overview")

  // --- HÀM QUAN TRỌNG: Vừa bay Camera, vừa mở Modal ---
  const handleRoomInteraction = (roomId: string) => {
    console.log("Đang chọn phòng:", roomId)
    
    // 1. Kích hoạt hiệu ứng bay Camera
    setActiveView(roomId)

    // 2. Tìm dữ liệu phòng tương ứng trong list rooms
    const foundRoom = rooms.find(r => r.id === roomId)
    
    // 3. Nếu tìm thấy, gọi hàm onSelectRoom để mở Modal Chart
    if (foundRoom) {
      console.log("Mở Modal cho:", foundRoom.name)
      onSelectRoom(foundRoom)
    } else {
      console.warn("Không tìm thấy dữ liệu cho phòng ID:", roomId)
    }
  }

  return (
    <div className="w-full h-full relative bg-gray-100 rounded-2xl overflow-hidden">
      <Canvas shadows camera={{ position: [20, 20, 20], fov: 45 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 5]} intensity={1} castShadow />
        <Environment preset="city" />
        
        {/* Truyền hàm handleRoomInteraction vào Model */}
        <Model onRoomClick={handleRoomInteraction} />
        
        {/* Camera Controller */}
        <CameraController targetRoomId={activeView} />
        
        <OrbitControls makeDefault />
      </Canvas>

      {/* UI Điều khiển nhanh */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 p-2 rounded-full shadow-lg flex gap-2 backdrop-blur-sm z-10">
        <button 
            onClick={() => setActiveView("Overview")}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${activeView === "Overview" ? "bg-gray-800 text-white" : "bg-gray-100 hover:bg-gray-200"}`}
        >
            Overview
        </button>
        {/* Các nút bấm cũng dùng hàm handleRoomInteraction để mở Modal luôn */}
        <button 
            onClick={() => handleRoomInteraction("A001")}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${activeView === "A001" ? "bg-blue-600 text-white" : "bg-blue-50 hover:bg-blue-100 text-blue-700"}`}
        >
            A001
        </button>
        <button 
            onClick={() => handleRoomInteraction("A002")}
            className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${activeView === "A002" ? "bg-blue-600 text-white" : "bg-blue-50 hover:bg-blue-100 text-blue-700"}`}
        >
            A002
        </button>
      </div>
    </div>
  )
}