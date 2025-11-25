'use client'

import { Clock, Edit2 } from 'lucide-react'

interface ScheduleTabProps {
  room: any
}

const mockSchedules = [
  {
    id: '1',
    courseName: 'Data Networks',
    lecturer: 'Dr. Smith',
    weekdays: ['MON', 'WED', 'FRI'],
    startTime: '09:00',
    endTime: '10:30',
    enabled: true,
  },
  {
    id: '2',
    courseName: 'Advanced Python',
    lecturer: 'Prof. Brown',
    weekdays: ['TUE', 'THU'],
    startTime: '13:30',
    endTime: '15:00',
    enabled: true,
  },
  {
    id: '3',
    courseName: 'Web Development',
    lecturer: 'Dr. Lee',
    weekdays: ['MON', 'WED'],
    startTime: '15:30',
    endTime: '17:00',
    enabled: false,
  },
]

export default function ScheduleTab({ room }: ScheduleTabProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-gray-900">Classroom Schedule</h3>
        <button className="text-emerald-600 hover:text-emerald-700 text-sm font-medium flex items-center gap-1">
          <Edit2 size={16} />
          Edit
        </button>
      </div>

      <div className="space-y-3">
        {mockSchedules.map((schedule) => (
          <div
            key={schedule.id}
            className={`glass-panel p-5 border-l-4 ${
              schedule.enabled ? 'border-l-emerald-500' : 'border-l-gray-300'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-semibold text-gray-900">{schedule.courseName}</h4>
                <p className="text-sm text-gray-600">{schedule.lecturer}</p>
              </div>
              {!schedule.enabled && (
                <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded">
                  Disabled
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {schedule.weekdays.map((day) => (
                <span
                  key={day}
                  className="px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded"
                >
                  {day}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock size={16} />
              <span>
                {schedule.startTime} – {schedule.endTime}
              </span>
            </div>
          </div>
        ))}
      </div>

      <button className="w-full glass-panel p-4 font-medium text-emerald-600 hover:bg-emerald-50 transition-colors mt-6">
        Add Schedule
      </button>
    </div>
  )
}
