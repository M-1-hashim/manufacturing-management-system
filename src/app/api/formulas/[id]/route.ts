import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

interface ItemInput {
  rawMaterialId: string
  quantity: number
}

function buildItemData(items: ItemInput[]) {
  const sumQty = items.reduce((a, it) => a + (Number(it.quantity) || 0), 0)
  return items.map((it) => ({
    rawMaterialId: String(it.rawMaterialId),
    quantity: Number(it.quantity) || 0,
    percentage:
      sumQty > 0
        ? Math.round(((Number(it.quantity) || 0) / sumQty) * 100 * 100) / 100
        : null,
  }))
}

// PUT /api/formulas/[id] — ویرایش فرمول یا ساخت نسخه جدید (createNewVersion)
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json()
    const existing = await db.formula.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'فرمول یافت نشد' }, { status: 404 })
    }

    const rawItems = Array.isArray(body.items) ? body.items : null
    if (rawItems) {
      for (const it of rawItems) {
        if (!it?.rawMaterialId || !(Number(it.quantity) > 0)) {
          return NextResponse.json({ error: 'مقدار هر ماده باید بزرگ‌تر از صفر باشد' }, { status: 400 })
        }
      }
    }

    // ---- ساخت نسخه جدید برای همین محصول ----
    if (body.createNewVersion === true) {
      const maxAgg = await db.formula.aggregate({
        where: { productId: existing.productId },
        _max: { version: true },
      })
      const nextVersion = (maxAgg._max.version ?? 0) + 1
      const itemData = buildItemData(
        rawItems && rawItems.length > 0
          ? rawItems
          : (await db.formulaItem.findMany({ where: { formulaId: id } })).map((i) => ({
              rawMaterialId: i.rawMaterialId,
              quantity: i.quantity,
            })),
      )
      if (itemData.length === 0) {
        return NextResponse.json({ error: 'حداقل یک ماده اولیه لازم است' }, { status: 400 })
      }

      const created = await db.$transaction(async (tx) => {
        await tx.formula.update({ where: { id }, data: { isActive: false } })
        return tx.formula.create({
          data: {
            productId: existing.productId,
            name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
            version: nextVersion,
            outputQty: Number(body.outputQty) > 0 ? Number(body.outputQty) : existing.outputQty,
            laborCost: body.laborCost !== undefined ? Number(body.laborCost) || 0 : existing.laborCost,
            overheadCost: body.overheadCost !== undefined ? Number(body.overheadCost) || 0 : existing.overheadCost,
            notes: body.notes !== undefined ? (body.notes?.trim() ? body.notes.trim() : null) : existing.notes,
            isActive: true,
            items: { create: itemData },
          },
          include: { product: true, items: { include: { rawMaterial: true } } },
        })
      })
      return NextResponse.json(created)
    }

    // ---- ویرایش همان فرمول ----
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name
    const outputQty = Number(body.outputQty) > 0 ? Number(body.outputQty) : existing.outputQty
    const laborCost = body.laborCost !== undefined ? Number(body.laborCost) || 0 : existing.laborCost
    const overheadCost = body.overheadCost !== undefined ? Number(body.overheadCost) || 0 : existing.overheadCost
    const notes = body.notes !== undefined ? (body.notes?.trim() ? body.notes.trim() : null) : existing.notes
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : existing.isActive

    const updated = await db.$transaction(async (tx) => {
      await tx.formula.update({
        where: { id },
        data: { name, outputQty, laborCost, overheadCost, notes, isActive },
      })
      if (rawItems) {
        await tx.formulaItem.deleteMany({ where: { formulaId: id } })
        if (rawItems.length > 0) {
          await tx.formulaItem.createMany({
            data: buildItemData(rawItems).map((d) => ({ ...d, formulaId: id })),
          })
        }
      }
      return tx.formula.findUnique({
        where: { id },
        include: { product: true, items: { include: { rawMaterial: true } } },
      })
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('formulas PUT', e)
    return NextResponse.json({ error: 'خطا در ذخیره فرمول' }, { status: 500 })
  }
}

// DELETE /api/formulas/[id] — حذف فرمول (اگر در تولید استفاده نشده باشد)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const existing = await db.formula.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'فرمول یافت نشد' }, { status: 404 })
    }
    const ordersCount = await db.productionOrder.count({ where: { formulaId: id } })
    if (ordersCount > 0) {
      return NextResponse.json(
        { error: 'این فرمول در سفارش‌های تولید استفاده شده است و قابل حذف نیست. برای تغییر، نسخه جدید بسازید.' },
        { status: 400 },
      )
    }
    await db.formula.delete({ where: { id } }) // مواد فرمول به‌صورت زنجیره‌ای حذف می‌شوند
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('formulas DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف فرمول' }, { status: 500 })
  }
}
