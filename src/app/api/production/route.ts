import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const ORDER_INCLUDE = {
  formula: { include: { items: { include: { rawMaterial: true } } } },
  product: true,
} as const

// GET /api/production?status= — لیست سفارش‌های تولید
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || undefined
    const rows = await db.productionOrder.findMany({
      where: status ? { status } : undefined,
      include: ORDER_INCLUDE,
      orderBy: { startDate: 'desc' },
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('production GET', e)
    return NextResponse.json({ error: 'خطا در دریافت سفارش‌های تولید' }, { status: 500 })
  }
}

// POST /api/production — ثبت سفارش تولید جدید (محاسبه مصارف بر اساس فورمولا)
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const formulaId = typeof body.formulaId === 'string' ? body.formulaId : ''
    const quantity = Number(body.quantity)
    if (!formulaId) {
      return NextResponse.json({ error: 'انتخاب فورمولا الزامی است' }, { status: 400 })
    }
    if (!(quantity > 0)) {
      return NextResponse.json({ error: 'مقدار تولید باید زیادتر از صفر باشد' }, { status: 400 })
    }
    if (body.startDate && Number.isNaN(new Date(body.startDate).getTime())) {
      return NextResponse.json({ error: 'تاریخ نامعتبر است' }, { status: 400 })
    }

    const formula = await db.formula.findUnique({
      where: { id: formulaId },
      include: { items: { include: { rawMaterial: true } }, product: true },
    })
    if (!formula) {
      return NextResponse.json({ error: 'فورمولا یافت نشد' }, { status: 400 })
    }
    if (formula.items.length === 0) {
      return NextResponse.json({ error: 'این فورمولا هیچ ماده اولیه ندارد' }, { status: 400 })
    }

    // ضریب تولید: مقدار برنامه نسبت به خروجی یک بچ فورمولا
    const scale = quantity / (formula.outputQty || 1)
    const materialCost = formula.items.reduce(
      (a, i) => a + i.quantity * scale * i.rawMaterial.purchasePrice,
      0,
    )
    const laborCost = formula.laborCost * scale
    const overheadCost = formula.overheadCost * scale

    // نمبر سفارش یکتا
    let orderNumber = `PR-${Date.now().toString().slice(-8)}`
    const clash = await db.productionOrder.findUnique({ where: { orderNumber } })
    if (clash) {
      orderNumber = `PR-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`
    }

    const created = await db.productionOrder.create({
      data: {
        orderNumber,
        formulaId,
        productId: formula.productId,
        quantity,
        status: 'in_progress',
        materialCost: Math.round(materialCost * 100) / 100,
        laborCost: Math.round(laborCost * 100) / 100,
        overheadCost: Math.round(overheadCost * 100) / 100,
        startDate: body.startDate ? new Date(body.startDate) : new Date(),
        notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      },
      include: ORDER_INCLUDE,
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('production POST', e)
    return NextResponse.json({ error: 'خطا در ثبت سفارش تولید' }, { status: 500 })
  }
}
