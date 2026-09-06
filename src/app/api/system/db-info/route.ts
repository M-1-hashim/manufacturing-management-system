import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

/*
 * وضعیت اتصال دیتابیس — برای کارت «اتصال برنامه به هاست» در تنظیمات.
 * به کاربر نشان می‌دهد برنامه واقعاً به کدام دیتابیس وصل است، نسخهٔ سرور،
 * و اینکه ۱۹ جدول سیستم کامل ساخته شده است یا نه.
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

export async function GET() {
  const url = process.env.DATABASE_URL || ''
  const isMysql = url.startsWith('mysql:')
  const { host, port, database } = parseUrl(url)

  try {
    let version = ''
    let tables: string[] = []

    if (isMysql) {
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
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      tables = rows.map((r) => String(r.name))
      version = 'SQLite (local)'
    }

    const missing = EXPECTED_TABLES.filter((t) => !tables.includes(t))

    return NextResponse.json({
      ok: true,
      mode: isMysql ? 'host-mysql' : 'local-sqlite',
      host,
      port,
      database,
      version,
      tableCount: tables.length,
      expectedCount: EXPECTED_TABLES.length,
      missingTables: missing,
      schemaComplete: missing.length === 0,
    })
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        mode: isMysql ? 'host-mysql' : 'local-sqlite',
        host,
        port,
        database,
        error: e instanceof Error ? e.message.split('\n')[0] : String(e).split('\n')[0],
      },
      { status: 200 }
    )
  }
}
