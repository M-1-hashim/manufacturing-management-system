import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tallyAttendance, absenceDeduction } from '@/lib/salary-deduction'

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
      return NextResponse.json({ error: 'مبلغ باید زیادتر از صفر باشد' }, { status: 400 })
    if (body.date && Number.isNaN(new Date(String(body.date)).getTime()))
      return NextResponse.json({ error: 'تاریخ نامعتبر است' }, { status: 400 })

    const employee = await db.employee.findUnique({ where: { id: employeeId } })
    if (!employee) return NextResponse.json({ error: 'کارمند یافت نشد' }, { status: 404 })

    // کسر خودکار غیبت — روزهای «غایب» ثبت‌شدهٔ حاضری در همین ماه شمسی شمرده می‌شوند و
    // به مقدار تنظیم‌شده (absentDeductionPerDay؛ خالی → ۱/۳۰ معاش) از معاش کم می‌شود.
    // applyDeduction=false → کسر صفر می‌ماند (پرداخت کامل دستی). روزهای غیبت همیشه ثبت می‌شوند.
    const attRows = await db.attendance.findMany({
      where: { employeeId },
      select: { status: true, date: true },
      take: 5000,
    })
    const stats = tallyAttendance(attRows, month)
    const settingRow = await db.setting
      .findUnique({ where: { key: 'absentDeductionPerDay' } })
      .catch(() => null)
    const applyDeduction = body.applyDeduction !== false
    const { deduction } = absenceDeduction(employee.salary, stats.absentDays, settingRow?.value)

    const row = await db.salaryPayment.create({
      data: {
        employeeId,
        month,
        amount,
        absentDays: stats.absentDays,
        deduction: applyDeduction ? deduction : 0,
        date,
        notes,
      },
      include: { employee: { select: { name: true } } },
    })
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    console.error('salaries POST', e)
    return NextResponse.json({ error: 'خطا در ثبت پرداخت معاش' }, { status: 500 })
  }
}
