'use client'

/**
 * هندلر تنظیمات — آینهٔ src/app/api/settings/route.ts
 * GET  → آبجکت کامل { key: value }
 * PUT  → upsert چند تنظیم باهم { key: value, ... } و بازگشت آبجکت کامل
 */

import { bodyAs, route, type RouteDef } from '../types'
import { readCol, setSetting, type Row } from '../db'

interface SettingRow extends Row {
  key: string
  value: string
}

/** همهٔ تنظیمات به‌صورت آبجکت — مثل route هاست */
function allSettings(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of readCol<SettingRow>('settings')) out[r.key] = r.value
  return out
}

export const routes: RouteDef[] = [
  // GET /api/settings
  route('GET', '/api/settings', () => allSettings()),

  // PUT /api/settings — ذخیره چند تنظیم باهم
  // (هاست برای تنظیمات audit ثبت نمی‌کند — اینجا هم چیزی ثبت نمی‌شود تا گزارش فعالیت‌ها یکی بماند)
  route('PUT', '/api/settings', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body)
    if (body && Object.keys(body).length > 0) {
      for (const [key, value] of Object.entries(body)) setSetting(key, String(value))
    }
    return allSettings()
  }),
]
