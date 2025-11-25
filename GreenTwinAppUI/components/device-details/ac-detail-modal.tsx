"use client"

import { useState } from "react"
import { X, Wind, Minus, Plus } from "lucide-react"
import { updateAcSettings } from "@/lib/api"
import { CURRENT_USER } from "@/lib/user";


interface ACDetailModalProps {
  device: any;
  roomId: string;
  onClose: () => void;
}

export default function ACDetailModal({ device, roomId, onClose }: ACDetailModalProps) {
  const [powerState, setPowerState] = useState<boolean>(
    device.powerState ?? true
  )
  const [mode, setMode] = useState<string>(device.mode ?? "cool")
  const [fanSpeed, setFanSpeed] = useState<string>(device.fanSpeed ?? "auto")
  const [temperature, setTemperature] = useState<number>(
    device.targetTemperature ?? 24
  )

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function handleApply() {
    try {
      setSaving(true)
      setError(null)
      setSuccess(null)

      await updateAcSettings(roomId, device.id, {
        powerState,
        mode,
        fanSpeed,
        targetTemperature: temperature,
        user: CURRENT_USER,
      })

      setSuccess("Updated AC successfully")
    } catch (e) {
      console.error(e)
      setError("Failed to update AC")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-end">
      <div className="w-full bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center">
              <Wind size={24} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {(device.roomName || "Room") + " – " + (device.name || "AC")}
              </h2>
              <p className="text-sm text-gray-600">
                {device.model || device.id}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={24} className="text-gray-700" />
          </button>
        </div>

        <div className="p-6 pb-20 space-y-5">
          {/* Power */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900">Power</span>
              <button
                onClick={() => setPowerState(!powerState)}
                className={`relative w-14 h-8 rounded-full transition-all ${powerState ? "bg-green-500" : "bg-gray-300"
                  }`}
              >
                <div
                  className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${powerState ? "translate-x-7" : "translate-x-1"
                    }`}
                />
              </button>
            </div>
          </div>

          {/* Temperature */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-2xl p-8 border border-blue-100">
            <h3 className="font-semibold text-gray-900 mb-6 text-center">
              Target Temperature
            </h3>
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => setTemperature(Math.max(16, temperature - 1))}
                disabled={!powerState}
                className="w-14 h-14 rounded-full bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-xl transition-all shadow-sm flex items-center justify-center"
              >
                <Minus size={20} />
              </button>
              <div className="text-center">
                <p className="text-6xl font-bold text-gray-900">{temperature}°</p>
                <p className="text-sm text-gray-600 mt-2">
                  Current: {device.currentTemperature ?? "--"}°C
                </p>
              </div>
              <button
                onClick={() => setTemperature(Math.min(32, temperature + 1))}
                disabled={!powerState}
                className="w-14 h-14 rounded-full bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-bold text-xl transition-all shadow-sm flex items-center justify-center"
              >
                <Plus size={20} />
              </button>
            </div>
          </div>

          {/* Mode */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-4">Mode</h3>
            <div className="grid grid-cols-2 gap-3">
              {["cool", "eco"].map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={!powerState}
                  className={`py-4 px-4 rounded-xl font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed ${mode === m
                      ? "bg-green-500 text-white shadow-md"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                    }`}
                >
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Fan speed */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100">
            <h3 className="font-semibold text-gray-900 mb-4">Fan Speed</h3>
            <div className="grid grid-cols-4 gap-2">
              {["auto", "low", "medium", "high"].map((speed) => (
                <button
                  key={speed}
                  onClick={() => setFanSpeed(speed)}
                  disabled={!powerState}
                  className={`py-3 px-2 rounded-xl font-medium text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed ${fanSpeed === speed
                      ? "bg-green-500 text-white shadow-md"
                      : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                    }`}
                >
                  {speed === "medium"
                    ? "Med"
                    : speed.charAt(0).toUpperCase() + speed.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Presets giữ nguyên như bạn */}

          {/* Status message + Apply button */}
          {error && (
            <p className="text-xs text-red-600 font-medium">{error}</p>
          )}
          {success && (
            <p className="text-xs text-green-600 font-medium">{success}</p>
          )}

          <button
            onClick={handleApply}
            disabled={saving}
            className="w-full py-3 rounded-2xl bg-green-600 text-white font-semibold mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {saving ? "Applying..." : "Apply changes"}
          </button>

        </div>
      </div>
    </div>
  )
}
