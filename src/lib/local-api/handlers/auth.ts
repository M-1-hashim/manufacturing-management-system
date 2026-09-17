'use client'

/**
 * هندلرهای تصدیق هویت — آینهٔ src/app/api/auth/**
 * نشست در localStorage نگه‌داری می‌شود (بدون کوکی — حالت محلی)
 *
 * پسوردها:
 *  - رکوردهای محلیِ ساخته‌شده در همین دستگاه → متن ساده (مانند قبل)
 *  - رکوردهای کپی‌شده از هاست → هش scrypt:<salt>:<hash> هاست عیناً حفظ می‌شود و
 *    در ورود با scrypt-js تأیید می‌گردد (ورود آفلاین با پسورد واقعی همان کاربر)
 *  - اگر کاربر در کولکشن محلی نبود → تطبیق با اعتبارنامهٔ ذخیره‌شدهٔ موفقِ قبلی
 *    (setab-local.savedCreds — پس از نخستین ورود از راه دور) → ورود آفلاین
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import {
  clearSession, getSession, logAudit, readCol, setSession, writeCol, newRow, withUpdate,
  type Row,
} from '../db'
import { isScryptHash, verifyScryptHash } from '../scrypt-verify'
import { getSavedCreds } from '@/lib/host-link'

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

/** تأیید پسورد محلی — هش scrypt هاست یا متن سادهٔ رکوردهای قدیمی */
async function verifyLocalPassword(password: string, stored: string): Promise<boolean> {
  if (isScryptHash(stored)) return verifyScryptHash(password, stored)
  return password === stored
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

function clearFailFor(fails: LoginFailMap, failKey: string): void {
  if (fails[failKey]) {
    delete fails[failKey]
    writeLoginFails(fails)
  }
}

export const routes: RouteDef[] = [
  // POST /api/auth/login — اگر هاست تنظیم شده باشد، موتور (engine.ts) ابتدا
  // ورود از راه دور را می‌آزماید و فقط در قطعی هاست به این هندلر می‌رسد.
  route('POST', '/api/auth/login', async (ctx) => {
    const body = bodyAs<{ username?: string; password?: string }>(ctx.body)
    if (!body?.username || !body?.password) throw new ApiError(400, 'نام کاربری و پسورد الزامی است')
    const uname = String(body.username).trim()
    const entered = String(body.password)
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

    // --- ورود آفلاین با اعتبارنامهٔ ذخیره‌شدهٔ موفق قبلی (نخستین ورودِ از راه دور) ---
    // وقتی رکورد محلی نیست یا هش آن با پسورد واردشده نخواند، اگر همان زوج
    // کاربری/رمزی که قبلاً روی هاست موفق شده ذخیره باشد → نشست محلی ساخته می‌شود.
    if (!user || !(await verifyLocalPassword(entered, String(user.password)))) {
      const saved = getSavedCreds()
      const savedMatch =
        saved &&
        saved.username.toLowerCase() === uname.toLowerCase() &&
        saved.password === entered
      if (savedMatch) {
        if (user && !user.active) {
          throw new ApiError(403, 'حساب کاربری شما غیرفعال است؛ با ادمین تماس بگیرید')
        }
        clearFailFor(fails, failKey)
        const mint = user
          ? toSessionUser(user)
          : {
              id: `saved-${failKey}`,
              username: saved!.username,
              fullName: saved!.username,
              role: 'admin',
              department: 'general',
            }
        setSession(mint)
        logAudit({ uid: mint.id, username: mint.username }, 'login_offline', 'auth', undefined, 'ورود آفلاین با حساب ذخیره‌شدهٔ دستگاه')
        return mint
      }
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
    clearFailFor(fails, failKey)
    setSession(toSessionUser(user))
    logAudit({ uid: user.id, username: user.username }, 'login', 'auth')
    return toSessionUser(user)
  }),

  // GET /api/auth/me
  route('GET', '/api/auth/me', (ctx) => {
    const s = ctx.session ?? getSession()
    if (!s) throw new ApiError(401, 'نشست نامعتبر است')
    const user = readCol<LocalUser>('users').find((u) => u.id === s.uid)
    if (!user || !user.active) {
      // رکورد محلی گم/قدیمی است (مثلاً هاست عوض شده و هنوز کپی نگرفته) —
      // به‌جای اخراج کاربر، همان نسخهٔ نشست (کپیِ ذخیره‌شده) برگردانده می‌شود
      return { id: s.uid, username: s.username, fullName: s.fullName, role: s.role, department: s.department }
    }
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
  route('POST', '/api/auth/change-password', async (ctx) => {
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
    if (!user || !(await verifyLocalPassword(String(body.currentPassword), String(user.password)))) {
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
