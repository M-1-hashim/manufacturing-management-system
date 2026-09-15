'use client'

/**
 * هندلر دانلود نصب‌کننده — آینهٔ src/app/api/download/setup/route.ts
 * در APK مستقل هیچ فایل نصب‌کنندهٔ ویندوز/اندرویدی روی سرور نیست:
 *  - ?info=1 → متادیتا با available: false (دکمه‌های دانلود خودشان پنهان می‌شوند)
 *  - درخواست خود فایل (بدون info یا با ?variant=…) → 404 با همان پیام هاست
 */

import { ApiError, route, type RouteDef } from '../types'
import { APP_VERSION } from '@/lib/app-version'

// پیام 404 — دقیقاً همان متن route هاست برای فایل ناموجود
const MISSING_MSG = 'فایل درخواستی هنوز ساخته نشده است — با مدیر سیستم تماس بگیرید'

export const routes: RouteDef[] = [
  route('GET', '/api/download/setup', (ctx) => {
    // متادیتا برای رابط کاربری — ساختار فیلدها مثل DlFileInfo در route هاست
    if (ctx.url.searchParams.get('info') === '1') {
      return {
        version: APP_VERSION,
        setup: {
          available: false,
          filename: 'ManufacturingERP-Setup.exe',
          size: null,
          sizeHuman: null,
          updatedAt: null,
        },
        portable: {
          available: false,
          filename: 'ManufacturingERP-Windows-Portable.zip',
          size: null,
          sizeHuman: null,
          updatedAt: null,
        },
        apk: {
          available: false,
          filename: 'app.apk',
          size: null,
          sizeHuman: null,
          updatedAt: null,
        },
      }
    }
    // هیچ فایلی برای دانلود نیست — مثل هاست وقتی نصب‌کننده ساخته نشده
    throw new ApiError(404, MISSING_MSG)
  }),
]
