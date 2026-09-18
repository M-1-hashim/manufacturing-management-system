/*
 * ترمیم خودکار شکاف‌های اسکیما — پاسخ به «خطای داخلی هاست» (v1.0.26):
 *
 * ریشهٔ باگ: دیتابیس‌های محلیِ ساخته‌شده با نسخه‌های ≤۱.۰.۱۸ ستون tokenVersion
 * را ندارند (v1.0.19 اضافه‌اش کرد) و ensureLocalSchema هم هرگز ALTER نمی‌زد —
 * نتیجه: هر findUnique/create روی کاربر P2022 می‌داد و مسیر ورود همیشه با
 * خطای عمومی «خطای داخلی هاست» شکست می‌خورد. همین مشکل در استقرار وب روی
 * هاستِ تازه (بدون جدول) به‌شکل P2021 ظاهر می‌شد.
 *
 * این ماژول سه چیز می‌دهد:
 *  - isSchemaGapError  → تشخیص خطاهای «جدول/ستون غایب» (Prisma + متن خام)
 *  - repairSchemaGap   → ترمیم: SQLite → ensureLocalSchema / وب → ساخت جدول‌های هاست
 *  - internalDbErrorText → پیام کاربردی فارسی + کد خطا برای نمایش در فرم ورود
 */
import { dbInternal } from '@/lib/db'
import { ensureLocalSchema } from '@/lib/local-schema'
import { createHostTables, migrateHostSchema } from '@/lib/host-setup'

/** آیا این خطا یعنی «جدول یا ستون در دیتابیس موجود نیست»؟ */
export function isSchemaGapError(e: unknown): boolean {
  const err = e as { code?: string; message?: string }
  const code = String(err?.code || '')
  if (code === 'P2021' || code === 'P2022') return true
  const msg = String(err?.message || e)
  // Prisma P2022 متن انگلیسی «does not exist in the current database» می‌دهد؛
  // SQLite خام: no such table/column — MySQL: Table 'x' doesn't exist
  // («Unknown database» اسم دیتابیس غلط است — شکاف اسکیما نیست)
  if (/Unknown database/i.test(msg)) return false
  return /no such table|no such column|does not exist in the current database|doesn't exist|Unknown column/i.test(msg)
}

export interface RepairResult {
  attempted: boolean
  repaired: boolean
  detail: string
}

/**
 * ترمیم شکاف اسکیما روی کلاینت فعال:
 *  - دسکتاپ (SQLite محلی) → ensureLocalSchema (جدول‌های غایب + ALTER ستون‌های غایب)
 *  - استقرار وب روی هاست (بدون دیتابیس محلی) → ساخت ۱۹ جدول + مهاجرت ستون‌ها روی MySQL
 * تکرارپذیر و بی‌خطر — فقط چیزهای غایب ساخته/اضافه می‌شوند.
 */
export async function repairSchemaGap(): Promise<RepairResult> {
  const { sqlite, mysql } = dbInternal.getClients()
  try {
    if (sqlite) {
      await ensureLocalSchema()
      return { attempted: true, repaired: true, detail: 'local schema ensured' }
    }
    if (mysql) {
      const ddl = await createHostTables(mysql)
      const mig = await migrateHostSchema(mysql)
      const ok = ddl.failed.length === 0 && mig.failed.length === 0
      return {
        attempted: true,
        repaired: ok,
        detail: `host tables ensured (${ddl.after})` + (ok ? '' : ` failed=[${[...ddl.failed, ...mig.failed].map((f) => (typeof f === 'string' ? f : f.name)).join(',').slice(0, 120)}]`),
      }
    }
    return { attempted: false, repaired: false, detail: 'no database client available' }
  } catch (e) {
    return { attempted: true, repaired: false, detail: String((e as Error)?.message || e).slice(0, 200) }
  }
}

/** پیام ۵۰۰ کاربردی — به‌جای «خطای داخلی هاست» خالی، دلیل + راهنما می‌دهد */
export function internalDbErrorText(e: unknown): string {
  const err = e as { code?: string; message?: string }
  const code = String(err?.code || '')
  const base = 'خطای داخلی هاست'
  if (code === 'P2021' || code === 'P2022' || /does not exist in the current database|no such (table|column)/i.test(String(err?.message || '')))
    return (
      base +
      ' — ساختار دیتابیس قدیمی/ناقص است و ترمیم خودکار ناموفق بود. برنامه را ببندید و دوباره باز کنید (' +
      (code || 'SCHEMA') +
      ')'
    )
  if (/readonly|read-only/i.test(String(err?.message || '')))
    return base + ' — فایل دیتابیس فقط‌خواندنی است؛ برنامه را با دسترسی کامل اجرا کنید یا آنتی‌ویروس را بررسی کنید'
  return base + (code ? ` (${code})` : '')
}
