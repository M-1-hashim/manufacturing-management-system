import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/customers — لیست مشتریان با تعداد بل‌ها
export async function GET() {
  try {
    const customers = await db.customer.findMany({
      include: { _count: { select: { sales: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(customers)
  } catch (e) {
    console.error('customers GET', e)
    return NextResponse.json({ error: 'خطا در دریافت مشتریان' }, { status: 500 })
  }
}

// POST /api/customers — ثبت مشتری جدید
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = String(body.name || '').trim()
    if (!name) {
      return NextResponse.json({ error: 'نام مشتری ضروری است' }, { status: 400 })
    }
    const type = ['retail', 'wholesale'].includes(body.type) ? body.type : 'retail'
    const customer = await db.customer.create({
      data: {
        name,
        phone: body.phone ? String(body.phone) : null,
        address: body.address ? String(body.address) : null,
        type,
        notes: body.notes ? String(body.notes) : null,
      },
      include: { _count: { select: { sales: true } } },
    })
    return NextResponse.json(customer, { status: 201 })
  } catch (e) {
    console.error('customers POST', e)
    return NextResponse.json({ error: 'خطا در ثبت مشتری' }, { status: 500 })
  }
}
