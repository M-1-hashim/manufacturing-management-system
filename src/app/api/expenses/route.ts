import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/expenses?category= — لیست مصارف
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category') || undefined
    const where: Record<string, string> = {}
    if (category) where.category = category
    const expenses = await db.expense.findMany({
      where,
      orderBy: { date: 'desc' },
    })
    return NextResponse.json(expenses)
  } catch (e) {
    console.error('expenses GET', e)
    return NextResponse.json({ error: 'خطا در دریافت مصارف' }, { status: 500 })
  }
}

// POST /api/expenses — ثبت مصرف جدید
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const description = String(body.description || '').trim()
    const amount = Number(body.amount)
    if (!description) {
      return NextResponse.json({ error: 'توضیح مصرف ضروری است' }, { status: 400 })
    }
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'مقدار مصرف باید زیادتر از صفر باشد' }, { status: 400 })
    }
    const currency = ['AFN', 'USD', 'PKR'].includes(body.currency) ? body.currency : 'AFN'
    let date = body.date ? new Date(body.date) : new Date()
    if (isNaN(date.getTime())) date = new Date()
    const expense = await db.expense.create({
      data: {
        date,
        category: body.category ? String(body.category) : 'عمومی',
        description,
        amount,
        currency,
      },
    })
    return NextResponse.json(expense, { status: 201 })
  } catch (e) {
    console.error('expenses POST', e)
    return NextResponse.json({ error: 'خطا در ثبت مصرف' }, { status: 500 })
  }
}
