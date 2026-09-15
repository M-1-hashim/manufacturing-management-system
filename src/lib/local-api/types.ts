'use client'

/**
 * موتور API محلی — تایپ‌های مشترک
 * ---------------------------------------------------------------
 * در نسخهٔ اندروید مستقل (APK آفلاین)، کل برنامه به‌صورت استاتیک داخل
 * خود اپ ذخیره می‌شود و هیچ هاست/سروری در کار نیست. تمام درخواست‌های
 * `/api/*` توسط همین موتور در داخل مرورگر WebView پاسخ داده می‌شوند و
 * دیتا در localStorage همان دستگاه ذخیره می‌گردد.
 *
 * قواعد مهم برای هندلرها:
 *  - ساختار پاسخ باید «دقیقاً» مطابق route هاست (src/app/api/**) باشد
 *    تا ماژول‌های UI بدون هیچ تغییری کار کنند.
 *  - خطاها با ApiError پرتاب می‌شوند: new ApiError(400, 'پیام دری')
 */

/** خطای API با کد وضعیت HTTP — مشابه پاسخ‌های هاست */
export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** نشست محلی — ساختار مشابه SessionPayload در src/lib/session.ts */
export interface LocalSession {
  uid: string
  username: string
  fullName: string
  role: string
  department: string
  exp: number // epoch millis
}

/** زمینهٔ درخواست — در اختیار هر هندلر قرار می‌گیرد */
export interface Ctx {
  url: URL // آدرس کامل درخواست (pathname + searchParams)
  method: string // GET | POST | PUT | DELETE
  body: unknown // بدنهٔ JSON تجزیه‌شده (یا null)
  session: LocalSession | null // نشست محلی فعلی
}

/**
 * یک هندلر — داده برمی‌گرداند (JSON 200) یا ApiError پرتاب می‌کند.
 * params: پارامترهای مسیر مثل :id
 */
export type Handler = (ctx: Ctx, params: string[]) => unknown | Promise<unknown>

/** تعریف یک مسیر — pattern مثل '/api/products/:id' */
export interface RouteDef {
  method: string
  pattern: string
  regex: RegExp
  handler: Handler
}

/** ساخت مسیر با تبدیل ':param' به regex */
export function route(method: string, pattern: string, handler: Handler): RouteDef {
  const regexSrc =
    '^' +
    pattern
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) return '([^/]+)'
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('/') +
    '$'
  return { method: method.toUpperCase(), pattern, regex: new RegExp(regexSrc), handler }
}

/** خواندن بدنه به‌صورت آبجکت (در صورت وجود) */
export function bodyAs<T>(body: unknown): T | null {
  if (body == null || typeof body !== 'object') return null
  return body as T
}
