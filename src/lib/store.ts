'use client'

// State management مرکزی (Zustand) با ذخیره‌سازی در localStorage
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Lang } from '@/lib/i18n'

export interface SessionUser {
  id: string
  username: string
  fullName: string
  role: 'admin' | 'manager' | 'operator' | 'viewer'
  department: string
}

export type TabId =
  | 'dashboard'
  | 'products'
  | 'materials'
  | 'formulas'
  | 'production'
  | 'sales'
  | 'inventory'
  | 'finance'
  | 'hr'
  | 'reports'
  | 'settings'
  | 'users'
  | 'audit'

interface AppState {
  lang: Lang
  activeTab: TabId
  user: SessionUser | null
  sidebarOpen: boolean // برای موبایل
  online: boolean
  pendingOps: number // تعداد اجراؤات در صف همگام‌سازی آفلاین

  setLang: (l: Lang) => void
  setActiveTab: (t: TabId) => void
  setUser: (u: SessionUser | null) => void
  setSidebarOpen: (v: boolean) => void
  setOnline: (v: boolean) => void
  setPendingOps: (n: number) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      lang: 'fa',
      activeTab: 'dashboard',
      user: null,
      sidebarOpen: false,
      online: true,
      pendingOps: 0,

      setLang: (lang) => set({ lang }),
      setActiveTab: (activeTab) => set({ activeTab }),
      setUser: (user) => set({ user }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setOnline: (online) => set({ online }),
      setPendingOps: (pendingOps) => set({ pendingOps }),
    }),
    {
      name: 'mfg-erp-state',
      partialize: (s) => ({ lang: s.lang, activeTab: s.activeTab, user: s.user }),
    }
  )
)
