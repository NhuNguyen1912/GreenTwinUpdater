"use client"

import { useEffect, useState, useRef } from "react"
import { X, Wind, Minus, Plus, Clock, User, Zap, Power } from "lucide-react"
import { getAcState, updateAcSettings, type AcState } from "@/lib/api"
import { CURRENT_USER } from "@/lib/user"

interface ACDetailModalProps {
  device: any;
  roomId: string;
  onClose: () => void;
}

export default function ACDetailModal({ device, roomId, onClose }: ACDetailModalProps) {
  const deviceId = device.id;

  // Data State
  const [acState, setAcState] = useState<AcState | null>(null);
  
  // UI Local States (Optimistic UI)
  const [localPower, setLocalPower] = useState<boolean>(device.powerState ?? true);
  const [localMode, setLocalMode] = useState<string>(device.mode ?? "cool");
  const [localFan, setLocalFan] = useState<string>(device.fanSpeed ?? "auto");
  const [localTemp, setLocalTemp] = useState<number>(device.targetTemperature ?? 24);

  // Override Duration State (Default 60 mins)
  const [overrideDuration, setOverrideDuration] = useState<number>(60);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const isSavingRef = useRef(false);

  // Helper: Format End Time (e.g. 14:30)
  const getEndTimeString = (minutes: number) => {
    const end = new Date();
    end.setMinutes(end.getMinutes() + minutes);
    return end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  // Helper: Format Duration (e.g. 1h 30m)
  const formatDuration = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  };

  const fetchData = async (isInitialLoad = false) => {
    if (isSavingRef.current && !isInitialLoad) return;
    if (!roomId || !deviceId) return;

    try {
      const state = await getAcState(roomId, deviceId);
      setAcState(state);
      
      if (!isSavingRef.current || isInitialLoad) {
        if (state.powerState !== undefined) setLocalPower(state.powerState);
        if (state.mode) setLocalMode(state.mode);
        if (state.fanSpeed) setLocalFan(state.fanSpeed);
        if (typeof state.targetTemperature === 'number') {
          setLocalTemp(state.targetTemperature);
        }
      }
    } catch (e) {
      console.error("Poll error:", e);
    } finally {
        setLoading(false); 
    }
  };

  useEffect(() => {
    isSavingRef.current = false;
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(interval);
  }, [roomId, deviceId]);

  const handleUpdate = (updates: any) => {
    if (updates.powerState !== undefined) setLocalPower(updates.powerState);
    if (updates.mode) setLocalMode(updates.mode);
    if (updates.fanSpeed) setLocalFan(updates.fanSpeed);
    if (updates.targetTemperature) setLocalTemp(updates.targetTemperature);
  };

  async function onApplyChanges() {
    try {
      setSaving(true);
      isSavingRef.current = true;

      const updatedState = await updateAcSettings(roomId, deviceId, {
        powerState: localPower,
        mode: localMode,
        fanSpeed: localFan,
        targetTemperature: localTemp,
        user: CURRENT_USER,
        durationMinutes: overrideDuration,
      });

      setAcState(updatedState);
      
      // Sync lại local state để UI đồng bộ
      if (updatedState.powerState !== undefined) setLocalPower(updatedState.powerState);
      if (updatedState.mode) setLocalMode(updatedState.mode);
      if (updatedState.fanSpeed) setLocalFan(updatedState.fanSpeed);
      if (typeof updatedState.targetTemperature === 'number') {
        setLocalTemp(updatedState.targetTemperature);
      }

    } catch (e) {
      console.error(e);
      alert("Failed to update settings. Please try again.");
    } finally {
      setSaving(false);
      isSavingRef.current = false;
    }
  }

  const isOverride = acState?.overrideActive;
  const currentTempDisplay = acState?.currentTemperature != null ? acState.currentTemperature.toFixed(1) : "--";

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose}></div>

      <div className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-white px-6 py-4 flex items-center justify-between border-b border-gray-100 sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${localPower ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
              <Wind size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900 leading-none">
                {device.name || "AC Unit"}
              </h2>
              <span className="text-xs text-gray-500 font-medium">
                {device.model || "Smart Air Conditioner"}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
          
          {/* Status Banner */}
          <div className={`rounded-xl p-3 flex items-start gap-3 border ${isOverride ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
            <div className={`mt-0.5 ${isOverride ? 'text-green-600' : 'text-gray-500'}`}>
              {isOverride ? <Clock size={16} /> : <Zap size={16} />}
            </div>
            <div className="flex-1">
              <p className={`text-sm font-bold ${isOverride ? 'text-green-800' : 'text-gray-700'}`}>
                {isOverride ? "Manual Override Active" : "Auto Schedule Mode"}
              </p>
              {isOverride ? (
                <div className="mt-1 text-xs text-green-700 space-y-0.5">
                  <p>
                    Ends at <strong>{acState?.overrideExpiresOnLocalFormatted?.split(' ')[0]}</strong>
                  </p>
                  <p className="flex items-center gap-1 opacity-90">
                    <User size={10} /> By {acState?.lastUpdatedBy || "User"}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-gray-500 mt-0.5">System is running automatically.</p>
              )}
            </div>
          </div>

          {/* --- POWER CONTROL --- */}
          <div className="flex items-center justify-between bg-gray-50 rounded-2xl p-4 border border-gray-100">
            <span className="font-bold text-gray-700 text-sm uppercase tracking-wider">Power</span>
            <button
              onClick={() => handleUpdate({ powerState: !localPower })}
              disabled={saving}
              className={`relative w-14 h-8 rounded-full transition-colors duration-300 focus:outline-none ${localPower ? "bg-blue-500" : "bg-gray-300"}`}
            >
              <div className={`absolute top-1 left-1 bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${localPower ? "translate-x-6" : ""}`} />
            </button>
          </div>

          {/* --- Temperature Control --- */}
          <div className={`rounded-3xl p-6 text-center transition-all duration-300 ${
            localPower 
              ? "bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-blue-200" 
              : "bg-gray-50 border-2 border-gray-100 text-gray-400"
          }`}>
            <p className={`text-xs font-bold uppercase tracking-widest mb-4 ${localPower ? 'opacity-80' : 'text-gray-500'}`}>Target Temperature</p>
            
            <div className="flex items-center justify-center gap-6">
              <button
                onClick={() => handleUpdate({ targetTemperature: Math.max(16, localTemp - 1) })}
                disabled={!localPower || saving}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
                    localPower ? "bg-white/20 hover:bg-white/30" : "bg-gray-200 text-gray-500"
                }`}
              >
                <Minus size={24} />
              </button>
              
              <div className="flex items-start">
                <span className="text-7xl font-bold tracking-tighter leading-none">{localTemp}</span>
                <span className="text-3xl font-light mt-1">°</span>
              </div>

              <button
                onClick={() => handleUpdate({ targetTemperature: Math.min(30, localTemp + 1) })}
                disabled={!localPower || saving}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
                    localPower ? "bg-white/20 hover:bg-white/30" : "bg-gray-200 text-gray-500"
                }`}
              >
                <Plus size={24} />
              </button>
            </div>

            <div className={`mt-6 inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
                localPower ? "bg-black/10 backdrop-blur-md" : "bg-gray-200 text-gray-500"
            }`}>
              <Wind size={12} /> Room Temp: {currentTempDisplay}°C
            </div>
          </div>

          {/* Settings Group */}
          <div className="space-y-4">
            {/* Mode */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">Mode</p>
              <div className="flex bg-gray-100 p-1 rounded-xl">
                {["cool", "eco"].map((m) => (
                  <button
                    key={m}
                    onClick={() => handleUpdate({ mode: m })}
                    disabled={!localPower}
                    className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${
                      localMode === m 
                        ? "bg-white text-blue-600 shadow-sm border border-gray-100" 
                        : "text-gray-500 hover:text-gray-700"
                    } disabled:opacity-50`}
                  >
                    {m === "cool" ? "Cool" : "Eco"}
                  </button>
                ))}
              </div>
            </div>

            {/* Fan Speed */}
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase mb-2">Fan Speed</p>
              <div className="grid grid-cols-4 gap-2">
                {["auto", "low", "medium", "high"].map((s) => (
                  <button
                    key={s}
                    onClick={() => handleUpdate({ fanSpeed: s })}
                    disabled={!localPower}
                    className={`py-2 rounded-lg text-xs font-bold uppercase border transition-all ${
                      localFan === s
                        ? "bg-blue-50 border-blue-200 text-blue-700"
                        : "bg-white border-gray-100 text-gray-500 hover:border-gray-200"
                    } disabled:opacity-50`}
                  >
                    {s === "medium" ? "Med" : s}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Override Duration Slider (Updated: 1min to 4h) */}
          <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-gray-700">
                <Clock size={16} className="text-blue-600" />
                <span className="font-bold text-sm">Hold Settings For</span>
              </div>
              <span className="text-blue-700 font-bold bg-blue-50 px-2 py-0.5 rounded text-sm min-w-[60px] text-center">
                {formatDuration(overrideDuration)}
              </span>
            </div>

            <div className="relative h-6 flex items-center">
              <input
                type="range"
                min="1"    // FIX: Bắt đầu từ 1 phút
                max="240"
                step="1"   // FIX: Bước nhảy 1 phút
                value={overrideDuration}
                onChange={(e) => setOverrideDuration(Number(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 z-10"
              />
              
              {/* Visual Ticks (0h, 1h, 2h, 3h, 4h) */}
              <div className="absolute w-full flex justify-between px-1 pointer-events-none">
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 1 ? 'bg-blue-600' : 'bg-gray-300'}`} />
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 60 ? 'bg-blue-600' : 'bg-gray-300'}`} />
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 120 ? 'bg-blue-600' : 'bg-gray-300'}`} />
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 180 ? 'bg-blue-600' : 'bg-gray-300'}`} />
                <div className={`w-1 h-1 rounded-full ${overrideDuration >= 240 ? 'bg-blue-600' : 'bg-gray-300'}`} />
              </div>
            </div>
            
            <div className="flex justify-between text-xs text-gray-400 mt-2 font-medium">
              <span>1m</span>
              <span className="pl-2">1h</span>
              <span className="pl-1">2h</span>
              <span className="pl-1">3h</span>
              <span>4h</span>
            </div>

            <p className="text-xs text-center text-gray-500 mt-3 border-t border-gray-200 pt-3">
              Will return to schedule at <span className="font-bold text-gray-800">{getEndTimeString(overrideDuration)}</span>
            </p>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-5 border-t border-gray-100 bg-white sticky bottom-0 z-10">
          <button
            onClick={onApplyChanges}
            disabled={saving}
            className="w-full py-3.5 rounded-xl bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold text-base shadow-lg shadow-green-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Applying...</span>
              </>
            ) : (
              "Apply Settings"
            )}
          </button>
        </div>

      </div>
    </div>
  )
}