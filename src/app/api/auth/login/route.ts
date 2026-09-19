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

// POST /api/auth/login — تصدیق هویت با نقش و بخش سازمانی + نشست کوکی امن
// (خطاها پرتاب می‌شوند — POST پایین ترمیم اسکیما + تلاش دوباره را مدیریت می‌کند)
async function handleLogin(req: Request): Promise<NextResponse> {
  const { username, password } = await req.json()
  if (!username || !password) {
    return NextResponse.json({ error: 'نام کاربری و پسورد الزامی است' }, { status: 400 })
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

  // آماده‌سازی خودکار حساب ادمین — فقط وقتی جدول کاربران سیستم محلی خالی است.
  // اگر هاست تنظیم شده باشد، اول دیتای هاست کشیده می‌شود (نصب تازه روی
  // دستگاه جدید) تا ورود با کاربران سیستم واقعی هاست انجام شود — نه ادمین ساختگی.
  const userCountBefore = await db.user.count()
  if (userCountBefore === 0 && dbInternal.mysqlConfigured()) {
    await ensureInitialPull()
  }
  const userCount = await db.user.count()
  if (userCount === 0) {
    await db.user.create({
      data: {
        username: 'admin',
        password: hashPassword('admin123'),
        fullName: 'مدیر سیستم',
        role: 'admin',
        department: 'general',
      },
    })
    await logAudit(null, 'bootstrap', 'auth', undefined, 'حساب ادمین پیش‌فرض در دیتابیس محلی خالی ساخته شد — admin/admin123')
  }

  const user = await db.user.findUnique({ where: { username: uname } })
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
  // مکانیزم «رمز ادمین را فراموش کرده‌ام» — فایل reset-admin-password.txt اگر
  // روی دیسک باشد، قبل از بررسی اعتبارنامه مصرف می‌شود (هرگز خطا پرتاب نمی‌کند؛
  // حتی ورود ناموفق ریست را اعمال می‌کند — کاربر بدون ری‌استارت برنامه رها می‌شود)
  const reset = await consumeAdminPasswordReset().catch((e) => {
    console.error('[login] admin reset failed', e)
    return null
  })
  if (reset?.attempted) console.log(`[login] admin-reset attempted complete=${reset.complete}`)
  try {
    return await handleLogin(req)
  } catch (e) {
    // شکاف اسکیما (جدول/ستون غایب) → ترمیم خودکار → یک‌بار تلاش دوباره
    if (isSchemaGapError(e)) {
      const rep = await repairSchemaGap()
      console.warn(`[auth] schema gap repaired=${rep.repaired} (${rep.detail}) — retrying login`)
      if (rep.repaired) {
        try {
          return await handleLogin(req)
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
