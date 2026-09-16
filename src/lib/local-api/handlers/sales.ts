'use client'

/**
 * هندلرهای فروش — آینهٔ src/app/api/sales/route.ts و [id]/route.ts
 * عوارض جانبی مثل هاست: کسر موجودی محصول + تراکنش انبار «out/product» با
 * reference = شماره بل + افزایش قرض مشتری برای فروش نسیه/ناقص.
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import {
  actorFrom, logAudit, newRow, nowISO, readCol, withUpdate, writeCol,
  type Row,
} from '../db'

interface LocalCustomer extends Row {
  name: string
  type: string
  balance: number
}
interface LocalProduct extends Row {
  name: string
  unit: string
  stock: number
}
interface LocalSale extends Row {
  invoiceNumber: string
  customerId: string | null
  customerName: string | null
  date: string
  currency: string
  exchangeRate: number
  subtotal: number
  discount: number
  taxRate: number
  taxAmount: number
  total: number
  paidAmount: number
  paymentMethod: string
  status: string
  notes: string | null
}
interface LocalSaleItem extends Row {
  saleId: string
  productId: string
  quantity: number
  unitPrice: number
  discount: number
  total: number
}
interface LocalInventoryTx extends Row {
  reference: string | null
  type: string
  itemType: string
}

/** زمان ISO رکورد تاریخ — برای مرتب‌سازی/فیلتر */
function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

/** تجمیع بل با مشتری و اقلام (به‌همراه محصول) — مثل include هاست */
function saleWithIncludes(
  sale: LocalSale,
  customers: LocalCustomer[],
  items: LocalSaleItem[],
  products: LocalProduct[]
) {
  return {
    ...sale,
    customer: customers.find((c) => c.id === sale.customerId) ?? null,
    items: items
      .filter((i) => i.saleId === sale.id)
      .map((i) => ({ ...i, product: products.find((p) => p.id === i.productId) ?? null })),
  }
}

/** تاریخ بدنه — نامعتبر بودن به «اکنون» برمی‌گردد (مثل هاست) */
function parseDateOr(v: unknown, fallback: Date): Date {
  if (v == null || v === '') return fallback
  const d = new Date(String(v))
  return isNaN(d.getTime()) ? fallback : d
}

export const routes: RouteDef[] = [
  // GET /api/sales — لیست بل‌ها با فیلتر اختیاری ?status=&method=&customerId=
  route('GET', '/api/sales', (ctx) => {
    const status = ctx.url.searchParams.get('status') || undefined
    const method = ctx.url.searchParams.get('method') || undefined
    const customerId = ctx.url.searchParams.get('customerId') || undefined

    const sales = readCol<LocalSale>('sales').filter(
      (s) =>
        (!status || s.status === status) &&
        (!method || s.paymentMethod === method) &&
        (!customerId || s.customerId === customerId)
    )
    sales.sort((a, b) => timeOf(b.date) - timeOf(a.date))

    const customers = readCol<LocalCustomer>('customers')
    const items = readCol<LocalSaleItem>('saleItems')
    const products = readCol<LocalProduct>('products')
    return sales.map((s) => saleWithIncludes(s, customers, items, products))
  }),

  // POST /api/sales — ثبت فروش جدید (کسر موجودی + قرض مشتری + تراکنش انبار)
  route('POST', '/api/sales', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length === 0) {
      throw new ApiError(400, 'حداقل یک کالا برای فروش ضروری است')
    }

    const products = readCol<LocalProduct>('products')
    const productMap = new Map(products.map((p) => [p.id, p]))

    // محاسبهٔ سطر به سطر — قبل از هر نوشتن (اتمیک بودن)
    let subtotal = 0
    const cleanItems: {
      productId: string
      productName: string
      unit: string
      quantity: number
      unitPrice: number
      discount: number
      total: number
    }[] = []
    for (const it of rawItems) {
      const o = (it ?? {}) as Record<string, unknown>
      const product = productMap.get(String(o.productId))
      if (!product) throw new ApiError(400, 'یکی از محصولات یافت نشد')
      const quantity = Number(o.quantity)
      const unitPrice = Number(o.unitPrice)
      const discount = Number(o.discount) || 0
      if (!quantity || quantity <= 0) {
        throw new ApiError(400, 'مقدار کالا باید زیادتر از صفر باشد')
      }
      if (isNaN(unitPrice) || unitPrice < 0) {
        throw new ApiError(400, 'فی کالا نامعتبر است')
      }
      if (discount < 0) {
        throw new ApiError(400, 'تخفیف نمی‌تواند منفی باشد')
      }
      const lineTotal = quantity * unitPrice - discount
      subtotal += lineTotal
      cleanItems.push({
        productId: product.id,
        productName: product.name,
        unit: product.unit,
        quantity,
        unitPrice,
        discount,
        total: lineTotal,
      })
    }

    const discount = Number(body.discount) || 0
    if (discount < 0) {
      throw new ApiError(400, 'تخفیف نمی‌تواند منفی باشد')
    }
    const requestedTax = Number(body.taxRate) || 0
    const taxRate = [0, 2, 10].includes(requestedTax) ? requestedTax : 0
    const taxable = Math.max(0, subtotal - discount)
    const taxAmount = (taxable * taxRate) / 100
    const total = taxable + taxAmount
    const paidAmount = Number(body.paidAmount) || 0
    if (paidAmount < 0) {
      throw new ApiError(400, 'مبلغ پرداخت نمی‌تواند منفی باشد')
    }
    const status = total - paidAmount <= 0.001 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'
    // گارد برخورد شماره بل در همان میلی‌ثانیه — مثل هاست (P2002) یک پسوند تازه می‌گیرد
    let invoiceNumber = `INV-${Date.now().toString().slice(-9)}`
    if (readCol<LocalSale>('sales').some((s) => s.invoiceNumber === invoiceNumber)) {
      invoiceNumber = `INV-${Date.now().toString().slice(-9)}-${Math.floor(Math.random() * 1000)}`
    }
    const currency = ['AFN', 'USD', 'PKR'].includes(String(body.currency)) ? String(body.currency) : 'AFN'
    const exchangeRate = Number(body.exchangeRate) > 0 ? Number(body.exchangeRate) : 1
    const paymentMethod = ['cash', 'credit', 'transfer'].includes(String(body.paymentMethod))
      ? String(body.paymentMethod)
      : 'cash'
    const date = parseDateOr(body.date, new Date())

    const customerId = body.customerId ? String(body.customerId) : null
    const customers = readCol<LocalCustomer>('customers')
    const customer = customerId ? customers.find((c) => c.id === customerId) : null
    if (customerId && !customer) throw new ApiError(400, 'مشتری انتخاب‌شده معتبر نیست')
    const customerName = body.customerName ? String(body.customerName) : null
    const notes = body.notes ? String(body.notes) : null

    // ---- نوشتن‌ها — بعد از اتمام همهٔ اعتبارسنجی‌ها ----
    const newSale = newRow({
      invoiceNumber,
      customerId,
      customerName,
      date: date.toISOString(),
      currency,
      exchangeRate,
      subtotal,
      discount,
      taxRate,
      taxAmount,
      total,
      paidAmount,
      paymentMethod,
      status,
      notes,
    })
    const newItems = cleanItems.map((it) =>
      newRow({
        saleId: newSale.id,
        productId: it.productId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discount: it.discount,
        total: it.total,
      })
    )

    // کسر موجودی انبار + ثبت تراکنش خروج
    const txs = readCol<LocalInventoryTx>('inventoryTransactions')
    for (const it of cleanItems) {
      const p = productMap.get(it.productId)
      if (p) {
        p.stock = Number(p.stock ?? 0) - it.quantity
        p.updatedAt = nowISO()
      }
      txs.push(
        newRow({
          date: nowISO(),
          type: 'out',
          itemType: 'product',
          itemId: it.productId,
          itemName: it.productName,
          unit: it.unit,
          quantity: it.quantity,
          warehouseId: null,
          reference: invoiceNumber,
          notes: null,
        })
      )
    }
    writeCol('products', products)
    writeCol('inventoryTransactions', txs)

    // افزایش قرض مشتری در صورت پرداخت ناقص — باقیات همیشه به افغانی است (تبدیل با نرخ بل)
    if (customer && status !== 'paid') {
      customer.balance = Number(customer.balance ?? 0) + (total - paidAmount) * (exchangeRate || 1)
      customer.updatedAt = nowISO()
      writeCol('customers', customers)
    }

    writeCol('sales', [...readCol<LocalSale>('sales'), newSale])
    writeCol('saleItems', [...readCol<LocalSaleItem>('saleItems'), ...newItems])

    logAudit(
      actorFrom(ctx.session),
      'create',
      'sale',
      newSale.id,
      `بل ${invoiceNumber} به مبلغ ${Math.round(total * exchangeRate)} AFG`
    )

    return saleWithIncludes(
      newSale,
      readCol<LocalCustomer>('customers'),
      readCol<LocalSaleItem>('saleItems'),
      readCol<LocalProduct>('products')
    )
  }),

  // GET /api/sales/:id — بل کامل برای چاپ / مشاهدهٔ مجدد
  route('GET', '/api/sales/:id', (_ctx, params) => {
    const sale = readCol<LocalSale>('sales').find((s) => s.id === params[0])
    if (!sale) throw new ApiError(404, 'بل یافت نشد')
    return saleWithIncludes(
      sale,
      readCol<LocalCustomer>('customers'),
      readCol<LocalSaleItem>('saleItems'),
      readCol<LocalProduct>('products')
    )
  }),

  // PUT /api/sales/:id — ثبت / تعدیل پرداخت { paidAmount }
  route('PUT', '/api/sales/:id', (ctx, params) => {
    const id = params[0]
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const paidAmount = Number(body.paidAmount)
    if (isNaN(paidAmount)) {
      throw new ApiError(400, 'مبلغ پرداخت نامعتبر است')
    }
    if (paidAmount < 0) {
      throw new ApiError(400, 'مبلغ پرداخت نمی‌تواند منفی باشد')
    }

    const sales = readCol<LocalSale>('sales')
    const sale = sales.find((s) => s.id === id)
    if (!sale) throw new ApiError(404, 'بل یافت نشد')

    const newStatus =
      sale.total - paidAmount <= 0.001 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

    // تعدیل قرض مشتری — اختلاف باقیات قدیم و جدید؛ باقیات همیشه به افغانی است (تبدیل با نرخ بل)
    // delta مثبت = کاهش قرض؛ delta منفی = کاهش پرداخت → برگشت قرض به دفتر
    if (sale.customerId) {
      const rate = Number(sale.exchangeRate) || 1
      const oldRemaining = Math.max(0, (sale.total - sale.paidAmount) * rate)
      const newRemaining = Math.max(0, (sale.total - paidAmount) * rate)
      const delta = oldRemaining - newRemaining
      if (Math.abs(delta) > 0.001) {
        const customers = readCol<LocalCustomer>('customers')
        const customer = customers.find((c) => c.id === sale.customerId)
        if (customer) {
          customer.balance = Math.max(0, Number(customer.balance ?? 0) - delta)
          customer.updatedAt = nowISO()
          writeCol('customers', customers)
        }
      }
    }

    const updated = withUpdate(sale, { paidAmount, status: newStatus })
    writeCol('sales', sales.map((s) => (s.id === id ? updated : s)))

    logAudit(
      actorFrom(ctx.session),
      'payment',
      'sale',
      id,
      `دریافت برای بل ${sale.invoiceNumber} — باقیات جدید ${Math.max(0, sale.total - paidAmount)}`
    )

    return saleWithIncludes(
      updated,
      readCol<LocalCustomer>('customers'),
      readCol<LocalSaleItem>('saleItems'),
      readCol<LocalProduct>('products')
    )
  }),

  // DELETE /api/sales/:id — حذف بل: برگشت موجودی، تعدیل قرض، حذف تراکنش‌ها
  route('DELETE', '/api/sales/:id', (ctx, params) => {
    const id = params[0]
    const sales = readCol<LocalSale>('sales')
    const sale = sales.find((s) => s.id === id)
    if (!sale) throw new ApiError(404, 'بل یافت نشد')

    const saleItems = readCol<LocalSaleItem>('saleItems').filter((i) => i.saleId === id)

    // برگشت موجودی انبار برای هر قلم
    const products = readCol<LocalProduct>('products')
    for (const it of saleItems) {
      const p = products.find((x) => x.id === it.productId)
      if (p) {
        p.stock = Number(p.stock ?? 0) + it.quantity
        p.updatedAt = nowISO()
      }
    }
    writeCol('products', products)

    // کاهش قرض مشتری اگر بل پرداخت‌نشده یا ناقص بود — باقیات به افغانی (تبدیل با نرخ بل)
    if (sale.customerId && sale.status !== 'paid') {
      const remaining =
        Math.max(0, sale.total - sale.paidAmount) * (Number(sale.exchangeRate) || 1)
      const customers = readCol<LocalCustomer>('customers')
      const customer = customers.find((c) => c.id === sale.customerId)
      if (customer && remaining > 0) {
        customer.balance = Math.max(0, Number(customer.balance ?? 0) - remaining)
        customer.updatedAt = nowISO()
        writeCol('customers', customers)
      }
    }

    // حذف تراکنش‌های انبار مرتبط با این بل
    writeCol(
      'inventoryTransactions',
      readCol<LocalInventoryTx>('inventoryTransactions').filter(
        (t) => !(t.reference === sale.invoiceNumber && t.type === 'out' && t.itemType === 'product')
      )
    )

    // حذف اقلام + بل
    writeCol('saleItems', readCol<LocalSaleItem>('saleItems').filter((i) => i.saleId !== id))
    writeCol('sales', sales.filter((s) => s.id !== id))

    logAudit(actorFrom(ctx.session), 'delete', 'sale', id, `حذف بل ${sale.invoiceNumber}`)

    return { ok: true }
  }),
]
