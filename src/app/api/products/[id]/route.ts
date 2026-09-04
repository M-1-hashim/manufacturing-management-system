import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/products/[id] — یک محصول همراه دسته‌بندی
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const product = await db.product.findUnique({
      where: { id },
      include: { category: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'محصول یافت نشد' }, { status: 404 })
    }
    return NextResponse.json(product)
  } catch (e) {
    console.error('product GET', e)
    return NextResponse.json({ error: 'خطا در دریافت محصول' }, { status: 500 })
  }
}

// PUT /api/products/[id] — ویرایش محصول (فیلدهای ارسال‌شده به‌روزرسانی می‌شوند)
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const existing = await db.product.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'محصول یافت نشد' }, { status: 404 })
    }

    const body = (await req.json()) as Record<string, unknown>
    const data: Record<string, unknown> = {}

    if ('name' in body) {
      const v = String(body.name ?? '').trim()
      if (!v) return NextResponse.json({ error: 'نام محصول الزامی است' }, { status: 400 })
      data.name = v
    }
    if ('code' in body) {
      const v = String(body.code ?? '').trim()
      if (!v) return NextResponse.json({ error: 'کود محصول الزامی است' }, { status: 400 })
      data.code = v
    }
    if ('categoryId' in body) {
      const cid = body.categoryId ? String(body.categoryId) : ''
      if (cid) {
        const cat = await db.productCategory.findUnique({ where: { id: cid } })
        if (!cat) return NextResponse.json({ error: 'دسته‌بندی یافت نشد' }, { status: 400 })
        data.categoryId = cat.id
      } else {
        data.categoryId = null
      }
    }
    if ('unit' in body) data.unit = String(body.unit ?? 'عدد')
    if ('barcode' in body) data.barcode = body.barcode ? String(body.barcode) : null
    if ('description' in body) data.description = body.description ? String(body.description) : null

    const numFields = ['salePrice', 'wholesalePrice', 'costPrice', 'minStock', 'stock'] as const
    for (const f of numFields) {
      if (f in body) {
        const n = Number(body[f])
        if (isNaN(n) || n < 0) {
          return NextResponse.json({ error: 'مقادیر عددی نمی‌توانند منفی باشند' }, { status: 400 })
        }
        data[f] = n
      }
    }
    if ('active' in body) data.active = !!body.active

    const updated = await db.product.update({
      where: { id },
      data,
      include: { category: true },
    })
    return NextResponse.json(updated)
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'کود تکراری است؛ کود دیگری انتخاب کنید' }, { status: 400 })
    }
    console.error('product PUT', e)
    return NextResponse.json({ error: 'خطا در ویرایش محصول' }, { status: 500 })
  }
}

// DELETE /api/products/[id] — حذف محصول (اگر سوابق فروش/فرمول/تولید نداشته باشد)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const [saleItems, formulas, orders] = await Promise.all([
      db.saleItem.count({ where: { productId: id } }),
      db.formula.count({ where: { productId: id } }),
      db.productionOrder.count({ where: { productId: id } }),
    ])
    if (saleItems > 0 || formulas > 0 || orders > 0) {
      return NextResponse.json(
        { error: 'قابل حذف نیست؛ سوابق فروش/تولید دارد' },
        { status: 400 }
      )
    }
    await db.product.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('product DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف محصول' }, { status: 500 })
  }
}
