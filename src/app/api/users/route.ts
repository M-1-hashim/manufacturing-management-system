import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { hashPassword } from '@/lib/passwords'
import { isRole, isDepartment } from '@/lib/rbac'
import { logAudit } from '@/lib/audit'

function sanitize(u: { id: string; username: string; fullName: string; role: string; department: string; active: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    department: u.department,
    active: u.active,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }
}

async function requireAdmin(req: Request) {
  const session = await getSessionFromRequest(req)
  if (!session) return { error: 'ابتدا وارد سیستم شوید', status: 401 as const }
  if (session.role !== 'admin') return { error: 'فقط مدیر سیستم به مدیریت کاربران سیستم دسترسی دارد', status: 403 as const }
  return { session }
}

// GET /api/users — لیست کاربران سیستم (فقط ادمین)
export async function GET(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const users = await db.user.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json(users.map(sanitize))
  } catch (e) {
    console.error('users GET', e)
    return NextResponse.json({ error: 'خطا در دریافت کاربران سیستم' }, { status: 500 })
  }
}

// POST /api/users — ایجاد حساب جدید برای کارکنان بخش‌ها (فقط ادمین)
export async function POST(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const body = await req.json()
    const username = String(body.username || '').trim()
    const fullName = String(body.fullName || '').trim()
    const password = String(body.password || '')
    const role = isRole(body.role) ? body.role : null
    const department = body.department === undefined || body.department === '' ? 'general' : body.department

    if (username.length < 3) {
      return NextResponse.json({ error: 'نام کاربری باید حداقل 3 کاراکتر باشد' }, { status: 400 })
    }
    if (!fullName) {
      return NextResponse.json({ error: 'نام کامل الزامی است' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'پسورد باید حداقل 6 کاراکتر باشد' }, { status: 400 })
    }
    if (!role) {
      return NextResponse.json({ error: 'نقش کاربر نامعتبر است' }, { status: 400 })
    }
    if (!isDepartment(department)) {
      return NextResponse.json({ error: 'بخش سازمانی نامعتبر است' }, { status: 400 })
    }

    const exists = await db.user.findUnique({ where: { username } })
    if (exists) {
      return NextResponse.json({ error: 'این نام کاربری قبلاً استفاده شده است' }, { status: 400 })
    }

    const user = await db.user.create({
      data: { username, fullName, password: hashPassword(password), role, department, active: body.active !== false },
    })
    await logAudit(guard.session, 'create', 'user', user.id, `حساب ${username} (${fullName})`)
    return NextResponse.json(sanitize(user))
  } catch (e) {
    console.error('users POST', e)
    return NextResponse.json({ error: 'خطا در ایجاد حساب' }, { status: 500 })
  }
}
