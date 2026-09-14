import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { hashPassword, verifyPassword } from '@/lib/passwords'
import { logAudit } from '@/lib/audit'

// POST /api/auth/change-password — تغییر پسورد توسط خود کاربر
export async function POST(req: Request) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ error: 'ابتدا وارد سیستم شوید' }, { status: 401 })
    }
    const { currentPassword, newPassword } = await req.json()
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'پسورد فعلی و پسورد جدید الزامی است' }, { status: 400 })
    }
    if (String(newPassword).length < 6) {
      return NextResponse.json({ error: 'پسورد جدید باید حداقل ۶ کاراکتر باشد' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { id: session.uid } })
    if (!user || !verifyPassword(String(currentPassword), user.password)) {
      return NextResponse.json({ error: 'پسورد فعلی اشتباه است' }, { status: 400 })
    }

    await db.user.update({
      where: { id: user.id },
      data: { password: hashPassword(String(newPassword)) },
    })
    await logAudit({ uid: user.id, username: user.username }, 'change_password', 'auth', user.id)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('change-password error', e)
    return NextResponse.json({ error: 'خطای داخلی هاست' }, { status: 500 })
  }
}
