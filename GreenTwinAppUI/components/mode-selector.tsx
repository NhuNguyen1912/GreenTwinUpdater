'use client'

interface ModeSelectorProps {
  value: string
  onChange: (value: string) => void
}

export default function ModeSelector({ value, onChange }: ModeSelectorProps) {
  const modes = ['cool', 'eco']
  const labels: Record<string, string> = {
    cool: 'Cool',
    eco: 'Eco',
  }

  return (
    <div className="flex gap-3">
      {modes.map((mode) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          className={`flex-1 px-4 py-3 rounded-2xl text-sm font-medium transition-all duration-300 ${
            value === mode
              ? 'bg-green-500/80 text-black glow-green shadow-green-500/50'
              : 'bg-white/5 text-gray-300 hover:bg-white/10'
          }`}
        >
          {labels[mode]}
        </button>
      ))}
    </div>
  )
}
