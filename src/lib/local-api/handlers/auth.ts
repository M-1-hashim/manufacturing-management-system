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

// ---------------- قفل حساب بعد از کوشش‌های ناکام — آینهٔ route هاست ----------------
// هاست: ۵ کوشش ناکام → قفل ۱۵ دقیقه با پاسخ 423؛ ورود موفق شمارنده را پاک می‌کند.
const FAILS_KEY = 'setab-local.loginFails'
const MAX_FAILS = 5
const LOCK_MS = 15 * 60 * 1000

interface LoginFailEntry {
  count: number
  until: number // epoch millis — 0 یعنی در حال شمارش، هنوز قفل نشده
}
type LoginFailMap = Record<string, LoginFailEntry>

function readLoginFails(): LoginFailMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(FAILS_KEY) ?? '{}') as LoginFailMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeLoginFails(map: LoginFailMap): void {
  try {
    localStorage.setItem(FAILS_KEY, JSON.stringify(map))
  } catch {
    /* بی‌اهمیت */
  }
}

/** پاک‌سازی فرصتی مدخل‌های منقضی (قفل‌های ختم‌شده) — در هر خواندن */
function pruneLoginFails(map: LoginFailMap): LoginFailMap {
  const now = Date.now()
  for (const k of Object.keys(map)) {
    const e = map[k]
    if (!e || typeof e !== 'object' || (e.until > 0 && e.until <= now)) delete map[k]
  }
  return map
}

export const routes: RouteDef[] = [
  // POST /api/auth/login
  route('POST', '/api/auth/login', (ctx) => {
    const body = bodyAs<{ username?: string; password?: string }>(ctx.body)
    if (!body?.username || !body?.password) throw new ApiError(400, 'نام کاربری و پسورد الزامی است')
    const uname = String(body.username).trim()
    // تطبیق کاربر در حالت محلی نسبت به حروف بزرگ/کوچک حساس نیست — کلید شمارنده هم یکسان می‌ماند
    const failKey = uname.toLowerCase()
    const fails = pruneLoginFails(readLoginFails())
    writeLoginFails(fails) // پاک‌سازی فرصتی مدخل‌های منقضی
    const entry = fails[failKey]
    if (entry?.until && entry.until > Date.now()) {
      const lockMin = Math.ceil((entry.until - Date.now()) / 60000)
      throw new ApiError(423, `حساب شما موقتاً قفل شده است؛ ${lockMin} دقیقه دیگر کوشش کنید`)
    }
    const users = readCol<LocalUser>('users')
    const user = users.find((u) => u.username.toLowerCase() === uname.toLowerCase())
    if (!user || String(user.password) !== String(body.password)) {
      const fail = fails[failKey] ?? { count: 0, until: 0 }
      fail.count += 1
      if (fail.count >= MAX_FAILS) {
        fail.until = Date.now() + LOCK_MS
        fail.count = 0
      }
      fails[failKey] = fail
      writeLoginFails(fails)
      logAudit(null, 'login_failed', 'auth', undefined, `نام کاربری: ${uname}`)
      throw new ApiError(401, 'نام کاربری یا پسورد اشتباه است')
    }
    if (!user.active) throw new ApiError(403, 'حساب کاربری شما غیرفعال است؛ با ادمین تماس بگیرید')
    // ورود موفق — شمارندهٔ کوشش‌های ناکام پاک می‌شود
    if (fails[failKey]) {
      delete fails[failKey]
      writeLoginFails(fails)
    }
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

