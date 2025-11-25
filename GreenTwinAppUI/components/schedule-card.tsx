'use client'

import { Clock } from 'lucide-react'

export default function ScheduleCard() {
  return (
    <div className="glass-panel p-5">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-green-400" />
        <p className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Schedule
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-xs text-gray-500 mb-1">Start Time</p>
          <p className="text-lg font-bold text-green-400">06:00 AM</p>
        </div>
        <div className="bg-white/5 rounded-xl p-3 border border-white/5">
          <p className="text-xs text-gray-500 mb-1">Stop Time</p>
          <p className="text-lg font-bold text-green-400">10:00 PM</p>
        </div>
      </div>

      <button className="w-full mt-4 px-4 py-2.5 rounded-xl bg-white/5 text-sm text-gray-300 hover:bg-white/10 transition-colors border border-white/5">
        Edit Schedule
      </button>
    </div>
  )
}
