import { dbInternal, type DbMode } from '@/lib/db'
import {
  getMeta,
  setMeta,
  ensureJournalTable,
  installOfflineJournaling,
  snapshotServerToLocal,
  runReconnectSync,
  pendingPushCount,
  type ClientPair,
  type SyncSummary,
} from '@/lib/sync-engine'
import { ensureHostReady } from '@/lib/host-setup'
import { MYSQL_TABLE_NAMES } from '@/lib/mysql-ddl'

/*
 * مدیریت اتصال — سوییچ خودکار آنلاین/آفلاین:
 *
 * - هر ۱۵ ثانیه یک SELECT 1 روی هاست MySQL زده می‌شود (تایم‌اوت ۸ ثانیه)
 * - حالت آنلاین (host-mysql): دو خطای پیاپی (یا اولین خطا در ۶۰ ثانیهٔ اول)
 *   → سوییچ به دیتابیس محلی (host-offline). از این لحظه همهٔ خواندن/نوشتن‌ها
 *   روی آخرین کپی دیتای سرور (SQLite) انجام می‌شود و حذف‌ها ژورنال می‌شوند.
 * - حالت آفلاین (host-offline): با اولین پینگ موفق → برگشت خودکار به هاست +
 *   همگام‌سازی کامل (push تغییرات آفلاین → تکرار حذف‌ها → اسنپ‌شات سرور)
 * - بدون هاست (local): هیچ تایمری روشن نمی‌شود.
 */

export const CHECK_INTERVAL_MS = 15_000
export const PING_TIMEOUT_MS = 8_000
const SNAPSHOT_INTERVAL_MS = 15 * 60 * 1000
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
  startedAt: number
  checking: boolean
  fails: number
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
      startedAt: Date.now(),
      checking: false,
      fails: 0,
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
    const timer = setTimeout(() => reject(new Error('PING_TIMEOUT — هاست در ۸ ثانیه پاسخ نداد')), PING_TIMEOUT_MS)
    q.then(
      () => { clearTimeout(timer); resolve() },
      (e) => { clearTimeout(timer); reject(e) }
    )
  })
}

/* ------------------------------- سوییچ‌ها ------------------------------- */

/**
 * راه‌اندازی خودکار هاست — فقط یک‌بار در طول عمر پروسه:
 * ساخت جدول‌های گمشده روی هاست تازه (۱۹ جدول) + بوت‌استرپ کاربران/تنظیمات
 * وقتی هاست خالی است. نتیجه در لاگ سرور ثبت می‌شود.
 */
let hostSetupTried = false
async function ensureHostOnce(): Promise<void> {
  if (hostSetupTried) return
  const pair = getPair()
  if (!pair) return
  hostSetupTried = true
  try {
    const r = await ensureHostReady(pair)
    if (r.ok) {
      console.log(
        `[conn] host setup OK: tables ${r.tablesAfter}/${MYSQL_TABLE_NAMES.length}` +
          ` created=[${r.createdTables.join(',') || '-'}]` +
          (r.bootstrapped ? ` bootstrap(users:${r.copiedUsers}, settings:${r.copiedSettings})` : '')
      )
    } else {
      console.warn(`[conn] host setup problem: ${r.error}`)
    }
  } catch (e) {
    console.error('[conn] host setup failed:', e)
  }
}

async function switchToOffline(errorText: string): Promise<void> {
  const pair = getPair()
  if (!dbInternal.hasLocal() || !pair) {
    // استقرار وب روی هاست — دیتابیس محلی در کار نیست؛ فقط گزارش
    console.error('[conn] host unreachable and no local db — staying on mysql:', errorText)
    return
  }
  const s = st()
  dbInternal.setActive('sqlite')
  dbInternal.setMode('host-offline')
  s.fails = 0
  if (!s.offlineSince) s.offlineSince = new Date().toISOString()
  try {
    await setMeta(pair, 'sync.offlineSince', s.offlineSince)
    await setMeta(pair, 'sync.lastMode', 'host-offline')
  } catch (e) {
    console.error('[conn] persist offline meta failed:', e)
  }
  console.warn(`[conn] ⚠ OFFLINE mode — host unreachable (${errorText}). Working on local SQLite since ${s.offlineSince}`)
}

function switchToOnline(): void {
  const pair = getPair()
  if (!pair) return
  const s = st()
  dbInternal.setActive('mysql')
  dbInternal.setMode('host-mysql')
  s.fails = 0
  void setMeta(pair, 'sync.lastMode', 'host-mysql').catch(() => {})
  s.syncing = true
  const since = s.offlineSince
  console.log('[conn] ✅ host reachable again — reconnect sync started')
  // اول راه‌اندازی هاست (جدول‌های گمشده) — بعد push/snapshot تا خطای NO_TABLES نبینیم
  void ensureHostOnce()
    .catch(() => {})
    .then(() => runReconnectSync(pair, since))
    .then((summary) => {
      s.lastSyncAt = summary.finishedAt
      s.lastSyncSummary = summary
      s.lastSyncError = null
      s.offlineSince = null
      console.log('[conn] reconnect sync finished:', JSON.stringify(summary))
    })
    .catch((e) => {
      s.lastSyncError = String((e as Error)?.message || e)
      console.error('[conn] reconnect sync failed:', e)
    })
    .finally(() => {
      s.syncing = false
    })
}

/* ------------------------------- بررسی دوره‌ای ------------------------------- */

export async function checkNow(): Promise<ConnectionStatus> {
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
      switchToOnline()
    } else if (mode === 'host-mysql') {
      // اولین اتصال موفق: راه‌اندازی هاست (جدول‌ها/بوت‌استرپ) — یک‌بار
      void ensureHostOnce()
      void maybeSnapshot()
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

async function maybeSnapshot(): Promise<void> {
  const s = st()
  const pair = getPair()
  if (!pair || s.snapshotting || s.syncing) return
  const last = s.lastSnapshotAt ? Date.parse(s.lastSnapshotAt) : 0
  if (Date.now() - last < SNAPSHOT_INTERVAL_MS) return
  s.snapshotting = true
  try {
    const r = await snapshotServerToLocal(pair)
    s.lastSnapshotAt = new Date().toISOString()
    s.lastSnapshotRows = r.rows
  } catch (e) {
    console.error('[conn] background snapshot failed:', e)
  } finally {
    s.snapshotting = false
  }
}

/* ------------------------------- شروع ------------------------------- */

export function startConnectionManager(): void {
  const s = st()
  if (s.started) return
  s.started = true
  s.startedAt = Date.now()

  if (!dbInternal.mysqlConfigured()) {
    dbInternal.setMode('local')
    console.log('[conn] no host configured — local SQLite mode')
    return
  }

  void (async () => {
    const pair = getPair()
    if (!pair) {
      // استقرار وب روی هاست (بدون دیتابیس محلی) — بدون failover
      console.log('[conn] mysql configured but no local db — failover disabled (web deploy)')
      return
    }
    try {
      installOfflineJournaling()
      await ensureJournalTable(pair)
      const lastMode = await getMeta(pair, 'sync.lastMode')
      const storedOffline = await getMeta(pair, 'sync.offlineSince')
      s.lastSnapshotAt = await getMeta(pair, 'sync.lastSnapshotAt')
      s.lastSyncAt = await getMeta(pair, 'sync.lastSyncAt')
      if (lastMode === 'host-offline' || (storedOffline && storedOffline.length > 4)) {
        // اجرای قبلی در حالت آفلاین تمام شده — همین‌طور شروع کن (سریع و امن)
        dbInternal.setActive('sqlite')
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
  })()
}

/* ------------------------------- اکشن‌های دستی ------------------------------- */

/** «همگام‌سازی اکنون»: در آفلاین تلاش برای اتصال؛ در آنلاین اسنپ‌شات تازه */
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
    if (!pair) return { action: 'snapshot', error: 'no local db' }
    if (s.snapshotting) return { action: 'snapshot', result: 'already running' }
    s.snapshotting = true
    try {
      const r = await snapshotServerToLocal(pair)
      s.lastSnapshotAt = new Date().toISOString()
      s.lastSnapshotRows = r.rows
      return { action: 'snapshot', result: `${r.rows} rows` }
    } catch (e) {
      return { action: 'snapshot', error: String((e as Error)?.message || e) }
    } finally {
      s.snapshotting = false
    }
  }
  return { action: 'none', error: 'حالت محلی — هاستی تنظیم نشده است' }
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

export async function getFullStatus(): Promise<ConnectionStatus & { pendingPush: number | null }> {
  const s = st()
  const base = getState()
  let pendingPush: number | null = null
  const pair = getPair()
  if (pair && dbInternal.getMode() === 'host-offline' && s.offlineSince) {
    try {
      const since = new Date(s.offlineSince)
      if (!Number.isNaN(since.getTime())) pendingPush = await pendingPushCount(pair, since)
    } catch {
      /* ignore */
    }
  }
  return { ...base, pendingPush }
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
