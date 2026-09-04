import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/categories — دسته‌بندی‌ها همراه تعداد محصولات
export async function GET() {
  try {
    const rows = await db.productCategory.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    })
    return NextResponse.json(rows)
  } catch (e) {
    console.error('categories GET', e)
    return NextResponse.json({ error: 'خطا در دریافت دسته‌بندی‌ها' }, { status: 500 })
  }
}

// POST /api/categories — ثبت دسته‌بندی جدید
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    if (!name) {
      return NextResponse.json({ error: 'نام دسته‌بندی الزامی است' }, { status: 400 })
    }
    const created = await db.productCategory.create({
      data: { name },
      include: { _count: { select: { products: true } } },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'نام دسته‌بندی تکراری است' }, { status: 400 })
    }
    console.error('categories POST', e)
    return NextResponse.json({ error: 'خطا در ثبت دسته‌بندی' }, { status: 500 })
  }
}
