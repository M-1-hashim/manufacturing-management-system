import { NextResponse } from 'next/server'
import { getLiveRates } from '@/lib/exchange-rate'

// GET /api/exchange-rate — نرخ لحظه‌ای تبدیل ارز (USD↔AFN و PKR↔AFN) از API واقعی
// پارامتر ?refresh=1 → کش حافظه نادیده گرفته می‌شود و نرخ تازه گرفته می‌شود
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const force = url.searchParams.get('refresh') === '1'
    const rates = await getLiveRates(force)
    return NextResponse.json(rates)
  } catch (e) {
    console.error('exchange-rate GET', e)
    return NextResponse.json({ error: 'خطا در دریافت نرخ ارز' }, { status: 500 })
  }
}
