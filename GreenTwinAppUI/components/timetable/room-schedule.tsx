"use client"

import { useState, useMemo, useEffect } from "react"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus } from "lucide-react"
import { format, addDays, startOfWeek, isSameDay, addWeeks, subWeeks } from "date-fns"
import { vi } from "date-fns/locale"
import ScheduleExceptionModal from "./schedule-exception-modal" // Đảm bảo đường dẫn đúng

// --- TYPES ---
export interface Schedule {
  id: string
  roomId: string
  roomName: string
  courseName: string
  lecturer: string
  startTime: string 
  endTime: string   
  weekdays: string[] 
  effectiveFrom?: string 
  effectiveTo?: string
  isException?: boolean 
  isEnabled?: boolean
}

// --- CONSTANTS ---
const PERIODS = [
  { period: 1, start: "06:50", end: "07:40" },
  { period: 2, start: "07:40", end: "08:30" },
  { period: 3, start: "08:30", end: "09:20" },
  { period: 4, start: "09:30", end: "10:20" },
  { period: 5, start: "10:20", end: "11:10" },
  { period: 6, start: "11:10", end: "12:00" },
  { period: 7, start: "12:45", end: "13:35" },
  { period: 8, start: "13:35", end: "14:25" },
  { period: 9, start: "14:25", end: "15:15" },
  { period: 10, start: "15:25", end: "16:15" },
  { period: 11, start: "16:15", end: "17:05" },
  { period: 12, start: "17:05", end: "17:55" },
]

const DAY_MAP = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]

// --- HELPERS ---
const normalizeTime = (time: string) => {
    if (!time) return "00:00:00";
    let [h, m, s] = time.split(':');
    h = h.padStart(2, '0');
    m = (m || '00').padStart(2, '0');
    s = (s || '00').padStart(2, '0');
    return `${h}:${m}:${s}`;
}

interface RoomScheduleProps {
  schedules: Schedule[]
  roomId: string 
  // Handler cho việc click vào ô trống (Tạo lịch mới)
  onAddException?: (date: Date, startTime: string, endTime: string) => void
  // Handler mới: Xử lý khi confirm từ Modal (Hủy hoặc Thay thế)
  onUpdateSchedule?: (exceptionData: any) => void 
}

export default function RoomSchedule({ schedules, roomId, onAddException, onUpdateSchedule }: RoomScheduleProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  
  // State quản lý Modal
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{ schedule: Schedule, date: Date } | null>(null)

  useEffect(() => {
    console.log(`[RoomSchedule] Received ${schedules.length} schedules for room ${roomId}`, schedules);
  }, [schedules, roomId]);

  const startDate = startOfWeek(currentDate, { weekStartsOn: 1 })
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startDate, i))

  // --- LOGIC TÌM LỊCH ---
  const getScheduleForCell = (date: Date, periodStart: string, periodEnd: string) => {
    const dateStr = format(date, "yyyy-MM-dd")
    const dayOfWeek = DAY_MAP[date.getDay()]
    const pStart = normalizeTime(periodStart);
    const pEnd = normalizeTime(periodEnd);

    const timeMatches = schedules.filter(s => {
      if (s.roomId && s.roomId !== "Unknown" && s.roomId !== roomId) return false;
      const sStart = normalizeTime(s.startTime);
      const sEnd = normalizeTime(s.endTime);
      return sStart < pEnd && sEnd > pStart;
    });

    const exception = timeMatches.find(s => s.isException && s.effectiveFrom === dateStr)
    if (exception) return { ...exception, type: 'exception' }

    const regular = timeMatches.find(s => {
      if (s.isException) return false;
      const days = Array.isArray(s.weekdays) ? s.weekdays : String(s.weekdays || "").split(',').map(d => d.trim());
      const normalizedDays = days.map(d => d.toUpperCase());
      if (!normalizedDays.includes(dayOfWeek)) return false;
      const from = s.effectiveFrom || "1900-01-01"
      const to = s.effectiveTo || "2099-12-31"
      return dateStr >= from && dateStr <= to;
    })

    return regular ? { ...regular, type: 'regular' } : null
  }

  // --- RENDER MATRIX ---
  const renderMatrix = useMemo(() => {
    const matrix = [];
    const skipMap = new Set<string>(); 

    for (let pIndex = 0; pIndex < PERIODS.length; pIndex++) {
      const row = [];
      const period = PERIODS[pIndex];
      const pStart = normalizeTime(period.start);

      for (let dIndex = 0; dIndex < weekDays.length; dIndex++) {
        const day = weekDays[dIndex];
        const key = `${dIndex}-${pIndex}`;

        if (skipMap.has(key)) {
            row.push(null); 
            continue;
        }

        const periodEnd = normalizeTime(period.end);
        const schedule = getScheduleForCell(day, pStart, periodEnd);

        if (schedule) {
            let span = 1;
            for (let nextP = pIndex + 1; nextP < PERIODS.length; nextP++) {
                const nextPeriod = PERIODS[nextP];
                const nextStart = normalizeTime(nextPeriod.start);
                const sEnd = normalizeTime(schedule.endTime);

                if (sEnd > nextStart) {
                    span++;
                    skipMap.add(`${dIndex}-${nextP}`); 
                } else {
                    break;
                }
            }
            row.push({ schedule, span });
        } else {
            row.push({ schedule: null, span: 1 });
        }
      }
      matrix.push(row);
    }
    return matrix;
  }, [schedules, currentDate, roomId]); 

  // --- HANDLERS ---
  const handleSlotClick = (schedule: Schedule, date: Date) => {
    setSelectedSlot({ schedule, date })
    setIsModalOpen(true)
  }

  const handleModalConfirm = (exceptionData: any) => {
    if (onUpdateSchedule) {
      onUpdateSchedule(exceptionData);
    } else {
      console.log("Exception confirmed:", exceptionData);
    }
    setIsModalOpen(false);
    setSelectedSlot(null);
  }

  return (
    <>
      <div className="flex flex-col h-full w-full bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* HEADER */}
        <div className="flex-none flex items-center justify-between p-4 border-b border-gray-100 bg-white z-20">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <CalendarIcon className="text-emerald-600" />
              Lịch phòng {roomId}
            </h2>
            <span className="text-sm text-gray-500 font-medium bg-gray-100 px-3 py-1 rounded-full hidden sm:inline-block">
              {format(startDate, "dd/MM")} - {format(addDays(startDate, 6), "dd/MM/yyyy")}
            </span>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCurrentDate(subWeeks(currentDate, 1))} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronLeft size={20} /></button>
            <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1.5 text-sm font-medium text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors">Hôm nay</button>
            <button onClick={() => setCurrentDate(addWeeks(currentDate, 1))} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"><ChevronRight size={20} /></button>
          </div>
        </div>

        {/* TABLE CONTENT */}
        <div className="flex-1 overflow-auto relative w-full min-h-0">
            <table className="w-full text-sm text-left border-collapse min-w-[800px]"> 
              <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b border-gray-200 sticky top-0 z-20 shadow-sm">
                <tr>
                  <th className="px-2 py-3 font-semibold w-16 text-center border-r border-gray-200 bg-gray-50 sticky left-0 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Tiết</th>
                  {weekDays.map((day, i) => (
                    <th key={i} className={`px-2 py-3 font-semibold text-center border-r border-gray-100 min-w-[100px] ${isSameDay(day, new Date()) ? "bg-emerald-50 text-emerald-700" : "bg-gray-50"}`}>
                      <div>{format(day, "EEE", { locale: vi })}</div>
                      <div className="text-[10px] opacity-70">{format(day, "dd/MM")}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {PERIODS.map((period, pIndex) => (
                  <tr key={period.period} className="hover:bg-gray-50/30 transition-colors">
                    <td className="px-1 py-2 border-r border-gray-200 text-center sticky left-0 bg-white z-10 h-14 border-b border-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      <div className="font-bold text-gray-700 text-xs">{period.period}</div>
                      <div className="text-[9px] text-gray-400 leading-tight mt-0.5">{period.start}<br/>{period.end}</div>
                    </td>
                    
                    {renderMatrix[pIndex].map((cell, dIndex) => {
                      if (!cell) return null; 
                      const { schedule, span } = cell;
                      
                      if (schedule) {
                          const isCanceled = schedule.courseName?.toLowerCase().includes("canceled") || schedule.courseName?.toLowerCase().includes("nghỉ");
                          const isOverride = schedule.type === 'exception';

                          return (
                            <td 
                              key={`${pIndex}-${dIndex}`} 
                              rowSpan={span}
                              className="p-1 border-r border-gray-100 last:border-r-0 align-top border-b border-gray-50 relative group"
                              // --- SỬA ĐỔI: GỌI MODAL KHI CLICK ---
                              onClick={() => handleSlotClick(schedule, weekDays[dIndex])}
                            >
                              <div className={`absolute inset-1 rounded-md p-1.5 text-[10px] flex flex-col gap-0.5 shadow-sm transition-all cursor-pointer border overflow-hidden hover:scale-[1.02]
                                  ${isCanceled 
                                  ? "bg-red-50 border-red-200 text-red-700 hover:bg-red-100" 
                                  : isOverride 
                                      ? "bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100" 
                                      : "bg-emerald-50 border-emerald-100 text-emerald-800 hover:shadow-md" 
                                  }
                              `}>
                                  {isOverride && (
                                  <div className={`absolute top-0 right-0 px-1 py-0 text-[8px] font-bold rounded-bl-md ${isCanceled ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`}>
                                      {isCanceled ? 'OFF' : 'CHANGE'}
                                  </div>
                                  )}
                                  <div className="font-bold line-clamp-2 leading-tight pr-3 break-words">{schedule.courseName}</div>
                                  {!isCanceled && (
                                  <div className="text-[9px] opacity-80 flex items-center gap-1 mt-auto">
                                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-50 flex-shrink-0"></span>
                                      <span className="truncate">{schedule.lecturer}</span>
                                  </div>
                                  )}
                                  <div className="text-[9px] opacity-60 mt-0.5">
                                      {schedule.startTime.substring(0,5)} - {schedule.endTime.substring(0,5)}
                                  </div>
                              </div>
                            </td>
                          )
                      } else {
                          // Render ô trống để Add Exception thủ công (giữ nguyên)
                          return (
                             <td 
                              key={`${pIndex}-${dIndex}`} 
                              rowSpan={span}
                              className="p-1 border-r border-gray-100 last:border-r-0 align-top border-b border-gray-50 relative"
                              onClick={() => {
                                  const day = weekDays[dIndex];
                                  const pStart = normalizeTime(PERIODS[pIndex].start);
                                  const endIndex = pIndex + span - 1;
                                  const endPeriodObj = PERIODS[endIndex < PERIODS.length ? endIndex : PERIODS.length - 1];
                                  const pEnd = normalizeTime(endPeriodObj.end);
                                  if (onAddException) onAddException(day, pStart.substring(0,5), pEnd.substring(0,5));
                              }}
                            >
                              <div className="w-full h-full min-h-[3rem] rounded-md hover:bg-gray-50 flex items-center justify-center opacity-0 hover:opacity-100 transition-all cursor-pointer border border-transparent hover:border-dashed hover:border-gray-300 group">
                                  <Plus className="w-3 h-3 text-gray-400 group-hover:scale-110 transition-transform" />
                              </div>
                            </td>
                          )
                      }
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
        </div>
      </div>

      {/* --- RENDER MODAL --- */}
      // RENDER MODAL
{selectedSlot && (
  <ScheduleExceptionModal
    isOpen={isModalOpen}
    scheduleEntry={selectedSlot.schedule}
    date={format(selectedSlot.date, "yyyy-MM-dd")} 
    onClose={() => {
      setIsModalOpen(false)
      setSelectedSlot(null)
    }}
    onConfirm={handleModalConfirm}
    // Không cần truyền availableCourses nữa
  />
)}
    </>
  )
}