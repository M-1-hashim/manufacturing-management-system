import { NextResponse } from 'next/server'
import { checkNow, triggerSyncNow, triggerSnapshotNow, getState } from '@/lib/connection-manager'

/*
 * اکشن‌های دستی همگام‌سازی/اتصال — از کارت تنظیمات:
 *   { action: 'check' }        → بررسی فوری اتصال به هاست
 *   { action: 'sync-now' }     → آفلاین: تلاش برای اتصال + همگام‌سازی
 *                                آنلاین: اسنپ‌شات تازه از سرور به محلی
 *   { action: 'snapshot-now' } → کپی کامل دیتای سرور روی دستگاه (فقط آنلاین)
 */

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    switch (body.action) {
      case 'check': {
        await checkNow()
        return NextResponse.json({ ok: true, status: getState() })
      }
      case 'sync-now': {
        const r = await triggerSyncNow()
        return NextResponse.json({ ok: !r.error, ...r, status: getState() })
      }
      case 'snapshot-now': {
        const r = await triggerSnapshotNow()
        return NextResponse.json({ ok: r.ok, ...r, status: getState() })
      }
      default:
        return NextResponse.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message || e) },
      { status: 200 }
    )
  }
}
