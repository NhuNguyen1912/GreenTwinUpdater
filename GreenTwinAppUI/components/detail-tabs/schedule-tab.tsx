"use client"

import { useEffect, useState } from "react"
import { Upload, Plus, Trash2, Clock, Calendar, User, BookOpen } from "lucide-react"
import { getRooms, getSchedules, createSchedule, deleteSchedule, type Room } from "@/lib/api"
import * as XLSX from 'xlsx'; 
import { format } from "date-fns"
import RoomSchedule from "../timetable/room-schedule" 

// Interface Schedule (khớp với room-schedule.tsx)
export interface Schedule {
  id: string;
  roomId: string;
  roomName: string;
  courseName: string;
  lecturer: string;
  weekdays: string[];
  startTime: string;
  endTime: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  enabled?: boolean;
  isException?: boolean; 
}

// Helper parse Excel (giữ nguyên)
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

// Nhận prop room để biết đang ở phòng nào
export default function ScheduleTab({ room }: { room?: any }) {
  // Nếu không có prop room, fallback về A001 hoặc lấy từ list
  const currentRoomId = room?.id || "A001"; 
  
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  
  // Form & Import state...
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  
  // Form fields
  const [courseName, setCourseName] = useState("")
  const [lecturer, setLecturer] = useState("")
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [startTime, setStartTime] = useState("")
  const [endTime, setEndTime] = useState("")
  const [effectiveFrom, setEffectiveFrom] = useState("")
  const [effectiveTo, setEffectiveTo] = useState("")

  const weekdays = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]

  // Load Data
  const loadData = async () => {
  try {
    setLoading(true); // Nên set loading để UI biết đang làm việc
    const s = await getSchedules();
    
    // --- KHẮC PHỤC LỖI TẠI ĐÂY ---
    // Lấy lịch của phòng hiện tại HOẶC lịch chưa kịp cập nhật phòng (Unknown)
    // Lưu ý: "Unknown" thường là lịch mới tạo của chính phòng này
    const roomSchedules = s.filter((item: any) => 
      item.roomId === currentRoomId || item.roomId === null
    );
    
    console.log("Dữ liệu sau khi lọc:", roomSchedules); // Log để kiểm tra
    setSchedules(roomSchedules as unknown as Schedule[]);
  } catch (err) {
    console.error("Failed load schedules", err)
  } finally {
    setLoading(false)
  }
}

  useEffect(() => {
    loadData()
  }, [currentRoomId])

  // Handle Exception
  const handleAddException = async (date: Date, startT: string, endT: string) => {
    const dateStr = format(date, "yyyy-MM-dd");
    const dayOfWeek = format(date, "EEE").toUpperCase(); 

    const action = window.prompt(
        `TẠO NGOẠI LỆ CHO NGÀY ${dateStr} (${startT}-${endT})?\n\n` +
        `- Nhập 'nghi' để báo nghỉ.\n` +
        `- Nhập tên môn mới để dạy bù.\n`, 
        "nghi"
    );
    
    if (!action) return;

    let newCourse = action;
    let newLecturer = "";
    if (action.toLowerCase().trim() === "nghi") {
        newCourse = "Canceled";
    } else {
        newLecturer = window.prompt("Tên giảng viên (nếu có):") || "";
    }

    try {
        const created = await createSchedule(currentRoomId, {
            courseName: newCourse,
            lecturer: newLecturer,
            weekdays: [dayOfWeek],
            startTime: startT,
            endTime: endT,
            effectiveFrom: dateStr,
            effectiveTo: dateStr
        });

        // OPTIMISTIC UPDATE: Thêm ngay vào UI
        const newSched: Schedule = {
            id: created.id,
            roomId: currentRoomId,
            roomName: room?.name || currentRoomId,
            courseName: created.courseName,
            lecturer: created.lecturer,
            weekdays: created.weekdays,
            startTime: created.startTime,
            endTime: created.endTime,
            effectiveFrom: created.effectiveFrom,
            effectiveTo: created.effectiveTo,
            isException: true, // Vì logic exception
            enabled: true
        };
        setSchedules(prev => [...prev, newSched]);

        // Gọi load lại để đồng bộ sau
        loadData();
    } catch (err) {
        alert("Lỗi tạo ngoại lệ");
    }
  }

  // Handle Manual Create
  const handleCreateSchedule = async () => {
     if (!courseName || !startTime || !endTime || !effectiveFrom || !effectiveTo || selectedDays.length === 0) {
        alert("Vui lòng điền đầy đủ thông tin.");
        return;
     }
     setCreating(true);
     try {
        const sTime = startTime.length === 5 ? `${startTime}:00` : startTime;
        const eTime = endTime.length === 5 ? `${endTime}:00` : endTime;
        
        // 1. Gọi API
        const created = await createSchedule(currentRoomId, {
            courseName, lecturer, weekdays: selectedDays, startTime: sTime, endTime: eTime, effectiveFrom, effectiveTo
        });

        // 2. OPTIMISTIC UPDATE: Thêm ngay vào mảng schedules hiện tại
        // Đây là bước quan trọng nhất để lịch hiện ngay lập tức
        const newSched: Schedule = {
            id: created.id,
            roomId: currentRoomId, // Gán cứng roomId hiện tại
            roomName: room?.name || currentRoomId,
            courseName: created.courseName,
            lecturer: created.lecturer,
            weekdays: created.weekdays,
            startTime: created.startTime,
            endTime: created.endTime,
            effectiveFrom: created.effectiveFrom,
            effectiveTo: created.effectiveTo,
            enabled: true,
            isException: false
        };

        setSchedules(prev => [...prev, newSched]);

        // Reset form
        setCourseName(""); setLecturer(""); setSelectedDays([]); setStartTime(""); setEndTime("");
        alert("Tạo lịch thành công!");

        // 3. Load ngầm để đồng bộ (không await để ko chặn UI)
        loadData();

     } catch(err) {
         console.error(err);
         alert("Lỗi tạo lịch.");
     } finally {
         setCreating(false);
     }
  }

  // --- LOGIC IMPORT EXCEL, DELETE, TOGGLE DAY GIỮ NGUYÊN ---
  // (Tôi rút gọn phần này để tập trung vào fix, bạn giữ nguyên code cũ của bạn cho các hàm handleFileUpload, handleDeleteSchedule, toggleDay)

  const toggleDay = (day: string) => {
    if (selectedDays.includes(day)) {
        setSelectedDays(selectedDays.filter(d => d !== day));
    } else {
        setSelectedDays([...selectedDays, day]);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      // ... Copy logic cũ của bạn vào đây ...
  };

  if (loading) return <div className="py-10 text-center text-gray-500">Loading schedules...</div>;

  return (
    <div className="p-6 space-y-6">
      <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
        <Calendar className="text-emerald-600" /> 
        Thời Khóa Biểu - Phòng {room?.name || currentRoomId}
      </h2>

      {/* BẢNG LỊCH */}
      <div className="glass-panel p-1 border border-emerald-100 bg-white rounded-2xl shadow-sm overflow-hidden h-[600px]">
          <RoomSchedule 
            schedules={schedules} 
            roomId={currentRoomId} 
            onAddException={handleAddException} 
          />
      </div>
      
      {/* FORM TẠO LỊCH THỦ CÔNG */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <h3 className="font-bold mb-4 flex items-center gap-2">
            <Plus size={18} /> Tạo lịch mới
        </h3>
        <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Môn học</label>
                <input 
                    className="w-full border p-2 rounded-md" 
                    value={courseName} 
                    onChange={e => setCourseName(e.target.value)}
                    placeholder="Nhập tên môn..." 
                />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Giảng viên</label>
                <input 
                    className="w-full border p-2 rounded-md" 
                    value={lecturer} 
                    onChange={e => setLecturer(e.target.value)}
                    placeholder="Nhập tên GV..." 
                />
            </div>
        </div>

        <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">Ngày trong tuần</label>
            <div className="flex gap-2 flex-wrap">
                {weekdays.map(d => (
                    <button 
                        key={d}
                        onClick={() => toggleDay(d)}
                        className={`px-3 py-1 rounded-full text-xs font-bold border transition-colors ${
                            selectedDays.includes(d) 
                            ? "bg-emerald-600 text-white border-emerald-600" 
                            : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"
                        }`}
                    >
                        {d}
                    </button>
                ))}
            </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Giờ bắt đầu</label>
                <input type="time" className="w-full border p-2 rounded-md" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Giờ kết thúc</label>
                <input type="time" className="w-full border p-2 rounded-md" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hiệu lực từ</label>
                <input type="date" className="w-full border p-2 rounded-md" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Đến ngày</label>
                <input type="date" className="w-full border p-2 rounded-md" value={effectiveTo} onChange={e => setEffectiveTo(e.target.value)} />
            </div>
        </div>

        <button 
            onClick={handleCreateSchedule} 
            disabled={creating}
            className="w-full bg-emerald-600 text-white py-2 rounded-md font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50"
        >
            {creating ? "Đang tạo..." : "Lưu Lịch Học"}
        </button>
      </div>
    </div>
  )
}