'use client'

interface FanSpeedSelectorProps {
  value: string
  onChange: (value: string) => void
}

export default function FanSpeedSelector({ value, onChange }: FanSpeedSelectorProps) {
  const speeds = ['auto', 'low', 'medium', 'high']
  const labels: Record<string, string> = {
    auto: 'Auto',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  }

  return (
    <div className="flex gap-3">
      {speeds.map((speed) => (
        <button
          key={speed}
          onClick={() => onChange(speed)}
          className={`flex-1 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-300 ${
            value === speed
              ? 'bg-green-500/80 text-black glow-green shadow-green-500/50'
              : 'bg-white/5 text-gray-300 hover:bg-white/10'
          }`}
        >
          {labels[speed]}
        </button>
      ))}
    </div>
  )
}
