'use client'

import { useState } from 'react'
import { X, Lightbulb } from 'lucide-react'

interface LightDetailModalProps {
  device: any
  onClose: () => void
}

export default function LightDetailModal({ device, onClose }: LightDetailModalProps) {
  const [powerState, setPowerState] = useState(device.powerState)
  const [brightness, setBrightness] = useState(device.brightness)

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-end">
      <div className="w-full bg-white rounded-t-3xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-100 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Lightbulb size={24} className="text-emerald-600" />
            <div>
              <h2 className="text-xl font-bold text-gray-900">{device.name}</h2>
              <p className="text-sm text-gray-600">{device.model}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X size={24} />
          </button>
        </div>

        <div className="p-6 pb-12 space-y-6">
          {/* Power Toggle */}
          <div className="glass-panel p-6">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-gray-900">Power</span>
              <button
                onClick={() => setPowerState(!powerState)}
                className={`relative w-12 h-7 rounded-full transition-all ${
                  powerState
                    ? 'bg-emerald-500 shadow-md shadow-emerald-500/30'
                    : 'bg-gray-300'
                }`}
              >
                <div
                  className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-transform ${
                    powerState ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Brightness Slider */}
          <div className="glass-panel p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Brightness</h3>
            <div className="space-y-4">
              <input
                type="range"
                min="0"
                max="100"
                value={brightness}
                onChange={(e) => setBrightness(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-emerald-500"
              />
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Level</span>
                <span className="text-2xl font-bold text-gray-900">{brightness}%</span>
              </div>
            </div>
          </div>

          {/* Illuminance Info */}
          <div className="glass-panel p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Illuminance</h3>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Current</span>
                <span className="font-semibold text-gray-900">{device.currentLux}lx</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Target</span>
                <span className="font-semibold text-gray-900">{device.targetLux}lx</span>
              </div>
              <p className="text-xs text-gray-600 pt-2 border-t border-gray-100">
                Lights adjust automatically to maintain target illuminance levels
              </p>
            </div>
          </div>

          {/* Automation */}
          <div className="glass-panel p-6">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900">Presence Control</span>
              <div className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium">
                Enabled
              </div>
            </div>
          </div>

          {/* Info */}
          <div className="text-xs text-gray-600 space-y-1 px-2">
            <p>Last updated: automation</p>
            <p>Status: Online</p>
          </div>
        </div>
      </div>
    </div>
  )
}
