"use client"

import React, { createContext, useContext, useState, useEffect } from "react"
import { useRouter } from "next/navigation"

export type UserRole = "admin" | "guest"

export interface User {
  username: string
  role: UserRole
}

interface AuthContextType {
  user: User | null
  login: (username: string, role: UserRole) => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const router = useRouter()

  // Khôi phục session từ localStorage khi reload trang
  useEffect(() => {
    const storedUser = localStorage.getItem("gt_user")
    if (storedUser) {
      setUser(JSON.parse(storedUser))
    }
  }, [])

  const login = (username: string, role: UserRole) => {
    const newUser = { username, role }
    setUser(newUser)
    localStorage.setItem("gt_user", JSON.stringify(newUser))
    router.push("/") // Chuyển về trang chủ sau khi login
  }

  const logout = () => {
    setUser(null)
    localStorage.removeItem("gt_user")
    router.push("/login")
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}