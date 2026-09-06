import { NextResponse } from 'next/server'
import { getFullStatus } from '@/lib/connection-manager'

/*
 * وضعیت اتصال برنامه به دیتابیس — برای بج هدر و کارت تنظیمات.
 * mode:
 *   host-mysql   → متصل به هاست (دیتا روی سرور ذخیره می‌شود)
 *   host-offline → هاست در دسترس نیست؛ برنامه روی کپی محلی دیتای سرور کار
 *                  می‌کند و بعد از وصل شدن خودکار همگام می‌شود
 *   local        → بدون هاست؛ دیتابیس محلی
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const status = await getFullStatus()
    return NextResponse.json({ ok: true, ...status })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: String((e as Error)?.message || e) },
      { status: 200 }
    )
  }
}
