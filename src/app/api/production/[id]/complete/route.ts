import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { logAudit } from '@/lib/audit'

// خطای کنترل‌شده برای بازگرداندن کد وضعیت از داخل تراکنش
class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * POST /api/production/[id]/complete
 * تکمیل سفارش تولید به‌صورت اتمیک:
 *  1) کسر مواد اولیه از انبار + ثبت تراکنش خروجی برای هر ماده
 *  2) علاوه کردن «مقدار خالص» محصول (تولید منهای ضایعات) به انبار + ثبت تراکنش ورودی
 *     — ضایعات هرگز به گدام اضافه نمی‌شود، فقط ثبت می‌گردد
 *  3) ثبت ضایعات، مصارفی نهایی، وضعیت QC و تاریخ پایان
 *  4) تجدید قیمت تمام‌شده محصول (costPrice) بر اساس مقدار خالص
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const producedQty = Number(body.producedQty)
    const wasteQty = body.wasteQty !== undefined && body.wasteQty !== null && Number(body.wasteQty) >= 0
      ? Number(body.wasteQty)
      : 0
    if (!Number.isFinite(producedQty) || producedQty <= 0) {
      return NextResponse.json({ error: 'مقدار تولیدشده باید زیادتر از صفر باشد' }, { status: 400 })
    }
    if (!Number.isFinite(wasteQty) || wasteQty > producedQty) {
      return NextResponse.json({ error: 'مقدار ضایعات نمی‌تواند زیادتر از مقدار تولید باشد' }, { status: 400 })
    }
    // مقدار خالص قابل ورود به گدام = تولید کل منهای ضایعات
    const goodQty = Math.round((producedQty - wasteQty) * 10000) / 10000

    const updated = await db.$transaction(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id },
        include: {
          product: true,
          formula: { include: { items: { include: { rawMaterial: true } } } },
        },
      })
      if (!order) throw new ApiError(404, 'سفارش تولید یافت نشد')
      if (order.status === 'completed') throw new ApiError(400, 'این سفارش قبلاً تکمیل شده است')
      if (order.status === 'cancelled') throw new ApiError(400, 'این سفارش لغو شده است')

      // ضریب: مقدار واقعی تولید نسبت به خروجی یک بچ فورمولا
      const multiplier = producedQty / (order.formula.outputQty || 1)

      // 1) کسر مواد اولیه + تراکنش خروجی انبار برای هر ماده
      for (const item of order.formula.items) {
        const qty = item.quantity * multiplier
        if (qty <= 0) continue
        await tx.rawMaterial.update({
          where: { id: item.rawMaterialId },
          data: { stock: { decrement: qty } },
        })
        await tx.inventoryTransaction.create({
          data: {
            type: 'out',
            itemType: 'material',
            itemId: item.rawMaterialId,
            itemName: item.rawMaterial.name,
            unit: item.rawMaterial.unit,
            quantity: Math.round(qty * 10000) / 10000,
            reference: order.orderNumber,
            notes: 'مصرف تولید',
          },
        })
      }

      // 2) فقط مقدار خالص (بدون ضایعات) به گدام اضافه می‌شود
      if (goodQty > 0) {
        await tx.product.update({
          where: { id: order.productId },
          data: { stock: { increment: goodQty } },
        })
        await tx.inventoryTransaction.create({
          data: {
            type: 'in',
            itemType: 'product',
            itemId: order.productId,
            itemName: order.product.name,
            unit: order.product.unit,
            quantity: goodQty,
            reference: order.orderNumber,
            notes: wasteQty > 0 ? `تولید — خالص (${wasteQty} ضایعات ثبت شد، به انبار اضافه نشد)` : 'تولید',
          },
        })
      }

      // 3) مصارفی نهایی بر اساس مقدار واقعی تولیدشده
      const materialCost = order.formula.items.reduce(
        (a, i) => a + i.quantity * multiplier * i.rawMaterial.purchasePrice,
        0,
      )
      const laborCost = order.formula.laborCost * multiplier
      const overheadCost = order.formula.overheadCost * multiplier
      const totalCost = materialCost + laborCost + overheadCost

      const qcStatus =
        typeof body.qcStatus === 'string' && ['passed', 'failed', 'pending'].includes(body.qcStatus)
          ? body.qcStatus
          : 'pending'

      const result = await tx.productionOrder.update({
        where: { id },
        data: {
          status: 'completed',
          producedQty,
          wasteQty,
          qcStatus,
          qcNotes: typeof body.qcNotes === 'string' && body.qcNotes.trim() ? body.qcNotes.trim() : null,
          endDate: new Date(),
          materialCost: Math.round(materialCost * 100) / 100,
          laborCost: Math.round(laborCost * 100) / 100,
          overheadCost: Math.round(overheadCost * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
        },
        include: {
          product: true,
          formula: { include: { items: { include: { rawMaterial: true } } } },
        },
      })

      // 4) قیمت تمام‌شده واحد = مصرف کل ÷ مقدار خالص (ضایعات به قیمت اقلام سالم توزیع می‌شود)
      if (goodQty > 0) {
        await tx.product.update({
          where: { id: order.productId },
          data: { costPrice: Math.round((totalCost / goodQty) * 100) / 100 },
        })
      }

      return result
    })

    const session = await getSessionFromRequest(req)
    const goodNote = goodQty > 0 ? `${goodQty} ${updated.product.unit} خالص به گدام اضافه شد` : 'هیچ مقدار خالصی به گدام اضافه نشد'
    await logAudit(session, 'complete', 'production', id, `تکمیل سفارش ${updated.orderNumber} — تولید ${updated.producedQty} ${updated.product.unit}، ضایعات ${updated.wasteQty} (به گدام اضافه نشد)، ${goodNote}`)

    return NextResponse.json(updated)
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('production complete', e)
    return NextResponse.json({ error: 'خطا در تکمیل تولید' }, { status: 500 })
  }
}
