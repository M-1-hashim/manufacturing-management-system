import { NextResponse } from 'next/server'
import { getSessionFromRequest, SESSION_COOKIE } from '@/lib/session'
import { logAudit } from '@/lib/audit'

// POST /api/auth/logout — خروج و پاک کردن کوکی نشست
export async function POST(req: Request) {
  try {
    const session = await getSessionFromRequest(req)
    if (session) {
      await logAudit({ uid: session.uid, username: session.username }, 'logout', 'auth')
    }
    const res = NextResponse.json({ ok: true })
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
    return res
  } catch (e) {
    console.error('logout error', e)
    return NextResponse.json({ error: 'خطای داخلی سرور' }, { status: 500 })
  }
}
