// کاپی احتیاطی JSON — مستقل از نوع دیتابیس (SQLite و MySQL هر دو کاپی احتیاطی می‌شوند)
// برای انتقال دیتا بین SQLite محلی و MySQL هاست اشتراکی استفاده می‌شود
import { db } from '@/lib/db'
import type { AuditActor } from '@/lib/audit'

type Delegate = {
  findMany: (args?: unknown) => Promise<Record<string, unknown>[]>
  createMany: (args: { data: Record<string, unknown>[] }) => Promise<{ count: number }>
  deleteMany: (args?: unknown) => Promise<{ count: number }>
}

/** ترتیب جداول: اولین‌ها والد هستند — درج به ترتیب، حذف به ترتیب معکوس */
const TABLES: { name: string; dates: string[] }[] = [
  { name: 'User', dates: ['createdAt', 'updatedAt'] },
  { name: 'ProductCategory', dates: ['createdAt'] },
  { name: 'Product', dates: ['createdAt', 'updatedAt'] },
  { name: 'Supplier', dates: ['createdAt'] },
  { name: 'RawMaterial', dates: ['expiryDate', 'createdAt', 'updatedAt'] },
  { name: 'Formula', dates: ['createdAt', 'updatedAt'] },
  { name: 'FormulaItem', dates: [] },
  { name: 'ProductionOrder', dates: ['startDate', 'endDate', 'createdAt', 'updatedAt'] },
  { name: 'Customer', dates: ['createdAt', 'updatedAt'] },
  { name: 'Sale', dates: ['date', 'createdAt', 'updatedAt'] },
  { name: 'SaleItem', dates: [] },
  { name: 'Warehouse', dates: ['createdAt'] },
  { name: 'InventoryTransaction', dates: ['date', 'createdAt'] },
  { name: 'Expense', dates: ['date', 'createdAt'] },
  { name: 'Employee', dates: ['hireDate', 'createdAt', 'updatedAt'] },
  { name: 'Attendance', dates: ['date', 'createdAt'] },
  { name: 'SalaryPayment', dates: ['date', 'createdAt'] },
  { name: 'AuditLog', dates: ['createdAt'] },
  { name: 'Setting', dates: [] },
]

const CHUNK = 500

function clientFor(name: string): Delegate {
  return db[name as keyof typeof db] as unknown as Delegate
}

/** نوع دیتابیس فعال بر اساس DATABASE_URL */
export function currentDbType(): 'sqlite' | 'mysql' {
  const url = process.env.DATABASE_URL || ''
  return url.startsWith('mysql') ? 'mysql' : 'sqlite'
}

export interface FullJsonBackup {
  app: string
  version: number
  dbType: 'sqlite' | 'mysql'
  createdAt: string
  tables: Record<string, Record<string, unknown>[]>
}

/** خروجی کامل همه جداول به‌صورت JSON — ترتیب جداول: والد اول */
export async function exportAllJson(): Promise<FullJsonBackup> {
  const tables: FullJsonBackup['tables'] = {}
  for (const t of TABLES) {
    tables[t.name] = await clientFor(t.name).findMany()
  }
  return {
    app: 'manufacturing-management-system',
    version: 1,
    dbType: currentDbType(),
    createdAt: new Date().toISOString(),
    tables,
  }
}

/** بررسی صحت ساختار فایل کاپی احتیاطی JSON */
export function validateJsonBackup(data: unknown): FullJsonBackup {
  if (!data || typeof data !== 'object') {
    throw new Error('فایل کاپی احتیاطی JSON نامعتبر است')
  }
  const d = data as Partial<FullJsonBackup>
  if (d.app !== 'manufacturing-management-system' || d.version !== 1 || !d.tables) {
    throw new Error('این فایل یک کاپی احتیاطی معتبر سامانه نیست')
  }
  for (const t of TABLES) {
    if (!Array.isArray(d.tables[t.name])) {
      throw new Error(`فایل کاپی احتیاطی ناقص است — جدول ${t.name} یافت نشد`)
    }
  }
  return d as FullJsonBackup
}

function parseRow(modelName: string, dateFields: string[], row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row }
  for (const f of dateFields) {
    const v = out[f]
    if (typeof v === 'string' || typeof v === 'number') {
      const dt = new Date(v)
      if (!Number.isNaN(dt.getTime())) out[f] = dt
    }
  }
  // فیلدهای محاسباتی Prisma (در صورت وجود) حذف شوند
  void modelName
  return out
}

export interface JsonRestoreResult {
  restoredTables: number
  restoredRows: number
}

/**
 * بازیابی کامل از کاپی احتیاطی JSON — در یک تراکنش اتمیک:
 * اگر هر مرحله‌ای خطا بدهد، همه‌چیز به حالت قبل برمی‌گردد
 * (کاپی احتیاطی قبل از فراخوانی این تابع باید گرفته شود)
 */
export async function restoreFromJson(data: unknown): Promise<JsonRestoreResult> {
  const backup = validateJsonBackup(data)
  const parsed = TABLES.map((t) => ({
    name: t.name,
    dates: t.dates,
    rows: (backup.tables[t.name] || []).map((r) => parseRow(t.name, t.dates, r)),
  }))
  const totalRows = parsed.reduce((s, t) => s + t.rows.length, 0)

  await db.$transaction(async (tx) => {
    const txc = (model: string) => tx[model as keyof typeof tx] as unknown as Delegate

    // ۱) حذف همه رکوردها — فرزندان اول (ترتیب معکوس)
    for (const t of [...parsed].reverse()) {
      await txc(t.name).deleteMany()
    }

    // ۲) درج رکوردها — والدین اول، دسته‌ای
    for (const t of parsed) {
      for (let i = 0; i < t.rows.length; i += CHUNK) {
        const chunk = t.rows.slice(i, i + CHUNK).map((r) => parseRow(t.name, t.dates, r))
        // بدون skipDuplicates — جدول خالی است و کلیدها از کاپی احتیاطی عیناً برمی‌گردند
        await txc(t.name).createMany({ data: chunk })
      }
    }

    // ۳) راستی‌آزمایی داخل تراکنش — تعداد رکوردها باید دقیقاً مطابق کاپی احتیاطی باشد
    for (const t of parsed) {
      const found = await txc(t.name).findMany()
      if (found.length !== t.rows.length) {
        throw new Error(`جدول ${t.name}: ${found.length} سطر به‌جای ${t.rows.length} بازیابی شد`)
      }
    }
  })

  return { restoredTables: parsed.length, restoredRows: totalRows }
}
