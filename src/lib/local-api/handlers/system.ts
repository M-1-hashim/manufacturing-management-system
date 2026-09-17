'use client'

/**
 * هندلرهای وضعیت سیستم — آینهٔ src/app/api/system/**
 * در APK مستقل همیشه: بدون هاست، دیتابیس = localStorage همین دستگاه
 * ساختار پاسخ‌ها دقیقاً مثل route های هاست (همهٔ فیلدها با مقادیر حالت محلی)
 */

import { ApiError, bodyAs, route, type Ctx, type RouteDef } from '../types'
import { getSession } from '../db'
import { APP_VERSION } from '@/lib/app-version'
import { getHostConfig } from '@/lib/host-link'
import { probeHost } from '@/lib/host-link'
import { pullSnapshot } from '../host-client'

// 19 کولکشن محلی — معادل 19 جدول EXPECTED_TABLES در route هاست (به همان ترتیب)
const COLLECTIONS = [
  'users', 'auditLogs', 'productCategories', 'products', 'suppliers', 'rawMaterials',
  'formulas', 'formulaItems', 'productionOrders', 'customers', 'sales', 'saleItems',
  'warehouses', 'inventoryTransactions', 'expenses', 'employees', 'attendance',
  'salaries', 'settings',
]

const PREFIX = 'setab-local.'

/** قالب‌بندی حجم — همان فرمول route هاست */
function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/** حجم بایتِ همهٔ داده‌های برنامه در localStorage (کلیدهای setab-local.*) */
function localBytes(): number {
  const enc = new TextEncoder()
  let total = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      total += enc.encode(k).length + enc.encode(localStorage.getItem(k) ?? '').length
    }
  } catch {
    /* localStorage در دسترس نیست */
  }
  return total
}

/** فقط ادمین — پیام‌ها مثل route هاست db-setup */
function requireAdmin(ctx: Ctx): void {
  const s = ctx.session ?? getSession()
  if (!s) throw new ApiError(401, 'ابتدا وارد سیستم شوید')
  if (s.role !== 'admin') throw new ApiError(403, 'فقط مدیر سیستم به این بخش دسترسی دارد')
}

export const routes: RouteDef[] = [
  // GET /api/system/connection-status — دیتابیس محلی + (اگر تنظیم شده باشد) وضعیت پیوند هاست
  route('GET', '/api/system/connection-status', () => {
    const cfg = getHostConfig()
    return {
    ok: true,
    configured: true,
    mode: 'local',
    host: null,
    port: null,
    database: null,
    lastCheckAt: null,
    lastOkAt: null,
    lastError: null,
    lastErrorCode: null,
    lastErrorKind: null,
    offlineSince: null,
    syncing: false,
    snapshotting: false,
    lastSyncAt: null,
    lastSnapshotAt: cfg?.lastPullAt ?? null,
    lastSnapshotRows: null,
    lastSyncError: cfg?.lastPullError ?? null,
    pendingPush: 0,
    lastTick: null,
    // پیوند هاست (سرور مرکزی) — مخصوص نسخهٔ اندروید با هاست تنظیم‌شده
    hostLink: cfg
      ? {
          configured: true,
          url: cfg.url,
          serverVersion: cfg.serverVersion ?? null,
          verifiedAt: cfg.verifiedAt ?? null,
          lastPullAt: cfg.lastPullAt ?? null,
          lastPullError: cfg.lastPullError ?? null,
        }
      : { configured: false },
  }
  }),

  // GET /api/system/db-info — وضعیت دیتابیس فعال (localStorage) با همان ساختار هاست
  route('GET', '/api/system/db-info', () => {
    // جدول‌های گمشده = کولکشن‌هایی که هنوز در localStorage نیستند
    const missing = COLLECTIONS.filter((c) => {
      try {
        return localStorage.getItem(PREFIX + c) == null
      } catch {
        return true
      }
    })
    const size = localBytes()
    return {
      ok: true,
      appVersion: APP_VERSION,
      mode: 'local-sqlite',
      configuredForHost: false,
      host: '',
      port: '',
      database: '',
      version: 'SQLite (local copy)',
      tableCount: COLLECTIONS.length - missing.length,
      expectedCount: COLLECTIONS.length,
      missingTables: missing,
      schemaComplete: missing.length === 0,
      lastHostError: null,
      lastHostErrorKind: null,
      lastHostErrorCode: null,
      lastHostOkAt: null,
      lastCheckAt: null,
      offlineSince: null,
      lastSnapshotAt: null,
      lastSyncAt: null,
      syncing: false,
      // حجم دیتای محلی — مخصوص نسخهٔ اندروید (نمایش در تنظیمات)
      size,
      sizeHuman: humanSize(size),
    }
  }),

  // POST /api/system/db-setup — راه‌اندازی هاست در نسخهٔ مستقل بی‌معناست
  route('POST', '/api/system/db-setup', (ctx) => {
    requireAdmin(ctx)
    return {
      ok: false,
      error: 'در نسخهٔ اندروید مستقل نیازی به تنظیم هاست نیست',
    }
  }),

  // POST /api/system/sync-actions — همگام‌سازی دوسویه هنوز مخصوص نسخهٔ دسکتاپ است
  route('POST', '/api/system/sync-actions', (ctx) => {
    const body = bodyAs<{ action?: string }>(ctx.body)
    if (!body?.action) throw new ApiError(400, 'UNKNOWN_ACTION')
    return {
      ok: true,
      result: 'در حالت محلی همگام‌سازی لازم نیست',
    }
  }),

  // POST /api/system/host-sync — پیوند هاست: تست اتصال / کپی بروز دیتا از سرور
  // (برای همهٔ نقش‌ها مجاز است — گارد ناظر در engine برای این مسیر مستثنا شده)
  route('POST', '/api/system/host-sync', async (ctx) => {
    const s = ctx.session ?? getSession()
    if (!s) throw new ApiError(401, 'ابتدا وارد سیستم شوید')
    const body = bodyAs<{ action?: string }>(ctx.body)
    if (body?.action === 'test') {
      const cfg = getHostConfig()
      if (!cfg) return { ok: false, error: 'هاست تنظیم نشده است' }
      const p = await probeHost(cfg.url)
      return p.ok ? { ok: true, version: p.version ?? null } : { ok: false, error: p.error ?? 'هاست در دسترس نیست' }
    }
    if (body?.action === 'pull') {
      const r = await pullSnapshot({ uid: s.uid, username: s.username })
      return r.ok ? { ok: true, rows: r.rows ?? null } : { ok: false, error: r.error ?? 'کپی گرفتن ناموفق بود' }
    }
    throw new ApiError(400, 'UNKNOWN_ACTION')
  }),
]
