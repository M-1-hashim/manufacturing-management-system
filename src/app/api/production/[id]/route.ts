import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const ORDER_INCLUDE = {
  formula: { include: { items: { include: { rawMaterial: true } } } },
  product: true,
} as const

// GET /api/production/[id] — یک سفارش تولید با تفصیلات
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const order = await db.productionOrder.findUnique({
      where: { id },
      include: ORDER_INCLUDE,
    })
    if (!order) {
      return NextResponse.json({ error: 'سفارش تولید یافت نشد' }, { status: 404 })
    }
    return NextResponse.json(order)
  } catch (e) {
    console.error('production GET [id]', e)
    return NextResponse.json({ error: 'خطا در دریافت سفارش' }, { status: 500 })
  }
}

// PUT /api/production/[id] — تجدید محدود: qcStatus، qcNotes، notes و وضعیت
// (تکمیل تولید فقط از طریق /complete انجام می‌شود)
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const body = await req.json()
    const existing = await db.productionOrder.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'سفارش تولید یافت نشد' }, { status: 404 })
    }
    if (existing.status === 'completed') {
      return NextResponse.json({ error: 'سفارش تکمیل‌شده قابل تغییر نیست' }, { status: 400 })
    }

    const data: Record<string, unknown> = {}

    if (body.qcStatus !== undefined) {
      if (body.qcStatus !== null && !['passed', 'failed', 'pending'].includes(body.qcStatus)) {
        return NextResponse.json({ error: 'وضعیت کنترل کیفیت نامعتبر است' }, { status: 400 })
      }
      data.qcStatus = body.qcStatus
    }
    if (body.qcNotes !== undefined) {
      data.qcNotes = typeof body.qcNotes === 'string' && body.qcNotes.trim() ? body.qcNotes.trim() : null
    }
    if (body.notes !== undefined) {
      data.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null
    }
    if (body.status !== undefined) {
      // فقط انتقال به «در جریان»، «در انتظار» یا «لغو» مجاز است
      if (!['pending', 'in_progress', 'cancelled'].includes(body.status)) {
        return NextResponse.json(
          { error: 'تغییر وضعیت به این مقدار مجاز نیست. تکمیل تولید از دکمه «تکمیل تولید» انجام شود.' },
          { status: 400 },
        )
      }
      if (existing.status === 'cancelled' && body.status !== 'cancelled') {
        return NextResponse.json({ error: 'سفارش لغوشده قابل تغییر نیست' }, { status: 400 })
      }
      data.status = body.status
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'فیلد قابل تجدید ارسال نشده است' }, { status: 400 })
    }

    const updated = await db.productionOrder.update({
      where: { id },
      data,
      include: ORDER_INCLUDE,
    })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('production PUT [id]', e)
    return NextResponse.json({ error: 'خطا در تجدید سفارش' }, { status: 500 })
  }
}

// DELETE /api/production/[id] — حذف سفارش (فقط در وضعیت «در انتظار»)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const existing = await db.productionOrder.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'سفارش تولید یافت نشد' }, { status: 404 })
    }
    if (existing.status !== 'pending') {
      return NextResponse.json(
        { error: 'فقط سفارش‌های در انتظار قابل حذف هستند. سفارش در جریان را لغو کنید.' },
        { status: 400 },
      )
    }
    await db.productionOrder.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('production DELETE [id]', e)
    return NextResponse.json({ error: 'خطا در حذف سفارش' }, { status: 500 })
  }
}
