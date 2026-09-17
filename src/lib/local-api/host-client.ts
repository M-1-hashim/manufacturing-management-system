'use client'

/**
 * کارخواه هاست — ورود از راه دور + دریافت کپی دیتا (فقط حالت محلی/APK)
 * -------------------------------------------------------------------
 * «هاست» = آدرس نسخهٔ وب نصب‌شده (همان سیستمی که دیتابیس MySQL هاست را سرو می‌کند).
 * ورود ابتدا به هاست ارسال می‌شود (اعتبارسنجی با کاربران دیتابیس هاست)؛
 * اگر هاست در دسترس نباشد، مسیر عادی هندلر محلی ادامه می‌یابد (ورود آفلاین).
 *
 * HTTP از پل بومی AndroidBridge.httpRequest می‌رود (بدون محدودیت CORS) و در
 * مرورگر از fetch با credentials:include (کوکی‌ها را مرورگر مدیریت می‌کند).
 */

import {
  bridgeHttp,
  parseJsonResult,
  getHostConfig,
  updateHostConfig,
  type HostConfig,
} from '@/lib/host-link'
import { logAudit, newRow, nowISO, readCol, writeCol, type Row } from './db'
import { restoreAll, type FullExport } from './handlers/backup'

// ---------------- انواع ----------------

export interface RemoteUser {
  id: string
  username: string
  fullName: string
  role: string
  department: string
}

export type RemoteAuthResult =
  | { kind: 'ok'; user: RemoteUser }
  | { kind: 'invalid'; status: number; message: string }
  | { kind: 'locked'; status: number; message: string }
  | { kind: 'inactive'; status: number; message: string }
  | { kind: 'unreachable'; message: string }

// ---------------- ورود از راه دور ----------------

/** استخراج جفت mfg_session از هدر set-cookie (چند کوکی با \n جدا شده‌اند) */
function extractSessionCookie(setCookie: string | undefined): string | undefined {
  if (!setCookie) return undefined
  for (const line of setCookie.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.toLowerCase().startsWith('mfg_session=')) {
      return trimmed.split(';')[0]
    }
  }
  return undefined
}

/**
 * ورود به هاست — پاسخ قطعی هاست (401/423/403/200) عیناً برمی‌گردد؛
 * هر خطای شبکه/فرمت → kind:'unreachable' تا مسیر محلی (آفلاین) ادامه یابد.
 */
export async function remoteLogin(
  cfg: HostConfig,
  username: string,
  password: string
): Promise<RemoteAuthResult> {
  try {
    const r = await bridgeHttp(`${cfg.url}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      timeoutMs: 12000,
    })
    let parsed: { status: number; headers: Record<string, string>; json: unknown }
    try {
      parsed = parseJsonResult(r)
    } catch {
      return { kind: 'unreachable', message: 'پاسخ سرور قابل خواندن نبود (آدرس اشتباه است؟)' }
    }
    const { status, headers, json } = parsed
    const body = (json ?? {}) as { error?: string; id?: string; username?: string; fullName?: string; role?: string; department?: string }

    if (status === 200 && body.id && body.username) {
      // ذخیرهٔ کوکی نشست هاست (فقط مسیر پل اندروید set-cookie را می‌بیند)
      const cookie = extractSessionCookie(headers['set-cookie'])
      updateHostConfig({ cookie, cookieAt: cookie ? nowISO() : undefined })
      return {
        kind: 'ok',
        user: {
          id: String(body.id),
          username: String(body.username),
          fullName: String(body.fullName ?? body.username),
          role: String(body.role ?? 'operator'),
          department: String(body.department ?? 'general'),
        },
      }
    }
    if (status === 423) {
      return { kind: 'locked', status, message: String(body.error ?? 'حساب موقتاً قفل شده است') }
    }
    if (status === 403) {
      return { kind: 'inactive', status, message: String(body.error ?? 'حساب غیرفعال است') }
    }
    return {
      kind: 'invalid',
      status,
      message: String(body.error ?? `ورود ناموفق بود (کد ${status})`),
    }
  } catch (e) {
    return { kind: 'unreachable', message: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------- همگام‌سازی رکورد کاربر در کولکشن محلی ----------------

/**
 * رکورد کاربر موفقِ ورود از راه دور را در users محلی upsert می‌کند تا
 * /api/auth/me و RBAC محلی بدون نیاز به pull کامل کار کنند.
 */
export function upsertLocalUserFromHost(user: RemoteUser, enteredPassword?: string): void {
  const users = readCol<Row & { username: string; password?: string; active?: boolean }>('users')
  const idx = users.findIndex(
    (u) => u.id === user.id || String(u.username).toLowerCase() === user.username.toLowerCase()
  )
  if (idx >= 0) {
    const cur = users[idx]
    users[idx] = {
      ...cur,
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      active: true,
      ...(enteredPassword !== undefined ? { password: enteredPassword } : {}),
      updatedAt: nowISO(),
    }
    writeCol('users', users)
  } else {
    const row = newRow({
      username: user.username,
      // پسورد همان واردشدهٔ این دستگاه — ورود آفلاین بعدی همین کاربر ممکن شود
      ...(enteredPassword !== undefined ? { password: enteredPassword } : {}),
      fullName: user.fullName,
      role: user.role,
      department: user.department,
      active: true,
    })
    writeCol('users', [...users, { ...row, id: user.id }])
  }
}

// ---------------- کپی بروز از هاست ----------------

export interface PullResult {
  ok: boolean
  rows?: number
  error?: string
}

/**
 * دریافت snapshot کامل از هاست (endpoint جدید /api/system/device-snapshot)
 * و بازیابی آن در کولکشن‌های محلی — پسوردهای scrypt حفظ می‌شوند.
 */
export async function pullSnapshot(actor: { uid: string; username: string }): Promise<PullResult> {
  const cfg = getHostConfig()
  if (!cfg) return { ok: false, error: 'هاست تنظیم نشده است' }
  try {
    const headers: Record<string, string> = {}
    if (cfg.cookie) headers['Cookie'] = cfg.cookie
    const r = await bridgeHttp(`${cfg.url}/api/system/device-snapshot`, {
      method: 'GET',
      headers,
      timeoutMs: 30000,
    })
    let parsed: { status: number; json: unknown }
    try {
      parsed = parseJsonResult(r)
    } catch {
      const err = 'پاسخ سرور قابل خواندن نبود (آدرس اشتباه است؟)'
      updateHostConfig({ lastPullError: err })
      return { ok: false, error: err }
    }
    const { status, json } = parsed
    if (status === 401 || status === 403) {
      const err = 'دسترسی به هاست رد شد — دوباره وارد شوید'
      updateHostConfig({ lastPullError: err })
      return { ok: false, error: err }
    }
    if (status !== 200) {
      const err = `کپی گرفتن از هاست ناموفق بود (کد ${status})`
      updateHostConfig({ lastPullError: err })
      return { ok: false, error: err }
    }
    const rows = restoreAll(json as FullExport, actor)
    updateHostConfig({ lastPullAt: nowISO(), lastPullError: null })
    logAudit(actor, 'host_pull', 'system', undefined, `کپی بروز از هاست گرفته شد — ${rows} رکورد`)
    return { ok: true, rows }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    updateHostConfig({ lastPullError: msg })
    return { ok: false, error: msg }
  }
}
