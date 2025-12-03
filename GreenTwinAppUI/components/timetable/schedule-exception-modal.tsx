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
  // Đã xóa prop availableCourses vì không còn dùng nữa
}

export default function ScheduleExceptionModal({
  isOpen,
  scheduleEntry,
  date,
  onClose,
  onConfirm,
}: ScheduleExceptionModalProps) {
  const [selectedAction, setSelectedAction] = useState<"cancel" | "replace" | null>(null)
  
  // State mới cho input thủ công
  const [newCourseName, setNewCourseName] = useState("")
  const [newLecturer, setNewLecturer] = useState("")

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
    } else if (selectedAction === "replace") {
      // Logic mới: Lấy dữ liệu từ input text
      onConfirm({
        type: "replace",
        courseId: scheduleEntry.id,
        date,
        originalCourseName: scheduleEntry.courseName,
        originalLecturer: scheduleEntry.lecturer,
        startTime: scheduleEntry.startTime,
        endTime: scheduleEntry.endTime,
        newCourseName: newCourseName, // Lấy từ state
        newLecturer: newLecturer,     // Lấy từ state
      })
    }
  }

  // Điều kiện disable nút xác nhận
  const isConfirmDisabled = 
    !selectedAction || 
    (selectedAction === "replace" && !newCourseName.trim()); // Bắt buộc phải nhập tên môn

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

          {/* INPUT FORM: Chỉ hiện khi chọn Replace */}
          {selectedAction === "replace" && (
            <div className="space-y-4 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tên môn học thay thế <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newCourseName}
                  onChange={(e) => setNewCourseName(e.target.value)}
                  placeholder="Ví dụ: Lập trình Web (Dạy bù)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                  autoFocus
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                    Tên giảng viên
                </label>
                <input
                  type="text"
                  value={newLecturer}
                  onChange={(e) => setNewLecturer(e.target.value)}
                  placeholder="Nhập tên giảng viên..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 text-sm"
                />
              </div>
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
            Đóng
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
          >
            Xác nhận
          </button>
        </div>
      </div>
    </div>
  )
}