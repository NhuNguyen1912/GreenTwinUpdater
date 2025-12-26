"use client"

import { useState, useRef, useEffect } from "react"
import { MessageCircle, X, Send, Bot, Loader2, User } from "lucide-react"

// Định nghĩa kiểu tin nhắn đơn giản
type Message = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false)
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  
  // State lưu lịch sử chat
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: 'Xin chào! Tôi là GreenTwin AI. Bạn cần kiểm tra thông tin gì?' }
  ])

  const scrollRef = useRef<HTMLDivElement>(null)

  // Tự cuộn xuống cuối
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, isLoading])

  // Hàm gửi tin nhắn
  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!input.trim() || isLoading) return

    // 1. Hiển thị tin nhắn người dùng ngay lập tức
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setIsLoading(true)

    try {
      // 2. Gọi API (Gửi kèm toàn bộ lịch sử chat để AI nhớ ngữ cảnh)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            messages: [...messages, userMsg] // Gửi cả cũ lẫn mới
        })
      })

      const data = await response.json()

      // 3. Hiển thị câu trả lời của AI
      const botMsg: Message = { 
          id: (Date.now() + 1).toString(), 
          role: 'assistant', 
          content: data.content 
      }
      setMessages(prev => [...prev, botMsg])

    } catch (error) {
      console.error(error)
      setMessages(prev => [...prev, { id: 'err', role: 'assistant', content: "Xin lỗi, có lỗi kết nối." }])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex flex-col items-end pointer-events-none font-sans">
      
      {/* CỬA SỔ CHAT */}
      {isOpen && (
        <div className="bg-white w-[380px] h-[550px] rounded-2xl shadow-2xl border border-gray-200 mb-4 flex flex-col overflow-hidden pointer-events-auto animate-in slide-in-from-bottom-5 fade-in duration-300">
            
            {/* Header */}
            <div className="bg-emerald-600 p-4 flex justify-between items-center text-white shadow-md">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-white/20 rounded-full"><Bot size={24}/></div>
                    <div>
                        <h3 className="font-bold text-base">Trợ lý Tòa nhà</h3>
                        <p className="text-[11px] opacity-90">Hỗ trợ tra cứu dữ liệu</p>
                    </div>
                </div>
                <button onClick={() => setIsOpen(false)} className="hover:bg-white/20 p-2 rounded transition-colors"><X size={20}/></button>
            </div>

            {/* Khung tin nhắn */}
            <div ref={scrollRef} className="flex-1 p-4 bg-gray-50 overflow-y-auto space-y-4">
                {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] p-3.5 rounded-2xl text-sm shadow-sm ${
                            m.role === 'user' 
                            ? 'bg-emerald-600 text-white rounded-br-none' 
                            : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'
                        }`}>
                            {m.content}
                        </div>
                    </div>
                ))}
                
                {/* Loading Spinner */}
                {isLoading && (
                    <div className="flex justify-start">
                        <div className="bg-white p-4 rounded-2xl rounded-bl-none border border-gray-200 shadow-sm flex items-center gap-2">
                           <Loader2 size={16} className="animate-spin text-emerald-600"/>
                           <span className="text-xs text-gray-500">Đang xử lý...</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Input Form */}
            <form onSubmit={handleSend} className="p-3 bg-white border-t border-gray-100 flex gap-2">
                <input 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Nhập câu hỏi..."
                    className="flex-1 bg-gray-100 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button 
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="p-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-all"
                >
                    {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                </button>
            </form>
        </div>
      )}

      {/* Nút Mở Chat */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 bg-emerald-600 hover:bg-emerald-700 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-110 pointer-events-auto"
      >
        {isOpen ? <X size={28}/> : <MessageCircle size={28}/>}
      </button>
    </div>
  )
}