"use client"

import { useEffect, useState, useRef } from "react"
import { Upload, Plus, Trash2, Clock, Calendar, User, BookOpen } from "lucide-react"
import { getRooms, getSchedules, createSchedule, deleteSchedule, type Room, type Schedule } from "@/lib/api"
import * as XLSX from 'xlsx'; 

// Helper parse ngày giờ
const parseExcelDate = (excelValue: any, isTime = false): string => {
  if (!excelValue) return "";
  
  if (typeof excelValue === 'number') {
    const date = new Date(Math.round((excelValue - 25569) * 86400 * 1000));
    if (isTime) {
      const h = date.getUTCHours().toString().padStart(2, '0');
      const m = date.getUTCMinutes().toString().padStart(2, '0');
      const s = date.getUTCSeconds().toString().padStart(2, '0');
      return `${h}:${m}:${s}`;
    } else {
      return date.toISOString().split('T')[0];
    }
  }
  
  const str = String(excelValue).trim();
  if (isTime && str.includes(':')) {
      const parts = str.split(':');
      const h = parts[0].padStart(2, '0');
      const m = parts[1] ? parts[1].padStart(2, '0') : '00';
      const s = parts[2] ? parts[2].padStart(2, '0') : '00';
      return `${h}:${m}:${s}`;
  }
  return str;
};

export default function ScheduleTab() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false) 

  // Form state
  const [selectedRoom, setSelectedRoom] = useState<string>("")
  const [courseName, setCourseName] = useState("")
  const [lecturer, setLecturer] = useState("")
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")

  const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadData = async () => {
    // Không set loading=true ở đây để tránh nháy màn hình khi reload ngầm
    try {
      const [r, s] = await Promise.all([getRooms(), getSchedules()])
      setRooms(r)
      setSchedules(s)
    } catch (err) {
      console.error("Failed to load schedule data", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  function toggleDay(day: string) {
    if (selectedDays.includes(day)) {
        setSelectedDays([])
    } else {
        setSelectedDays([day])
    }
  }

  async function handleCreateSchedule() {
    if (!selectedRoom || !courseName || !startTime || !endTime || !effectiveFrom || !effectiveTo || selectedDays.length === 0) {
      alert("Please fill in all required fields.")
      return
    }

    setCreating(true)
    try {
      const formattedStartTime = startTime.length === 5 ? `${startTime}:00` : startTime;
      const formattedEndTime = endTime.length === 5 ? `${endTime}:00` : endTime;

      // 1. Gọi API tạo lịch
      const newSchedule = await createSchedule(selectedRoom, {
        courseName,
        lecturer,
        weekdays: selectedDays,
        startTime: formattedStartTime,
        endTime: formattedEndTime,
        effectiveFrom,
        effectiveTo
      })

      // 2. Cập nhật UI NGAY LẬP TỨC bằng cách thêm item mới vào state
      // (Cần bổ sung roomName cho item mới để hiển thị đẹp)
      const roomObj = rooms.find(r => r.id === selectedRoom);
      const scheduleWithRoomName: Schedule = {
        ...newSchedule,
        roomName: roomObj ? (roomObj.name || roomObj.id) : selectedRoom // Fallback name
      };

      setSchedules(prev => [...prev, scheduleWithRoomName]);

      // Reset form
      setCourseName("")
      setLecturer("")
      setSelectedDays([])
      setStartTime("")
      setEndTime("")
      setEffectiveFrom("")
      setEffectiveTo("")
      
      // Không cần alert, UI tự cập nhật là đủ feedback rồi
      // alert("Schedule created successfully!") 

    } catch (err) {
      console.error("Create error:", err)
      alert("Failed to create schedule.")
    } finally {
      setCreating(false)
    }
  }

  async function handleDeleteSchedule(id: string) {
    if (!confirm("Are you sure you want to delete this schedule?")) return
    
    // 1. Optimistic Update: Xóa khỏi UI ngay lập tức
    const previousSchedules = [...schedules];
    setSchedules(prev => prev.filter(s => s.id !== id));

    try {
      // 2. Gọi API xóa
      await deleteSchedule(id)
    } catch (err) {
      console.error(err)
      alert("Failed to delete schedule.")
      // Nếu lỗi, hoàn tác lại UI
      setSchedules(previousSchedules);
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    const reader = new FileReader();

    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        let successCount = 0;
        let errorCount = 0;
        
        // Danh sách các lịch mới được tạo thành công để update UI
        const newSchedules: Schedule[] = [];

        for (const row of data) {
            const roomName = row.Room || row.room;
            const courseName = row.Course || row.course;
            const lecturer = row.Lecturer || row.lecturer;
            const weekdaysRaw = row.Weekdays || row.weekdays;
            const startRaw = row.Start || row.start;
            const endRaw = row.End || row.end;
            const effFromRaw = row.EffectiveFrom || row.effectiveFrom || row.effective_from;
            const effToRaw = row.EffectiveTo || row.effectiveTo || row.effective_to;

            const room = rooms.find(r => r.name === roomName || r.id === roomName);
            
            if (room && courseName && startRaw && endRaw) {
                try {
                    const sTime = parseExcelDate(startRaw, true);
                    const eTime = parseExcelDate(endRaw, true);
                    
                    let dayToSave = "";
                    if (weekdaysRaw) {
                        const parts = String(weekdaysRaw).split(',');
                        if (parts.length > 0) {
                            dayToSave = parts[0].trim().toUpperCase();
                        }
                    }

                    const validDays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
                    if (!validDays.includes(dayToSave)) {
                        errorCount++;
                        continue;
                    }

                    const effFrom = parseExcelDate(effFromRaw) || "2024-01-01";
                    const effTo = parseExcelDate(effToRaw) || "2024-12-31";

                    // Gọi API
                    const created = await createSchedule(room.id, {
                        courseName: String(courseName),
                        lecturer: String(lecturer || ""),
                        weekdays: [dayToSave],
                        startTime: sTime,
                        endTime: eTime,
                        effectiveFrom: effFrom,
                        effectiveTo: effTo
                    });
                    
                    // Thêm vào danh sách tạm để update UI
                    newSchedules.push({
                        ...created,
                        roomName: room.name || room.id
                    });

                    successCount++;
                } catch (err) {
                    console.error("Failed to import row:", row, err);
                    errorCount++;
                }
            } else {
                errorCount++;
            }
        }

        // Cập nhật UI ngay lập tức với các lịch vừa import
        setSchedules(prev => [...prev, ...newSchedules]);

        alert(`Import completed.\nSuccess: ${successCount}\nFailed: ${errorCount}`);

      } catch (error) {
        console.error("Error reading file:", error);
        alert("Failed to process Excel file.");
      } finally {
        setImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = ""; 
      }
    };
    reader.readAsBinaryString(file);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-20 text-gray-500 gap-2">
        <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
        Loading schedules...
      </div>
    )

  return (
    <div className="px-4 pt-6 pb-20 space-y-8">
      
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <Calendar className="text-emerald-600" />
          Classroom Schedules
        </h1>
        <p className="text-sm text-gray-600">
          Manage recurring class schedules to automate AC & Lighting controls.
        </p>
      </div>

      {/* Import Section */}
      <div className="glass-panel p-8 text-center border border-gray-100 bg-white rounded-2xl shadow-sm">
        <div className="flex justify-center mb-4">
          <Upload size={32} className="text-emerald-600" />
        </div>
        <h3 className="font-semibold text-gray-900 mb-2">Import Schedule</h3>
        <p className="text-sm text-gray-600 mb-4">
          Upload Excel file with columns: Room, Course, Lecturer, Weekdays, Start, End, EffectiveFrom, EffectiveTo
        </p>
        
        <input 
            type="file" 
            accept=".xlsx, .xls" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            style={{ display: 'none' }} 
        />

        <button 
            onClick={triggerFileInput}
            disabled={importing}
            className="px-6 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors font-medium text-sm flex items-center gap-2 mx-auto disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Importing...
              </>
          ) : (
              "Choose Excel File"
          )}
        </button>
      </div>

      {/* Create Form */}
      <div className="glass-panel p-6 border border-gray-100 bg-white rounded-2xl shadow-sm">
        <h3 className="font-semibold text-gray-900 mb-5 flex items-center gap-2">
          <Plus size={20} className="text-emerald-600" />
          Add New Schedule (Manual)
        </h3>

        <div className="space-y-5">
          {/* Room Selection */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Room</label>
            <select
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
            >
              <option value="">Select a Room...</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name} ({room.building} - {room.floor})
                </option>
              ))}
            </select>
          </div>

          {/* Course & Lecturer */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Course Name</label>
              <div className="relative">
                <BookOpen size={18} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  value={courseName}
                  onChange={(e) => setCourseName(e.target.value)}
                  placeholder="e.g. Advanced IoT"
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Lecturer</label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-3 text-gray-400" />
                <input
                  type="text"
                  value={lecturer}
                  onChange={(e) => setLecturer(e.target.value)}
                  placeholder="e.g. Dr. Smith"
                  className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>
            </div>
          </div>

          {/* NEW: Effective Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Effective From</label>
              <input
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Effective To</label>
              <input
                type="date"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          {/* Weekdays */}
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2 block">Days of Week</label>
            <div className="flex flex-wrap gap-2">
              {weekdays.map((day) => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    selectedDays.includes(day)
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-200 scale-105"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Time Range */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1 block">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleCreateSchedule}
            disabled={creating}
            className="w-full py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-all font-bold shadow-lg shadow-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              "Save Schedule"
            )}
          </button>
        </div>
      </div>

      {/* Schedule List */}
      <div className="mb-8">
        <h3 className="font-semibold text-gray-900 mb-4">All Schedules</h3>
        <div className="space-y-3">
          {schedules.length === 0 ? (
             <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 rounded-xl bg-gray-50">No schedules found</div>
          ) : (
             schedules.map((schedule) => (
            <div key={schedule.id} className="glass-panel p-5 border-l-4 border-l-emerald-500 bg-white rounded-xl shadow-sm">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs font-medium text-gray-600 uppercase">{schedule.roomName}</p>
                  <h4 className="font-semibold text-gray-900 mt-1">{schedule.courseName}</h4>
                  <p className="text-sm text-gray-600">{schedule.lecturer}</p>
                </div>
                <button 
                  onClick={() => handleDeleteSchedule(schedule.id)}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Delete Schedule"
                >
                  <Trash2 size={18} className="text-gray-400 hover:text-red-600" />
                </button>
              </div>
              
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {/* Fix lỗi toString() trên type never bằng String() */}
                {(Array.isArray(schedule.weekdays) 
                    ? schedule.weekdays 
                    : String(schedule.weekdays || "").split(',')
                 ).map((day) => (
                  <span
                    key={day}
                    className="px-2 py-1 bg-emerald-50 text-emerald-700 text-xs font-medium rounded"
                  >
                    {day.trim().slice(0, 3)}
                  </span>
                ))}
              </div>
              
              <div className="flex justify-between items-end pt-2 border-t border-gray-50 mt-2">
                  <p className="text-sm text-gray-600 flex items-center gap-1">
                    <Clock size={14} className="text-emerald-600"/> 
                    {schedule.startTime ? schedule.startTime.substring(0, 5) : "--:--"} – {schedule.endTime ? schedule.endTime.substring(0, 5) : "--:--"}
                  </p>
                  {schedule.effectiveFrom && (
                      <p className="text-[10px] text-gray-400">
                          {schedule.effectiveFrom} → {schedule.effectiveTo}
                      </p>
                  )}
              </div>
            </div>
          )))}
        </div>
      </div>

    </div>
  )
}