'use client'

/**
 * هندلرهای مدیریت کاربران سیستم — آینهٔ src/app/api/users/**
 * پسوردها به‌صورت ساده در کولکشن users ذخیره می‌شوند (دیتا فقط روی همین دستگاه است)
 * پاسخ‌ها با sanitize همسان route هاست: password هرگز برنمی‌گردد
 */

import { ApiError, bodyAs, route, type Ctx, type RouteDef } from '../types'
import {
  getSession, logAudit, newRow, readCol, withUpdate, writeCol,
  type LocalSession, type Row,
} from '../db'
import { isDepartment, isRole } from '@/lib/rbac'

interface LocalUser extends Row {
  username: string
  password: string
  fullName: string
  role: string
  department: string
  active: boolean
}

/** همان sanitize در route هاست — فیلدهای پاسخ دقیقاً همین‌ها */
function sanitize(u: LocalUser) {
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

/** فقط ادمین — پیام‌ها دقیقاً مثل هاست */
function requireAdmin(ctx: Ctx): LocalSession {
  const s = ctx.session ?? getSession()
  if (!s) throw new ApiError(401, 'ابتدا وارد سیستم شوید')
  if (s.role !== 'admin') {
    throw new ApiError(403, 'فقط مدیر سیستم به مدیریت کاربران سیستم دسترسی دارد')
  }
  return s
}

/** تعداد ادمین‌های فعال به‌جز این کاربر (حفاظت آخرین ادمین) */
function otherActiveAdmins(users: LocalUser[], userId: string): number {
  return users.filter((u) => u.role === 'admin' && u.active && u.id !== userId).length
}

export const routes: RouteDef[] = [
  // GET /api/users — لیست کاربران (مرتب بر اساس createdAt صعودی مثل هاست)
  route('GET', '/api/users', (ctx) => {
    requireAdmin(ctx)
    return readCol<LocalUser>('users')
      .slice()
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map(sanitize)
  }),

  // POST /api/users — ایجاد حساب برای کارکنان بخش‌ها
  route('POST', '/api/users', (ctx) => {
    const session = requireAdmin(ctx)
    const body = bodyAs<Record<string, unknown>>(ctx.body)
    const username = String(body?.username ?? '').trim()
    const fullName = String(body?.fullName ?? '').trim()
    const password = String(body?.password ?? '')
    const role = isRole(body?.role) ? (body!.role as string) : null
    const department =
      body?.department === undefined || body?.department === '' ? 'general' : String(body.department)

    // ترتیب اعتبارسنجی دقیقاً مثل هاست
    if (username.length < 3) throw new ApiError(400, 'نام کاربری باید حداقل 3 کاراکتر باشد')
    if (!fullName) throw new ApiError(400, 'نام کامل الزامی است')
    if (password.length < 6) throw new ApiError(400, 'پسورد باید حداقل 6 کاراکتر باشد')
    if (!role) throw new ApiError(400, 'نقش کاربر نامعتبر است')
    if (!isDepartment(department)) throw new ApiError(400, 'بخش سازمانی نامعتبر است')

    const users = readCol<LocalUser>('users')
    // یکتایی نام کاربری (بی‌توجه به بزرگی/کوچکی حروف)
    if (users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
      throw new ApiError(400, 'این نام کاربری قبلاً استفاده شده است')
    }

    const user = newRow({
      username,
      fullName,
      password,
      role,
      department,
      active: body?.active !== false,
    }) as unknown as LocalUser
    users.push(user)
    writeCol('users', users)
    logAudit(
      { uid: session.uid, username: session.username },
      'create',
      'user',
      user.id,
      `حساب ${username} (${fullName})`
    )
    return sanitize(user)
  }),

  // PUT /api/users/:id — تصحیح حساب (نقش، بخش، فعال/غیرفعال، پسورد جدید)
  route('PUT', '/api/users/:id', (ctx, params) => {
    const session = requireAdmin(ctx)
    const id = params[0] ?? ''
    const users = readCol<LocalUser>('users')
    const user = users.find((u) => u.id === id)
    if (!user) throw new ApiError(404, 'کاربر یافت نشد')

    const body = bodyAs<Record<string, unknown>>(ctx.body)
    const patch: Partial<LocalUser> = {}

    if (body?.fullName !== undefined) {
      const fullName = String(body.fullName).trim()
      if (!fullName) throw new ApiError(400, 'نام کامل الزامی است')
      patch.fullName = fullName
    }
    if (body?.role !== undefined) {
      if (!isRole(body.role)) throw new ApiError(400, 'نقش نامعتبر است')
      if (id === session.uid && String(body.role) !== 'admin') {
        throw new ApiError(403, 'نمی‌توانید نقش خودتان را تغییر دهید')
      }
      if (user.role === 'admin' && String(body.role) !== 'admin' && otherActiveAdmins(users, id) === 0) {
        throw new ApiError(403, 'حداقل یک ادمین فعال باید باقی بماند')
      }
      patch.role = String(body.role)
    }
    if (body?.department !== undefined) {
      const department = body.department === '' ? 'general' : String(body.department)
      if (!isDepartment(department)) throw new ApiError(400, 'بخش سازمانی نامعتبر است')
      patch.department = department
    }
    if (body?.active !== undefined) {
      if (id === session.uid && body.active === false) {
        throw new ApiError(403, 'نمی‌توانید حساب خودتان را غیرفعال کنید')
      }
      if (user.role === 'admin' && user.active && body.active === false && otherActiveAdmins(users, id) === 0) {
        throw new ApiError(403, 'حداقل یک ادمین فعال باید باقی بماند')
      }
      patch.active = Boolean(body.active)
    }
    if (body?.password) {
      const password = String(body.password)
      if (password.length < 6) throw new ApiError(400, 'پسورد باید حداقل 6 کاراکتر باشد')
      patch.password = password
    }

    const updated = withUpdate(user, patch)
    const idx = users.findIndex((u) => u.id === id)
    users[idx] = updated
    writeCol('users', users)
    logAudit(
      { uid: session.uid, username: session.username },
      'update',
      'user',
      id,
      `تصحیح حساب ${user.username}`
    )
    return sanitize(updated)
  }),

  // DELETE /api/users/:id — حذف حساب (خود و آخرین ادمین حذف نمی‌شوند)
  route('DELETE', '/api/users/:id', (ctx, params) => {
    const session = requireAdmin(ctx)
    const id = params[0] ?? ''
    if (id === session.uid) throw new ApiError(403, 'نمی‌توانید حساب خودتان را حذف کنید')
    const users = readCol<LocalUser>('users')
    const user = users.find((u) => u.id === id)
    if (!user) throw new ApiError(404, 'کاربر یافت نشد')
    if (user.role === 'admin' && otherActiveAdmins(users, id) === 0) {
      throw new ApiError(403, 'حداقل یک ادمین فعال باید باقی بماند')
    }
    writeCol('users', users.filter((u) => u.id !== id))
    logAudit(
      { uid: session.uid, username: session.username },
      'delete',
      'user',
      id,
      `حذف حساب ${user.username}`
    )
    return { ok: true }
  }),
]
