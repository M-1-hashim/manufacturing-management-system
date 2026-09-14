import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { logAudit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/sales/[id] — فاکتور کامل برای چاپ / مشاهده مجدد
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const sale = await db.sale.findUnique({
      where: { id },
      include: { customer: true, items: { include: { product: true } } },
    })
    if (!sale) return NextResponse.json({ error: 'فاکتور یافت نشد' }, { status: 404 })
    return NextResponse.json(sale)
  } catch (e) {
    console.error('sale GET [id]', e)
    return NextResponse.json({ error: 'خطا در دریافت فاکتور' }, { status: 500 })
  }
}

// PUT /api/sales/[id] — ثبت / تعدیل پرداخت { paidAmount }
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const body = await req.json()
    const paidAmount = Number(body.paidAmount)
    if (isNaN(paidAmount) || paidAmount < 0) {
      return NextResponse.json({ error: 'مبلغ پرداخت نامعتبر است' }, { status: 400 })
    }

    const sale = await db.sale.findUnique({ where: { id } })
    if (!sale) return NextResponse.json({ error: 'فاکتور یافت نشد' }, { status: 404 })

    const updated = await db.$transaction(async (tx) => {
      const newStatus =
        sale.total - paidAmount <= 0.001 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid'

      // تعدیل بدهی مشتری: کاهش مانده به اندازه اختلاف باقیات قدیم و جدید
      if (sale.customerId) {
        const oldRemaining = Math.max(0, sale.total - sale.paidAmount)
        const newRemaining = Math.max(0, sale.total - paidAmount)
        const delta = oldRemaining - newRemaining
        if (delta > 0.001) {
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
    await logAudit(session, 'payment', 'sale', id, `دریافت برای فاکتور ${sale.invoiceNumber} — مانده جدید ${Math.max(0, sale.total - paidAmount)}`)

    return NextResponse.json(updated)
  } catch (e) {
    console.error('sale PUT [id]', e)
    return NextResponse.json({ error: 'خطا در ثبت پرداخت' }, { status: 500 })
  }
}

// DELETE /api/sales/[id] — حذف فاکتور: برگشت موجودی، تعدیل بدهی مشتری، حذف اتمیک
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const sale = await db.sale.findUnique({
      where: { id },
      include: { items: { include: { product: true } } },
    })
    if (!sale) return NextResponse.json({ error: 'فاکتور یافت نشد' }, { status: 404 })

    await db.$transaction(async (tx) => {
      // برگشت موجودی انبار برای هر قلم
      for (const it of sale.items) {
        await tx.product.update({
          where: { id: it.productId },
          data: { stock: { increment: it.quantity } },
        })
      }

      // کاهش بدهی مشتری اگر فاکتور پرداخت‌نشده یا ناقص بود
      if (sale.customerId && sale.status !== 'paid') {
        const remaining = Math.max(0, sale.total - sale.paidAmount)
        const customer = await tx.customer.findUnique({ where: { id: sale.customerId } })
        if (customer && remaining > 0) {
          await tx.customer.update({
            where: { id: sale.customerId },
            data: { balance: Math.max(0, customer.balance - remaining) },
          })
        }
      }

      // حذف تراکنش‌های انبار مرتبط با این فاکتور
      await tx.inventoryTransaction.deleteMany({
        where: { reference: sale.invoiceNumber, type: 'out', itemType: 'product' },
      })

      await tx.sale.delete({ where: { id } }) // آیتم‌ها با Cascade حذف می‌شوند
    })

    const session = await getSessionFromRequest(req)
    await logAudit(session, 'delete', 'sale', id, `حذف فاکتور ${sale.invoiceNumber}`)

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('sale DELETE [id]', e)
    return NextResponse.json({ error: 'خطا در حذف فاکتور' }, { status: 500 })
  }
}
