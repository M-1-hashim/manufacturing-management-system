'use client'

/**
 * دروازهٔ راه‌اندازی اولیه — منطق محض تصمیم (قابل تست بدون مرورگر)
 *
 * قواعد:
 *  - ?setup=1  → همیشه ویزارد (درگاه اضطراری، همه‌جا)
 *  - دسکتاپ (window.dbConnection موجود):
 *      • «فقط این دستگاه» انتخاب شده → برنامه (ویزارد مزاحم نمی‌شود)
 *      • اتصال ذخیره‌شده سالم (active و reachable ≠ false و dbOk ≠ false) → برنامه
 *      • بقیهٔ حالت‌ها (تنظیم نشده **یا** ذخیره‌شده ولی عملاً وصل نمی‌شود) → ویزارد
 *        — ویزارد با مقادیر فعلی پیش‌پر می‌شود تا کاربر فقط ایراد را اصلاح کند
 *  - اندروید (LOCAL_MODE):
 *      • بدون «اطلاعات هاست» یا آدرسِ ذخیره‌شدهٔ بدون تست موفق (verifiedAt ندارد)
 *        → ویزارد — حتی اگر کاربرِ قبلی ذخیره شده باشد (ارتقا از نسخه‌های قدیمی)
 *  - وب: بدون ویزارد (اتصال هاست از env هاست می‌آید)
 *
 * نکته: reachable و dbOk سه‌حالته‌اند — true (وصل شد)، false (قطعاً وصل
 * نمی‌شود)، null (نامعلوم/بررسی اجرا نشد). فقط false ویزارد را باز می‌کند تا
 * پروبِ مشکوک یا نبودِ endpoint باعث حلقهٔ ویزارد نشود.
 *
 * reachable = پروب TCP سطح پورت (سریع) — dbOk = پینگ واقعی MySQL با SELECT 1
 * (زنجیرهٔ کامل: تونل → MySQL → احراز هویت → دیتابیس). حالت «فایل فعال +
 * پورت باز + MySQL خراب» (مثل نام دیتابیس/رمز غلط) فقط با dbOk=false پیدا
 * می‌شود — بدون آن کاربر هرگز صفحهٔ هاست را نمی‌دید و فکر می‌کرد «تغیری نکرد».
 */

export type FirstRunDecision = 'wizard' | 'app'

export interface FirstRunInput {
  /** ?setup=1 — درگاه اضطراری */
  forceSetup: boolean
  /** window.dbConnection موجود است (نسخهٔ ویندوز) */
  desktop: boolean
  /** فایل db-connection.txt خط اتصال فعال دارد */
  infoActive: boolean
  /** نتیجهٔ پروب TCP پورت: true وصل شد / false قطعاً وصل نمی‌شود / null نامعلوم */
  infoReachable: boolean | null
  /** نتیجهٔ پینگ واقعی MySQL (SELECT 1): true/false/null نامعلوم */
  infoDbOk: boolean | null
  /** فلگ «فقط این دستگاه» (mfg-setup-local-mode) */
  localOnly: boolean
  /** فلگ اتمام راه‌اندازی (mfg-setup-completed) */
  setupFlag: boolean
  /** نشست کاربر ذخیره شده (نسخهٔ وب / حساب محلی قدیمی) */
  hasSavedUser: boolean
  /** بیلد اندروید مستقل (NEXT_PUBLIC_LOCAL_MODE=1) */
  localMode: boolean
  /** حالت دمو بدون دیتابیس (استقرار ابری) — مثل وب: بدون ویزارد، لاگین ساده */
  demoMode?: boolean
  /** hostConfig ذخیره شده (آدرس سرور مرکزی) */
  hasHostConfig: boolean
  /** hostConfig هست ولی هرگز تست موفق نشده (verifiedAt ندارد) */
  hostConfigUnverified: boolean
}

export function decideFirstRun(i: FirstRunInput): FirstRunDecision {
  if (i.forceSetup) return 'wizard'

  // ---------- نسخهٔ ویندوز (دسکتاپ) ----------
  if (i.desktop) {
    // کاربر قبلاً «فقط این دستگاه» را انتخاب کرده — دیگر ویزارد لازم نیست
    if (i.localOnly) return 'app'
    // اتصال ذخیره‌شده سالم است → برنامه. اگر پروب نامعلوم بود (null) هم برنامه —
    // فقط قطع‌بودنِ قطعی (false) در هر سطح (پورت یا MySQL) ویزارد را باز می‌کند
    if (i.infoActive && i.infoReachable !== false && i.infoDbOk !== false) return 'app'
    // هاست تنظیم نشده **یا** ذخیره شده ولی عملاً وصل نمی‌شود → صفحهٔ اطلاعات هاست
    return 'wizard'
  }

  // ---------- اندروید (LOCAL_MODE) ----------
  // مهم: این چک باید قبل از میان‌بر «کاربر ذخیره‌شده» باشد — وگرنه ارتقا از
  // نسخه‌های قدیمی (با حساب محلی ذخیره‌شده) هرگز صفحهٔ اطلاعات هاست را نمی‌بیند.
  // حالت دمو (استقرار ابری بدون دیتابیس) ویزارد هاست ندارد — لاگین ساده.
  if (i.localMode && !i.demoMode && (!i.hasHostConfig || i.hostConfigUnverified)) return 'wizard'

  // ---------- نسخهٔ وب / بقیهٔ حالت‌ها ----------
  if (i.setupFlag) return 'app'
  if (i.hasSavedUser) return 'app'
  if (i.localMode && !i.demoMode) return 'wizard' // دفاعی — دمو ویزارد ندارد؛ مستقیم صفحهٔ ورود
  return 'app' // وب تازه / دمو — بدون ویزارد
}
