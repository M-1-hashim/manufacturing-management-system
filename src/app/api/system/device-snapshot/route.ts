import { NextResponse } from 'next/server'
import { exportAllJson } from '@/lib/json-backup'
import { verifySession, SESSION_COOKIE } from '@/lib/session'
import { cookies } from 'next/headers'

/**
 * کپی کامل دیتا برای دستگاه‌ها — GET /api/system/device-snapshot
 *
 * مشابه «خروجی JSON» کاپی احتیاطی ولی برای همهٔ کاربران واردشده (نه فقط ادمین):
 * نسخهٔ اندروید پس از ورود موفق، همین endpoint را می‌خواند تا کپی آفلاین
 * دستگاه با دیتای هاست یکی شود. فقط‌خواندنی و بدون اثر جانبی.
 */
export async function GET() {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json(
      { error: 'دسترسی غیرمجاز — ابتدا وارد سیستم شوید' },
      { status: 401 }
    )
  }
  const data = await exportAllJson()
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
