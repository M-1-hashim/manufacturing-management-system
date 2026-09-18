import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest, signSession, SESSION_COOKIE, SESSION_MAX_AGE_S } from '@/lib/session'
import { hashPassword, verifyPassword } from '@/lib/passwords'
import { logAudit } from '@/lib/audit'
import { ensureLocalSchema } from '@/lib/local-schema'
import { isSchemaGapError, repairSchemaGap, internalDbErrorText } from '@/lib/db-repair'

// POST /api/auth/change-password — تغییر پسورد توسط خود کاربر
// (خطاها پرتاب می‌شوند — POST پایین ترمیم اسکیما + تلاش دوباره را مدیریت می‌کند)
async function handleChangePassword(req: Request): Promise<NextResponse> {
  const session = await getSessionFromRequest(req)
  if (!session) {
    return NextResponse.json({ error: 'ابتدا وارد سیستم شوید' }, { status: 401 })
  }
  const { currentPassword, newPassword } = await req.json()
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'پسورد فعلی و پسورد جدید الزامی است' }, { status: 400 })
  }
  if (String(newPassword).length < 6) {
    return NextResponse.json({ error: 'پسورد جدید باید حداقل 6 کاراکتر باشد' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { id: session.uid } })
  if (!user || !verifyPassword(String(currentPassword), user.password)) {
    return NextResponse.json({ error: 'پسورد فعلی اشتباه است' }, { status: 400 })
  }

  // نسخهٔ توکن +1 می‌شود تا نشست‌های دیگر دستگاه‌ها باطل شوند؛
  // همین دستگاه با کوکی تازه (صادرشده از کاربر به‌روزشده) داخل می‌ماند.
  // اگر ستون tokenVersion در این استقرار موجود نباشد، فقط ارتقا نادیده
  // گرفته می‌شود و خود تغییر پسورد سالم می‌ماند
  const data: Record<string, unknown> = { password: hashPassword(String(newPassword)) }
  if (user.tokenVersion !== undefined) data.tokenVersion = Number(user.tokenVersion) + 1
  const updated = await db.user.update({ where: { id: user.id }, data })
  await logAudit({ uid: user.id, username: user.username }, 'change_password', 'auth', user.id)
  const token = await signSession(updated)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  })
  return res
}

export async function POST(req: Request) {
  await ensureLocalSchema().catch(() => {})
  try {
    return await handleChangePassword(req)
  } catch (e) {
    if (isSchemaGapError(e)) {
      const rep = await repairSchemaGap()
      console.warn(`[auth] change-password schema gap repaired=${rep.repaired} (${rep.detail}) — retrying`)
      if (rep.repaired) {
        try {
          return await handleChangePassword(req)
        } catch (e2) {
          console.error('change-password error (after repair)', e2)
          return NextResponse.json({ error: internalDbErrorText(e2) }, { status: 500 })
        }
      }
    }
    console.error('change-password error', e)
    return NextResponse.json({ error: internalDbErrorText(e) }, { status: 500 })
  }
}
