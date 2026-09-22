import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { tallyAttendance, absenceDeduction } from '@/lib/salary-deduction'

// GET /api/salaries/preview?employeeId=&month=1403-01
// پیش‌نمایش کسر خودکار غیبت قبل از ثبت پرداخت معاش:
// معاش اساسی + روزهای غیبت/حاضری/رخصتی ماه شمسی + نرخ کسر روزانه + کسر کل + مبلغ پیشنهادی
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = String(searchParams.get('employeeId') ?? '')
    const month = String(searchParams.get('month') ?? '').trim()
    if (!employeeId) return NextResponse.json({ error: 'کارمند انتخاب نشده است' }, { status: 400 })
    if (!/^\d{4}-\d{2}$/.test(month))
      return NextResponse.json({ error: 'ماه باید به شکل 1403-01 باشد' }, { status: 400 })

    const employee = await db.employee.findUnique({ where: { id: employeeId } })
    if (!employee) return NextResponse.json({ error: 'کارمند یافت نشد' }, { status: 404 })

    const rows = await db.attendance.findMany({
      where: { employeeId },
      select: { status: true, date: true },
      take: 5000,
    })
    const stats = tallyAttendance(rows, month)

    const settingRow = await db.setting
      .findUnique({ where: { key: 'absentDeductionPerDay' } })
      .catch(() => null)
    const { perDay, deduction } = absenceDeduction(employee.salary, stats.absentDays, settingRow?.value)
    const suggestedAmount = Math.max(0, Math.round((employee.salary - deduction) * 100) / 100)

    // اگر برای این ماه قبلاً پرداخت ثبت شده باشد — هشدار پرداخت تکراری
    const paidRow = await db.salaryPayment.findFirst({
      where: { employeeId, month },
      select: { amount: true },
    })

    return NextResponse.json({
      salary: employee.salary,
      absentDays: stats.absentDays,
      presentDays: stats.presentDays,
      leaveDays: stats.leaveDays,
      rangeOk: stats.rangeOk,
      perDay,
      deduction,
      suggestedAmount,
      alreadyPaid: paidRow ? paidRow.amount : null,
    })
  } catch (e) {
    console.error('salaries preview GET', e)
    return NextResponse.json({ error: 'خطا در محاسبهٔ پیش‌نمایش معاش' }, { status: 500 })
  }
}
