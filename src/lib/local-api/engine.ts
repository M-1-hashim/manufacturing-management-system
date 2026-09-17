'use client'

/**
 * موتور API محلی — رهگیری سراسری fetch و پاسخ‌دهی بدون هاست
 * ---------------------------------------------------------------
 * نصب یک‌باره در ابتدای برنامه (قبل از installAuthInterceptor).
 * همهٔ درخواست‌های /api/* از کولکشن‌های localStorage پاسخ می‌گیرند؛
 * درخواست‌های دیگر (فونت‌ها، فایل‌های استاتیک...) عادی پیش می‌روند.
 */

import { allRoutes } from './handlers'
import { ensureSeeded } from './seed'
import { getSession, logAudit, setSession, type LocalSession } from './db'
import { ApiError, type Ctx } from './types'
import { getHostConfig, saveCreds } from '@/lib/host-link'
import { remoteLogin, upsertLocalUserFromHost } from './host-client'

/** حالت محلی فعال است؟ — فقط در بیلد APK اندروید (NEXT_PUBLIC_LOCAL_MODE=1) */
export const LOCAL_MODE: boolean = process.env.NEXT_PUBLIC_LOCAL_MODE === '1'

let installed = false

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

/**
 * گارد سراسری RBAC — آینهٔ src/middleware.ts هاست (پیش از دیسپچ هر هندلر)
 * ---------------------------------------------------------------
 *  - مسیرهای عمومی (بدون نشست): POST /api/auth/login و GET/HEAD /api/download/setup
 *  - بدون نشست معتبر/ختم‌شده → 401
 *  - ناظر (viewer) فقط خواندن — نوشتن به‌جز مسیرهای auth مثل تغییر پسورد خود → 403
 *  - PUT تنظیمات فقط ادمین/مدیر (GET برای همهٔ واردشدگان آزاد است) → 403
 * مسیرهای users/audit/admin جداگانه داخل هندلرهای خودشان گیت ادمین دارند.
 * پاسخ از همان مسیر عادی خطاها (jsonResponse با status) برمی‌گردد تا
 * res.ok=false شود و toast های موجود UI بدون تغییر کار کنند.
 */
function rbacResponse(pathname: string, method: string, session: LocalSession | null): Response | null {
  // مسیرهای عمومی — مثل PUBLIC_PATHS هاست
  const isPublic =
    (pathname === '/api/auth/login' && method === 'POST') ||
    (pathname === '/api/download/setup' && (method === 'GET' || method === 'HEAD'))
  if (isPublic) return null

  // هر مسیر دیگر — نشست معتبر الزامی است
  if (!session) {
    return jsonResponse({ error: 'دسترسی غیرمجاز — ابتدا وارد سیستم شوید' }, 401)
  }

  // PUT تنظیمات فقط ادمین/مدیر (GET برای همهٔ واردشدگان آزاد است) — مثل هاست قبل از قاعدهٔ ناظر
  if (pathname === '/api/settings' && method === 'PUT' && !['admin', 'manager'].includes(session.role)) {
    return jsonResponse({ error: 'تغییر تنظیمات فقط توسط مدیر مجاز است' }, 403)
  }

  // تغییر وضعیت (نوشتن) فقط برای غیرناظر — ناظر فقط خواندن
  // (host-sync استثناست: «کپی بروز از هاست» برای همهٔ نقش‌ها مجاز است)
  const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  if (isWrite && session.role === 'viewer' && !pathname.startsWith('/api/auth/') && pathname !== '/api/system/host-sync') {
    return jsonResponse({ error: 'حساب شما فقط دسترسی خواندن دارد' }, 403)
  }

  return null
}

export function installLocalApi(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  ensureSeeded()

  const originalFetch = window.fetch.bind(window)
  // برای لایه‌های دیگر (پل هاست) — fetch دست‌نخورده قبل از رهگیری
  ;(window as unknown as { __setabOriginalFetch?: typeof fetch }).__setabOriginalFetch = originalFetch

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // --- تشخیص آدرس درخواست ---
    let href: string
    try {
      href =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
      const url = new URL(href, window.location.origin)
      if (!url.pathname.startsWith('/api/')) return originalFetch(input, init)

      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()

      // --- تجزیهٔ بدنه ---
      let body: unknown = null
      const raw = init?.body
      if (typeof raw === 'string' && raw.length > 0) {
        try {
          body = JSON.parse(raw)
        } catch {
          body = raw
        }
      } else if (input instanceof Request && (input.method === 'POST' || input.method === 'PUT' || input.method === 'PATCH')) {
        try {
          const text = await input.clone().text()
          if (text) {
            try {
              body = JSON.parse(text)
            } catch {
              body = text
            }
          }
        } catch {
          /* بدون بدنه */
        }
      }

      const session: LocalSession | null = getSession()
      const ctx: Ctx = { url, method, body, session }

      // --- ورود با کاربران دیتابیس هاست (اگر هاست تنظیم شده باشد) ---
      // اول تلاش از راه دور (اعتبارسنجی با دیتابیس هاست)؛ در موفقیت: ذخیرهٔ
      // اعتبارنامه‌ها + ساخت نشست محلی + ثبت رکورد کاربر؛ در قطعیِ هاست، مسیر
      // عادی هندلر محلی ادامه می‌یابد (ورود آفلاین با هش scrypt یا حساب ذخیره‌شده).
      if (method === 'POST' && url.pathname === '/api/auth/login') {
        const hostCfg = getHostConfig()
        const loginBody = (body && typeof body === 'object' ? body : {}) as {
          username?: string
          password?: string
        }
        if (hostCfg && loginBody.username && loginBody.password) {
          const uname = String(loginBody.username).trim()
          const remote = await remoteLogin(hostCfg, uname, String(loginBody.password))
          if (remote.kind === 'ok') {
            upsertLocalUserFromHost(remote.user, String(loginBody.password))
            setSession(remote.user)
            saveCreds(uname, String(loginBody.password))
            logAudit(
              { uid: remote.user.id, username: remote.user.username },
              'login_host',
              'auth',
              undefined,
              'ورود با حساب دیتابیس هاست'
            )
            return jsonResponse(remote.user)
          }
          if (remote.kind !== 'unreachable') {
            return jsonResponse({ error: remote.message }, remote.status)
          }
          // هاست در دسترس نیست → ورود آفلاین (ادامه به هندلر محلی)
        }
      }

      // --- گارد دسترسی — قبل از هر هندلر، مثل middleware هاست ---
      const blocked = rbacResponse(url.pathname, method, session)
      if (blocked) return blocked

      // --- یافتن هندلر ---
      for (const r of allRoutes) {
        if (r.method !== method) continue
        const m = r.regex.exec(url.pathname)
        if (!m) continue
        try {
          const out = await r.handler(ctx, m.slice(1))
          return jsonResponse(out ?? { ok: true })
        } catch (e) {
          if (e instanceof ApiError) return jsonResponse({ error: e.message }, e.status)
          console.error('[local-api] handler error', url.pathname, e)
          return jsonResponse(
            { error: e instanceof Error ? e.message : 'خطای غیرمنتظره در حالت محلی برنامه' },
            500
          )
        }
      }

      // --- مسیر ناشناخته ---
      return jsonResponse(
        { error: 'این بخش در نسخهٔ نصب‌شدهٔ اندروید (حالت محلی) در دسترس نیست' },
        404
      )
    } catch (e) {
      console.error('[local-api] interceptor error', e)
      return originalFetch(input, init)
    }
  }
}
