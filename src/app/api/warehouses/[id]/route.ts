import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PUT /api/warehouses/[id] — ویرایش انبار
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const name = String(body.name ?? '').trim()
    const location = body.location ? String(body.location) : null
    if (!name) return NextResponse.json({ error: 'نام انبار الزامی است' }, { status: 400 })
    const existing = await db.warehouse.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'انبار یافت نشد' }, { status: 404 })
    const row = await db.warehouse.update({ where: { id }, data: { name, location } })
    return NextResponse.json(row)
  } catch (e) {
    console.error('warehouses PUT', e)
    return NextResponse.json({ error: 'خطا در ویرایش انبار' }, { status: 500 })
  }
}

// DELETE /api/warehouses/[id] — حذف (مسدود اگر گردش داشته باشد)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const count = await db.inventoryTransaction.count({ where: { warehouseId: id } })
    if (count > 0)
      return NextResponse.json(
        { error: 'این انبار دارای گردش انبار است و قابل حذف نیست' },
        { status: 400 }
      )
    const existing = await db.warehouse.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'انبار یافت نشد' }, { status: 404 })
    await db.warehouse.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('warehouses DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف انبار' }, { status: 500 })
  }
}
