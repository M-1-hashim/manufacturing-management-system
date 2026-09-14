import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/formulas — لیست تمام فورمولاها با محصول و مواد
export async function GET() {
  try {
    const rows = await db.formula.findMany({
      include: {
        product: true,
        items: { include: { rawMaterial: true } },
      },
      orderBy: [{ productId: 'asc' }, { version: 'desc' }],
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('formulas GET', e)
    return NextResponse.json({ error: 'خطا در دریافت فورمولاها' }, { status: 500 })
  }
}

// POST /api/formulas — ایجاد فورمولا جدید همراه با مواد
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const productId = typeof body.productId === 'string' ? body.productId : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const items = Array.isArray(body.items) ? body.items : []

    if (!productId || !name) {
      return NextResponse.json({ error: 'محصول و نام فورمولا الزامی است' }, { status: 400 })
    }
    if (items.length === 0) {
      return NextResponse.json({ error: 'حداقل یک ماده اولیه لازم است' }, { status: 400 })
    }
    for (const it of items) {
      if (!it?.rawMaterialId || !(Number(it.quantity) > 0)) {
        return NextResponse.json({ error: 'مقدار هر ماده باید بزرگ‌تر از صفر باشد' }, { status: 400 })
      }
    }
    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) {
      return NextResponse.json({ error: 'محصول یافت نشد' }, { status: 400 })
    }

    const sumQty = items.reduce((a: number, it) => a + (Number(it.quantity) || 0), 0)
    const outputQty = Number(body.outputQty) > 0 ? Number(body.outputQty) : 1

    const created = await db.formula.create({
      data: {
        productId,
        name,
        version: Number(body.version) > 0 ? Math.floor(Number(body.version)) : 1,
        outputQty,
        laborCost: Number(body.laborCost) || 0,
        overheadCost: Number(body.overheadCost) || 0,
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
        isActive: body.isActive !== false,
        items: {
          create: items.map((it) => ({
            rawMaterialId: String(it.rawMaterialId),
            quantity: Number(it.quantity) || 0,
            percentage:
              sumQty > 0
                ? Math.round(((Number(it.quantity) || 0) / sumQty) * 100 * 100) / 100
                : null,
          })),
        },
      },
      include: { product: true, items: { include: { rawMaterial: true } } },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('formulas POST', e)
    return NextResponse.json({ error: 'خطا در ایجاد فورمولا' }, { status: 500 })
  }
}
