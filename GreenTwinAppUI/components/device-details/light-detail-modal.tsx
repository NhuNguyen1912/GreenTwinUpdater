"use client"

import { useEffect, useState, useRef } from "react"
import { X, Lightbulb, Clock, Zap, Power, Sun } from "lucide-react"
import { getLightState, updateLightSettings, type LightState } from "@/lib/api"
import { CURRENT_USER } from "@/lib/user"

interface LightDetailModalProps {
  device: any;
  onClose: () => void;
}

export default function LightDetailModal({ device, onClose }: LightDetailModalProps) {
  const roomId = device.roomId; // Lấy roomId từ prop device
  const deviceId = device.id;

  const [lightState, setLightState] = useState<LightState | null>(null);
  
  // Optimistic UI States
  const [localPower, setLocalPower] = useState<boolean>(device.powerState ?? false);
  const [localBrightness, setLocalBrightness] = useState<number>(device.brightness ?? 80);
  const [overrideDuration, setOverrideDuration] = useState<number>(60);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const isSavingRef = useRef(false);

  const getEndTimeString = (minutes: number) => {
    const end = new Date();
    end.setMinutes(end.getMinutes() + minutes);
    return end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  const fetchData = async () => {
    if (isSavingRef.current || !roomId || !deviceId) return;

    try {
      const state = await getLightState(roomId, deviceId);
      setLightState(state);
      
      if (!isSavingRef.current) {
        setLocalPower(state.powerState);
        // Chỉ cập nhật brightness nếu API trả về số hợp lệ
        if (typeof state.brightness === 'number') setLocalBrightness(state.brightness);
      }
    } catch (e) {
      console.error("Poll error:", e);
    } finally {
        setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [roomId, deviceId]);

  async function onApplyChanges() {
    try {
      setSaving(true);
      isSavingRef.current = true;

      await updateLightSettings(roomId, deviceId, {
        powerState: localPower,
        brightness: localBrightness,
        durationMinutes: overrideDuration,
      });

      await fetchData();
      // onClose(); // Giữ modal mở như AC
    } catch (e) {
      console.error(e);
      alert("Failed to update light settings.");
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  }

  const isOverride = lightState?.overrideActive;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose}></div>

      <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-white px-6 py-4 flex items-center justify-between border-b border-gray-100 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${localPower ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-400'}`}>
              <Lightbulb size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 leading-none">
                {device.name || "Smart Light"}
              </h2>
              <span className="text-xs text-gray-500 font-medium">
                {device.model || "Light Switch"}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          
          {/* Status Badge */}
          <div className={`rounded-xl p-3 flex items-start gap-3 border ${isOverride ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className={`mt-0.5 ${isOverride ? 'text-green-600' : 'text-gray-500'}`}>
              {isOverride ? <Clock size={16} /> : <Zap size={16} />}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-bold ${isOverride ? 'text-green-800' : 'text-gray-700'}`}>
                {isOverride ? "Manual Override Active" : "Auto Schedule Mode"}
              </p>
              {isOverride ? (
                <p className="text-xs text-green-700 mt-0.5">
                  Ends at <strong>{lightState?.overrideExpiresOnLocalFormatted?.split(' ')[0]}</strong> • By {lightState?.controlMode === 'manual-override' ? CURRENT_USER : 'System'}
                </p>
              ) : (
                <p className="text-xs text-gray-500 mt-0.5">Light is controlled automatically.</p>
              )}
            </div>
          </div>

          {/* Power Control */}
          <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-4 border border-gray-100">
            <span className="font-bold text-gray-700 text-sm uppercase tracking-wider">Power</span>
            <button
              onClick={() => setLocalPower(!localPower)}
              disabled={saving}
              className={`relative w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none ${localPower ? "bg-amber-500" : "bg-gray-300"}`}
            >
              <div className={`absolute top-1 left-1 bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${localPower ? "translate-x-6" : ""}`} />
            </button>
          </div>

          {/* Brightness Control (Amber/Yellow Theme) */}
          <div className={`rounded-3xl p-6 text-center transition-all duration-300 ${
            localPower 
              ? "bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-200" 
              : "bg-gray-50 border-2 border-gray-100 text-gray-400"
          }`}>
            
            <div className="flex items-center justify-between mb-6 px-2">
                <p className={`text-xs font-bold uppercase tracking-widest ${localPower ? 'opacity-90' : 'text-gray-500'}`}>Brightness Level</p>
                <Sun size={18} className={localPower ? 'opacity-90' : 'text-gray-400'} />
            </div>

            <div className="relative flex flex-col items-center justify-center py-2">
                <span className="text-7xl font-bold tracking-tighter leading-none">{localBrightness}%</span>
                
                {/* Brightness Slider */}
                <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={localBrightness}
                    onChange={(e) => setLocalBrightness(Number(e.target.value))}
                    disabled={!localPower || saving}
                    className="w-full h-2 mt-6 bg-white/30 rounded-lg appearance-none cursor-pointer accent-white hover:accent-gray-50"
                />
                <div className="w-full flex justify-between text-[10px] font-medium mt-2 opacity-80">
                    <span>0%</span>
                    <span>50%</span>
                    <span>100%</span>
                </div>
            </div>
          </div>

          {/* Override Duration Slider */}
          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-gray-700">
                <Clock size={16} className="text-amber-600" />
                <span className="font-bold text-sm">Hold Settings For</span>
              </div>
              <span className="text-amber-700 font-bold bg-amber-100 px-2 py-0.5 rounded text-sm">
                {overrideDuration < 60 ? `${overrideDuration}m` : `${overrideDuration/60}h`}
              </span>
            </div>

            <div className="relative h-6 flex items-center">
              <input
                type="range"
                min="30"
                max="240"
                step="30"
                value={overrideDuration}
                onChange={(e) => setOverrideDuration(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-amber-500 z-10"
              />
              <div className="absolute w-full flex justify-between px-1 pointer-events-none">
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 30 ? 'bg-amber-500' : 'bg-gray-300'}`} />
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 60 ? 'bg-amber-500' : 'bg-gray-300'}`} />
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 120 ? 'bg-amber-500' : 'bg-gray-300'}`} />
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 240 ? 'bg-amber-500' : 'bg-gray-300'}`} />
              </div>
            </div>
            
            <p className="text-xs text-center text-gray-500 mt-3 border-t border-gray-200 pt-3">
              Will return to schedule at <span className="font-bold text-gray-800">{getEndTimeString(overrideDuration)}</span>
            </p>
          </div>

        </div>

        {/* Footer Actions - Giữ màu Xanh lá */}
        <div className="p-5 border-t border-gray-100 bg-white sticky bottom-0 z-10">
          <button
            onClick={onApplyChanges}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-base shadow-lg shadow-green-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? "Applying..." : "Apply Settings"}
          </button>
        </div>

      </div>
    </div>
  )
}