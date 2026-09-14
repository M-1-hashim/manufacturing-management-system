import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PUT /api/suppliers/[id] — تصحیح تأمین‌کننده
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const existing = await db.supplier.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'تأمین‌کننده یافت نشد' }, { status: 404 })
    }
    const body = (await req.json()) as Record<string, unknown>
    const data: Record<string, unknown> = {}
    if ('name' in body) {
      const v = String(body.name ?? '').trim()
      if (!v) return NextResponse.json({ error: 'نام تأمین‌کننده الزامی است' }, { status: 400 })
      data.name = v
    }
    if ('phone' in body) data.phone = body.phone ? String(body.phone) : null
    if ('address' in body) data.address = body.address ? String(body.address) : null
    if ('notes' in body) data.notes = body.notes ? String(body.notes) : null

    const updated = await db.supplier.update({
      where: { id },
      data,
      include: { _count: { select: { materials: true } } },
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('supplier PUT', e)
    return NextResponse.json({ error: 'خطا در تصحیح تأمین‌کننده' }, { status: 500 })
  }
}

// DELETE /api/suppliers/[id] — حذف تأمین‌کننده (اگر ماده خام ثبت نشده باشد)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const existing = await db.supplier.findUnique({
      where: { id },
      include: { _count: { select: { materials: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'تأمین‌کننده یافت نشد' }, { status: 404 })
    }
    if (existing._count.materials > 0) {
      return NextResponse.json(
        { error: 'قابل حذف نیست؛ مواد خام به این تأمین‌کننده ثبت شده است' },
        { status: 400 }
      )
    }
    await db.supplier.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('supplier DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف تأمین‌کننده' }, { status: 500 })
  }
}
