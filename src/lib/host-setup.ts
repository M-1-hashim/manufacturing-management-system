import { dbInternal } from '@/lib/db'
import { MYSQL_TABLES, MYSQL_TABLE_NAMES } from '@/lib/mysql-ddl'
import type { ClientPair } from '@/lib/sync-engine'

/*
 * راه‌اندازی خودکار هاست — قلب ویزارد «نصب و راه‌اندازی اولیه»:
 *
 * ۱) ساخت جدول‌ها: اگر هاست تازه خریداری شده و دیتابیسش خالی است،
 *    هر ۱۹ جدول به‌صورت خودکار ساخته می‌شود (CREATE TABLE IF NOT EXISTS)
 *    — بدون phpMyAdmin و بدون خط فرمان.
 *
 * ۲) بوت‌استرپ: اگر جدول User روی هاست «خالی» باشد ولی دستگاه محلی
 *    کاربر داشته باشد، همان کاربران (از جمله ادمین) + تنظیمات شرکت به
 *    هاست کپی می‌شوند تا ورود به سیستم بلافاصله بعد از اتصال به هاست
 *    کار کند (admin/admin123 یا کاربران ساخته‌شدهٔ قبلی).
 *
 * این عملیات در شروع برنامه (بعد از اولین پینگ موفق هاست) و از طریق
 * API ادمین (/api/system/db-setup) قابل اجراست.
 */

export interface HostSetupReport {
  ok: boolean
  hostReachable: boolean
  tablesBefore: number
  tablesAfter: number
  createdTables: string[]
  failedTables: { name: string; error: string }[]
  bootstrapped: boolean
  copiedUsers: number
  copiedSettings: number
  error?: string
}

const EXPECTED = MYSQL_TABLES.length

/** تعداد جدول‌های موجود در دیتابیسِ فعلیِ اتصال داده‌شده */
async function countTables(client: ClientPair['server']): Promise<number> {
  const rows = await client.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE()`
  )
  return Number(rows[0]?.n ?? 0)
}

/** فهرست جدول‌های موجود — برای گزارش جدول‌های گمشده */
async function listTables(client: ClientPair['server']): Promise<string[]> {
  const rows = await client.$queryRawUnsafe<Array<{ TABLE_NAME: string }>>(
    `SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()`
  )
  return rows.map((r) => String(r.TABLE_NAME))
}

/**
 * ساخت جدول‌های گمشده روی هاست. اگر همه از قبل موجود باشند کاری نمی‌کند.
 * برمی‌گرداند: جدول‌های ساخته‌شده و خطاهای هر جدول (اگر پیش آمد).
 */
export async function createHostTables(
  client: ClientPair['server']
): Promise<{ created: string[]; failed: { name: string; error: string }[]; before: number; after: number }> {
  const before = await countTables(client)
  const existing = new Set((await listTables(client)).map((n) => n.toLowerCase()))
  const created: string[] = []
  const failed: { name: string; error: string }[] = []

  for (const t of MYSQL_TABLES) {
    if (existing.has(t.name.toLowerCase())) continue
    try {
      await client.$executeRawUnsafe(t.sql)
      created.push(t.name)
    } catch (e) {
      // اگر خطا «جدول از قبل هست» باشد، مهم نیست
      const msg = String((e as Error)?.message || e)
      if (!/already exists/i.test(msg)) failed.push({ name: t.name, error: msg.slice(0, 300) })
    }
  }

  const after = await countTables(client)
  return { created, failed, before, after }
}

/** تعداد کاربران و تنظیمات روی هاست */
async function hostCounts(client: ClientPair['server']): Promise<{ users: number; settings: number }> {
  const users = await client.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM \`User\``)
  const settings = await client.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM \`Setting\``)
  return { users: Number(users[0]?.n ?? 0), settings: Number(settings[0]?.n ?? 0) }
}

/**
 * راه‌اندازی کامل هاست: جدول‌ها + بوت‌استرپ کاربران/تنظیمات.
 * pair لازم است — کاربران از دیتابیس محلی خوانده می‌شوند.
 */
export async function ensureHostReady(pair: ClientPair): Promise<HostSetupReport> {
  const report: HostSetupReport = {
    ok: false,
    hostReachable: false,
    tablesBefore: 0,
    tablesAfter: 0,
    createdTables: [],
    failedTables: [],
    bootstrapped: false,
    copiedUsers: 0,
    copiedSettings: 0,
  }
  try {
    const ddl = await createHostTables(pair.server)
    report.hostReachable = true
    report.createdTables = ddl.created
    report.failedTables = ddl.failed
    report.tablesBefore = ddl.before
    report.tablesAfter = ddl.after

    if (ddl.failed.length > 0) {
      report.error = `ساخت ${ddl.failed.length} جدول ناموفق بود`
      return report
    }

    // بوت‌استرپ — فقط وقتی هاست واقعاً خالی است
    const counts = await hostCounts(pair.server)
    if (counts.users === 0) {
      const localUsers = await pair.local.user.findMany()
      if (localUsers.length > 0) {
        for (let i = 0; i < localUsers.length; i += 100) {
          const chunk = localUsers.slice(i, i + 100).map((u) => ({ ...u }))
          await pair.server.user.createMany({ data: chunk, skipDuplicates: true })
        }
        report.copiedUsers = localUsers.length
        report.bootstrapped = true
      }
    }
    if (counts.settings === 0) {
      const localSettings = await pair.local.setting.findMany()
      const rows = localSettings.filter((s) => !String(s.key).startsWith('sync.'))
      if (rows.length > 0) {
        for (let i = 0; i < rows.length; i += 100) {
          await pair.server.setting.createMany({ data: rows.slice(i, i + 100).map((s) => ({ ...s })), skipDuplicates: true })
        }
        report.copiedSettings = rows.length
        report.bootstrapped = true
      }
    }

    report.ok = true
    return report
  } catch (e) {
    report.error = String((e as Error)?.message || e).slice(0, 400)
    return report
  }
}

/**
 * گزارش وضعیت هاست برای کارت تنظیمات (بدون تغییر دادن چیزی).
 */
export interface HostSetupStatus {
  hostReachable: boolean
  configured: boolean
  tableCount: number
  expectedCount: number
  missingTables: string[]
  hostUsers: number
  hostSettings: number
  error?: string
}

export async function getHostSetupStatus(): Promise<HostSetupStatus> {
  const status: HostSetupStatus = {
    hostReachable: false,
    configured: false,
    tableCount: 0,
    expectedCount: EXPECTED,
    missingTables: [],
    hostUsers: 0,
    hostSettings: 0,
  }
  const { mysql } = dbInternal.getClients()
  if (!mysql || !dbInternal.mysqlConfigured()) {
    return { ...status, error: 'NO_HOST' }
  }
  status.configured = true
  try {
    const names = await listTables(mysql)
    const lower = new Set(names.map((n) => n.toLowerCase()))
    status.hostReachable = true
    status.tableCount = names.length
    status.missingTables = MYSQL_TABLE_NAMES.filter((n) => !lower.has(n.toLowerCase()))
    const c = await hostCounts(mysql)
    status.hostUsers = c.users
    status.hostSettings = c.settings
    return status
  } catch (e) {
    status.error = String((e as Error)?.message || e).slice(0, 400)
    return status
  }
}
