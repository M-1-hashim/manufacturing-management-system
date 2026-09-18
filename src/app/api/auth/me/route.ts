import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest, signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import { ensureLocalSchema } from '@/lib/local-schema'
import { isSchemaGapError, repairSchemaGap, internalDbErrorText } from '@/lib/db-repair'

// GET /api/auth/me — بازیابی معلومات کاربر جاری از کوکی نشست
// (خطاها پرتاب می‌شوند — GET پایین ترمیم اسکیما + تلاش دوباره را مدیریت می‌کند)
async function handleMe(req: Request): Promise<NextResponse> {
  const session = await getSessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: 'نشست نامعتبر است' }, { status: 401 })
  }
  const user = await db.user.findUnique({ where: { id: session.uid } })
  if (!user || !user.active) {
    return NextResponse.json({ error: 'حساب یافت نشد یا غیرفعال است' }, { status: 401 })
  }
  // ناهم‌خوانی نسخهٔ توکن (تغییر پسورد/نقش/غیرفعال‌شدن در جای دیگر) → نشست قدیمی می‌میرد
  if (session.pv !== undefined && user.tokenVersion !== session.pv) {
    return NextResponse.json({ error: 'نشست نامعتبر است' }, { status: 401 })
  }
  // تمدید خودکار نشست فعال (sliding session) — کاربر فعال هرگز وسط کار خارج نمی‌شود
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
}

export async function GET(req: Request) {
  // تضمین اسکیمای محلی (دیتابیس‌های ≤۱.۰.۱۸ بدون ستون tokenVersion با P2022 می‌مردند)
  await ensureLocalSchema().catch(() => {})
  try {
    return await handleMe(req)
  } catch (e) {
    if (isSchemaGapError(e)) {
      const rep = await repairSchemaGap()
      console.warn(`[auth] me schema gap repaired=${rep.repaired} (${rep.detail}) — retrying`)
      if (rep.repaired) {
        try {
          return await handleMe(req)
        } catch (e2) {
          console.error('me error (after repair)', e2)
          return NextResponse.json({ error: internalDbErrorText(e2) }, { status: 500 })
        }
      }
    }
    console.error('me error', e)
    return NextResponse.json({ error: internalDbErrorText(e) }, { status: 500 })
  }
}
