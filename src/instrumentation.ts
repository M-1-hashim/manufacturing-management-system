// Next.js instrumentation hook — یک‌بار هنگام بالا آمدن هاست اجرا می‌شود
// اینجا زمان‌بند کاپی احتیاطی خودکار + مدیریت اتصال (سوییچ خودکار آنلاین/آفلاین)
// راه‌اندازی می‌شود
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initBackupScheduler } = await import('@/lib/backup')
    initBackupScheduler()
    const { startConnectionManager } = await import('@/lib/connection-manager')
    startConnectionManager()
  }
}
