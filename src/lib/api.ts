'use client'

// کلاینت API — helper های fetch با مدیریت خطا (پیام خطای سرور به‌صورت تمیز استخراج می‌شود)
import { notifyAuthFailure } from '@/lib/auth-client'

async function throwApiError(res: Response, url: string, fallback: string): Promise<never> {
  // انقضای نشست → خروج خودکار و بازگشت به صفحه ورود (به‌جز مسیرهای auth)
  if (res.status === 401 && !url.includes('/api/auth/')) notifyAuthFailure()
  let msg = fallback
  try {
    const text = await res.text()
    try {
      const json = JSON.parse(text) as { error?: string }
      if (json?.error) msg = json.error
      else if (text) msg = text.slice(0, 160)
    } catch {
      if (text) msg = text.slice(0, 160)
    }
  } catch { /* بدنه خالی */ }
  throw new Error(msg)
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    await throwApiError(res, url, `خطا در دریافت داده (${res.status})`)
  }
  return res.json()
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await throwApiError(res, url, `خطا در ثبت داده (${res.status})`)
  }
  return res.json()
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    await throwApiError(res, url, `خطا در به‌روزرسانی (${res.status})`)
  }
  return res.json()
}

export async function apiDelete<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    await throwApiError(res, url, `خطا در حذف (${res.status})`)
  }
  return res.json()
}
