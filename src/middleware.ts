// Middleware محافظت از API — اعتبارسنجی نشست و ماتریس دسترسی نقش‌ها
// ادمین: دسترسی کامل | ادمین+مدیر: گزارش فعالیت‌ها | سایر: نیاز به نشست معتبر
import { NextResponse, type NextRequest } from 'next/server'
import { verifySession, SESSION_COOKIE } from '@/lib/session'

// مسیرهای عمومی (بدون نشست)
// /api/download/setup → دانلود عمومی نصب‌کنندهٔ ویندوز — هر فردی با لینک می‌تواند دانلود کند
// /api/system/host-ping → پینگ هاست برای گِیت شروعِ برنامهٔ دسکتاپ (قبل از ورود) —
//   داخل خود route فقط Host لوکال (127.0.0.1/localhost) مجاز است و در استقرار وب 403 می‌دهد
const PUBLIC_PATHS = ['/api/auth/login', '/api/download/setup', '/api/system/host-ping']

// مسیرهای محدود به نقش خاص: [prefix, roles مجاز]
const ROLE_RULES: { prefix: string; roles: string[]; methods?: string[] }[] = [
  { prefix: '/api/users', roles: ['admin'] },
  { prefix: '/api/audit', roles: ['admin', 'manager'] },
  { prefix: '/api/admin', roles: ['admin'] },
]

/**
 * CORS برای کلاینت‌های مرورگری خارج‌ازمبدأ (نسخهٔ اندروید در مرورگر/تست، ابزارها)
 * مبدأ درخواست عیناً echo می‌شود؛ کوکی mfg_session از نوع SameSite=Lax است و
 * مرورگرها آن را در درخواست‌های کراس-سایت ضمیمه نمی‌کنند، پس این بازشدگی
 * برای نشست‌های کوکی‌دار خطر CSRF ندارد — کلاینت واقعی APK از پل بومی می‌رود.
 */
function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get('origin')
  if (!origin) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Vary': 'Origin',
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const cors = corsHeaders(req)

  // preflight — بدون ورود به منطق نشست
  if (req.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors })
  }

  if (PUBLIC_PATHS.some((p) => pathname === p)) {
    const res = NextResponse.next()
    for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
    return res
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const session = await verifySession(token)
  if (!session) {
    return NextResponse.json(
      { error: 'دسترسی غیرمجاز — ابتدا وارد سیستم شوید' },
      { status: 401, headers: cors }
    )
  }

  const rule = ROLE_RULES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + '/'))
  if (rule && !rule.roles.includes(session.role)) {
    return NextResponse.json(
      { error: 'شما به این بخش دسترسی ندارید' },
      { status: 403, headers: cors }
    )
  }

  // PUT تنظیمات فقط ادمین/مدیر (GET برای همه کاربران سیستم واردشده آزاد است)
  if (pathname === '/api/settings' && req.method === 'PUT' && !['admin', 'manager'].includes(session.role)) {
    return NextResponse.json({ error: 'تغییر تنظیمات فقط توسط مدیر مجاز است' }, { status: 403, headers: cors })
  }

  // تغییر وضعیت (نوشتن) فقط برای غیرناظر — ناظر فقط خواندن (به‌جز مسیرهای auth مانند تغییر پسورد خود)
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  if (isWrite && session.role === 'viewer' && !pathname.startsWith('/api/auth/')) {
    return NextResponse.json({ error: 'حساب شما فقط دسترسی خواندن دارد' }, { status: 403, headers: cors })
  }

  const res = NextResponse.next()
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v)
  return res
}

export const config = {
  matcher: '/api/:path*',
}
