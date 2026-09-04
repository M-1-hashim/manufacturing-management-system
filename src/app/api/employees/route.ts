import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/employees — فهرست کارکنان با تعداد سوابق
export async function GET() {
  try {
    const rows = await db.employee.findMany({
      include: { _count: { select: { attendance: true, salaries: true } } },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('employees GET', e)
    return NextResponse.json({ error: 'خطا در دریافت کارکنان' }, { status: 500 })
  }
}

// POST /api/employees — کارمند جدید
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const name = String(body.name ?? '').trim()
    const position = String(body.position ?? '').trim()
    const phone = body.phone ? String(body.phone) : null
    const salary = Number(body.salary)
    const active = body.active === undefined ? true : Boolean(body.active)
    const hireDate = body.hireDate ? new Date(String(body.hireDate)) : undefined

    if (!name) return NextResponse.json({ error: 'نام کارمند الزامی است' }, { status: 400 })
    if (!position) return NextResponse.json({ error: 'وظیفه الزامی است' }, { status: 400 })
    if (!salary || isNaN(salary) || salary <= 0)
      return NextResponse.json({ error: 'حقوق باید بزرگ‌تر از صفر باشد' }, { status: 400 })
    if (hireDate && isNaN(hireDate.getTime()))
      return NextResponse.json({ error: 'تاریخ استخدام نامعتبر است' }, { status: 400 })

    const row = await db.employee.create({
      data: { name, position, phone, salary, active, ...(hireDate ? { hireDate } : {}) },
    })
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    console.error('employees POST', e)
    return NextResponse.json({ error: 'خطا در ثبت کارمند' }, { status: 500 })
  }
}
