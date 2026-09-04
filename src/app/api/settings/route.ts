import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/settings — همه تنظیمات
export async function GET() {
  try {
    const rows = await db.setting.findMany()
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return NextResponse.json(out)
  } catch (e) {
    console.error('settings GET', e)
    return NextResponse.json({}, { status: 200 })
  }
}

// PUT /api/settings — ذخیره چند تنظیم باهم { key: value, ... }
export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Record<string, string>
    for (const [key, value] of Object.entries(body)) {
      await db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
    }
    const rows = await db.setting.findMany()
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return NextResponse.json(out)
  } catch (e) {
    console.error('settings PUT', e)
    return NextResponse.json({ error: 'خطا در ذخیره تنظیمات' }, { status: 500 })
  }
}
