import { NextResponse } from 'next/server'
import { db, dbInternal } from '@/lib/db'
import { getState } from '@/lib/connection-manager'
import { APP_VERSION } from '@/lib/app-version'

/*
 * وضعیت اتصال دیتابیس — برای کارت «اتصال برنامه به هاست» در تنظیمات.
 * به استفاده‌کننده نشان می‌دهد برنامه واقعاً به کدام دیتابیس وصل است، نسخهٔ هاست،
 * و اینکه ۱۹ جدول سیستم کامل ساخته شده است یا نه.
 *
 * حالت‌ها:
 *   host-mysql   → کوئری روی هاست؛ وضعیت واقعی اتصال MySQL
 *   host-offline → هاست در دسترس نیست؛ برنامه روی کپی محلی (SQLite) کار
 *                  می‌کند — آخرین خطای هاست + زمان اسنپ‌شات محلی گزارش می‌شود
 *   local-sqlite → حالت محلی بدون هاست
 * در حالت خطا، کد Prisma/MySQL به تشخیص سادهٔ فارسی ترجمه می‌شود تا استفاده‌کننده
 * بدون دانش فنی بفهمد مشکل کجاست (پورت بسته؟ پاسورد غلط؟ جدول‌های ناقص؟).
 */

export const dynamic = 'force-dynamic'

const EXPECTED_TABLES = [
  'User', 'AuditLog', 'ProductCategory', 'Product', 'Supplier', 'RawMaterial',
  'Formula', 'FormulaItem', 'ProductionOrder', 'Customer', 'Sale', 'SaleItem',
  'Warehouse', 'InventoryTransaction', 'Expense', 'Employee', 'Attendance',
  'SalaryPayment', 'Setting',
]

function parseUrl(url: string) {
  try {
    const u = new URL(url)
    return { host: u.hostname, port: u.port || '3306', database: u.pathname.replace(/^\//, '') }
  } catch {
    return { host: '', port: '', database: '' }
  }
}

type ErrorKind =
  | 'UNREACHABLE' // پورت/فایروال/Remote MySQL
  | 'AUTH' // پاسورد یا استفاده‌کننده غلط
  | 'NO_DATABASE' // نام دیتابیس غلط
  | 'NO_TABLES' // جدول‌ها ساخته نشده
  | 'BAD_URL' // آدرس خراب
  | 'UNKNOWN'

function classifyError(e: unknown): { code: string; kind: ErrorKind } {
  const err = e as { code?: string; message?: string }
  const code = String(err?.code || '')
  const msg = String(err?.message || '')

  if (code === 'P1001' || /Can't reach|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|EHOSTUNREACH|PING_TIMEOUT/i.test(msg))
    return { code: code || 'P1001', kind: 'UNREACHABLE' }
  if (code === 'P1017' || /server refused|not allowed to connect|ER_HOST_NOT_PRIVILEGED|Host .* is not allowed/i.test(msg))
    return { code: code || 'P1017', kind: 'UNREACHABLE' }
  if (/Access denied/i.test(msg) || code === 'P2025')
    return { code: code || 'ACCESS_DENIED', kind: 'AUTH' }
  if (/Unknown database/i.test(msg) || /does not exist.*database|database.*does not exist/i.test(msg))
    return { code: code || 'UNKNOWN_DB', kind: 'NO_DATABASE' }
  if (code === 'P2021' || /does not exist in the (current )?database|TABLE_NAME|doesn't exist/i.test(msg))
    return { code: code || 'P2021', kind: 'NO_TABLES' }
  if (/must use|protocol|invalid.*url|malformed/i.test(msg))
    return { code: code || 'BAD_URL', kind: 'BAD_URL' }
  return { code: code || 'UNKNOWN', kind: 'UNKNOWN' }
}

export async function GET() {
  const url = process.env.DATABASE_URL || ''
  const isMysql = url.startsWith('mysql:')
  const { host, port, database } = parseUrl(url)
  const mgr = getState()
  const mode = mgr.mode // local | host-mysql | host-offline

  // در معماری محلی‌محور، برنامه همیشه روی SQLite کار می‌کند؛ این گزارش
  // وضعیت دیتابیسِ «فعالِ برنامه» (محلی) را نشان می‌دهد. جدول‌های محلی
  // همیشه کامل ساخته شده‌اند (db push دسکتاپ).
  const effectiveIsMysql = isMysql && !dbInternal.hasLocal()

  try {
    let version = ''
    let tables: string[] = []

    if (effectiveIsMysql) {
      const verRows: Array<{ v: string }> = await db.$queryRawUnsafe(
        'SELECT VERSION() AS v'
      )
      version = verRows[0]?.v ?? ''
      const rows: Array<{ TABLE_NAME: string }> = await db.$queryRawUnsafe(
        "SELECT TABLE_NAME AS TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
      )
      tables = rows.map((r) => String(r.TABLE_NAME))
    } else {
      const rows: Array<{ name: string }> = await db.$queryRawUnsafe(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_Sync%' ORDER BY name"
      )
      tables = rows.map((r) => String(r.name))
      version = effectiveIsMysql ? '' : 'SQLite (local)'
    }

    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t))

    return NextResponse.json({
      ok: true,
      appVersion: APP_VERSION,
      // mode = وضعیت اتصال به هاست (نه محل ذخیره — داده همیشه محلی است)
      mode: mode === 'host-offline' ? 'host-offline' : isMysql ? 'host-mysql' : 'local-sqlite',
      configuredForHost: isMysql,
      host,
      port,
      database,
      version: effectiveIsMysql ? version : 'SQLite (local copy)',
      tableCount: tables.length,
      expectedCount: EXPECTED_TABLES.length,
      missingTables: missing,
      schemaComplete: missing.length === 0,
      // معلومات حالت آفلاین
      lastHostError: mgr.lastError,
      lastHostErrorKind: mgr.lastErrorKind,
      lastHostErrorCode: mgr.lastErrorCode,
      lastHostOkAt: mgr.lastOkAt,
      lastCheckAt: mgr.lastCheckAt,
      offlineSince: mgr.offlineSince,
      lastSnapshotAt: mgr.lastSnapshotAt,
      lastSyncAt: mgr.lastSyncAt,
      syncing: mgr.syncing,
    })
  } catch (e) {
    // اگر کوئری وضعیت روی خود هاست (حالت mysql) خطا داد → احتمالاً همین حالا قطع شده
    const { code, kind } = classifyError(e)
    const msg = e instanceof Error ? e.message.split('\n').filter(Boolean).slice(-1)[0] || e.message.split('\n')[0] : String(e).split('\n')[0]
    return NextResponse.json(
      {
        ok: false,
        appVersion: APP_VERSION,
        mode: mode === 'host-offline' ? 'host-offline' : isMysql ? 'host-mysql' : 'local-sqlite',
        configuredForHost: isMysql,
        host,
        port,
        database,
        errorCode: code,
        errorKind: kind,
        error: msg.slice(0, 220),
        lastHostError: mgr.lastError,
        offlineSince: mgr.offlineSince,
        lastSnapshotAt: mgr.lastSnapshotAt,
      },
      { status: 200 }
    )
  }
}
