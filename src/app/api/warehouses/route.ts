import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/warehouses — فهرست انبارها با تعداد گردش
export async function GET() {
  try {
    const rows = await db.warehouse.findMany({
      include: { _count: { select: { transactions: true } } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('warehouses GET', e)
    return NextResponse.json({ error: 'خطا در دریافت انبارها' }, { status: 500 })
  }
}

// POST /api/warehouses — انبار جدید
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = String(body.name ?? '').trim()
    const location = body.location ? String(body.location) : null
    if (!name) return NextResponse.json({ error: 'نام انبار الزامی است' }, { status: 400 })
    const row = await db.warehouse.create({ data: { name, location } })
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    console.error('warehouses POST', e)
    return NextResponse.json({ error: 'خطا در ثبت انبار' }, { status: 500 })
  }
}
