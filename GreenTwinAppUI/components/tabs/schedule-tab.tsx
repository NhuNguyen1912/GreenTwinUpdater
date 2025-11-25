"use client"

import { useEffect, useState } from "react"
import { Upload, Plus, Trash2 } from "lucide-react"
import { getRooms, getSchedules, type Room, type Schedule } from "@/lib/api"

export default function ScheduleTab() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)

  // Form state
  const [selectedRoom, setSelectedRoom] = useState<string>("")
  const [courseName, setCourseName] = useState("")
  const [lecturer, setLecturer] = useState("")
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")

  const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

  // Load rooms + schedules
  useEffect(() => {
    async function load() {
      try {
        const r = await getRooms()
        const s = await getSchedules()
        setRooms(r)
        setSchedules(s)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function toggleDay(day: string) {
    setSelectedDays((prev) =>
      prev.includes(day)
        ? prev.filter((d) => d !== day)
        : [...prev, day]
    )
  }

  function handleCreateSchedule() {
    if (!selectedRoom || !courseName || !startTime || !endTime) return

    const roomObj = rooms.find((r) => r.id === selectedRoom)
    if (!roomObj) return

    const newItem: Schedule = {
      id: Date.now().toString(),
      roomId: roomObj.id,
      roomName: roomObj.name,
      courseName,
      lecturer,
      weekdays: selectedDays,
      startTime,
      endTime,
    }

    setSchedules((prev) => [...prev, newItem])

    // Reset form
    setSelectedRoom("")
    setCourseName("")
    setLecturer("")
    setSelectedDays([])
    setStartTime("")
    setEndTime("")
  }

  function deleteSchedule(id: string) {
    setSchedules((prev) => prev.filter((s) => s.id !== id))
  }

  if (loading)
    return <div className="px-4 pt-6 text-gray-500">Loading schedules…</div>

  return (
    <div className="px-4 pt-6 pb-20">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Classroom Schedules</h1>
      <p className="text-sm text-gray-600 mb-8">
        Schedules drive room automation. Set up courses to enable smart controls.
      </p>

      {/* Import */}
      <div className="glass-panel p-8 mb-8 text-center border border-gray-100 bg-white rounded-2xl">
        <div className="flex justify-center mb-4">
          <Upload size={32} className="text-emerald-600" />
        </div>
        <h3 className="font-semibold text-gray-900 mb-2">Import Schedule</h3>
        <p className="text-sm text-gray-600 mb-4">
          Upload Excel file with: Room, Course, Lecturer, Weekdays, Start, End
        </p>
        <button className="px-6 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors font-medium text-sm">
          Choose File
        </button>
      </div>

      {/* Manual Create */}
      <div className="glass-panel p-6 mb-8 border border-gray-100 bg-white rounded-2xl">
        <h3 className="font-semibold text-gray-900 mb-4">Create Schedule Manually</h3>

        <div className="space-y-4">
          {/* Room */}
          <div>
            <label className="text-sm font-medium text-gray-900">Room</label>
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="w-full mt-2 px-4 py-2 border border-gray-200 rounded-lg text-gray-900"
            >
              <option value="">Select Room</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </select>
          </div>

          {/* Course */}
          <div>
            <label className="text-sm font-medium text-gray-900">Course Name</label>
            <input
              type="text"
              value={courseName}
              onChange={(e) => setCourseName(e.target.value)}
              className="w-full mt-2 px-4 py-2 border border-gray-200 rounded-lg"
            />
          </div>

          {/* Lecturer */}
          <div>
            <label className="text-sm font-medium text-gray-900">Lecturer</label>
            <input
              type="text"
              value={lecturer}
              onChange={(e) => setLecturer(e.target.value)}
              className="w-full mt-2 px-4 py-2 border border-gray-200 rounded-lg"
            />
          </div>

          {/* Weekdays */}
          <div>
            <label className="text-sm font-medium text-gray-900 block mb-3">Weekdays</label>
            <div className="grid grid-cols-4 gap-2">
              {weekdays.map((day) => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`py-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedDays.includes(day)
                      ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                      : "border-gray-200 text-gray-700 hover:border-emerald-400"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-900">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full mt-2 px-4 py-2 border border-gray-200 rounded-lg"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-900">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full mt-2 px-4 py-2 border border-gray-200 rounded-lg"
              />
            </div>
          </div>

          <button
            onClick={handleCreateSchedule}
            className="w-full py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors font-medium"
          >
            Save Schedule
          </button>
        </div>
      </div>

      {/* Schedule List */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-4">All Schedules</h3>

        <div className="space-y-3">
          {schedules.map((s) => (
            <div
              key={s.id}
              className="glass-panel p-5 border-l-4 border-l-emerald-500 bg-white rounded-xl shadow-sm"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs font-medium text-gray-600 uppercase">{s.roomName}</p>
                  <h4 className="font-semibold text-gray-900 mt-1">{s.courseName}</h4>
                  <p className="text-sm text-gray-600">{s.lecturer}</p>
                </div>

                <button
                  onClick={() => deleteSchedule(s.id)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Trash2 size={18} className="text-gray-400 hover:text-red-600" />
                </button>
              </div>

              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {s.weekdays.map((day) => (
                  <span
                    key={day}
                    className="px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded"
                  >
                    {day}
                  </span>
                ))}
              </div>

              <p className="text-sm text-gray-600">
                {s.startTime} – {s.endTime}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
