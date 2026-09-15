// Middleware محافظت از API — اعتبارسنجی نشست و ماتریس دسترسی نقش‌ها
// ادمین: دسترسی کامل | ادمین+مدیر: گزارش فعالیت‌ها | سایر: نیاز به نشست معتبر
import { NextResponse, type NextRequest } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

// مسیرهای عمومی (بدون نشست)
// /api/download/setup → دانلود عمومی نصب‌کنندهٔ ویندوز — هر فردی با لینک می‌تواند دانلود کند
const PUBLIC_PATHS = ['/api/auth/login', '/api/download/setup']

// مسیرهای محدود به نقش خاص: [prefix, roles مجاز]
const ROLE_RULES: { prefix: string; roles: string[]; methods?: string[] }[] = [
  { prefix: '/api/users', roles: ['admin'] },
  { prefix: '/api/audit', roles: ['admin', 'manager'] },
  { prefix: '/api/admin', roles: ['admin'] },
]

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    return NextResponse.next()
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json(
      { error: 'دسترسی غیرمجاز — ابتدا وارد سیستم شوید' },
      { status: 401 }
    )
  }

  const rule = ROLE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  if (rule && !rule.roles.includes(session.role)) {
    return NextResponse.json(
      { error: 'شما به این بخش دسترسی ندارید' },
      { status: 403 }
    )
  }

  // PUT تنظیمات فقط ادمین/مدیر (GET برای همه کاربران سیستم واردشده آزاد است)
  if (pathname === '/api/settings' && req.method === 'PUT' && !['admin', 'manager'].includes(session.role)) {
    return NextResponse.json({ error: 'تغییر تنظیمات فقط توسط مدیر مجاز است' }, { status: 403 })
  }

  // تغییر وضعیت (نوشتن) فقط برای غیرناظر — ناظر فقط خواندن (به‌جز مسیرهای auth مانند تغییر پسورد خود)
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  if (isWrite && session.role === 'viewer' && !pathname.startsWith('/api/auth/')) {
    return NextResponse.json({ error: 'حساب شما فقط دسترسی خواندن دارد' }, { status: 403 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
