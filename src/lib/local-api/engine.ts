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
import { getSession, type LocalSession } from './db'
import { ApiError, type Ctx } from './types'

/** حالت محلی فعال است؟ — فقط در بیلد APK اندروید (NEXT_PUBLIC_LOCAL_MODE=1) */
export const LOCAL_MODE: boolean = process.env.NEXT_PUBLIC_LOCAL_MODE === '1'

let installed = false

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

export function installLocalApi(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true

  ensureSeeded()

  const originalFetch = window.fetch.bind(window)

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
