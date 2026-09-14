import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

// PUT /api/customers/[id] — تصحیح مشتری
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const body = await req.json()
    const name = String(body.name || '').trim()
    if (!name) {
      return NextResponse.json({ error: 'نام مشتری ضروری است' }, { status: 400 })
    }
    const existing = await db.customer.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'مشتری یافت نشد' }, { status: 404 })
    const type = ['retail', 'wholesale'].includes(body.type) ? body.type : existing.type
    const customer = await db.customer.update({
      where: { id },
      data: {
        name,
        phone: body.phone ? String(body.phone) : null,
        address: body.address ? String(body.address) : null,
        type,
        notes: body.notes ? String(body.notes) : null,
      },
      include: { _count: { select: { sales: true } } },
    })
    return NextResponse.json(customer)
  } catch (e) {
    console.error('customers PUT [id]', e)
    return NextResponse.json({ error: 'خطا در تصحیح مشتری' }, { status: 500 })
  }
}

// DELETE /api/customers/[id] — حذف مشتری (اگر بل داشته باشد ممنوع)
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const existing = await db.customer.findUnique({
      where: { id },
      include: { _count: { select: { sales: true } } },
    })
    if (!existing) return NextResponse.json({ error: 'مشتری یافت نشد' }, { status: 404 })
    if (existing._count.sales > 0) {
      return NextResponse.json(
        { error: 'این مشتری بل فروش دارد و قابل حذف نیست' },
        { status: 400 }
      )
    }
    await db.customer.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('customers DELETE [id]', e)
    return NextResponse.json({ error: 'خطا در حذف مشتری' }, { status: 500 })
  }
}
