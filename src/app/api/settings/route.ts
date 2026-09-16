import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { logAudit } from '@/lib/audit'

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
    const body = (await req.json()) as Record<string, unknown>
    for (const [key, value] of Object.entries(body)) {
      // مقدار همیشه رشته ذخیره می‌شود — مقدار عددی/بولی از کلاینت 500 نمی‌دهد
      const v = String(value ?? '')
      await db.setting.upsert({ where: { key }, update: { value: v }, create: { key, value: v } })
    }
    // ثبت در گزارش فعالیت‌ها — بازیگر از نشست (middleware نقش ادمین/مدیر را تضمین می‌کند)
    const session = await getSessionFromRequest(req)
    await logAudit(
      session ? { uid: session.uid, username: session.username } : null,
      'update',
      'settings',
      undefined,
      `ذخیرهٔ تنظیمات: ${Object.keys(body).join('، ')}`
    )
    const rows = await db.setting.findMany()
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return NextResponse.json(out)
  } catch (e) {
    console.error('settings PUT', e)
    return NextResponse.json({ error: 'خطا در ذخیره تنظیمات' }, { status: 500 })
  }
}
