"use client"

import { useState } from "react"
import { X, AlertCircle } from "lucide-react"

interface ScheduleException {
  type: "cancel" | "replace"
  courseId: string
  date: string
  originalCourseName: string
  originalLecturer: string
  startTime: string
  endTime: string
  newCourseName?: string
  newLecturer?: string
}

interface ScheduleExceptionModalProps {
  isOpen: boolean
  scheduleEntry: any
  date: string
  onClose: () => void
  onConfirm: (exception: ScheduleException) => void
  availableCourses: Array<{ name: string; lecturer: string }>
}

export default function ScheduleExceptionModal({
  isOpen,
  scheduleEntry,
  date,
  onClose,
  onConfirm,
  availableCourses,
}: ScheduleExceptionModalProps) {
  const [selectedAction, setSelectedAction] = useState<"cancel" | "replace" | null>(null)
  const [selectedCourse, setSelectedCourse] = useState<{ name: string; lecturer: string } | null>(null)

  if (!isOpen) return null

  const handleConfirm = () => {
    if (selectedAction === "cancel") {
      onConfirm({
        type: "cancel",
        courseId: scheduleEntry.id,
        date,
        originalCourseName: scheduleEntry.courseName,
        originalLecturer: scheduleEntry.lecturer,
        startTime: scheduleEntry.startTime,
        endTime: scheduleEntry.endTime,
      })
    } else if (selectedAction === "replace" && selectedCourse) {
      onConfirm({
        type: "replace",
        courseId: scheduleEntry.id,
        date,
        originalCourseName: scheduleEntry.courseName,
        originalLecturer: scheduleEntry.lecturer,
        startTime: scheduleEntry.startTime,
        endTime: scheduleEntry.endTime,
        newCourseName: selectedCourse.name,
        newLecturer: selectedCourse.lecturer,
      })
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-md w-full shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Quản lý lịch học</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Current Schedule Info */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <p className="text-sm font-semibold text-gray-900">{scheduleEntry.courseName}</p>
            <p className="text-xs text-gray-600">{scheduleEntry.lecturer}</p>
            <p className="text-xs text-gray-500 mt-2">
              {scheduleEntry.startTime.slice(0, 5)} – {scheduleEntry.endTime.slice(0, 5)} • {date}
            </p>
          </div>

          {/* Action Selection */}
          <div className="space-y-3">
            {/* Cancel Option */}
            <label
              className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all hover:bg-red-50"
              style={{ borderColor: selectedAction === "cancel" ? "#ef4444" : "#e5e7eb" }}
            >
              <input
                type="radio"
                name="action"
                value="cancel"
                checked={selectedAction === "cancel"}
                onChange={(e) => setSelectedAction(e.target.value as "cancel" | "replace")}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Hủy buổi học này</p>
                <p className="text-xs text-gray-600 mt-1">Chỉ áp dụng cho ngày này, không ảnh hưởng các tuần khác</p>
              </div>
            </label>

            {/* Replace Option */}
            <label
              className="flex items-start gap-3 p-4 border-2 rounded-lg cursor-pointer transition-all hover:bg-green-50"
              style={{ borderColor: selectedAction === "replace" ? "#16a34a" : "#e5e7eb" }}
            >
              <input
                type="radio"
                name="action"
                value="replace"
                checked={selectedAction === "replace"}
                onChange={(e) => setSelectedAction(e.target.value as "cancel" | "replace")}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-medium text-gray-900">Thay bằng môn khác</p>
                <p className="text-xs text-gray-600 mt-1">Thay thế bằng một môn học khác trong cùng khung giờ</p>
              </div>
            </label>
          </div>

          {/* Course Selection for Replace */}
          {selectedAction === "replace" && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">Chọn môn học thay thế</label>
              <select
                value={selectedCourse ? `${selectedCourse.name}|${selectedCourse.lecturer}` : ""}
                onChange={(e) => {
                  if (e.target.value) {
                    const [name, lecturer] = e.target.value.split("|")
                    setSelectedCourse({ name, lecturer })
                  } else {
                    setSelectedCourse(null)
                  }
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">-- Chọn môn học --</option>
                {availableCourses.map((course, idx) => (
                  <option key={idx} value={`${course.name}|${course.lecturer}`}>
                    {course.name} - {course.lecturer}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Warning */}
          <div className="flex gap-3 p-3 bg-amber-50 rounded-lg">
            <AlertCircle size={18} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">Lịch gốc sẽ vẫn được giữ nguyên, chỉ ngày này bị áp dụng ngoại lệ.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors font-medium"
          >
            Hủy
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedAction || (selectedAction === "replace" && !selectedCourse)}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Xác nhận
          </button>
        </div>
      </div>
    </div>
  )
}
