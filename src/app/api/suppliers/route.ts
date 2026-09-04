import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/suppliers — تأمین‌کننده‌ها همراه تعداد مواد خام
export async function GET() {
  try {
    const rows = await db.supplier.findMany({
      include: { _count: { select: { materials: true } } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('suppliers GET', e)
    return NextResponse.json({ error: 'خطا در دریافت تأمین‌کننده‌ها' }, { status: 500 })
  }
}

// POST /api/suppliers — ثبت تأمین‌کننده جدید
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'نام تأمین‌کننده الزامی است' }, { status: 400 })
    }
    const created = await db.supplier.create({
      data: {
        name,
        phone: body.phone ? String(body.phone) : null,
        address: body.address ? String(body.address) : null,
        notes: body.notes ? String(body.notes) : null,
      },
      include: { _count: { select: { materials: true } } },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('suppliers POST', e)
    return NextResponse.json({ error: 'خطا در ثبت تأمین‌کننده' }, { status: 500 })
  }
}
