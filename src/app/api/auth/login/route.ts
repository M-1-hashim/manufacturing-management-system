import { NextResponse } from 'next/server'
import { db, dbInternal } from '@/lib/db'
import { verifyPassword, hashPassword, isHashed } from '@/lib/passwords'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import { logAudit } from '@/lib/audit'
import { ensureInitialPull } from '@/lib/connection-manager'
import { ensureLocalSchema } from '@/lib/local-schema'
import { isSchemaGapError, repairSchemaGap, internalDbErrorText } from '@/lib/db-repair'
import { consumeAdminPasswordReset } from '@/lib/admin-reset'

// قفل شدن حساب بعد از 5 بار داخل شدن ناکام به مدت 15 دقیقه (حافظه محلی هاست)
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
// سقف حافظهٔ نقشهٔ کوشش‌های ناموفق — جلوگیری از رشد بی‌حد حافظه
const FAIL_MAP_MAX = 1000
const failMap = new Map<string, { count: number; lockedUntil: number }>()
// تایم‌اوت پینگ هاست در مسیر fallback ورود — کاربر نباید برای پیام خطا صبر کند
const HOST_FALLBACK_TIMEOUT_MS = 6000

function isLocked(entry: { count: number; lockedUntil: number } | undefined): number {
  if (!entry) return 0
  if (entry.lockedUntil > Date.now()) return Math.ceil((entry.lockedUntil - Date.now()) / 60000)
  return 0
}

/** IP کلاینت — اولین مقدار x-forwarded-for وگرنه «local» */
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const first = fwd.split(',')[0]?.trim()
  return first || 'local'
}

/** کلید قفل = نام کاربری + IP — قفل فقط بر اساس نام کاربری باعث DoS قفل
 * حساب می‌شد (هر کسی با نام دلخواه حتی admin می‌توانست حساب را قفل کند) */
function failKey(username: string, req: Request): string {
  return `${username}::${clientIp(req)}`
}

/** سقف نقشهٔ قفل: وقتی از حد گذشت، قدیمی‌ترین کلیدها حذف می‌شوند
 * (Map ترتیب درج را نگه می‌دارد — قدیمی‌ها اول جدول‌اند) */
function pruneFailMap(): void {
  while (failMap.size > FAIL_MAP_MAX) {
    const oldest = failMap.keys().next().value
    if (oldest === undefined) break
    failMap.delete(oldest)
  }
}

type HostUserRow = {
  id: string
  username: string
  password: string
  fullName: string
  role: string
  department: string
  active: boolean
}

/**
 * تأیید کاربر مستقیم از هاست — برگشت امن ورود (fallback):
 * وقتی آینهٔ محلی هنوز کاربر را ندارد یا رمزش قدیمی است (مثلاً رمز در دستگاه
 * دیگری عوض شده یا اسنپ‌شات پذیرش هاست هنوز تمام نشده)، اعتبارنامه مستقیم روی
 * دیتابیس MySQL هاست چک می‌شود؛ در موفقیت، کاربر روی آینهٔ محلی تازه می‌شود.
 * هر خطای هاست (قطعی/کندی) → null — ورود هرگز به‌خاطر این fallback کند یا شکسته نمی‌شود.
 */
async function verifyUserOnHost(username: string, password: string): Promise<HostUserRow | null> {
  const { mysql } = dbInternal.getClients()
  if (!mysql) return null
  try {
    const ping = mysql.$queryRawUnsafe('SELECT 1')
    ping.catch(() => {}) // جلوگیری از unhandledRejection پس از تایم‌اوت مسابقه
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HOST_FALLBACK_TIMEOUT')), HOST_FALLBACK_TIMEOUT_MS)
      ping.then(() => { clearTimeout(timer); resolve() }, (e) => { clearTimeout(timer); reject(e) })
    })
    const user = (await (mysql as unknown as {
      user: { findUnique: (a: { where: { username: string } }) => Promise<HostUserRow | null> }
    }).user.findUnique({ where: { username } }))
    if (!user || !user.active) return null
    if (!verifyPassword(password, user.password)) return null
    return user
  } catch (e) {
    console.warn('[auth] host fallback verify skipped:', (e as Error)?.message || e)
    return null
  }
}

/**
 * تازه‌کردن آینهٔ محلی یک کاربر از ردیف هاست — بعد از fallback موفق:
 *   • کاربر با همان username روی محلی هست → فیلدهایش با هاست به‌روز می‌شود
 *   • نیست → با همان id هاست ساخته می‌شود تا سینک بعدی همان سطر را ببیند
 */
async function mirrorHostUser(hostUser: HostUserRow): Promise<void> {
  if (!dbInternal.hasLocal()) return // استقرار وب — کاربر مستقیم روی هاست است
  try {
    const existing = await db.user.findUnique({ where: { username: hostUser.username } })
    if (existing) {
      await db.user.update({
        where: { id: existing.id },
        data: {
          password: hostUser.password,
          fullName: hostUser.fullName,
          role: hostUser.role,
          department: hostUser.department,
          active: hostUser.active,
        },
      })
    } else {
      const { tokenVersion: _tv, ...rest } = hostUser as HostUserRow & { tokenVersion?: number }
      void _tv
      await db.user.create({ data: { ...rest } })
    }
  } catch (e) {
    console.error('[auth] mirror host user failed:', e)
  }
}

// POST /api/auth/login — تصدیق هویت با نقش و بخش سازمانی + نشست کوکی امن
// (خطاها پرتاب می‌شوند — POST پایین ترمیم اسکیما + تلاش دوباره را مدیریت می‌کند)
// توجه: body بیرون خوانده و پاس داده می‌شود — در retry نمی‌توان req.json() را دوباره خواند
// (Body is unusable: Body has already been read) — باگ ۵۰۰ در لاگینِ پس از ترمیم اسکیما
async function handleLogin(
  body: { username?: unknown; password?: unknown },
  req: Request
): Promise<NextResponse> {
  const { username, password } = body
  if (!username || !password) {
    return NextResponse.json({ error: 'نام کاربری و پسورد الزامی است' }, { status: 400 })
  }

  // ─── گِیت سرور: تا هاست تنظیم نشده، هیچ ورودی — حتی محلی ───
  // سیاست نسخهٔ دسکتاپ (۱.۰.۲۸+): ورود فقط با کاربران هاست؛ دیتابیس محلی فقط
  // «آینهٔ آفلاین» همان دیتاست. وقتی سرور بدون mysql:// بالا آمده یعنی هاست
  // هنوز تنظیم نشده — صفحهٔ ورود اصلاً نباید کار کند (و رندرر هم ویزارد نشان می‌دهد).
  if (!dbInternal.mysqlConfigured()) {
    return NextResponse.json(
      {
        error:
          'اتصال به هاست تنظیم نشده است — ورود فقط بعد از تنظیم هاست ممکن است. در صفحهٔ راه‌اندازی، مشخصات هاست را وارد یا فایل تنظیمات را آپلود کنید.',
        code: 'HOST_NOT_CONFIGURED',
      },
      { status: 451 }
    )
  }

  const uname = String(username).trim()
  const lockKey = failKey(uname, req)
  const lockMin = isLocked(failMap.get(lockKey))
  if (lockMin > 0) {
    return NextResponse.json(
      { error: `حساب شما موقتاً قفل شده است؛ ${lockMin} دقیقه دیگر کوشش کنید` },
      { status: 423 }
    )
  }

  // کاربران از هاست می‌آیند — اگر آینهٔ محلی خالی است (نصب تازه)، اول از هاست
  // کشیده می‌شود تا ورود با کاربران سیستم واقعی هاست انجام شود، نه حساب ساختگی.
  // فقط استقرار وب روی هاستِ واقعاً خالی (بدون دستگاه محلی) ادمین اول را می‌سازد.
  let userCount = await db.user.count()
  if (userCount === 0) {
    await ensureInitialPull().catch(() => {})
    userCount = await db.user.count()
  }
  if (userCount === 0) {
    if (!dbInternal.hasLocal()) {
      // استقرار وب (Vercel/سرور) روی هاست خالی — اولین ادمین
      await db.user.create({
        data: {
          username: 'admin',
          password: hashPassword('admin123'),
          fullName: 'مدیر سیستم',
          role: 'admin',
          department: 'general',
        },
      })
      await logAudit(null, 'bootstrap', 'auth', undefined, 'حساب ادمین پیش‌فرض روی هاست خالی ساخته شد — admin/admin123')
    } else {
      // دسکتاپ: هاست تنظیم شده ولی کاربرانش هنوز به محلی نرسیده — بدون حساب ساختگی
      return NextResponse.json(
        {
          error:
            'کاربران هاست هنوز دریافت نشده‌اند — اتصال هاست را در تنظیمات چک کنید یا چند لحظه بعد دوباره کوشش کنید (همگام‌سازی اول در پس‌زمینه انجام می‌شود).',
          code: 'USERS_NOT_SYNCED',
        },
        { status: 503 }
      )
    }
  }

  let user = await db.user.findUnique({ where: { username: uname } })
  const localOk = !!user && verifyPassword(String(password), user.password)
  if (!localOk) {
    // ─── برگشت به هاست: شاید آینهٔ محلی قدیمی است ولی هاست همین کاربر را می‌شناسد ───
    const hostUser = await verifyUserOnHost(uname, String(password))
    if (hostUser) {
      await mirrorHostUser(hostUser)
      user = await db.user.findUnique({ where: { username: uname } })
      await logAudit(
        null,
        'login_host_fallback',
        'auth',
        undefined,
        `کاربر ${uname} مستقیم از هاست تأیید و آینهٔ محلی تازه شد`
      )
    }
  }
  if (!user || !verifyPassword(String(password), user.password)) {
    const entry = failMap.get(lockKey) || { count: 0, lockedUntil: 0 }
    entry.count += 1
    if (entry.count >= MAX_FAILS) {
      entry.lockedUntil = Date.now() + LOCK_MS
      entry.count = 0
    }
    failMap.set(lockKey, entry)
    pruneFailMap()
    await logAudit(null, 'login_failed', 'auth', undefined, `نام کاربری: ${uname}`)
    return NextResponse.json({ error: 'نام کاربری یا پسورد اشتباه است' }, { status: 401 })
  }
  if (!user.active) {
    return NextResponse.json({ error: 'حساب کاربری شما غیرفعال است؛ با ادمین تماس بگیرید' }, { status: 403 })
  }

  // ارتقای شفاف رمزهای قدیمی (بدون هش) به هش scrypt
  if (!isHashed(user.password)) {
    const hashed = hashPassword(String(password))
    await db.user.update({ where: { id: user.id }, data: { password: hashed } }).catch(() => {})
  }

  failMap.delete(lockKey)

  // tokenVersion کاربر از دیتابیس در توکن می‌آید (pv) — تغییر پسورد/نقش
  // بعداً نشست‌های قدیمی را باطل می‌کند
  const token = await signSession(user)
  const res = NextResponse.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    department: user.department,
  })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  })
  await logAudit({ uid: user.id, username: user.username }, 'login', 'auth')
  return res
}

export async function POST(req: Request) {
  // اسکیمای محلی قبل از هر کوئری تضمین می‌شود (پس از اجرای اول، فقط یک Promise کش‌شده است) —
  // بدون این، نصب‌های قدیمی (≤۱.۰.۱۸) روی اولین کوئری کاربر P2022 می‌گرفتند
  await ensureLocalSchema().catch(() => {})
  // body فقط یک‌بار خوانده می‌شود و به handleLogin پاس داده می‌شود (retry ایمن)
  const body = await req.json().catch(() => ({}))
  // مکانیزم «رمز ادمین را فراموش کرده‌ام» — فایل reset-admin-password.txt اگر
  // روی دیسک باشد، قبل از بررسی اعتبارنامه مصرف می‌شود (هرگز خطا پرتاب نمی‌کند؛
  // حتی ورود ناموفق ریست را اعمال می‌کند — کاربر بدون ری‌استارت برنامه رها می‌شود)
  const reset = await consumeAdminPasswordReset().catch((e) => {
    console.error('[login] admin reset failed', e)
    return null
  })
  if (reset?.attempted) console.log(`[login] admin-reset attempted complete=${reset.complete}`)
  try {
    return await handleLogin(body, req)
  } catch (e) {
    // شکاف اسکیما (جدول/ستون غایب) → ترمیم خودکار → یک‌بار تلاش دوباره
    if (isSchemaGapError(e)) {
      const rep = await repairSchemaGap()
      console.warn(`[auth] schema gap repaired=${rep.repaired} (${rep.detail}) — retrying login`)
      if (rep.repaired) {
        try {
          return await handleLogin(body, req)
        } catch (e2) {
          console.error('login error (after repair)', e2)
          return NextResponse.json({ error: internalDbErrorText(e2) }, { status: 500 })
        }
      }
    }
    console.error('login error', e)
    return NextResponse.json({ error: internalDbErrorText(e) }, { status: 500 })
  }
}
