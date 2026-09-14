import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PUT /api/categories/[id] — تغییر نام دسته‌بندی
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = (await req.json()) as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'نام کتگوری الزامی است' }, { status: 400 })
    }
    const existing = await db.productCategory.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'کتگوری یافت نشد' }, { status: 404 })
    }
    const updated = await db.productCategory.update({
      where: { id },
      data: { name },
      include: { _count: { select: { products: true } } },
    })
    return NextResponse.json(updated)
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'نام کتگوری تکراری است' }, { status: 400 })
    }
    console.error('category PUT', e)
    return NextResponse.json({ error: 'خطا در تصحیح کتگوری' }, { status: 500 })
  }
}

// DELETE /api/categories/[id] — حذف دسته‌بندی (اگر محصولی در آن نباشد)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const existing = await db.productCategory.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'کتگوری یافت نشد' }, { status: 404 })
    }
    if (existing._count.products > 0) {
      return NextResponse.json(
        { error: 'قابل حذف نیست؛ محصولات در این کتگوری ثبت شده‌اند' },
        { status: 400 }
      )
    }
    await db.productCategory.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('category DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف کتگوری' }, { status: 500 })
  }
}
