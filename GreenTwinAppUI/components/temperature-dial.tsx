'use client'

import { useRef, useEffect, useState } from 'react'

interface TemperatureDialProps {
  current: number
  setpoint: number
  onChange: (value: number) => void
  isPowered: boolean
}

export default function TemperatureDial({
  current,
  setpoint,
  onChange,
  isPowered,
}: TemperatureDialProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const MIN_TEMP = 16
  const MAX_TEMP = 32
  const RADIUS = 100
  const CENTER_X = 130
  const CENTER_Y = 130

  const tempToAngle = (temp: number) => {
    const range = MAX_TEMP - MIN_TEMP
    const position = (temp - MIN_TEMP) / range
    return position * 270 - 135
  }

  const angleToTemp = (angle: number) => {
    let normalizedAngle = angle + 135
    if (normalizedAngle < 0) normalizedAngle += 360
    const range = MAX_TEMP - MIN_TEMP
    const temp = MIN_TEMP + (normalizedAngle / 270) * range
    return Math.max(MIN_TEMP, Math.min(MAX_TEMP, Math.round(temp * 10) / 10))
  }

  const drawDial = () => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = 260 * dpr
    canvas.height = 260 * dpr
    ctx.scale(dpr, dpr)

    ctx.clearRect(0, 0, 260, 260)

    // Draw background circle
    ctx.beginPath()
    ctx.arc(CENTER_X, CENTER_Y, RADIUS + 10, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(229, 231, 235, 0.5)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(209, 213, 219, 0.6)'
    ctx.lineWidth = 1
    ctx.stroke()

    // Draw temperature range arc (background track)
    ctx.beginPath()
    ctx.arc(
      CENTER_X,
      CENTER_Y,
      RADIUS,
      (tempToAngle(MIN_TEMP) * Math.PI) / 180,
      (tempToAngle(MAX_TEMP) * Math.PI) / 180
    )
    ctx.strokeStyle = 'rgba(209, 213, 219, 0.8)'
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    ctx.stroke()

    // Draw temperature fill arc (active range) - fresh green
    const gradientAngle = (tempToAngle(setpoint) * Math.PI) / 180
    ctx.beginPath()
    ctx.arc(
      CENTER_X,
      CENTER_Y,
      RADIUS,
      (tempToAngle(MIN_TEMP) * Math.PI) / 180,
      gradientAngle
    )
    ctx.strokeStyle = '#00E676'
    ctx.lineWidth = 8
    ctx.lineCap = 'round'
    ctx.stroke()

    // Draw glow effect on arc
    ctx.beginPath()
    ctx.arc(
      CENTER_X,
      CENTER_Y,
      RADIUS,
      (tempToAngle(MIN_TEMP) * Math.PI) / 180,
      gradientAngle
    )
    ctx.strokeStyle = 'rgba(0, 230, 118, 0.25)'
    ctx.lineWidth = 16
    ctx.lineCap = 'round'
    ctx.stroke()

    // Draw tick marks
    for (let i = MIN_TEMP; i <= MAX_TEMP; i += 2) {
      const angle = (tempToAngle(i) * Math.PI) / 180
      const x1 = CENTER_X + Math.cos(angle) * (RADIUS - 8)
      const y1 = CENTER_Y + Math.sin(angle) * (RADIUS - 8)
      const x2 = CENTER_X + Math.cos(angle) * (RADIUS - 14)
      const y2 = CENTER_Y + Math.sin(angle) * (RADIUS - 14)

      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle = i % 4 === 0 ? 'rgba(55, 65, 81, 0.6)' : 'rgba(107, 114, 128, 0.4)'
      ctx.lineWidth = i % 4 === 0 ? 2 : 1
      ctx.stroke()
    }

    // Draw center circle
    ctx.beginPath()
    ctx.arc(CENTER_X, CENTER_Y, 12, 0, Math.PI * 2)
    ctx.fillStyle = '#00E676'
    ctx.fill()

    // Draw knob/thumb indicator
    const angle = (tempToAngle(setpoint) * Math.PI) / 180
    const thumbX = CENTER_X + Math.cos(angle) * RADIUS
    const thumbY = CENTER_Y + Math.sin(angle) * RADIUS

    // Glow effect around thumb
    const glowGradient = ctx.createRadialGradient(thumbX, thumbY, 0, thumbX, thumbY, 20)
    glowGradient.addColorStop(0, 'rgba(0, 230, 118, 0.3)')
    glowGradient.addColorStop(1, 'rgba(0, 230, 118, 0)')
    ctx.beginPath()
    ctx.arc(thumbX, thumbY, 20, 0, Math.PI * 2)
    ctx.fillStyle = glowGradient
    ctx.fill()

    // Thumb circle
    ctx.beginPath()
    ctx.arc(thumbX, thumbY, 10, 0, Math.PI * 2)
    ctx.fillStyle = '#00E676'
    ctx.fill()

    // White highlight on thumb
    ctx.beginPath()
    ctx.arc(thumbX - 3, thumbY - 3, 3, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
    ctx.fill()

    // Draw temperature text in center
    ctx.fillStyle = '#00E676'
    ctx.font = 'bold 48px Geist'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`${setpoint}°`, CENTER_X, CENTER_Y - 15)

    ctx.font = '11px Geist'
    ctx.fillStyle = 'rgba(107, 114, 128, 0.8)'
    ctx.fillText(`Current: ${current}°`, CENTER_X, CENTER_Y + 20)
  }

  useEffect(() => {
    drawDial()
  }, [setpoint, current])

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPowered) return
    setIsDragging(true)
    handleMove(e)
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging && isPowered) handleMove(e)
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - CENTER_X
    const y = e.clientY - rect.top - CENTER_Y

    let angle = Math.atan2(y, x) * (180 / Math.PI)
    const temp = angleToTemp(angle)
    onChange(temp)
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvasRef}
        className={`w-64 h-64 ${isPowered ? 'cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-50'}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <p className="text-xs text-gray-500 text-center">
        {isPowered ? 'Drag to adjust temperature' : 'Turn on to adjust'}
      </p>
    </div>
  )
}
