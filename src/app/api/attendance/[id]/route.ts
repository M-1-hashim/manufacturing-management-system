import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PUT /api/attendance/[id] — ویرایش رکورد حضور
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const existing = await db.attendance.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'رکورد یافت نشد' }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.employeeId !== undefined && body.employeeId !== existing.employeeId) {
      const emp = await db.employee.findUnique({ where: { id: String(body.employeeId) } })
      if (!emp) return NextResponse.json({ error: 'کارمند یافت نشد' }, { status: 404 })
      data.employeeId = String(body.employeeId)
    }
    if (body.status !== undefined) {
      const status = String(body.status)
      if (!['present', 'absent', 'leave'].includes(status))
        return NextResponse.json({ error: 'وضعیت نامعتبر است' }, { status: 400 })
      data.status = status
    }
    if (body.date !== undefined && body.date !== null && body.date !== '') {
      const date = new Date(String(body.date))
      if (isNaN(date.getTime()))
        return NextResponse.json({ error: 'تاریخ نامعتبر است' }, { status: 400 })
      data.date = date
    }
    if (body.shift !== undefined) data.shift = body.shift ? String(body.shift) : null
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null

    const row = await db.attendance.update({
      where: { id },
      data,
      include: { employee: { select: { name: true, position: true } } },
    })
    return NextResponse.json(row)
  } catch (e) {
    console.error('attendance PUT', e)
    return NextResponse.json({ error: 'خطا در ویرایش رکورد حضور' }, { status: 500 })
  }
}

// DELETE /api/attendance/[id] — حذف رکورد حضور
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.attendance.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'رکورد یافت نشد' }, { status: 404 })
    await db.attendance.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('attendance DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف رکورد حضور' }, { status: 500 })
  }
}
