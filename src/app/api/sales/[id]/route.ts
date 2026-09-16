import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { logAudit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/sales/[id] — بل کامل برای چاپ / مشاهده مجدد
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const sale = await db.sale.findUnique({
      where: { id },
      include: { customer: true, items: { include: { product: true } } },
    })
    if (!sale) return NextResponse.json({ error: 'بل یافت نشد' }, { status: 404 })
    return NextResponse.json(sale)
  } catch (e) {
    console.error('sale GET [id]', e)
    return NextResponse.json({ error: 'خطا در دریافت بل' }, { status: 500 })
  }
}

// PUT /api/sales/[id] — ثبت / تعدیل پرداخت { paidAmount }
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const body = await req.json()
    const paidAmount = Number(body.paidAmount)
    if (isNaN(paidAmount)) {
      return NextResponse.json({ error: 'مبلغ پرداخت نامعتبر است' }, { status: 400 })
    }
    if (paidAmount < 0) {
      return NextResponse.json({ error: 'مبلغ پرداخت نمی‌تواند منفی باشد' }, { status: 400 })
    }

    const sale = await db.sale.findUnique({ where: { id } })
    if (!sale) return NextResponse.json({ error: 'بل یافت نشد' }, { status: 404 })

    const updated = await db.$transaction(async (tx) => {
      const newStatus =
        sale.total - paidAmount <= 0.001 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

      // تعدیل قرض مشتری: اختلاف باقیات قدیم و جدید — باقیات همیشه به افغانی است (تبدیل با نرخ بل)
      // delta مثبت = پرداخت بیشتر → کاهش قرض؛ delta منفی = کاهش پرداخت → برگشت قرض به دفتر
      if (sale.customerId) {
        const rate = Number(sale.exchangeRate) || 1
        const oldRemaining = Math.max(0, (sale.total - sale.paidAmount) * rate)
        const newRemaining = Math.max(0, (sale.total - paidAmount) * rate)
        const delta = oldRemaining - newRemaining
        if (Math.abs(delta) > 0.001) {
          const customer = await tx.customer.findUnique({ where: { id: sale.customerId } })
          if (customer) {
            await tx.customer.update({
              where: { id: sale.customerId },
              data: { balance: Math.max(0, customer.balance - delta) },
            })
          }
        }
      }

      return tx.sale.update({
        where: { id },
        data: { paidAmount, status: newStatus },
        include: { customer: true, items: { include: { product: true } } },
      })
    })

    const session = await getSessionFromRequest(req)
    await logAudit(session, 'payment', 'sale', id, `دریافت برای بل ${sale.invoiceNumber} — باقیات جدید ${Math.max(0, sale.total - paidAmount)}`)

    return NextResponse.json(updated)
  } catch (e) {
    console.error('sale PUT [id]', e)
    return NextResponse.json({ error: 'خطا در ثبت پرداخت' }, { status: 500 })
  }
}

// DELETE /api/sales/[id] — حذف بل: برگشت موجودی، تعدیل قرض مشتری، حذف اتمیک
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const sale = await db.sale.findUnique({
      where: { id },
      include: { items: { include: { product: true } } },
    })
    if (!sale) return NextResponse.json({ error: 'بل یافت نشد' }, { status: 404 })

    await db.$transaction(async (tx) => {
      // برگشت موجودی انبار برای هر قلم
      for (const it of sale.items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { increment: it.quantity } },
        })
      }

      // کاهش قرض مشتری اگر بل پرداخت‌نشده یا ناقص بود — باقیات به افغانی (تبدیل با نرخ بل)
      if (sale.customerId && sale.status !== 'paid') {
        const remaining =
          Math.max(0, sale.total - sale.paidAmount) * (Number(sale.exchangeRate) || 1)
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } })
        if (customer && remaining > 0) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: { balance: Math.max(0, customer.balance - remaining) },
          })
        }
      }

      // حذف تراکنش‌های انبار مرتبط با این بل
      await tx.inventoryTransaction.deleteMany({
        where: { reference: sale.invoiceNumber, type: 'out', itemType: 'product' },
      })

      await tx.sale.delete({ where: { id } }) // آیتم‌ها با Cascade حذف می‌شوند
    })

    const session = await getSessionFromRequest(req)
    await logAudit(session, 'delete', 'sale', id, `حذف بل ${sale.invoiceNumber}`)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('sale DELETE [id]', e)
    return NextResponse.json({ error: 'خطا در حذف بل' }, { status: 500 })
  }
}
