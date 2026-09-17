'use client'

/**
 * دروازهٔ راه‌اندازی اولیه — منطق محض تصمیم (قابل تست بدون مرورگر)
 *
 * قواعد:
 *  - ?setup=1  → همیشه ویزارد (درگاه اضطراری، همه‌جا)
 *  - دسکتاپ (window.dbConnection موجود):
 *      • «فقط این دستگاه» انتخاب شده → برنامه (ویزارد مزاحم نمی‌شود)
 *      • اتصال ذخیره‌شده سالم (active و reachable ≠ false) → برنامه
 *      • بقیهٔ حالت‌ها (تنظیم نشده **یا** ذخیره‌شده ولی عملاً وصل نمی‌شود) → ویزارد
 *        — ویزارد با مقادیر فعلی پیش‌پر می‌شود تا کاربر فقط ایراد را اصلاح کند
 *  - اندروید (LOCAL_MODE):
 *      • بدون «اطلاعات هاست» یا آدرسِ ذخیره‌شدهٔ بدون تست موفق (verifiedAt ندارد)
 *        → ویزارد — حتی اگر کاربرِ قبلی ذخیره شده باشد (ارتقا از نسخه‌های قدیمی)
 *  - وب: بدون ویزارد (اتصال هاست از env هاست می‌آید)
 *
 * نکته: reachable سه‌حالته است — true (وصل شد)، false (قطعاً وصل نمی‌شود)،
 * null (نامعلوم/پروب اجرا نشد). فقط false ویزارد را باز می‌کند تا پروبِ
 * مشکوک باعث حلقهٔ ویزارد نشود.
 */

export type FirstRunDecision = 'wizard' | 'app'

export interface FirstRunInput {
  /** ?setup=1 — درگاه اضطراری */
  forceSetup: boolean
  /** window.dbConnection موجود است (نسخهٔ ویندوز) */
  desktop: boolean
  /** فایل db-connection.txt خط اتصال فعال دارد */
  infoActive: boolean
  /** نتیجهٔ پروب TCP: true وصل شد / false قطعاً وصل نمی‌شود / null نامعلوم */
  infoReachable: boolean | null
  /** فلگ «فقط این دستگاه» (mfg-setup-local-mode) */
  localOnly: boolean
  /** فلگ اتمام راه‌اندازی (mfg-setup-completed) */
  setupFlag: boolean
  /** نشست کاربر ذخیره شده (نسخهٔ وب / حساب محلی قدیمی) */
  hasSavedUser: boolean
  /** بیلد اندروید مستقل (NEXT_PUBLIC_LOCAL_MODE=1) */
  localMode: boolean
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
    // فقط قطع‌بودنِ قطعی (false) ویزارد را باز می‌کند
    if (i.infoActive && i.infoReachable !== false) return 'app'
    // هاست تنظیم نشده **یا** ذخیره شده ولی عملاً وصل نمی‌شود → صفحهٔ اطلاعات هاست
    return 'wizard'
  }

  // ---------- اندروید (LOCAL_MODE) ----------
  // مهم: این چک باید قبل از میان‌بر «کاربر ذخیره‌شده» باشد — وگرنه ارتقا از
  // نسخه‌های قدیمی (با حساب محلی ذخیره‌شده) هرگز صفحهٔ اطلاعات هاست را نمی‌بیند
  if (i.localMode && (!i.hasHostConfig || i.hostConfigUnverified)) return 'wizard'

  // ---------- نسخهٔ وب / بقیهٔ حالت‌ها ----------
  if (i.setupFlag) return 'app'
  if (i.hasSavedUser) return 'app'
  if (i.localMode) return 'wizard' // دفاعی — بالاتر پوشش داده شده
  return 'app' // وب تازه — بدون ویزارد
}
