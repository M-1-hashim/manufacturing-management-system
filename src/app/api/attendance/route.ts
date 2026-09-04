import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/attendance?employeeId=&days= — سابقه حضور و غیاب
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const employeeId = searchParams.get('employeeId') || undefined
    const days = Number(searchParams.get('days')) || 7
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const rows = await db.attendance.findMany({
      where: {
        date: { gte: since },
        ...(employeeId ? { employeeId } : {}),
      },
      include: { employee: { select: { name: true, position: true } } },
      orderBy: { date: 'desc' },
      take: 500,
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('attendance GET', e)
    return NextResponse.json({ error: 'خطا در دریافت حضور و غیاب' }, { status: 500 })
  }
}

// POST /api/attendance — ثبت حضور/غیاب
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const employeeId = String(body.employeeId ?? '')
    const status = String(body.status ?? '')
    const date = body.date ? new Date(String(body.date)) : new Date()
    const shift = body.shift ? String(body.shift) : null
    const notes = body.notes ? String(body.notes) : null

    if (!employeeId)
      return NextResponse.json({ error: 'کارمند انتخاب نشده است' }, { status: 400 })
    if (!['present', 'absent', 'leave'].includes(status))
      return NextResponse.json({ error: 'وضعیت نامعتبر است' }, { status: 400 })
    if (isNaN(date.getTime()))
      return NextResponse.json({ error: 'تاریخ نامعتبر است' }, { status: 400 })

    const employee = await db.employee.findUnique({ where: { id: employeeId } })
    if (!employee) return NextResponse.json({ error: 'کارمند یافت نشد' }, { status: 404 })

    const row = await db.attendance.create({
      data: { employeeId, date, status, shift, notes },
      include: { employee: { select: { name: true, position: true } } },
    })
    return NextResponse.json(row, { status: 201 })
  } catch (e) {
    console.error('attendance POST', e)
    return NextResponse.json({ error: 'خطا در ثبت حضور و غیاب' }, { status: 500 })
  }
}
