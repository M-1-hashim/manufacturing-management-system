import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/salaries?employeeId= — پرداخت‌های معاش
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId') || undefined
    const rows = await db.salaryPayment.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: { employee: { select: { name: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('salaries GET', e)
    return NextResponse.json({ error: 'خطا در دریافت معاشات' }, { status: 500 })
  }
}

// POST /api/salaries — ثبت پرداخت معاش
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const employeeId = String(body.employeeId ?? '')
    const month = String(body.month ?? '').trim()
    const amount = Number(body.amount)
    const date = body.date ? new Date(String(body.date)) : new Date()
    const notes = body.notes ? String(body.notes) : null

    if (!employeeId)
      return NextResponse.json({ error: 'کارمند انتخاب نشده است' }, { status: 400 })
    if (!/^\d{4}-\d{2}$/.test(month))
      return NextResponse.json(
        { error: 'ماه باید به شکل 1403-01 باشد' },
        { status: 400 }
      )
    if (!amount || isNaN(amount) || amount <= 0)
      return NextResponse.json({ error: 'مبلغ باید بزرگ‌تر از صفر باشد' }, { status: 400 })

    const employee = await db.employee.findUnique({ where: { id: employeeId } })
    if (!employee) return NextResponse.json({ error: 'کارمند یافت نشد' }, { status: 404 })

    const row = await db.salaryPayment.create({
      data: { employeeId, month, amount, date, notes },
      include: { employee: { select: { name: true } } },
    })
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    console.error('salaries POST', e)
    return NextResponse.json({ error: 'خطا در ثبت پرداخت معاش' }, { status: 500 })
  }
}
