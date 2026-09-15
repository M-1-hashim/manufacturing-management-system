'use client'

/**
 * هندلرهای سفارش تولید — آینهٔ src/app/api/production/**
 * GET/POST/PUT/DELETE + اندپوینت تکمیل تولید با همهٔ عوارض جانبی:
 *  کسر مواد خام به نسبت تولید، ورود «مقدار خالص» محصول (منهای ضایعات)،
 *  ثبت تراکنش‌های انبار، محاسبهٔ هزینه‌ها، تجدید قیمت تمام‌شده و ثبت Audit
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import {
  actorFrom, byDateDesc, logAudit, newRow, nowISO, readCol, withUpdate, writeCol, type Row,
} from '../db'
import {
  hydrateFormula, type HydratedFormula, type LocalMaterialLite, type LocalProductLite,
} from './formulas'

interface LocalOrder extends Row {
  orderNumber: string
  formulaId: string
  productId: string
  quantity: number
  producedQty: number
  wasteQty: number
  status: string
  qcStatus: string | null
  qcNotes: string | null
  materialCost: number
  laborCost: number
  overheadCost: number
  totalCost: number
  startDate: string
  endDate: string | null
  notes: string | null
}

/** سفارش همراه روابط توکار — مطابق ORDER_INCLUDE هاست */
interface HydratedOrder extends Row {
  product: LocalProductLite | null
  formula: HydratedFormula | null
}

const round2 = (n: number): number => Math.round(n * 100) / 100
const round4 = (n: number): number => Math.round(n * 10000) / 10000

/** سفارش را با فرمولا (شامل اقلام) و محصول کامل می‌کند */
function hydrateOrder(o: LocalOrder): HydratedOrder {
  const formula = readCol<Row>('formulas').find((f) => f.id === o.formulaId)
  return {
    ...o,
    product: readCol<LocalProductLite>('products').find((p) => p.id === o.productId) ?? null,
    formula: formula ? hydrateFormula(formula) : null,
  }
}

export const routes: RouteDef[] = [
  // GET /api/production?status= — لیست سفارش‌ها (مرتب بر اساس startDate نزولی)
  route('GET', '/api/production', (ctx) => {
    const status = ctx.url.searchParams.get('status') || ''
    let rows = readCol<LocalOrder>('productionOrders')
    if (status) rows = rows.filter((o) => o.status === status)
    return rows.sort(byDateDesc('startDate')).map(hydrateOrder)
  }),

  // POST /api/production — ثبت سفارش جدید (هزینه‌های تخمینی بر اساس فورمولا)
  route('POST', '/api/production', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const formulaId = typeof body.formulaId === 'string' ? body.formulaId : ''
    const quantity = Number(body.quantity)
    if (!formulaId) throw new ApiError(400, 'انتخاب فورمولا الزامی است')
    if (!(quantity > 0)) throw new ApiError(400, 'مقدار تولید باید زیادتر از صفر باشد')

    const formula = readCol<Row>('formulas').find((f) => f.id === formulaId)
    if (!formula) throw new ApiError(400, 'فورمولا یافت نشد')
    const hydrated = hydrateFormula(formula)
    if (hydrated.items.length === 0) throw new ApiError(400, 'این فورمولا هیچ ماده اولیه ندارد')

    // ضریب تولید: مقدار برنامه نسبت به خروجی یک بچ فورمولا
    const scale = quantity / (Number(formula.outputQty) || 1)
    const materialCost = hydrated.items.reduce(
      (a, i) => a + Number(i.quantity) * scale * Number(i.rawMaterial?.purchasePrice ?? 0),
      0
    )
    const laborCost = Number(formula.laborCost) * scale
    const overheadCost = Number(formula.overheadCost) * scale

    // نمبر سفارش یکتا — همان قالب هاست
    const orders = readCol<LocalOrder>('productionOrders')
    let orderNumber = `PR-${Date.now().toString().slice(-8)}`
    if (orders.some((o) => o.orderNumber === orderNumber)) {
      orderNumber = `PR-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`
    }

    const created: LocalOrder = newRow({
      orderNumber,
      formulaId,
      productId: String(formula.productId),
      quantity,
      producedQty: 0,
      wasteQty: 0,
      status: 'in_progress',
      qcStatus: null,
      qcNotes: null,
      materialCost: round2(materialCost),
      laborCost: round2(laborCost),
      overheadCost: round2(overheadCost),
      totalCost: 0, // مطابق هاست — فقط در تکمیل تولید محاسبه می‌شود
      startDate: body.startDate ? new Date(String(body.startDate)).toISOString() : nowISO(),
      endDate: null,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    })
    orders.push(created)
    writeCol('productionOrders', orders)
    return hydrateOrder(created)
  }),

  // GET /api/production/:id — یک سفارش با تفصیلات
  route('GET', '/api/production/:id', (_ctx, params) => {
    const o = readCol<LocalOrder>('productionOrders').find((x) => x.id === params[0])
    if (!o) throw new ApiError(404, 'سفارش تولید یافت نشد')
    return hydrateOrder(o)
  }),

  // PUT /api/production/:id — تجدید محدود: qcStatus، qcNotes، notes و وضعیت
  route('PUT', '/api/production/:id', (ctx, params) => {
    const id = params[0]
    const orders = readCol<LocalOrder>('productionOrders')
    const existing = orders.find((o) => o.id === id)
    if (!existing) throw new ApiError(404, 'سفارش تولید یافت نشد')
    if (existing.status === 'completed') throw new ApiError(400, 'سفارش تکمیل‌شده قابل تغییر نیست')

    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const data: Partial<LocalOrder> = {}

    if (body.qcStatus !== undefined) {
      if (
        body.qcStatus !== null &&
        !['passed', 'failed', 'pending'].includes(String(body.qcStatus))
      ) {
        throw new ApiError(400, 'وضعیت کنترل کیفیت نامعتبر است')
      }
      data.qcStatus = body.qcStatus === null ? null : String(body.qcStatus)
    }
    if (body.qcNotes !== undefined) {
      data.qcNotes = typeof body.qcNotes === 'string' && body.qcNotes.trim() ? body.qcNotes.trim() : null
    }
    if (body.notes !== undefined) {
      data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
    }
    if (body.status !== undefined) {
      // فقط انتقال به «در جریان»، «در انتظار» یا «لغو» مجاز است
      if (!['pending', 'in_progress', 'cancelled'].includes(String(body.status))) {
        throw new ApiError(
          400,
          'تغییر وضعیت به این مقدار مجاز نیست. تکمیل تولید از دکمه «تکمیل تولید» انجام شود.'
        )
      }
      if (existing.status === 'cancelled' && body.status !== 'cancelled') {
        throw new ApiError(400, 'سفارش لغوشده قابل تغییر نیست')
      }
      data.status = String(body.status)
    }

    if (Object.keys(data).length === 0) throw new ApiError(400, 'فیلد قابل تجدید ارسال نشده است')

    const updated = withUpdate(existing, data)
    writeCol('productionOrders', orders.map((o) => (o.id === id ? updated : o)))
    return hydrateOrder(updated)
  }),

  // DELETE /api/production/:id — حذف فقط در وضعیت «در انتظار»
  route('DELETE', '/api/production/:id', (_ctx, params) => {
    const id = params[0]
    const orders = readCol<LocalOrder>('productionOrders')
    const existing = orders.find((o) => o.id === id)
    if (!existing) throw new ApiError(404, 'سفارش تولید یافت نشد')
    if (existing.status !== 'pending') {
      throw new ApiError(400, 'فقط سفارش‌های در انتظار قابل حذف هستند. سفارش در جریان را لغو کنید.')
    }
    writeCol('productionOrders', orders.filter((o) => o.id !== id))
    return { ok: true }
  }),

  // POST /api/production/:id/complete — تکمیل تولید اتمیک با همهٔ عوارض جانبی
  route('POST', '/api/production/:id/complete', (ctx, params) => {
    const id = params[0]
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const producedQty = Number(body.producedQty)
    const wasteQty =
      body.wasteQty !== undefined && body.wasteQty !== null && Number(body.wasteQty) >= 0
        ? Number(body.wasteQty)
        : 0
    if (!Number.isFinite(producedQty) || producedQty <= 0) {
      throw new ApiError(400, 'مقدار تولیدشده باید زیادتر از صفر باشد')
    }
    if (!Number.isFinite(wasteQty) || wasteQty > producedQty) {
      throw new ApiError(400, 'مقدار ضایعات نمی‌تواند زیادتر از مقدار تولید باشد')
    }
    // مقدار خالص قابل ورود به گدام = تولید کل منهای ضایعات
    const goodQty = round4(producedQty - wasteQty)

    const orders = readCol<LocalOrder>('productionOrders')
    const order = orders.find((o) => o.id === id)
    if (!order) throw new ApiError(404, 'سفارش تولید یافت نشد')
    if (order.status === 'completed') throw new ApiError(400, 'این سفارش قبلاً تکمیل شده است')
    if (order.status === 'cancelled') throw new ApiError(400, 'این سفارش لغو شده است')

    const products = readCol<LocalProductLite>('products')
    const product = products.find((p) => p.id === order.productId)
    const formulaRow = readCol<Row>('formulas').find((f) => f.id === order.formulaId)
    const formula = formulaRow ? hydrateFormula(formulaRow) : null
    if (!product || !formula) throw new ApiError(500, 'خطا در تکمیل تولید')

    // ضریب: مقدار واقعی تولید نسبت به خروجی یک بچ فورمولا
    const multiplier = producedQty / (Number(formula.outputQty) || 1)

    // 1) کسر مواد اولیه + تراکنش خروجی انبار برای هر ماده
    //    (مطابق هاست موجودی منفی هم می‌شود — بدون بررسی کفایت)
    const materials = readCol<LocalMaterialLite>('rawMaterials')
    const txs = readCol<Row>('inventoryTransactions')
    for (const item of formula.items) {
      const qty = Number(item.quantity) * multiplier
      if (qty <= 0) continue
      const mat = materials.find((m) => m.id === item.rawMaterialId)
      if (mat) mat.stock = Number(mat.stock) - qty
      txs.push(
        newRow({
          type: 'out',
          itemType: 'material',
          itemId: item.rawMaterialId,
          itemName: mat?.name ?? '',
          unit: mat?.unit ?? '',
          quantity: round4(qty),
          warehouseId: null,
          reference: order.orderNumber,
          notes: 'مصرف تولید',
          date: nowISO(),
        })
      )
    }
    writeCol('rawMaterials', materials)

    // 2) فقط مقدار خالص (بدون ضایعات) به گدام اضافه می‌شود
    if (goodQty > 0) {
      product.stock = Number(product.stock) + goodQty
      txs.push(
        newRow({
          type: 'in',
          itemType: 'product',
          itemId: product.id,
          itemName: product.name,
          unit: product.unit,
          quantity: goodQty,
          warehouseId: null,
          reference: order.orderNumber,
          notes:
            wasteQty > 0
              ? `تولید — خالص (${wasteQty} ضایعات ثبت شد، به انبار اضافه نشد)`
              : 'تولید',
          date: nowISO(),
        })
      )
    }
    writeCol('inventoryTransactions', txs)

    // 3) مصارفی نهایی بر اساس مقدار واقعی تولیدشده
    const materialCost = formula.items.reduce(
      (a, i) => a + Number(i.quantity) * multiplier * Number(i.rawMaterial?.purchasePrice ?? 0),
      0
    )
    const laborCost = Number(formula.laborCost) * multiplier
    const overheadCost = Number(formula.overheadCost) * multiplier
    const totalCost = materialCost + laborCost + overheadCost

    const qcStatus =
      typeof body.qcStatus === 'string' && ['passed', 'failed', 'pending'].includes(body.qcStatus)
        ? body.qcStatus
        : 'pending'

    const updated = withUpdate(order, {
      status: 'completed',
      producedQty,
      wasteQty,
      qcStatus,
      qcNotes: typeof body.qcNotes === 'string' && body.qcNotes.trim() ? body.qcNotes.trim() : null,
      endDate: nowISO(),
      materialCost: round2(materialCost),
      laborCost: round2(laborCost),
      overheadCost: round2(overheadCost),
      totalCost: round2(totalCost),
    })
    writeCol('productionOrders', orders.map((o) => (o.id === id ? updated : o)))

    // 4) قیمت تمام‌شدهٔ واحد = مصرف کل ÷ مقدار خالص (ضایعات به قیمت اقلام سالم توزیع می‌شود)
    if (goodQty > 0) {
      product.costPrice = round2(totalCost / goodQty)
    }
    writeCol('products', products)

    const goodNote =
      goodQty > 0
        ? `${goodQty} ${product.unit} خالص به گدام اضافه شد`
        : 'هیچ مقدار خالصی به گدام اضافه نشد'
    logAudit(
      actorFrom(ctx.session),
      'complete',
      'production',
      id,
      `تکمیل سفارش ${updated.orderNumber} — تولید ${updated.producedQty} ${product.unit}، ضایعات ${updated.wasteQty} (به گدام اضافه نشد)، ${goodNote}`
    )

    return hydrateOrder(updated)
  }),
]
