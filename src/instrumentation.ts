// Next.js instrumentation hook — یک‌بار هنگام بالا آمدن سرور اجرا می‌شود
// اینجا زمان‌بند پشتیبان‌گیری خودکار راه‌اندازی می‌شود
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initBackupScheduler } = await import('@/lib/backup')
    initBackupScheduler()
  }
}
