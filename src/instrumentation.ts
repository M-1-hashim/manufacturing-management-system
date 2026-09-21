// Next.js instrumentation hook — یک‌بار هنگام بالا آمدن هاست اجرا می‌شود
// اینجا زمان‌بند کاپی احتیاطی خودکار + مدیریت اتصال (سوییچ خودکار آنلاین/آفلاین)
// راه‌اندازی می‌شود
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // روی پلتفرم‌های سرورلس (Vercel) فایل‌سیستم فقط‌خواندنی است —
    // کاپی احتیاطیِ فایل معنا ندارد (کاربر از «خروجی JSON» استفاده می‌کند)
    const isServerless = process.env.VERCEL === '1'
    if (!isServerless) {
      const { initBackupScheduler } = await import('@/lib/backup')
      initBackupScheduler()
    }
    if (isServerless) {
      // سرورلس: هر نمونهٔ سرد جدید باید قبل از اولین درخواست مطمئن شود
      // جدول‌های MySQL آماده‌اند (ping + ساخت جدول‌های گمشده — یک‌بار در هر نمونه).
      // قبل از startConnectionManager اجرا می‌شود تا هم‌زمانی پینگ رخ ندهد
      const { ensureWebHostTables } = await import('@/lib/connection-manager')
      await ensureWebHostTables().catch(() => {})
    }
    const { startConnectionManager } = await import('@/lib/connection-manager')
    startConnectionManager()
  }
}
