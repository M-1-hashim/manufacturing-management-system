import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

// PUT /api/expenses/[id] — تصحیح مصرف
export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const body = await req.json()
    const existing = await db.expense.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'مصرف یافت نشد' }, { status: 404 })

    const description =
      body.description !== undefined ? String(body.description).trim() : existing.description
    if (!description) {
      return NextResponse.json({ error: 'توضیح مصرف ضروری است' }, { status: 400 })
    }
    const amount = body.amount !== undefined ? Number(body.amount) : existing.amount
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'مقدار مصرف باید بزرگ‌تر از صفر باشد' }, { status: 400 })
    }
    const currency = ['AFN', 'USD', 'PKR'].includes(body.currency) ? body.currency : existing.currency
    let date = existing.date
    if (body.date) {
      const parsed = new Date(body.date)
      if (!isNaN(parsed.getTime())) date = parsed
    }
    const expense = await db.expense.update({
      where: { id },
      data: {
        date,
        category: body.category !== undefined ? String(body.category) : existing.category,
        description,
        amount,
        currency,
      },
    })
    return NextResponse.json(expense)
  } catch (e) {
    console.error('expenses PUT [id]', e)
    return NextResponse.json({ error: 'خطا در تصحیح مصرف' }, { status: 500 })
  }
}

// DELETE /api/expenses/[id] — حذف مصرف
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params
    const existing = await db.expense.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'مصرف یافت نشد' }, { status: 404 })
    await db.expense.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('expenses DELETE [id]', e)
    return NextResponse.json({ error: 'خطا در حذف مصرف' }, { status: 500 })
  }
}
