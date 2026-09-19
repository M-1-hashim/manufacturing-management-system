/*
 * ریست رمز ادمین از طریق فایل — مکانیزم «رمز را فراموش کرده‌ام»
 *
 * فلسفهٔ همان db-connection.txt: کاربر نهایی با Notepad راحت است، نه با ترمینال.
 * اگر فایل reset-admin-password.txt در یکی از مسیرهای شناخته‌شده باشد،
 * در اولین کوشش ورود، رمز کاربر admin به مقدار داخل فایل (یا admin123) برمی‌گردد.
 *
 * مسیرهای شناخته‌شده (به‌ترتیب):
 *   ۱) مسیرهای داده‌شده از Electron در ERP_ADMIN_RESET_FILES (با | جدا می‌شوند):
 *      • C:\Users\<کاربر>\ManufacturingERP\reset-admin-password.txt  (پیدا‌کردنی)
 *      • %APPDATA%\ManufacturingERP\reset-admin-password.txt         (استاندارد)
 *   ۲) کنار فایل دیتابیس SQLite (دسکتاپ — UserData\data)
 *   ۳) پوشهٔ اجرای سرور (استقرار وب — cPanel File Manager)
 *
 * قواعد امنیتی:
 *   • فایل بعد از ریست موفق به reset-admin-password.done.txt تغییر نام می‌یابد —
 *     فقط وقتی «همهٔ» دیتابیس‌های پیکربندی‌شده (SQLite + MySQL در صورت وجود) ریست
 *     شوند. اگر هاست در دسترس نباشد فایل می‌ماند و در اجرای بعدی دوباره تلاش
 *     می‌شود — وگرنه اسنپ‌شات هاست، رمز محلی را با هش قدیمی بازنویسی می‌کرد.
 *   • tokenVersion کاربر +1 می‌شود → همهٔ نشست‌های فعال ادمین بی‌اعتبار می‌شوند.
 *   • کل عملیات هرگز خطا پرتاب نمی‌کند — ورود باید حتی در شکست ریست ادامه یابد.
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { dbInternal } from '@/lib/db'
import { hashPassword, verifyPassword } from '@/lib/passwords'
import { logAudit } from '@/lib/audit'

export const ADMIN_RESET_FILENAME = 'reset-admin-password.txt'
export const ADMIN_RESET_DONE_SUFFIX = '.done.txt'
export const ADMIN_RESET_DEFAULT_PASSWORD = 'admin123'

/** حداقل/حداکثر طول رمز قابل‌قبول در فایل — بیرون از بازه → رمز پیش‌فرض */
const MIN_PWD_LEN = 4
const MAX_PWD_LEN = 128

/** استخراج رمز از محتوای فایل — خطوط # کامنت‌اند؛ password=X یا اولین خط ساده */
export function parseAdminResetContent(content: string): string {
  const lines = String(content ?? '').split(/\r?\n/)
  let firstPlain: string | null = null
  for (const raw of lines) {
    const l = raw.trim()
    if (!l || l.startsWith('#')) continue
    const eq = l.indexOf('=')
    if (eq > 0) {
      const key = l.slice(0, eq).trim().toLowerCase()
      const val = l.slice(eq + 1).trim()
      if (key === 'password') return sanitizePassword(val)
      if (key === 'username' || key === 'user') continue // رزرو — فقط ادمین ریست می‌شود
    }
    if (firstPlain === null) firstPlain = l
  }
  return sanitizePassword(firstPlain ?? '')
}

function sanitizePassword(pwd: string): string {
  const p = String(pwd ?? '').trim()
  if (p.length < MIN_PWD_LEN || p.length > MAX_PWD_LEN) return ADMIN_RESET_DEFAULT_PASSWORD
  return p
}

/** مسیرهای کاندید فایل ریست — env از Electron + کنار SQLite + cwd (استقرار وب) */
export function adminResetFileCandidates(): string[] {
  const out: string[] = []
  const envList = process.env.ERP_ADMIN_RESET_FILES || ''
  for (const p of envList.split('|')) {
    const t = p.trim()
    if (t) out.push(t)
  }
  // کنار فایل دیتابیس محلی (دسکتاپ — userData\data)
  const dbUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || ''
  if (dbUrl.startsWith('file:')) {
    const dbFile = dbUrl.slice('file:'.length)
    if (dbFile) out.push(path.join(path.dirname(dbFile), ADMIN_RESET_FILENAME))
  }
  // پوشهٔ اجرای سرور — استقرار وب (cPanel File Manager)
  try {
    out.push(path.join(process.cwd(), ADMIN_RESET_FILENAME))
  } catch {
    /* cwd در دسترس نیست — بی‌اهمیت */
  }
  return out.filter((p, i, arr) => arr.indexOf(p) === i)
}

interface ClientResetResult {
  name: 'sqlite' | 'mysql'
  ok: boolean
  error?: string
  skipped?: boolean // رمز از قبل همان است — بدون تغییر (بدون churn توکن)
}

/** ریست کاربر admin روی یک کلاینت Prisma مشخص */
async function resetAdminIn(
  client: unknown,
  name: 'sqlite' | 'mysql',
  password: string
): Promise<ClientResetResult> {
  const c = client as {
    user: {
      findUnique: (a: unknown) => Promise<{ id: string; password: string; active: boolean; tokenVersion?: number } | null>
      update: (a: unknown) => Promise<unknown>
      create: (a: unknown) => Promise<unknown>
    } | null
  }
  if (!c?.user) return { name, ok: false, error: 'user model unavailable' }
  try {
    const existing = await c.user.findUnique({ where: { username: 'admin' } })
    if (existing && existing.active && verifyPassword(password, existing.password)) {
      // رمز از قبل درست است — بدون تغییر (جلوگیری از رشد بی‌مورد tokenVersion)
      return { name, ok: true, skipped: true }
    }
    const hashed = hashPassword(password)
    if (existing) {
      // tokenVersion +1 → نشست‌های قدیمی ادمین همه‌جا می‌میرند؛ اگر ستون در
      // اسکیمای خیلی قدیمی نبود، بدون آن هم رمز عوض می‌شود
      try {
        await c.user.update({
          where: { id: existing.id },
          data: { password: hashed, active: true, tokenVersion: (Number(existing.tokenVersion) || 0) + 1 },
        })
      } catch {
        await c.user.update({ where: { id: existing.id }, data: { password: hashed, active: true } })
      }
    } else {
      await c.user.create({
        data: {
          username: 'admin',
          password: hashed,
          fullName: 'مدیر سیستم',
          role: 'admin',
          department: 'general',
        },
      })
    }
    return { name, ok: true }
  } catch (e) {
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export interface AdminResetOutcome {
  /** آیا حداقل یک فایل ریست پیدا و پردازش شد؟ */
  attempted: boolean
  /** ریست روی همهٔ کلاینت‌های پیکربندی‌شده موفق بود؟ (فقط سپس فایل مصرف می‌شود) */
  complete: boolean
  files: { path: string; consumed: boolean; password?: string }[]
  clients: ClientResetResult[]
}

/**
 * مصرف فایل(های) ریست — در شروع POST /api/auth/login صدا زده می‌شود.
 * هرگز خطا پرتاب نمی‌کند. فایل فقط وقتی مصرف می‌شود که «هر دو» کلاینت
 * پیکربندی‌شده (sqlite + mysql در صورت وجود) با موفقیت ریست شده باشند.
 */
export async function consumeAdminPasswordReset(): Promise<AdminResetOutcome> {
  const outcome: AdminResetOutcome = { attempted: false, complete: false, files: [], clients: [] }

  const candidates = adminResetFileCandidates().filter((p) => existsSync(p))
  if (candidates.length === 0) return outcome
  outcome.attempted = true

  // اولین فایل موجود مبنای رمز است (بقیه همان کار را می‌کردند)
  let password: string | null = null
  try {
    password = parseAdminResetContent(readFileSync(candidates[0], 'utf8'))
  } catch (e) {
    password = ADMIN_RESET_DEFAULT_PASSWORD
    console.error('[admin-reset] read failed — using default password:', e)
  }
  outcome.files.push({ path: candidates[0], consumed: false, password })

  const { sqlite, mysql } = dbInternal.getClients()
  const targets: { client: unknown; name: 'sqlite' | 'mysql' }[] = []
  if (sqlite) targets.push({ client: sqlite, name: 'sqlite' })
  if (mysql) targets.push({ client: mysql, name: 'mysql' })
  // استقرار وب: DATABASE_URL=mysql بدون کلاینت mysql ساخته‌شده → کلاینت فعال همان mysql است
  if (targets.length === 0) {
    const active = dbInternal.getActive()
    targets.push({ client: active.client, name: active.name })
  }

  let allOk = true
  for (const t of targets) {
    const r = await resetAdminIn(t.client, t.name, password as string)
    outcome.clients.push(r)
    if (!r.ok) allOk = false
  }

  // کلاینت mysql انتظار می‌رفت ولی ساخته نشده (نصب دسکتاپ بدون mysql-client) —
  // مصرف فایل در این حالت باعث می‌شد رمز هاست قدیمی بماند → ناقص حساب می‌شود
  const hostExpected = (process.env.DATABASE_URL || '').startsWith('mysql:')
  if (hostExpected && !mysql) allOk = false

  if (allOk) {
    for (const p of candidates) {
      try {
        renameSync(p, p + ADMIN_RESET_DONE_SUFFIX)
        outcome.files.push({ path: p + ADMIN_RESET_DONE_SUFFIX, consumed: true })
      } catch (e) {
        // تغییر نام شکست خورد → محتوا را خنثی می‌کنیم تا ریست دوباره اجرا نشود
        try {
          writeFileSync(
            p,
            `# این فایل مصرف شده است — ${(new Date()).toISOString()}\n# اگر ریست دوباره می‌خواهید این فایل را حذف و فایل تازه بسازید.\n`,
            'utf8'
          )
        } catch {
          /* حتی این هم نشد — ریست تکراری idempotent است (skipped) */
        }
        console.error('[admin-reset] rename failed:', e)
      }
    }
    outcome.files[0].consumed = true
    await logAudit(
      null,
      'bootstrap',
      'auth',
      undefined,
      `ریست رمز ادمین از فایل ${candidates[0]} انجام شد — کاربران هدف: ${outcome.clients
        .map((c) => `${c.name}:${c.ok ? (c.skipped ? 'same' : 'ok') : 'fail'}`)
        .join(' ')}`
    )
    console.log(`[admin-reset] admin password reset applied (clients: ${outcome.clients.map((c) => c.name).join('+')})`)
  } else {
    console.warn(
      `[admin-reset] partial reset — file kept for retry: ${outcome.clients
        .map((c) => `${c.name}=${c.ok ? 'ok' : 'fail'}`)
        .join(' ')}`
    )
  }

  outcome.complete = allOk
  return outcome
}

/**
 * آیا الان فایل ریست روی دیسک هست؟ (برای نمایش وضعیت در UI — فقط تعداد/مسیر)
 * در رندرر مستقیم در دسترس نیست؛ از طریق IPC الکترون یا پاسخ وضعیت‌سنج استفاده می‌شود.
 */
export function adminResetFileStatus(): { exists: boolean; paths: string[] } {
  const all = adminResetFileCandidates()
  const existing = all.filter((p) => existsSync(p))
  return { exists: existing.length > 0, paths: existing }
}
