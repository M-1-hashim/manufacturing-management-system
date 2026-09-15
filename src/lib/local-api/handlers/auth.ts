'use client'

/**
 * هندلرهای تصدیق هویت — آینهٔ src/app/api/auth/**
 * نشست در localStorage نگه‌داری می‌شود (بدون کوکی — حالت محلی)
 * پسوردها به‌صورت ساده ذخیره می‌شوند (دیتای محلی فقط روی همین دستگاه است)
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import {
  clearSession, getSession, logAudit, readCol, setSession, writeCol, newRow, withUpdate,
  type Row,
} from '../db'

interface LocalUser extends Row {
  username: string
  password: string
  fullName: string
  role: string
  department: string
  active: boolean
}

function toSessionUser(u: LocalUser) {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role, department: u.department }
}

export const routes: RouteDef[] = [
  // POST /api/auth/login
  route('POST', '/api/auth/login', (ctx) => {
    const body = bodyAs<{ username?: string; password?: string }>(ctx.body)
    if (!body?.username || !body?.password) throw new ApiError(400, 'نام کاربری و پسورد الزامی است')
    const uname = String(body.username).trim()
    const users = readCol<LocalUser>('users')
    const user = users.find((u) => u.username.toLowerCase() === uname.toLowerCase())
    if (!user || String(user.password) !== String(body.password)) {
      logAudit(null, 'login_failed', 'auth', undefined, `نام کاربری: ${uname}`)
      throw new ApiError(401, 'نام کاربری یا پسورد اشتباه است')
    }
    if (!user.active) throw new ApiError(403, 'حساب کاربری شما غیرفعال است؛ با ادمین تماس بگیرید')
    setSession(toSessionUser(user))
    logAudit({ uid: user.id, username: user.username }, 'login', 'auth')
    return toSessionUser(user)
  }),

  // GET /api/auth/me
  route('GET', '/api/auth/me', (ctx) => {
    const s = ctx.session ?? getSession()
    if (!s) throw new ApiError(401, 'نشست نامعتبر است')
    const user = readCol<LocalUser>('users').find((u) => u.id === s.uid)
    if (!user || !user.active) throw new ApiError(401, 'حساب یافت نشد یا غیرفعال است')
    // تمدید خودکار نشست فعال (sliding session)
    setSession(toSessionUser(user))
    return toSessionUser(user)
  }),

  // POST /api/auth/logout
  route('POST', '/api/auth/logout', (ctx) => {
    const s = ctx.session ?? getSession()
    if (s) logAudit({ uid: s.uid, username: s.username }, 'logout', 'auth')
    clearSession()
    return { ok: true }
  }),

  // POST /api/auth/change-password
  route('POST', '/api/auth/change-password', (ctx) => {
    const s = ctx.session ?? getSession()
    if (!s) throw new ApiError(401, 'ابتدا وارد سیستم شوید')
    const body = bodyAs<{ currentPassword?: string; newPassword?: string }>(ctx.body)
    if (!body?.currentPassword || !body?.newPassword) {
      throw new ApiError(400, 'پسورد فعلی و پسورد جدید الزامی است')
    }
    if (String(body.newPassword).length < 6) {
      throw new ApiError(400, 'پسورد جدید باید حداقل 6 کاراکتر باشد')
    }
    const users = readCol<LocalUser>('users')
    const user = users.find((u) => u.id === s.uid)
    if (!user || String(user.password) !== String(body.currentPassword)) {
      throw new ApiError(400, 'پسورد فعلی اشتباه است')
    }
    const idx = users.findIndex((u) => u.id === user.id)
    users[idx] = withUpdate(user, { password: String(body.newPassword) })
    writeCol('users', users)
    logAudit({ uid: user.id, username: user.username }, 'change_password', 'auth', user.id)
    return { ok: true }
  }),
]

// ابزار مشترک برای هندلر users (بدون رفتن به چرخهٔ import)
export function makeLocalUser(data: {
  username: string
  password: string
  fullName: string
  role: string
  department: string
  active?: boolean
}): LocalUser {
  return newRow({
    username: data.username,
    password: data.password,
    fullName: data.fullName,
    role: data.role,
    department: data.department,
    active: data.active ?? true,
  })
}

