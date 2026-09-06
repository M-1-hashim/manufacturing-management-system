import { createRequire } from 'module'
import path from 'path'
import { PrismaClient } from '@prisma/client'

/*
 * پشتیبانی دوگانه از دیتابیس + تعویض خودکار آنلاین/آفلاین — قلب نسخهٔ دسکتاپ:
 *
 * ۱) کلاینت Prisma در زمان build به یک provider قفل می‌شود (sqlite یا mysql).
 *    اسکریپت دسکتاپ (electron/build-desktop.sh) دو کلاینت می‌سازد:
 *      - SQLite  → node_modules/.prisma/client  (پیش‌فرض)
 *      - MySQL   → node_modules/prisma-mysql-client
 * ۲) این ماژول هر دو کلاینت را در زمان اجرا می‌سازد و «db» یک Proxy است که
 *    همهٔ کوئری‌ها را به «کلاینت فعال» می‌فرستد:
 *      - mode=host-mysql   → همه‌چیز روی هاست (آنلاین)
 *      - mode=host-offline → هاست در دسترس نیست؛ همه‌چیز روی SQLite محلی
 *        (آخرین کپی دیتای سرور) — حذف‌ها هم ژورنال می‌شوند تا بعد از وصل شدن
 *        روی هاست تکرار شوند
 *      - mode=local        → بدون هاست؛ فقط SQLite محلی
 * ۳) تصمیم سوییچ را connection-manager.ts می‌گیرد (پینگ هر ۱۵ ثانیه) و
 *    همگام‌سازی دوسویه را sync-engine.ts انجام می‌دهد.
 */

type AnyPrismaCtor = new (options?: Record<string, unknown>) => PrismaClient

export type DbMode = 'local' | 'host-mysql' | 'host-offline'
export type ActiveClientName = 'sqlite' | 'mysql'

/** نام‌های مدل‌ها (delegate) — فقط همین‌ها در حالت آفلاین رهگیری حذف می‌شوند */
const MODEL_DELEGATES = new Set([
  'user', 'auditLog', 'productCategory', 'product', 'supplier', 'rawMaterial',
  'formula', 'formulaItem', 'productionOrder', 'customer', 'sale', 'saleItem',
  'warehouse', 'inventoryTransaction', 'expense', 'employee', 'attendance',
  'salaryPayment', 'setting',
])

function loadMysqlClientCtor(): AnyPrismaCtor | null {
  try {
    // cwd در نسخهٔ بسته‌شده = resources/server (node_modules همان‌جاست)
    const req = createRequire(path.join(process.cwd(), 'package.json'))
    const mod = req('prisma-mysql-client') as { PrismaClient?: AnyPrismaCtor }
    return mod?.PrismaClient ?? null
  } catch {
    return null
  }
}

function mysqlUrl(): string | null {
  const url = process.env.DATABASE_URL || ''
  if (!url.startsWith('mysql:')) return null
  // تایم‌اوت کوتاه اتصال تا تشخیص قطعی هاست سریع باشد + اتصال ملایم به هاست اشتراکی
  const extra: string[] = []
  if (!/connect_timeout=/.test(url)) extra.push('connect_timeout=6000')
  if (!/connection_limit=/.test(url)) extra.push('connection_limit=5')
  if (extra.length === 0) return url
  return url + (url.includes('?') ? '&' : '?') + extra.join('&')
}

function localUrl(): string | null {
  const explicit = process.env.LOCAL_DATABASE_URL || ''
  if (explicit.startsWith('file:')) return explicit
  const url = process.env.DATABASE_URL || ''
  if (url.startsWith('file:')) return url
  return null
}

interface DbCore {
  sqlite: PrismaClient | null
  mysql: PrismaClient | null
  activeName: ActiveClientName
  active: PrismaClient
  mode: DbMode
  journalHook: ((table: string, where: unknown) => void) | null
}

const globalForDb = globalThis as unknown as { __mfgDbCore?: DbCore }

function buildCore(): DbCore {
  const mUrl = mysqlUrl()
  const lUrl = localUrl()
  const mysqlConfigured = !!mUrl

  let sqlite: PrismaClient | null = null
  if (lUrl) {
    sqlite = lUrl === (process.env.DATABASE_URL || '')
      ? new PrismaClient()
      : new PrismaClient({ datasources: { db: { url: lUrl } } })
  }

  let mysql: PrismaClient | null = null
  if (mUrl) {
    const MysqlCtor = loadMysqlClientCtor()
    if (MysqlCtor) {
      mysql = new MysqlCtor({ datasources: { db: { url: mUrl } } })
    } else if (!lUrl) {
      // استقرار وب روی هاست که طبق راهنما کلاینت پیش‌فرض را با اسکیمای mysql
      // ساخته است — همان پیش‌فرض جواب می‌دهد (دیتابیس محلی در کار نیست)
      console.error('[db] DATABASE_URL is mysql:// — using default client (web deploy)')
      mysql = new PrismaClient()
    } else {
      // دسکتاپ: کلاینت MySQL در بسته نیست (نصب خراب) — روی دیتابیس محلی کار
      // می‌کنیم؛ دادن mysql:// به کلاینت SQLite همهٔ کوئری‌ها را می‌شکند
      console.error('[db] prisma-mysql-client missing — running on local DB only (host disabled)')
      mysql = null
    }
  }

  // فعال اولیه: اگر هاست تنظیم شده → MySQL (خوش‌بینانه؛ manager سریع اصلاح می‌کند)
  const activeName: ActiveClientName = mysql ? 'mysql' : 'sqlite'
  const active = (activeName === 'mysql' ? mysql : sqlite) as PrismaClient
  const mode: DbMode = mysql ? 'host-mysql' : 'local'

  return { sqlite, mysql, activeName, active, mode, journalHook: null }
}

const core: DbCore = globalForDb.__mfgDbCore ?? buildCore()
if (process.env.NODE_ENV !== 'production') globalForDb.__mfgDbCore = core

/* ------------------------- ژورنال حذف در حالت آفلاین ------------------------- */

function wrapDelegateForJournal(table: string, delegate: object): object {
  return new Proxy(delegate, {
    get(target, prop) {
      const v = Reflect.get(target, prop, target)
      if ((prop === 'delete' || prop === 'deleteMany') && typeof v === 'function') {
        return (args?: { where?: unknown }) => {
          // ژورنال فقط بعد از موفقیت واقعی حذف ثبت می‌شود
          const result = (v as (...a: unknown[]) => unknown).apply(target, [args])
          Promise.resolve(result)
            .then(() => {
              try {
                core.journalHook?.(table, args?.where ?? {})
              } catch (e) {
                // ژورنال هرگز نباید عملیات اصلی را بشکند
                console.error('[db] delete journal failed:', e)
              }
            })
            .catch(() => {})
          return result
        }
      }
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v
    },
  })
}

/* ------------------------------ Proxy اصلی db ------------------------------ */

export const db = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    const active = core.active
    const raw: unknown = Reflect.get(active as unknown as object, prop, active)
    if (typeof raw === 'function') {
      return (raw as (...a: unknown[]) => unknown).bind(active)
    }
    if (
      raw &&
      typeof raw === 'object' &&
      core.mode === 'host-offline' &&
      core.journalHook &&
      MODEL_DELEGATES.has(String(prop))
    ) {
      return wrapDelegateForJournal(String(prop), raw as object)
    }
    return raw
  },
})

/* ------------------------------ API داخلی ------------------------------ */

export interface DbInternals {
  /** هر دو کلاینت (یکی ممکن است null باشد) */
  getClients(): { sqlite: PrismaClient | null; mysql: PrismaClient | null }
  /** کلاینت فعال فعلی */
  getActive(): { name: ActiveClientName; client: PrismaClient }
  /** تغییر کلاینت فعال (اگر کلاینت موجود باشد) */
  setActive(name: ActiveClientName): boolean
  /** حالت فعلی: local | host-mysql | host-offline */
  getMode(): DbMode
  setMode(mode: DbMode): void
  /** آیا اتصال هاست (mysql://) در تنظیمات وجود دارد؟ */
  mysqlConfigured(): boolean
  /** آیا دیتابیس محلی (SQLite) موجود است؟ */
  hasLocal(): boolean
  /** آدرس هاست (بدون رمز) برای نمایش */
  mysqlInfo(): { host: string; port: string; database: string } | null
  /** ثبت قلاب ژورنال حذف (sync-engine) */
  registerDeleteJournal(fn: (table: string, where: unknown) => void): void
}

export const dbInternal: DbInternals = {
  getClients: () => ({ sqlite: core.sqlite, mysql: core.mysql }),
  getActive: () => ({ name: core.activeName, client: core.active }),
  setActive(name) {
    const target = name === 'mysql' ? core.mysql : core.sqlite
    if (!target) return false
    core.activeName = name
    core.active = target
    return true
  },
  getMode: () => core.mode,
  setMode(mode) {
    core.mode = mode
  },
  mysqlConfigured: () => !!core.mysql,
  hasLocal: () => !!core.sqlite,
  mysqlInfo() {
    const url = process.env.DATABASE_URL || ''
    if (!url.startsWith('mysql:')) return null
    try {
      const u = new URL(url)
      return {
        host: u.hostname,
        port: u.port || '3306',
        database: u.pathname.replace(/^\//, ''),
      }
    } catch {
      return null
    }
  },
  registerDeleteJournal(fn) {
    core.journalHook = fn
  },
}
