// Utility functions for timetable logic

// Period definitions with fixed times
export const PERIODS = [
  { period: 1, start: "06:50", end: "07:40", session: "morning" },
  { period: 2, start: "07:40", end: "08:30", session: "morning" },
  { period: 3, start: "08:30", end: "09:20", session: "morning" },
  { period: 4, start: "09:30", end: "10:20", session: "morning" },
  { period: 5, start: "10:20", end: "11:10", session: "morning" },
  { period: 6, start: "11:10", end: "12:00", session: "morning" },
  { period: 7, start: "12:45", end: "13:35", session: "afternoon" },
  { period: 8, start: "13:35", end: "14:25", session: "afternoon" },
  { period: 9, start: "14:25", end: "15:15", session: "afternoon" },
  { period: 10, start: "15:25", end: "16:15", session: "afternoon" },
  { period: 11, start: "16:15", end: "17:05", session: "afternoon" },
  { period: 12, start: "17:05", end: "17:55", session: "afternoon" },
  { period: 13, start: "18:05", end: "18:55", session: "evening" },
  { period: 14, start: "18:55", end: "19:45", session: "evening" },
  { period: 15, start: "19:45", end: "20:35", session: "evening" },
  { period: 16, start: "20:35", end: "21:25", session: "evening" },
]

export const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

// Pastel color palette for courses
export const PASTEL_COLORS = [
  "bg-rose-100 border-rose-200 text-rose-900",
  "bg-blue-100 border-blue-200 text-blue-900",
  "bg-purple-100 border-purple-200 text-purple-900",
  "bg-amber-100 border-amber-200 text-amber-900",
  "bg-cyan-100 border-cyan-200 text-cyan-900",
  "bg-pink-100 border-pink-200 text-pink-900",
  "bg-indigo-100 border-indigo-200 text-indigo-900",
  "bg-teal-100 border-teal-200 text-teal-900",
  "bg-orange-100 border-orange-200 text-orange-900",
  "bg-lime-100 border-lime-200 text-lime-900",
]

// Convert time string (HH:MM:SS) to period number
export function timeToPeriodsRange(startTime: string, endTime: string): { startPeriod: number; endPeriod: number } {
  const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(":").map(Number)
    return h * 60 + m
  }

  const startMinutes = timeToMinutes(startTime)
  const endMinutes = timeToMinutes(endTime)

  let startPeriod = 1
  let endPeriod = 16

  // Find which period the start time falls into
  for (let i = 0; i < PERIODS.length; i++) {
    const periodStart = timeToMinutes(PERIODS[i].start)
    const periodEnd = timeToMinutes(PERIODS[i].end)

    if (startMinutes >= periodStart && startMinutes < periodEnd) {
      startPeriod = PERIODS[i].period
    }
    if (endMinutes > periodStart && endMinutes <= periodEnd) {
      endPeriod = PERIODS[i].period
    }
  }

  return { startPeriod, endPeriod }
}

// Get random pastel color for a course
export function getColorForCourse(courseId: string): string {
  const hash = courseId.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return PASTEL_COLORS[hash % PASTEL_COLORS.length]
}

// Map day name to day index (0-6)
export function dayToDayIndex(day: string): number {
  return DAYS.indexOf(day.toUpperCase())
}
