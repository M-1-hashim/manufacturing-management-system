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
  if (session.role !== 'admin') return { error: 'فقط مدیر سیستم به مدیریت استفاده‌کنندگان دسترسی دارد', status: 403 as const }
  return { session }
}

/** تعداد ادمین‌های فعال به‌جز این استفاده‌کننده */
async function otherActiveAdmins(userId: string): Promise<number> {
  return db.user.count({ where: { role: 'admin', active: true, NOT: { id: userId } } })
}

// PUT /api/users/[id] — تصحیح حساب (نقش، بخش، فعال/غیرفعال، پاسورد جدید)
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { id } = await ctx.params

    const user = await db.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ error: 'استفاده‌کننده یافت نشد' }, { status: 404 })

    const body = await req.json()
    const data: Record<string, unknown> = {}

    if (body.fullName !== undefined) {
      const fullName = String(body.fullName).trim()
      if (!fullName) return NextResponse.json({ error: 'نام کامل الزامی است' }, { status: 400 })
      data.fullName = fullName
    }
    if (body.role !== undefined) {
      if (!isRole(body.role)) return NextResponse.json({ error: 'نقش نامعتبر است' }, { status: 400 })
      if (id === guard.session.uid && body.role !== 'admin') {
        return NextResponse.json({ error: 'نمی‌توانید نقش خودتان را تغییر دهید' }, { status: 403 })
      }
      if (user.role === 'admin' && body.role !== 'admin' && (await otherActiveAdmins(id)) === 0) {
        return NextResponse.json({ error: 'حداقل یک ادمین فعال باید باقی بماند' }, { status: 403 })
      }
      data.role = body.role
    }
    if (body.department !== undefined) {
      const department = body.department === '' ? 'general' : body.department
      if (!isDepartment(department)) return NextResponse.json({ error: 'بخش سازمانی نامعتبر است' }, { status: 400 })
      data.department = department
    }
    if (body.active !== undefined) {
      if (id === guard.session.uid && body.active === false) {
        return NextResponse.json({ error: 'نمی‌توانید حساب خودتان را غیرفعال کنید' }, { status: 403 })
      }
      if (user.role === 'admin' && user.active && body.active === false && (await otherActiveAdmins(id)) === 0) {
        return NextResponse.json({ error: 'حداقل یک ادمین فعال باید باقی بماند' }, { status: 403 })
      }
      data.active = Boolean(body.active)
    }
    if (body.password) {
      const password = String(body.password)
      if (password.length < 6) {
        return NextResponse.json({ error: 'پاسورد باید حداقل ۶ کاراکتر باشد' }, { status: 400 })
      }
      data.password = hashPassword(password)
    }

    const updated = await db.user.update({ where: { id }, data })
    await logAudit(guard.session, 'update', 'user', id, `تصحیح حساب ${user.username}`)
    return NextResponse.json(sanitize(updated))
  } catch (e) {
    console.error('users PUT', e)
    return NextResponse.json({ error: 'خطا در تصحیح حساب' }, { status: 500 })
  }
}

// DELETE /api/users/[id] — حذف حساب (خود و آخرین ادمین حذف نمی‌شوند)
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const { id } = await ctx.params

    if (id === guard.session.uid) {
      return NextResponse.json({ error: 'نمی‌توانید حساب خودتان را حذف کنید' }, { status: 403 })
    }
    const user = await db.user.findUnique({ where: { id } })
    if (!user) return NextResponse.json({ error: 'استفاده‌کننده یافت نشد' }, { status: 404 })
    if (user.role === 'admin' && (await otherActiveAdmins(id)) === 0) {
      return NextResponse.json({ error: 'حداقل یک ادمین فعال باید باقی بماند' }, { status: 403 })
    }

    await db.user.delete({ where: { id } })
    await logAudit(guard.session, 'delete', 'user', id, `حذف حساب ${user.username}`)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('users DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف حساب' }, { status: 500 })
  }
}
