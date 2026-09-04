import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'
import { logAudit } from '@/lib/audit'

// خطای HTTP سفارشی برای استفاده داخل تراکنش
class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// GET /api/inventory — گردش انبار + خلاصه موجودی فعلی
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || undefined
    const itemType = searchParams.get('itemType') || undefined
    const warehouseId = searchParams.get('warehouseId') || undefined
    const days = Number(searchParams.get('days')) || 30
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const where: Prisma.InventoryTransactionWhereInput = { date: { gte: since } }
    if (type) where.type = type
    if (itemType) where.itemType = itemType
    if (warehouseId) where.warehouseId = warehouseId

    const [transactions, products, materials] = await Promise.all([
      db.inventoryTransaction.findMany({
        where,
        include: { warehouse: true },
        orderBy: { date: 'desc' },
        take: 500,
      }),
      db.product.findMany({ orderBy: { name: 'asc' } }),
      db.rawMaterial.findMany({ orderBy: { name: 'asc' } }),
    ])

    return NextResponse.json({
      transactions,
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        unit: p.unit,
        stock: p.stock,
        minStock: p.minStock,
        value: p.stock * p.costPrice,
      })),
      materials: materials.map((m) => ({
        id: m.id,
        name: m.name,
        unit: m.unit,
        stock: m.stock,
        minStock: m.minStock,
        maxStock: m.maxStock,
        purchasePrice: m.purchasePrice,
        value: m.stock * m.purchasePrice,
        expiryDate: m.expiryDate,
      })),
    })
  } catch (e) {
    console.error('inventory GET', e)
    return NextResponse.json({ error: 'خطا در دریافت داده‌های انبار' }, { status: 500 })
  }
}

// POST /api/inventory — ثبت حرکت دستی (ورود/خروج/اصلاح) با به‌روزرسانی موجودی
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const type = String(body.type ?? '')
    const itemType = String(body.itemType ?? '')
    const itemId = String(body.itemId ?? '')
    const quantity = Number(body.quantity)
    const warehouseId = body.warehouseId ? String(body.warehouseId) : null
    const reference = body.reference ? String(body.reference) : null
    const notes = body.notes ? String(body.notes) : null

    if (!['in', 'out', 'adjust'].includes(type))
      return NextResponse.json({ error: 'نوع حرکت نامعتبر است' }, { status: 400 })
    if (!['product', 'material'].includes(itemType))
      return NextResponse.json({ error: 'نوع قلم نامعتبر است' }, { status: 400 })
    if (!itemId) return NextResponse.json({ error: 'قلم انتخاب نشده است' }, { status: 400 })
    if (!quantity || isNaN(quantity) || quantity <= 0)
      return NextResponse.json({ error: 'مقدار باید بزرگ‌تر از صفر باشد' }, { status: 400 })

    const created = await db.$transaction(async (tx) => {
      const item =
        itemType === 'product'
          ? await tx.product.findUnique({ where: { id: itemId } })
          : await tx.rawMaterial.findUnique({ where: { id: itemId } })
      if (!item) throw new HttpError(404, 'قلم مورد نظر یافت نشد')

      let newStock = item.stock
      let txQty = quantity
      if (type === 'in') {
        newStock = item.stock + quantity
      } else if (type === 'out') {
        newStock = item.stock - quantity
        if (newStock < 0) throw new HttpError(400, 'موجودی کافی نیست')
      } else {
        // اصلاح: مقدار واردشده به‌صورت مطلق تنظیم می‌شود
        newStock = quantity
        txQty = Math.abs(quantity - item.stock)
      }

      if (itemType === 'product') {
        await tx.product.update({ where: { id: itemId }, data: { stock: newStock } })
      } else {
        await tx.rawMaterial.update({ where: { id: itemId }, data: { stock: newStock } })
      }

      return tx.inventoryTransaction.create({
        data: {
          type,
          itemType,
          itemId,
          itemName: item.name,
          unit: item.unit,
          quantity: txQty,
          warehouseId,
          reference,
          notes,
        },
        include: { warehouse: true },
      })
    })

    const session = await getSessionFromRequest(req)
    const typeFa = type === 'in' ? 'ورود' : type === 'out' ? 'خروج' : 'اصلاح'
    await logAudit(session, 'adjust', 'inventory', created.id, `${typeFa} ${created.quantity} ${created.unit} — ${created.itemName}`)

    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if (e instanceof HttpError)
      return NextResponse.json({ error: e.message }, { status: e.status })
    console.error('inventory POST', e)
    return NextResponse.json({ error: 'خطا در ثبت حرکت انبار' }, { status: 500 })
  }
}
