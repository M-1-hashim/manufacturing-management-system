import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { logAudit } from '@/lib/audit'

// GET /api/sales — لیست بل‌ها با فیلتر اختیاری ?status=&method=&customerId=
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || undefined
    const method = searchParams.get('method') || undefined
    const customerId = searchParams.get('customerId') || undefined

    const where: Record<string, string> = {}
    if (status) where.status = status
    if (method) where.paymentMethod = method
    if (customerId) where.customerId = customerId

    const sales = await db.sale.findMany({
      where,
      include: { customer: true, items: { include: { product: true } } },
      orderBy: { date: 'desc' },
    })
    return NextResponse.json(sales)
  } catch (e) {
    console.error('sales GET', e)
    return NextResponse.json({ error: 'خطا در دریافت بل‌ها' }, { status: 500 })
  }
}

// POST /api/sales — ثبت فروش جدید (کسر موجودی + قرض مشتری + تراکنش انبار، همه اتمیک)
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length === 0) {
      return NextResponse.json({ error: 'حداقل یک کالا برای فروش ضروری است' }, { status: 400 })
    }

    const productIds = rawItems.map((i: { productId: string }) => String(i.productId))
    const products = await db.product.findMany({ where: { id: { in: productIds } } })
    const productMap = new Map(products.map((p) => [p.id, p]))

    // محاسبه فکتورهای سطر به سطر
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
      const product = productMap.get(String(it.productId))
      if (!product) {
        return NextResponse.json({ error: 'یکی از محصولات یافت نشد' }, { status: 400 })
      }
      const quantity = Number(it.quantity)
      const unitPrice = Number(it.unitPrice)
      const discount = Number(it.discount) || 0
      if (!quantity || quantity <= 0) {
        return NextResponse.json({ error: 'مقدار کالا باید زیادتر از صفر باشد' }, { status: 400 })
      }
      if (isNaN(unitPrice) || unitPrice < 0) {
        return NextResponse.json({ error: 'فی کالا نامعتبر است' }, { status: 400 })
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
    const requestedTax = Number(body.taxRate) || 0
    const taxRate = [0, 2, 10].includes(requestedTax) ? requestedTax : 0
    const taxable = Math.max(0, subtotal - discount)
    const taxAmount = (taxable * taxRate) / 100
    const total = taxable + taxAmount
    const paidAmount = Number(body.paidAmount) || 0
    const status = total - paidAmount <= 0.001 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'
    const invoiceNumber = `INV-${Date.now().toString().slice(-9)}`
    const currency = ['AFN', 'USD', 'PKR'].includes(body.currency) ? body.currency : 'AFN'
    const exchangeRate = Number(body.exchangeRate) > 0 ? Number(body.exchangeRate) : 1
    const paymentMethod = ['cash', 'credit', 'transfer'].includes(body.paymentMethod)
      ? body.paymentMethod
      : 'cash'
    let date = body.date ? new Date(body.date) : new Date()
    if (isNaN(date.getTime())) date = new Date()

    const sale = await db.$transaction(async (tx) => {
      // کسر موجودی انبار و ثبت تراکنش خروج
      for (const it of cleanItems) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: it.quantity } },
        })
        await tx.inventoryTransaction.create({
          data: {
            type: 'out',
            itemType: 'product',
            itemId: it.productId,
            itemName: it.productName,
            unit: it.unit,
            quantity: it.quantity,
            reference: invoiceNumber,
          },
        })
      }

      // افزایش قرض مشتری در صورت پرداخت ناقص
      if (body.customerId && status !== 'paid') {
        await tx.customer.update({
          where: { id: String(body.customerId) },
          data: { balance: { increment: total - paidAmount } },
        })
      }

      return tx.sale.create({
        data: {
          invoiceNumber,
          customerId: body.customerId ? String(body.customerId) : null,
          customerName: body.customerName ? String(body.customerName) : null,
          date,
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
          notes: body.notes ? String(body.notes) : null,
          items: {
            create: cleanItems.map((it) => ({
              productId: it.productId,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              discount: it.discount,
              total: it.total,
            })),
          },
        },
        include: { customer: true, items: { include: { product: true } } },
      })
    })

    const session = await getSessionFromRequest(req)
    await logAudit(session, 'create', 'sale', sale.id, `بل ${sale.invoiceNumber} به مبلغ ${Math.round(sale.total * sale.exchangeRate)} افغانی`)

    return NextResponse.json(sale, { status: 201 })
  } catch (e) {
    console.error('sales POST', e)
    return NextResponse.json({ error: 'خطا در ثبت فروش' }, { status: 500 })
  }
}
