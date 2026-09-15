import { dbInternal } from '@/lib/db'
import { MYSQL_TABLES, MYSQL_TABLE_NAMES } from '@/lib/mysql-ddl'
import type { ClientPair } from '@/lib/sync-engine'

/*
 * راه‌اندازی خودکار هاست — قلب ویزارد «نصب و راه‌اندازی اولیه»:
 *
 * 1) ساخت جدول‌ها: اگر هاست تازه خریداری شده و دیتابیسش خالی است،
 *    همهٔ جدول‌ها به‌صورت خودکار ساخته می‌شوند (CREATE TABLE IF NOT EXISTS)
 *    — بدون phpMyAdmin و بدون خط فرمان.
 *
 * 2) مهاجرت اسکیما: هاست‌هایی که با نسخه‌های قبلی جدول‌هایشان را ساخته‌اند،
 *    ستون‌های جدید (updatedAt برای همهٔ جدول‌ها — لازمهٔ همگام‌سازی لحظه‌ای)
 *    و ایندکس‌ها و جدول سنگ‌قبر (_SyncTombstones) را خودکار می‌گیرند
 *    (ALTER TABLE ADD COLUMN — بی‌خطر و تکرارپذیر).
 *
 * 3) بوت‌استرپ: اگر جدول User روی هاست «خالی» باشد ولی دستگاه محلی
 *    کاربر داشته باشد، همان کاربران سیستم (از جمله ادمین) + تنظیمات شرکت به
 *    هاست کپی می‌شوند تا ورود به سیستم بلافاصله بعد از اتصال به هاست
 *    کار کند.
 *
 * این اجراؤات در شروع برنامه (بعد از اولین پینگ موفق هاست) و از طریق
 * API ادمین (/api/system/db-setup) قابل اجراست.
 */

export interface HostSetupReport {
  ok: boolean
  hostReachable: boolean
  tablesBefore: number
  tablesAfter: number
  createdTables: string[]
  failedTables: { name: string; error: string }[]
  migratedColumns: string[]
  bootstrapped: boolean
  copiedUsers: number
  copiedSettings: number
  error?: string
}

const EXPECTED = MYSQL_TABLES.filter((t) => !t.name.startsWith('_')).length

/** ستون‌هایی که همگام‌سازی لحظه‌ای به آن‌ها نیاز دارد — جدول → ستون‌ها */
const SYNC_COLUMNS: { table: string; columns: { name: string; sql: string }[] }[] = [
  { table: 'AuditLog', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'ProductCategory', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Product', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Supplier', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'RawMaterial', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Formula', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  {
    table: 'FormulaItem',
    columns: [
      { name: 'createdAt', sql: 'ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
      { name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
    ],
  },
  { table: 'ProductionOrder', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Customer', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Sale', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  {
    table: 'SaleItem',
    columns: [
      { name: 'createdAt', sql: 'ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
      { name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
    ],
  },
  { table: 'Warehouse', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'InventoryTransaction', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Expense', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Employee', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'Attendance', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  { table: 'SalaryPayment', columns: [{ name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' }] },
  {
    table: 'Setting',
    columns: [
      { name: 'createdAt', sql: 'ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
      { name: 'updatedAt', sql: 'ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
    ],
  },
]

/** ایندکس‌های updatedAt برای جست‌وجوی سریع دلتاها */
const SYNC_INDEXES: { table: string; name: string }[] = [
  'User', 'AuditLog', 'ProductCategory', 'Product', 'Supplier', 'RawMaterial',
  'Formula', 'FormulaItem', 'ProductionOrder', 'Customer', 'Sale', 'SaleItem',
  'Warehouse', 'InventoryTransaction', 'Expense', 'Employee', 'Attendance',
  'SalaryPayment', 'Setting',
].map((t) => ({ table: t, name: `${t}_updatedAt_idx` }))

const TOMBSTONE_DDL =
  `CREATE TABLE IF NOT EXISTS \`_SyncTombstones\` (\n` +
  `  \`id\` VARCHAR(191) NOT NULL,\n` +
  `  \`tbl\` VARCHAR(191) NOT NULL,\n` +
  `  \`recordId\` VARCHAR(191) NOT NULL,\n` +
  `  \`deletedAt\` DATETIME(3) NOT NULL,\n` +
  `  INDEX \`_SyncTombstones_deletedAt_idx\`(\`deletedAt\`),\n` +
  `  INDEX \`_SyncTombstones_tbl_recordId_idx\`(\`tbl\`, \`recordId\`),\n` +
  `  PRIMARY KEY (\`id\`)\n` +
  `) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`

/** تعداد جدول‌های سیستم در دیتابیسِ فعلیِ اتصال داده‌شده (جدول‌های داخلی _Sync مستثنا) */
async function countTables(client: ClientPair['server']): Promise<number> {
  const rows = await client.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name NOT LIKE '\\_%'`
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

/** ستون‌های موجود یک جدول */
async function tableColumns(client: ClientPair['server'], table: string): Promise<Set<string>> {
  const rows = await client.$queryRawUnsafe<Array<{ COLUMN_NAME: string }>>(
    `SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?`,
    table
  )
  return new Set(rows.map((r) => String(r.COLUMN_NAME)))
}

async function indexExists(client: ClientPair['server'], indexName: string): Promise<boolean> {
  const rows = await client.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_name = ?`,
    indexName
  )
  return Number(rows[0]?.n ?? 0) > 0
}

/**
 * ساخت جدول‌های گمشده روی هاست. اگر همه از قبل موجود باشند کاری نمی‌کند.
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
      const msg = String((e as Error)?.message || e)
      if (!/already exists/i.test(msg)) failed.push({ name: t.name, error: msg.slice(0, 300) })
    }
  }

  const after = await countTables(client)
  return { created, failed, before, after }
}

/**
 * مهاجرت اسکیمای هاست‌های قدیمی: ستون‌های updatedAt گمشده + ایندکس‌ها +
 * جدول سنگ‌قبر. تکرارپذیر — هر بار فقط گمشده‌ها اضافه می‌شوند.
 */
export async function migrateHostSchema(
  client: ClientPair['server']
): Promise<{ migratedColumns: string[]; failed: string[] }> {
  const migratedColumns: string[] = []
  const failed: string[] = []
  try {
    await client.$executeRawUnsafe(TOMBSTONE_DDL)
  } catch (e) {
    failed.push(`_SyncTombstones: ${String((e as Error)?.message || e).slice(0, 120)}`)
  }

  for (const t of SYNC_COLUMNS) {
    try {
      const cols = await tableColumns(client, t.table)
      for (const c of t.columns) {
        if (cols.has(c.name)) continue
        try {
          await client.$executeRawUnsafe(`ALTER TABLE \`${t.table}\` ${c.sql}`)
          migratedColumns.push(`${t.table}.${c.name}`)
        } catch (e) {
          const msg = String((e as Error)?.message || e)
          if (!/duplicate column|already exists/i.test(msg)) {
            failed.push(`${t.table}.${c.name}: ${msg.slice(0, 120)}`)
            console.error(`[host-setup] ALTER ${t.table} ADD ${c.name} failed:`, msg.slice(0, 200))
          }
        }
      }
    } catch (e) {
      // جدول روی هاست نیست — createHostTables می‌سازد
      console.warn(`[host-setup] columns of ${t.table} unreadable:`, String((e as Error)?.message || e).slice(0, 120))
    }
  }

  for (const idx of SYNC_INDEXES) {
    try {
      if (await indexExists(client, idx.name)) continue
      await client.$executeRawUnsafe(
        `ALTER TABLE \`${idx.table}\` ADD INDEX \`${idx.name}\`(\`updatedAt\`)`
      )
    } catch {
      /* ایندکس تکراری یا جدول نبود — مهم نیست */
    }
  }

  return { migratedColumns, failed }
}

/** تعداد کاربران سیستم و تنظیمات روی هاست */
async function hostCounts(client: ClientPair['server']): Promise<{ users: number; settings: number }> {
  const users = await client.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM \`User\``)
  const settings = await client.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM \`Setting\``)
  return { users: Number(users[0]?.n ?? 0), settings: Number(settings[0]?.n ?? 0) }
}

/**
 * راه‌اندازی کامل هاست: جدول‌ها + مهاجرت ستون‌ها + بوت‌استرپ کاربران سیستم/تنظیمات.
 */
export async function ensureHostReady(pair: ClientPair): Promise<HostSetupReport> {
  const report: HostSetupReport = {
    ok: false,
    hostReachable: false,
    tablesBefore: 0,
    tablesAfter: 0,
    createdTables: [],
    failedTables: [],
    migratedColumns: [],
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

    // مهاجرت اسکیما — ستون‌های همگام‌سازی روی هاست‌های قدیمی
    const mig = await migrateHostSchema(pair.server)
    report.migratedColumns = mig.migratedColumns

    // بوت‌استرپ — فقط وقتی هاست واقعاً خالی است
    const counts = await hostCounts(pair.server)
    if (counts.users === 0) {
      const localUsers = await pair.local.user.findMany()
      if (localUsers.length > 0) {
        for (let i = 0; i < localUsers.length; i += 100) {
          const chunk = localUsers.slice(i, i + 100).map((u) => ({ ...u }))
          await pair.server.user.createMany({ data: chunk, skipDuplicates: true as never })
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
          await pair.server.setting.createMany({ data: rows.slice(i, i + 100).map((s) => ({ ...s })), skipDuplicates: true as never })
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
    status.tableCount = names.filter((n) => !n.startsWith('_')).length
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
