import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PUT /api/employees/[id] — تصحیح کارمند
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const existing = await db.employee.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'کارمند یافت نشد' }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) data.name = String(body.name).trim()
    if (body.position !== undefined) data.position = String(body.position).trim()
    if (body.phone !== undefined) data.phone = body.phone ? String(body.phone) : null
    if (body.salary !== undefined) {
      const salary = Number(body.salary)
      if (!salary || isNaN(salary) || salary <= 0)
        return NextResponse.json({ error: 'معاش باید بزرگ‌تر از صفر باشد' }, { status: 400 })
      data.salary = salary
    }
    if (body.hireDate !== undefined && body.hireDate !== null && body.hireDate !== '') {
      const hireDate = new Date(String(body.hireDate))
      if (isNaN(hireDate.getTime()))
        return NextResponse.json({ error: 'تاریخ استخدام نامعتبر است' }, { status: 400 })
      data.hireDate = hireDate
    }
    if (body.active !== undefined) data.active = Boolean(body.active)

    if (data.name === '')
      return NextResponse.json({ error: 'نام کارمند الزامی است' }, { status: 400 })
    if (data.position === '')
      return NextResponse.json({ error: 'وظیفه الزامی است' }, { status: 400 })

    const row = await db.employee.update({ where: { id }, data })
    return NextResponse.json(row)
  } catch (e) {
    console.error('employees PUT', e)
    return NextResponse.json({ error: 'خطا در تصحیح کارمند' }, { status: 500 })
  }
}

// DELETE /api/employees/[id] — حذف (مسدود اگر سوابق حضور/معاش داشته باشد)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const [attCount, salCount] = await Promise.all([
      db.attendance.count({ where: { employeeId: id } }),
      db.salaryPayment.count({ where: { employeeId: id } }),
    ])
    if (attCount > 0 || salCount > 0)
      return NextResponse.json(
        { error: 'سوابق دارد؛ آن را غیرفعال کنید' },
        { status: 400 }
      )
    const existing = await db.employee.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'کارمند یافت نشد' }, { status: 404 })
    await db.employee.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('employees DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف کارمند' }, { status: 500 })
  }
}
