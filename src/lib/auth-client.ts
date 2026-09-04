'use client'

// مدیریت متمرکز انقضای نشست در سمت کلاینت
// هر جای برنامه که پاسخ 401 برسد: وضعیت کاربر پاک و پیام مناسب نمایش داده می‌شود
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import type { Lang } from '@/lib/i18n'

const MESSAGES: Record<Lang, string> = {
  fa: 'نشست شما منقضی شده است؛ لطفاً دوباره وارد شوید',
  ps: 'ستاسو ناسته پای ته رسیدلې؛ مهرباني وکړئ بیا ننوځئ',
  en: 'Your session has expired; please sign in again',
}

let lastNotify = 0

/** پاک‌سازی کاربر جاری و نمایش پیام انقضای نشست (حداکثر یک‌بار در ۳ ثانیه) */
export function notifyAuthFailure(): void {
  const before = useAppStore.getState().user
  useAppStore.getState().setUser(null)
  // اگر کاربری وارد نبود، پیام انقضا بی‌معنی است (مثلاً صفحه ورود)
  if (!before) return
  const now = Date.now()
  if (now - lastNotify < 3000) return
  lastNotify = now
  const lang = useAppStore.getState().lang
  toast.error(MESSAGES[lang] ?? MESSAGES.fa)
}

/** مسیرهای احراز هویت که نباید خروج خودکار ایجاد کنند */
function isAuthExempt(url: string): boolean {
  return url.includes('/api/auth/')
}

/** رهگیری سراسری پاسخ‌های 401 — fetch های مستقیم ماژول‌ها را هم پوشش می‌دهد */
export function installAuthInterceptor(): void {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __authInterceptorInstalled?: boolean }
  if (w.__authInterceptorInstalled) return
  w.__authInterceptorInstalled = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args)
    try {
      const input = args[0]
      const url =
        typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : String(input)
      if (res.status === 401 && url.includes('/api/') && !isAuthExempt(url)) {
        notifyAuthFailure()
      }
    } catch {
      // رهگیری هرگز جریان اصلی درخواست را نمی‌شکند
    }
    return res
  }
}
