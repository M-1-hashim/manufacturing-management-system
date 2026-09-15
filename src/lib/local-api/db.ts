'use client'

/**
 * دیتابیس محلی — لایهٔ ذخیره‌سازی روی localStorage
 * هر کولکشن یک آرایهٔ JSON در localStorage است (کلید: setab-local.<name>)
 * ساختار رکوردها مشابه schema.prisma — تاریخ‌ها ISO string
 */

export type Row = Record<string, unknown> & { id: string }

import type { LocalSession } from './types'

export type { LocalSession }

const PREFIX = 'setab-local.'

// ---------------- عملیات پایهٔ کولکشن ----------------

export function readCol<T extends Row>(name: string): T[] {
  try {
    const raw = localStorage.getItem(PREFIX + name)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export function writeCol<T extends Row>(name: string, rows: T[]): void {
  try {
    localStorage.setItem(PREFIX + name, JSON.stringify(rows))
  } catch (e) {
    console.error('[local-db] write failed', name, e)
    throw new Error('حافظهٔ دستگاه پر است — دیتای قدیمی را پاک یا کاپی احتیاطی بگیرید')
  }
}

/** تولید شناسهٔ یکتا (مشابه cuid) */
export function uid(): string {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 10)
  const rnd2 = Math.random().toString(36).slice(2, 6)
  return `c${ts}${rnd}${rnd2}`
}

export function nowISO(): string {
  return new Date().toISOString()
}

/** رکورد جدید با id/createdAt/updatedAt */
export function newRow<T extends object>(data: T): T & Row {
  const ts = nowISO()
  return { ...(data as object), id: uid(), createdAt: ts, updatedAt: ts } as unknown as T & Row
}

/** به‌روزرسانی updatedAt هنگام ویرایش */
export function withUpdate<T extends Row>(row: T, patch: Partial<T>): T {
  return { ...row, ...patch, updatedAt: nowISO() }
}

/** مرتب‌سازی نزولی بر اساس updatedAt (قرارداد رایج route های هاست) */
export function byUpdatedDesc<T extends Row>(a: T, b: T): number {
  return String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
}

/** مرتب‌سازی نزولی بر اساس تاریخ مشخص (date/createdAt) */
export function byDateDesc<T extends Row>(key: string = 'date') {
  return (a: T, b: T): number => String(b[key] ?? '').localeCompare(String(a[key] ?? ''))
}

// ---------------- تنظیمات (کولکشن key/value) ----------------

export function getSetting(key: string, fallback = ''): string {
  const rows = readCol<{ id: string; key: string; value: string }>('settings')
  return rows.find((r) => r.key === key)?.value ?? fallback
}

export function setSetting(key: string, value: string): void {
  const rows = readCol<{ id: string; key: string; value: string; updatedAt?: string }>('settings')
  const existing = rows.find((r) => r.key === key)
  if (existing) {
    existing.value = value
    existing.updatedAt = nowISO()
    writeCol('settings', rows)
  } else {
    writeCol('settings', [
      ...rows,
      { id: uid(), key, value, createdAt: nowISO(), updatedAt: nowISO() },
    ])
  }
}

// ---------------- نشست محلی ----------------

const SESSION_KEY = PREFIX + 'session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 روز — مشابه هاست

export function getSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as LocalSession
    if (!s?.uid || !s.exp || s.exp < Date.now()) {
      localStorage.removeItem(SESSION_KEY)
      return null
    }
    return s
  } catch {
    return null
  }
}

export function setSession(user: { id: string; username: string; fullName: string; role: string; department: string }): void {
  const s: LocalSession = {
    uid: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    department: user.department,
    exp: Date.now() + SESSION_TTL_MS,
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

// ---------------- گزارش فعالیت‌ها (Audit) ----------------

/**
 * ثبت رخداد — مشابه logAudit در src/lib/audit.ts
 * هرگز خطا پرتاب نمی‌کند.
 */
export function logAudit(
  actor: { uid?: string; username?: string } | null,
  action: string,
  entity: string,
  entityId?: string,
  details?: string
): void {
  try {
    const row = newRow({
      userId: actor?.uid ?? null,
      userName: actor?.username ?? null,
      action,
      entity,
      entityId: entityId ?? null,
      details: details ?? null,
    })
    const rows = readCol('auditLogs')
    rows.push(row)
    // نگه‌داری حداکثر 2000 رخداد آخر برای جلوگیری از پرشدن حافظه
    const trimmed = rows.length > 2000 ? rows.slice(rows.length - 2000) : rows
    writeCol('auditLogs', trimmed)
  } catch {
    /* بی‌اهمیت */
  }
}

/** بازیگر پیش‌فرض از نشست فعلی */
export function actorFrom(session: LocalSession | null): { uid?: string; username?: string } {
  return session ? { uid: session.uid, username: session.username } : { username: 'system' }
}
