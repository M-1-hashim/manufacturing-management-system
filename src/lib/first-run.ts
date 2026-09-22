'use client'

/**
 * دروازهٔ راه‌اندازی اولیه — منطق محض تصمیم (قابل تست بدون مرورگر)
 *
 * قواعد (v۱.۰.۲۸ — سیاست «ورود فقط با کاربران هاست»):
 *  - ?setup=1  → همیشه ویزارد (درگاه اضطراری، همه‌جا)
 *  - دسکتاپ (ویندوز): حقیقت سرور ملاک است نه فلگ‌های قدیمی مرورگر:
 *      • سرور بدون mysql:// بالا آمده (هاست تنظیم/اعمال نشده) → ویزارد
 *        — تا هاست تنظیم نشود ورود محلی هم وجود ندارد (حتی با فلگ‌های نصب قبلی)
 *      • سرور با mysql:// بالا آمده → برنامه (صفحهٔ ورود با کاربران هاست)
 *        — اگر هاست موقتاً قطع باشد، ورود با «آینهٔ محلی» کار می‌کند (دیتای
 *        هاست روی دستگاه ذخیره شده است) و بنر قطعی در صفحهٔ ورود دیده می‌شود
 *      • فلگ‌های قدیمی (mfg-setup-local-mode / mfg-setup-completed) دیگر
 *        هیچ تاثیری روی دسکتاپ ندارند — نصب‌های قدیمی که «فقط این دستگاه»
 *        انتخاب کرده بودند هم بعد از ارتقا به صفحهٔ هاست می‌روند
 *  - اندروید (LOCAL_MODE):
 *      • بدون «اطلاعات هاست» یا آدرسِ ذخیره‌شدهٔ بدون تست موفق (verifiedAt ندارد)
 *        → ویزارد — حتی اگر کاربرِ قبلی ذخیره شده باشد (ارتقا از نسخه‌های قدیمی)
 *  - وب: بدون ویزارد (اتصال هاست از env هاست می‌آید)
 *
 * نکته: reachable و dbOk سه‌حالته‌اند — true (وصل شد)، false (قطعاً وصل
 * نمی‌شود)، null (نامعلوم/بررسی اجرا نشد). در تصمیم «app/wizard» دسکتاپ
 * دیگر نقش ندارند (حقیقت سرور کافی است)؛ فقط برای پیش‌پرکردن ویزارد و بنر
 * دلیل داخل ویزارد مصرف می‌شوند.
 */

export type FirstRunDecision = 'wizard' | 'app'

export interface FirstRunInput {
  /** ?setup=1 — درگاه اضطراری */
  forceSetup: boolean
  /** window.dbConnection موجود است یا ?desktop=1 (نسخهٔ ویندوز) */
  desktop: boolean
  /** حقیقت سرور: DATABASE_URL واقعاً mysql است؟ (null = endpoint نبود — نسخه‌های قدیمی) */
  serverConfigured: boolean | null
  /** هاست تنظیم شده ولی هرگز واقعاً وصل نشده (بدون هیچ اسنپ‌شات) — یعنی احتمالاً مقادیر غلط است */
  serverOfflineNeverSynced?: boolean
  /** فایل db-connection.txt خط اتصال فعال دارد */
  infoActive: boolean
  /** نتیجهٔ پروب TCP پورت: true وصل شد / false قطعاً وصل نمی‌شود / null نامعلوم */
  infoReachable: boolean | null
  /** نتیجهٔ پینگ واقعی MySQL (SELECT 1): true/false/null نامعلوم */
  infoDbOk: boolean | null
  /** فلگ «فقط این دستگاه» (mfg-setup-local-mode) — دیگر هیچ اثری ندارد */
  localOnly: boolean
  /** فلگ اتمام راه‌اندازی (mfg-setup-completed) — دیگر روی دسکتاپ اثری ندارد */
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
    // حقیقت سرور: بدون mysql:// یعنی هاست تنظیم نشده → قفل کامل؛ تا هاست
    // تنظیم نشود ویزارد بسته می‌شود (ورود محلی سرور هم ۴۵۱ می‌دهد)
    if (i.serverConfigured === false) return 'wizard'
    if (i.serverConfigured === true) {
      // تنظیم شده ولی هرگز وصل نشده (بدون اسنپ‌شات) → ویزارد با مقادیر فعلی
      // و بنر دلیل — کاربر ایراد را ببیند؛ ورود با آینهٔ دمو گمراه‌کننده است.
      // بعد از اولین اسنپ‌شات موفق (lastSnapshotAt ثبت شده)، قطعی موقت دیگر
      // ویزارد نمی‌شود — ورود با آینهٔ واقعی دیتای هاست انجام می‌شود.
      if (i.serverOfflineNeverSynced) return 'wizard'
      return 'app'
    }
    // endpoint وضعیت نبود (سرور قدیمی) → به فایل اتصال اعتماد می‌کنیم
    if (i.infoActive && i.infoReachable !== false && i.infoDbOk !== false) return 'app'
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
