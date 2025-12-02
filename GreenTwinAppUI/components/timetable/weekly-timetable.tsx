"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import {
  PERIODS,
  DAY_NAMES,
  timeToPeriodsRange,
  getColorForCourse,
  dayToDayIndex,
} from "./timetable-utils" // :contentReference[oaicite:2]{index=2}

interface Schedule {
  id: string
  courseName: string
  startTime: string        // "06:50" hoặc "06:50:00"
  endTime: string          // "09:20" hoặc "09:20:00"
  weekdays: string[] | string // ["MON","WED"] hoặc "MON,WED"
  roomName?: string
  group?: string
}

interface WeeklyTimetableProps {
  schedules: Schedule[]
  currentDate?: Date
}

type CellKey = string | null

interface CellInfo {
  scheduleId: string
  dayIndex: number
  startPeriod: number
  endPeriod: number
  color: string
}

export default function WeeklyTimetable({
  schedules,
  currentDate = new Date(),
}: WeeklyTimetableProps) {
  const [weekOffset, setWeekOffset] = useState(0)

  // Ma trận 16 tiết x 7 ngày, mỗi ô lưu key dạng `${scheduleId}-${dayIndex}`
  const timetableMatrix: CellKey[][] = Array(PERIODS.length)
    .fill(null)
    .map(() => Array<CellKey>(7).fill(null))

  // Map thông tin block theo key
  const scheduleCellMap = new Map<string, CellInfo>()

  // Đưa tất cả lịch vào ma trận
  schedules.forEach((schedule) => {
    // Chuẩn hóa danh sách ngày trong tuần
    const daysArray = Array.isArray(schedule.weekdays)
      ? schedule.weekdays
      : String(schedule.weekdays || "")
          .split(",")
          .map((d) => d.trim().toUpperCase())
          .filter(Boolean)

    // Chuẩn hóa time về HH:MM:SS
    const sStart =
      schedule.startTime.length === 5
        ? `${schedule.startTime}:00`
        : schedule.startTime
    const sEnd =
      schedule.endTime.length === 5
        ? `${schedule.endTime}:00`
        : schedule.endTime

    const { startPeriod, endPeriod } = timeToPeriodsRange(sStart, sEnd)

    daysArray.forEach((dayCode) => {
      const dayIndex = dayToDayIndex(dayCode)
      if (dayIndex === -1) return

      const key = `${schedule.id}-${dayIndex}`
      const color = getColorForCourse(schedule.id)

      scheduleCellMap.set(key, {
        scheduleId: schedule.id,
        dayIndex,
        startPeriod,
        endPeriod,
        color,
      })

      // Đánh dấu ô bắt đầu block
      timetableMatrix[startPeriod - 1][dayIndex] = key
    })
  })

  return (
    <div className="space-y-6 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">
          Weekly Timetable
        </h3>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Previous week"
          >
            <ChevronLeft size={20} className="text-gray-600" />
          </button>
          <span className="text-sm font-medium text-gray-600 min-w-32 text-center">
            Week {Math.abs(weekOffset) + 1}
          </span>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Next week"
          >
            <ChevronRight size={20} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white rounded-xl border border-gray-200">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600 w-12">
                Period
              </th>
              <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600 min-w-20">
                Time
              </th>
              {DAY_NAMES.map((day) => (
                <th
                  key={day}
                  className="px-3 py-2 text-center text-xs font-semibold text-gray-600 min-w-24"
                >
                  {day}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERIODS.map((periodInfo, periodIdx) => (
              <tr key={periodInfo.period} className="border-b border-gray-100">
                {/* Cột số tiết */}
                <td className="px-3 py-2 text-center text-xs font-medium text-gray-600 bg-gray-50">
                  {periodInfo.period}
                </td>
                {/* Cột giờ bắt đầu */}
                <td className="px-3 py-2 text-center text-xs text-gray-600 bg-gray-50 whitespace-nowrap">
                  {periodInfo.start}
                </td>

                {/* 7 cột ngày */}
                {Array(7)
                  .fill(null)
                  .map((_, dayIdx) => {
                    const cellKey = timetableMatrix[periodIdx][dayIdx]

                    // Ô trống: nhưng có thể đang nằm trong block span từ trên xuống
                    if (cellKey === null) {
                      let isSpanned = false

                      for (let i = periodIdx - 1; i >= 0; i--) {
                        const prevKey = timetableMatrix[i][dayIdx]
                        if (!prevKey) continue

                        const info = scheduleCellMap.get(prevKey)
                        if (!info) continue

                        if (
                          info.startPeriod <= periodInfo.period &&
                          info.endPeriod >= periodInfo.period
                        ) {
                          isSpanned = true
                          break
                        }
                      }

                      if (isSpanned) return null

                      return (
                        <td
                          key={`${periodIdx}-${dayIdx}`}
                          className="px-3 py-2 border-r border-gray-100 hover:bg-gray-50 transition-colors"
                        />
                      )
                    }

                    const info = scheduleCellMap.get(cellKey)
                    if (!info) return null

                    // Chỉ vẽ ô ở hàng startPeriod
                    if (info.startPeriod !== periodInfo.period) return null

                    const schedule = schedules.find(
                      (s) => s.id === info.scheduleId,
                    )
                    if (!schedule) return null

                    const rowSpan =
                      info.endPeriod - info.startPeriod + 1

                    return (
                      <td
                        key={cellKey}
                        rowSpan={rowSpan}
                        className={`px-3 py-2 border-r border-gray-100 border-b-2 rounded-md m-1 hover:shadow-md transition-shadow cursor-pointer ${info.color}`}
                      >
                        <div className="text-xs font-semibold leading-tight break-words">
                          <p className="truncate">
                            {schedule.courseName}
                          </p>
                          {schedule.roomName && (
                            <p className="text-xs opacity-75">
                              {schedule.roomName}
                            </p>
                          )}
                          {schedule.group && (
                            <p className="text-xs opacity-75">
                              Group: {schedule.group}
                            </p>
                          )}
                          <p className="text-[10px] opacity-70 mt-1">
                            {schedule.startTime.slice(0, 5)} –{" "}
                            {schedule.endTime.slice(0, 5)}
                          </p>
                        </div>
                      </td>
                    )
                  })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {schedules.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">
            No schedules for this week
          </p>
        </div>
      )}
    </div>
  )
}
