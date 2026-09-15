import { dbInternal, type DbMode } from '@/lib/db'
import {
  getMeta,
  setMeta,
  ensureJournalTable,
  installOfflineJournaling,
  snapshotServerToLocal,
  runReconnectSync,
  pendingPushCount,
  syncTick,
  getLastTickResult,
  pruneServerTombstones,
  countMismatchTables,
  type ClientPair,
  type SyncSummary,
} from '@/lib/sync-engine'
import { ensureHostReady } from '@/lib/host-setup'
import { MYSQL_TABLE_NAMES } from '@/lib/mysql-ddl'
import { ensureLocalSchema } from '@/lib/local-schema'

/*
 * مدیریت اتصال + زمان‌بند همگام‌سازی لحظه‌ای — معماری محلی‌محور:
 *
 * - برنامه همیشه روی دیتابیس محلی (SQLite) کار می‌کند → سرعت حداکثر
 * - هر 3 ثانیه یک «تیک» همگام‌سازی دوسویه اجرا می‌شود (فقط دلتاها؛
 *   تیک بی‌کار فقط 2 رفت‌وبرگشت شبکه دارد)
 * - هر 15 ثانیه پینگ هاست (SELECT 1) — برای تشخیص قطعی/وصل شدن
 * - قطعی: بعد از دو خطای پیاپی (یا اولین خطا در 60 ثانیهٔ اول) → بج
 *   «آفلاین» + تیک‌ها متوقف + تغییرات روی محلی صف می‌شوند
 * - وصل شدن: برگشت خودکار → push تغییرات آفلاین + اسنپ‌شات کامل
 * - هر 15 دقیقه «مطابق‌سازی تور ایمنی»: اگر شمارش سطرها ناهم‌خوان باشد
 *   و هیچ تغییر ارسال‌نشده‌ای وجود نداشته باشد → اسنپ‌شات اصلاحی
 */

export const CHECK_INTERVAL_MS = 15_000
export const PING_TIMEOUT_MS = 8_000
export const TICK_INTERVAL_MS = 3_000
const RECONCILE_INTERVAL_MS = 15 * 60 * 1000
const FAILS_TO_SWITCH = 2
const BOOT_GRACE_MS = 60_000

export interface ConnectionStatus {
  configured: boolean
  mode: DbMode
  host: string | null
  port: string | null
  database: string | null
  lastCheckAt: string | null
  lastOkAt: string | null
  lastError: string | null
  lastErrorCode: string | null
  lastErrorKind: string | null
  offlineSince: string | null
  syncing: boolean
  snapshotting: boolean
  lastSyncAt: string | null
  lastSnapshotAt: string | null
  lastSnapshotRows: number | null
  lastSyncError: string | null
  lastSyncSummary: SyncSummary | null
}

interface ManagerState {
  started: boolean
  timer: ReturnType<typeof setInterval> | null
  tickTimer: ReturnType<typeof setInterval> | null
  reconcileTimer: ReturnType<typeof setInterval> | null
  startedAt: number
  checking: boolean
  fails: number
  hostReady: boolean
  hostSetupTried: boolean
  lastCheckAt: string | null
  lastOkAt: string | null
  lastError: string | null
  lastErrorCode: string | null
  lastErrorKind: string | null
  offlineSince: string | null
  syncing: boolean
  snapshotting: boolean
  lastSyncAt: string | null
  lastSnapshotAt: string | null
  lastSnapshotRows: number | null
  lastSyncError: string | null
  lastSyncSummary: SyncSummary | null
}

const g = globalThis as unknown as { __mfgConnMgr?: ManagerState }

function st(): ManagerState {
  if (!g.__mfgConnMgr) {
    g.__mfgConnMgr = {
      started: false,
      timer: null,
      tickTimer: null,
      reconcileTimer: null,
      startedAt: Date.now(),
      checking: false,
      fails: 0,
      hostReady: false,
      hostSetupTried: false,
      lastCheckAt: null,
      lastOkAt: null,
      lastError: null,
      lastErrorCode: null,
      lastErrorKind: null,
      offlineSince: null,
      syncing: false,
      snapshotting: false,
      lastSyncAt: null,
      lastSnapshotAt: null,
      lastSnapshotRows: null,
      lastSyncError: null,
      lastSyncSummary: null,
    }
  }
  return g.__mfgConnMgr
}

function getPair(): ClientPair | null {
  const { sqlite, mysql } = dbInternal.getClients()
  if (!mysql || !sqlite) return null
  return { server: mysql, local: sqlite }
}

function classifyError(e: unknown): { code: string; kind: string } {
  const err = e as { code?: string; message?: string }
  const code = String(err?.code || '')
  const msg = String(err?.message || '')
  if (code === 'P1001' || /Can't reach|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|EHOSTUNREACH|PING_TIMEOUT/i.test(msg))
    return { code: code || 'P1001', kind: 'UNREACHABLE' }
  if (code === 'P1017' || /not allowed to connect|ER_HOST_NOT_PRIVILEGED/i.test(msg))
    return { code: code || 'P1017', kind: 'UNREACHABLE' }
  if (/Access denied/i.test(msg)) return { code: code || 'ACCESS_DENIED', kind: 'AUTH' }
  if (/Unknown database/i.test(msg)) return { code: code || 'UNKNOWN_DB', kind: 'NO_DATABASE' }
  if (code === 'P2021' || /doesn't exist/i.test(msg)) return { code: code || 'P2021', kind: 'NO_TABLES' }
  return { code: code || 'UNKNOWN', kind: 'UNKNOWN' }
}

/* ------------------------------- پینگ هاست ------------------------------- */

async function pingMysql(): Promise<void> {
  const { mysql } = dbInternal.getClients()
  if (!mysql) throw new Error('NO_MYSQL_CLIENT')
  const q = mysql.$queryRawUnsafe('SELECT 1')
  q.catch(() => {}) // جلوگیری از unhandledRejection پس از تایم‌اوت مسابقه
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PING_TIMEOUT — هاست در 8 ثانیه پاسخ نداد')), PING_TIMEOUT_MS)
    q.then(
      () => { clearTimeout(timer); resolve() },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/* ------------------------------- راه‌اندازی هاست ------------------------------- */

/**
 * راه‌اندازی خودکار هاست — یک‌بار در طول عمر پروسه:
 * ساخت/تجدید جدول‌های هاست (19 جدول + ستون‌های جدید + جدول سنگ‌قبر)
 * + بوت‌استرپ استفاده‌کنندگان/تنظیمات وقتی هاست خالی است.
 */
async function ensureHostOnce(): Promise<boolean> {
  const s = st()
  if (s.hostReady) return true
  if (s.hostSetupTried) return false
  const pair = getPair()
  if (!pair) return false
  s.hostSetupTried = true
  try {
    const r = await ensureHostReady(pair)
    if (r.ok) {
      s.hostReady = true
      console.log(
        `[conn] host setup OK: tables ${r.tablesAfter}/${MYSQL_TABLE_NAMES.length}` +
          ` created=[${r.createdTables.join(',') || '-'}] migrated=[${r.migratedColumns.join(',') || '-'}]` +
          (r.bootstrapped ? ` bootstrap(users:${r.copiedUsers}, settings:${r.copiedSettings})` : '')
      )
      return true
    }
    console.warn(`[conn] host setup problem: ${r.error}`)
    return false
  } catch (e) {
    console.error('[conn] host setup failed:', e)
    return false
  }
}

/* ------------------------------- سوییچ‌ها ------------------------------- */

async function switchToOffline(errorText: string): Promise<void> {
  const pair = getPair()
  if (!dbInternal.hasLocal() || !pair) {
    // استقرار وب روی هاست — دیتابیس محلی در کار نیست؛ فقط گزارش
    console.error('[conn] host unreachable and no local db — staying on host:', errorText)
    return
  }
  const s = st()
  dbInternal.setMode('host-offline')
  s.fails = 0
  if (!s.offlineSince) s.offlineSince = new Date().toISOString()
  try {
    await setMeta(pair, 'sync.offlineSince', s.offlineSince)
    await setMeta(pair, 'sync.lastMode', 'host-offline')
  } catch (e) {
    console.error('[conn] persist offline meta failed:', e)
  }
  console.warn(`[conn] ⚠ OFFLINE mode — host unreachable (${errorText}). Changes queued locally since ${s.offlineSince}`)
}

async function switchToOnline(): Promise<void> {
  const pair = getPair()
  if (!pair) return
  const s = st()
  dbInternal.setMode('host-mysql')
  s.fails = 0
  void setMeta(pair, 'sync.lastMode', 'host-mysql').catch(() => {})
  s.syncing = true
  console.log('[conn] ✅ host reachable again — reconnect sync started')
  try {
    const ready = await ensureHostOnce()
    if (!ready) throw new Error('host setup failed')
    // اگر دستگاه محلی خالی است (نصب تازه روی دستگاه جدید) → اول کپی کامل هاست
    await ensureInitialPull(pair)
    const summary = await runReconnectSync(pair, s.offlineSince)
    s.lastSyncAt = summary.finishedAt
    s.lastSyncSummary = summary
    s.lastSyncError = null
    s.offlineSince = null
    console.log('[conn] reconnect sync finished:', JSON.stringify(summary))
  } catch (e) {
    s.lastSyncError = String((e as Error)?.message || e)
    console.error('[conn] reconnect sync failed:', e)
  } finally {
    s.syncing = false
  }
}

/* --------------------------- اولین کپی هاست → دستگاه --------------------------- */

let initialPullDone = false

/**
 * اگر دیتابیس محلی هیچ کاربری ندارد و هاست در دسترس است، کامل کپی می‌شود
 * (نصب تازه روی دستگاه جدید / پاک‌شدن دیتابیس محلی). از مسیر لاگین هم
 * قابل فراخوانی است تا اولین ورود بدون داده انجام نشود.
 */
export async function ensureInitialPull(pair?: ClientPair): Promise<boolean> {
  const p = pair ?? getPair()
  if (!p) return false
  if (initialPullDone) return true
  try {
    const userCount = await p.local.user.count()
    if (userCount > 0) {
      initialPullDone = true
      return true
    }
    const s = st()
    s.snapshotting = true
    try {
      const r = await snapshotServerToLocal(p)
      initialPullDone = true
      s.lastSnapshotAt = new Date().toISOString()
      s.lastSnapshotRows = r.rows
      console.log(`[conn] initial pull from host OK: ${r.rows} rows`)
      return true
    } finally {
      s.snapshotting = false
    }
  } catch (e) {
    console.error('[conn] initial pull failed:', e)
    return false
  }
}

/* ------------------------------- تیک همگام‌سازی ------------------------------- */

async function runTick(): Promise<void> {
  const s = st()
  const pair = getPair()
  if (!pair) return
  if (dbInternal.getMode() !== 'host-mysql' || !s.hostReady || s.syncing) return
  try {
    const r = await syncTick(pair)
    if (!r.ok && r.error && !r.error.startsWith('tables:')) {
      // خطای سطح شبکه/هاست — بگذار پینگ سریع بعدی وضعیت را تشخیص دهد
      s.fails++
      if (dbInternal.getMode() === 'host-mysql' && s.fails >= FAILS_TO_SWITCH) {
        await switchToOffline(`tick: ${r.error}`)
      }
    } else if (r.ok || (r.error ?? '').startsWith('tables:')) {
      s.fails = Math.max(0, s.fails - 1)
    }
  } catch (e) {
    console.error('[conn] tick crashed:', e)
  }
}

/* ------------------------------- بررسی دوره‌ای ------------------------------- */

export async function checkNow(): Promise<ReturnType<typeof getState>> {
  const s = st()
  if (!dbInternal.mysqlConfigured() || s.checking) return getState()
  s.checking = true
  try {
    await pingMysql()
    s.lastCheckAt = new Date().toISOString()
    s.lastOkAt = s.lastCheckAt
    s.lastError = null
    s.lastErrorCode = null
    s.lastErrorKind = null

    const mode = dbInternal.getMode()
    if (mode === 'host-offline') {
      // برگشت خودکار به هاست + همگام‌سازی
      await switchToOnline()
    } else if (mode === 'host-mysql') {
      // اولین اتصال موفق: راه‌اندازی هاست (جدول‌ها/ستون‌ها/بوت‌استرپ) — یک‌بار
      const ready = await ensureHostOnce()
      if (ready) {
        await ensureInitialPull()
      }
    }
  } catch (e) {
    const { code, kind } = classifyError(e)
    s.lastCheckAt = new Date().toISOString()
    s.lastError = String((e as Error)?.message || e).slice(0, 300)
    s.lastErrorCode = code
    s.lastErrorKind = kind
    s.fails++
    const bootGrace = Date.now() - s.startedAt < BOOT_GRACE_MS
    if (dbInternal.getMode() === 'host-mysql' && (s.fails >= FAILS_TO_SWITCH || bootGrace)) {
      await switchToOffline(s.lastError)
    }
  } finally {
    s.checking = false
  }
  return getState()
}

/* ------------------- مطابق‌سازی دوره‌ای (تور ایمنی) ------------------- */

async function reconcile(): Promise<void> {
  const s = st()
  const pair = getPair()
  if (!pair) return
  if (dbInternal.getMode() !== 'host-mysql' || !s.hostReady || s.syncing || s.snapshotting) return
  try {
    await pruneServerTombstones(pair)
    // فقط وقتی هیچ تغییر در صف نیست — وگرنه ناهم‌خوانی طبیعی است
    const pending = await pendingPushCount(pair)
    if (pending > 0) return
    const mismatched = await countMismatchTables(pair)
    if (mismatched.length === 0) return
    console.warn(`[conn] row-count mismatch on [${mismatched.join(',')}] — running repair snapshot`)
    s.snapshotting = true
    try {
      const r = await snapshotServerToLocal(pair)
      s.lastSnapshotAt = new Date().toISOString()
      s.lastSnapshotRows = r.rows
      console.log(`[conn] repair snapshot OK: ${r.rows} rows`)
    } finally {
      s.snapshotting = false
    }
  } catch (e) {
    console.error('[conn] reconcile failed:', e)
  }
}

/* ------------------------------- شروع ------------------------------- */

export function startConnectionManager(): void {
  const s = st()
  if (s.started) return
  s.started = true
  s.startedAt = Date.now()

  void ensureLocalSchema()

  if (!dbInternal.mysqlConfigured()) {
    dbInternal.setMode('local')
    console.log('[conn] no host configured — local SQLite mode')
    return
  }

  const pair = getPair()
  if (!pair) {
    // استقرار وب روی هاست (بدون دیتابیس محلی) — بدون failover و بدون سینک
    dbInternal.setMode('host-mysql')
    console.log('[conn] mysql configured but no local db — local-first disabled (web deploy)')
    return
  }

  void (async () => {
    try {
      installOfflineJournaling()
      await ensureJournalTable(pair)
      const lastMode = await getMeta(pair, 'sync.lastMode')
      const storedOffline = await getMeta(pair, 'sync.offlineSince')
      s.lastSnapshotAt = await getMeta(pair, 'sync.lastSnapshotAt')
      s.lastSyncAt = await getMeta(pair, 'sync.lastSyncAt')
      if (lastMode === 'host-offline' || (storedOffline && storedOffline.length > 4)) {
        // اجرای قبلی در حالت آفلاین تمام شده — همین‌طور شروع کن (سریع و امن)
        dbInternal.setMode('host-offline')
        s.offlineSince = storedOffline && storedOffline.length > 4 ? storedOffline : new Date().toISOString()
        await setMeta(pair, 'sync.offlineSince', s.offlineSince)
        console.log(`[conn] starting in OFFLINE mode (previous session) since ${s.offlineSince}`)
      }
    } catch (e) {
      console.error('[conn] init from previous state failed:', e)
    }
    void checkNow()
    s.timer = setInterval(() => void checkNow(), CHECK_INTERVAL_MS)
    s.tickTimer = setInterval(() => void runTick(), TICK_INTERVAL_MS)
    s.reconcileTimer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS)
  })()
}

/* ------------------------------- اکشن‌های دستی ------------------------------- */

/** «همگام‌سازی اکنون»: در آفلاین کوشش برای اتصال؛ در آنلاین یک تیک فوری */
export async function triggerSyncNow(): Promise<{ action: string; result?: string; error?: string }> {
  const s = st()
  const mode = dbInternal.getMode()
  if (mode === 'host-offline') {
    await checkNow() // اگر هاست رسیده باشد → switchToOnline + sync خودکار
    const newMode = dbInternal.getMode()
    if (newMode === 'host-mysql') return { action: 'reconnect', result: 'sync started' }
    return { action: 'reconnect', error: s.lastError || 'هاست هنوز در دسترس نیست' }
  }
  if (mode === 'host-mysql') {
    const pair = getPair()
    if (!pair) return { action: 'tick', error: 'no local db' }
    const r = await syncTick(pair)
    return {
      action: 'tick',
      result: r.ok
        ? `↑${r.pushed} ↓${r.pulled} ✕${r.deleted} (${r.ms}ms)`
        : `error: ${r.error ?? 'unknown'}`,
      error: r.ok ? undefined : r.error,
    }
  }
  return { action: 'none', error: 'حالت محلی — هاست تنظیم نشده است' }
}

export async function triggerSnapshotNow(): Promise<{ ok: boolean; rows?: number; error?: string }> {
  const s = st()
  const pair = getPair()
  if (!pair) return { ok: false, error: 'no local db or no host' }
  if (dbInternal.getMode() !== 'host-mysql') return { ok: false, error: 'فقط در حالت اتصال به هاست' }
  if (s.snapshotting) return { ok: false, error: 'اسنپ‌شات قبلی در حال اجراست' }
  s.snapshotting = true
  try {
    const r = await snapshotServerToLocal(pair)
    s.lastSnapshotAt = new Date().toISOString()
    s.lastSnapshotRows = r.rows
    return { ok: true, rows: r.rows }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) }
  } finally {
    s.snapshotting = false
  }
}

/* ------------------------------- وضعیت ------------------------------- */

export interface TickInfo {
  ok: boolean
  pushed: number
  pulled: number
  deleted: number
  ms: number
  at: string | null
  error?: string
}

export async function getFullStatus(): Promise<ConnectionStatus & { pendingPush: number | null; lastTick: TickInfo | null }> {
  const s = st()
  const base = getState()
  let pendingPush: number | null = null
  const pair = getPair()
  // شمارش صف فقط روی دیتابیس محلی است — هم در آنلاین و هم در آفلاین معنا دارد
  if (pair && (dbInternal.getMode() === 'host-mysql' || dbInternal.getMode() === 'host-offline')) {
    try {
      pendingPush = await pendingPushCount(pair)
    } catch {
      /* ignore */
    }
  }
  const t = getLastTickResult()
  const lastTick: TickInfo | null = t
    ? { ok: t.ok, pushed: t.pushed, pulled: t.pulled, deleted: t.deleted, ms: t.ms, at: new Date().toISOString(), error: t.error }
    : null
  return { ...base, pendingPush, lastTick }
}

export function getState(): ConnectionStatus {
  const s = st()
  const info = dbInternal.mysqlInfo()
  return {
    configured: dbInternal.mysqlConfigured(),
    mode: dbInternal.getMode(),
    host: info?.host ?? null,
    port: info?.port ?? null,
    database: info?.database ?? null,
    lastCheckAt: s.lastCheckAt,
    lastOkAt: s.lastOkAt,
    lastError: s.lastError,
    lastErrorCode: s.lastErrorCode,
    lastErrorKind: s.lastErrorKind,
    offlineSince: s.offlineSince,
    syncing: s.syncing,
    snapshotting: s.snapshotting,
    lastSyncAt: s.lastSyncAt,
    lastSnapshotAt: s.lastSnapshotAt,
    lastSnapshotRows: s.lastSnapshotRows,
    lastSyncError: s.lastSyncError,
    lastSyncSummary: s.lastSyncSummary,
  }
}
