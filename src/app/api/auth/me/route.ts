import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest, signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'

// GET /api/auth/me — بازیابی معلومات استفاده‌کننده جاری از کوکی نشست
export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ error: 'نشست نامعتبر است' }, { status: 401 })
    }
    const user = await db.user.findUnique({ where: { id: session.uid } })
    if (!user || !user.active) {
      return NextResponse.json({ error: 'حساب یافت نشد یا غیرفعال است' }, { status: 401 })
    }
    // تمدید خودکار نشست فعال (sliding session) — استفاده‌کننده فعال هرگز وسط کار خارج نمی‌شود
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
    return res
  } catch (e) {
    console.error('me error', e)
    return NextResponse.json({ error: 'خطای داخلی هاست' }, { status: 500 })
  }
}
