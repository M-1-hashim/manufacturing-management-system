'use client'

// سیستم چندزبانه: دری (پیش‌فرض)، پشتو، انگلیسی
// نحوه استفاده در ماژول‌ها:
//   const { t, lang, dir } = useI18n()
//   t('محصولات', 'محصولات', 'Products')
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useAppStore } from '@/lib/store'

export type Lang = 'fa' | 'ps' | 'en'

interface I18nCtx {
  lang: Lang
  dir: 'rtl' | 'ltr'
  t: (fa: string, ps: string, en: string) => string
}

const ctx = createContext<I18nCtx>({
  lang: 'fa',
  dir: 'rtl',
  t: (fa) => fa,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const lang = useAppStore((s) => s.lang)
  const dir: 'rtl' | 'ltr' = lang === 'en' ? 'ltr' : 'rtl'

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])

  const t = (fa: string, ps: string, en: string) =>
    lang === 'fa' ? fa : lang === 'ps' ? ps : en

  return <ctx.Provider value={{ lang, dir, t }}>{children}</ctx.Provider>
}

export function useI18n() {
  return useContext(ctx)
}
