'use client'

/**
 * هندلرهای انبار — آینهٔ src/app/api/inventory/route.ts
 * GET: گردش‌های اخیر (با انبار توکار) + خلاصهٔ موجودی محصولات و مواد خام؛
 * POST: ثبت حرکت دستی (in/out/adjust) با تجدید موجودی و ثبت Audit
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { actorFrom, logAudit, newRow, nowISO, readCol, writeCol, type Row } from '../db'

interface LocalWarehouse extends Row {
  name: string
  location: string | null
}

interface LocalTx extends Row {
  date: string
  type: string
  itemType: string
  itemId: string
  itemName: string
  unit: string
  quantity: number
  warehouseId: string | null
  reference: string | null
  notes: string | null
}

interface LocalProductRow extends Row {
  name: string
  unit: string
  stock: number
  minStock: number
  costPrice: number
}

interface LocalMaterialRow extends Row {
  name: string
  unit: string
  stock: number
  minStock: number
  maxStock: number
  purchasePrice: number
  expiryDate: string | null
}

/** تراکنش همراه انبار — مطابق include: { warehouse: true } پریمایز */
function withWarehouse(t: LocalTx): LocalTx & { warehouse: LocalWarehouse | null } {
  const warehouse = t.warehouseId
    ? readCol<LocalWarehouse>('warehouses').find((w) => w.id === t.warehouseId) ?? null
    : null
  return { ...t, warehouse }
}

/** محاسبهٔ حرکت — دقیقاً با منطق هاست (in اضافه، out کسر با بررسی کفایت، adjust مطلق) */
function computeMove(type: string, cur: number, quantity: number): { newStock: number; txQty: number } {
  if (type === 'in') return { newStock: cur + quantity, txQty: quantity }
  if (type === 'out') {
    const newStock = cur - quantity
    if (newStock < 0) throw new ApiError(400, 'موجودی کافی نیست')
    return { newStock, txQty: quantity }
  }
  // اصلاح: مقدار واردشده به‌صورت مطلق تنظیم می‌شود
  return { newStock: quantity, txQty: Math.abs(quantity - cur) }
}

/** مرتب‌سازی صعودی نام — مطابق orderBy: { name: 'asc' } پریمایز */
function byNameAsc<T extends Row & { name: string }>(a: T, b: T): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

export const routes: RouteDef[] = [
  // GET /api/inventory — فیلترها: type، itemType، warehouseId، days (پیش‌فرض 30)
  route('GET', '/api/inventory', (ctx) => {
    const sp = ctx.url.searchParams
    const type = sp.get('type') || ''
    const itemType = sp.get('itemType') || ''
    const warehouseId = sp.get('warehouseId') || ''
    const days = Number(sp.get('days')) || 30
    const since = Date.now() - days * 24 * 60 * 60 * 1000

    let txs = readCol<LocalTx>('inventoryTransactions').filter(
      (t) => new Date(t.date).getTime() >= since
    )
    if (type) txs = txs.filter((t) => t.type === type)
    if (itemType) txs = txs.filter((t) => t.itemType === itemType)
    if (warehouseId) txs = txs.filter((t) => t.warehouseId === warehouseId)
    const transactions = txs
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 500)
      .map(withWarehouse)

    const products = readCol<LocalProductRow>('products')
      .sort(byNameAsc)
      .map((p) => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        stock: Number(p.stock),
        minStock: Number(p.minStock),
        value: Number(p.stock) * Number(p.costPrice),
      }))

    const materials = readCol<LocalMaterialRow>('rawMaterials')
      .sort(byNameAsc)
      .map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        stock: Number(m.stock),
        minStock: Number(m.minStock),
        maxStock: Number(m.maxStock),
        purchasePrice: Number(m.purchasePrice),
        value: Number(m.stock) * Number(m.purchasePrice),
        expiryDate: m.expiryDate,
      }))

    return { transactions, products, materials }
  }),

  // POST /api/inventory — ثبت حرکت دستی (ورود/خروج/اصلاح) با تجدید موجودی
  route('POST', '/api/inventory', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const type = String(body.type ?? '')
    const itemType = String(body.itemType ?? '')
    const itemId = String(body.itemId ?? '')
    const quantity = Number(body.quantity)
    const warehouseId = body.warehouseId ? String(body.warehouseId) : null
    const reference = body.reference ? String(body.reference) : null
    const notes = body.notes ? String(body.notes) : null

    if (!['in', 'out', 'adjust'].includes(type)) throw new ApiError(400, 'نوع حرکت نامعتبر است')
    if (!['product', 'material'].includes(itemType)) throw new ApiError(400, 'نوع قلم نامعتبر است')
    if (!itemId) throw new ApiError(400, 'قلم انتخاب نشده است')
    if (!quantity || Number.isNaN(quantity) || quantity <= 0) {
      throw new ApiError(400, 'مقدار باید زیادتر از صفر باشد')
    }

    // تجدید موجودی قلم — دقیقاً مطابق منطق هاست
    let itemName = ''
    let unit = ''
    let txQty = quantity
    if (itemType === 'product') {
      const prods = readCol<LocalProductRow>('products')
      const item = prods.find((p) => p.id === itemId)
      if (!item) throw new ApiError(404, 'قلم مورد نظر یافت نشد')
      const move = computeMove(type, Number(item.stock), quantity)
      item.stock = move.newStock
      txQty = move.txQty
      itemName = item.name
      unit = item.unit
      writeCol('products', prods)
    } else {
      const mats = readCol<LocalMaterialRow>('rawMaterials')
      const item = mats.find((m) => m.id === itemId)
      if (!item) throw new ApiError(404, 'قلم مورد نظر یافت نشد')
      const move = computeMove(type, Number(item.stock), quantity)
      item.stock = move.newStock
      txQty = move.txQty
      itemName = item.name
      unit = item.unit
      writeCol('rawMaterials', mats)
    }

    const txs = readCol<LocalTx>('inventoryTransactions')
    const created: LocalTx = newRow({
      type,
      itemType,
      itemId,
      itemName,
      unit,
      quantity: txQty,
      warehouseId,
      reference,
      notes,
      date: nowISO(),
    })
    txs.push(created)
    writeCol('inventoryTransactions', txs)

    const typeFa = type === 'in' ? 'ورود' : type === 'out' ? 'خروج' : 'اصلاح'
    logAudit(
      actorFrom(ctx.session),
      'adjust',
      'inventory',
      created.id,
      `${typeFa} ${created.quantity} ${created.unit} — ${created.itemName}`
    )

    return withWarehouse(created)
  }),
]
