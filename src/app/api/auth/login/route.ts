import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, hashPassword, isHashed } from '@/lib/passwords'
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import { logAudit } from '@/lib/audit'

// قفل شدن حساب پس از ۵ ورود ناموفق به مدت ۱۵ دقیقه (حافظه محلی سرور)
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000
const failMap = new Map<string, { count: number; lockedUntil: number }>()

function isLocked(entry: { count: number; lockedUntil: number } | undefined): number {
  if (!entry) return 0
  if (entry.lockedUntil > Date.now()) return Math.ceil((entry.lockedUntil - Date.now()) / 60000)
  return 0
}

// POST /api/auth/login — احراز هویت با نقش و بخش سازمانی + نشست کوکی امن
export async function POST(req: Request) {
  try {
    const { username, password } = await req.json()
    if (!username || !password) {
      return NextResponse.json({ error: 'نام کاربری و رمز عبور الزامی است' }, { status: 400 })
    }

    const uname = String(username).trim()
    const lockMin = isLocked(failMap.get(uname))
    if (lockMin > 0) {
      return NextResponse.json(
        { error: `حساب شما موقتاً قفل شده است؛ ${lockMin} دقیقه دیگر تلاش کنید` },
        { status: 423 }
      )
    }

    // آماده‌سازی خودکار حساب ادمین — فقط وقتی جدول کاربران خالی است
    // (اولین اتصال به دیتابیس تازه هاست — برای امکان ورود و بازیابی بکاپ JSON)
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
      await logAudit(null, 'bootstrap', 'auth', undefined, 'حساب ادمین پیش‌فرض در دیتابیس خالی ساخته شد — admin/admin123')
    }

    const user = await db.user.findUnique({ where: { username: uname } })
    if (!user || !verifyPassword(String(password), user.password)) {
      const entry = failMap.get(uname) || { count: 0, lockedUntil: 0 }
      entry.count += 1
      if (entry.count >= MAX_FAILS) {
        entry.lockedUntil = Date.now() + LOCK_MS
        entry.count = 0
      }
      failMap.set(uname, entry)
      await logAudit(null, 'login_failed', 'auth', undefined, `نام کاربری: ${uname}`)
      return NextResponse.json({ error: 'نام کاربری یا رمز عبور اشتباه است' }, { status: 401 })
    }
    if (!user.active) {
      return NextResponse.json({ error: 'حساب کاربری شما غیرفعال است؛ با ادمین تماس بگیرید' }, { status: 403 })
    }

    // ارتقای شفاف رمزهای قدیمی (بدون هش) به هش scrypt
    if (!isHashed(user.password)) {
      const hashed = hashPassword(String(password))
      await db.user.update({ where: { id: user.id }, data: { password: hashed } }).catch(() => {})
    }

    failMap.delete(uname)

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
  } catch (e) {
    console.error('login error', e)
    return NextResponse.json({ error: 'خطای داخلی سرور' }, { status: 500 })
  }
}
