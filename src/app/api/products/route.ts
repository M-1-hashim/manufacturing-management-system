import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/products — لیست محصولات همراه دسته‌بندی (فیلترهای اختیاری: search, categoryId, active, stock)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') ?? '').trim()
    const categoryId = searchParams.get('categoryId') ?? ''
    const active = searchParams.get('active') ?? ''
    const stock = searchParams.get('stock') ?? ''

    // دیتاست کوچک است — همه را می‌گیریم و در JS فیلتر می‌کنیم
    // (contains در SQLite به حروف بزرگ/کوچک حساس است؛ فیلتر JS با toLowerCase مطمئن‌تر است)
    const rows = await db.product.findMany({
      include: { category: true },
      orderBy: { createdAt: 'desc' },
    })

    let out = rows
    if (search) {
      const s = search.toLowerCase()
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          p.code.toLowerCase().includes(s) ||
          (p.barcode ?? '').toLowerCase().includes(s)
      )
    }
    if (categoryId) out = out.filter((p) => p.categoryId === categoryId)
    if (active === 'true') out = out.filter((p) => p.active)
    if (active === 'false') out = out.filter((p) => !p.active)
    if (stock === 'low') out = out.filter((p) => p.stock <= p.minStock)
    if (stock === 'out') out = out.filter((p) => p.stock <= 0)

    return NextResponse.json(out)
  } catch (e) {
    console.error('products GET', e)
    return NextResponse.json({ error: 'خطا در دریافت محصولات' }, { status: 500 })
  }
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

// POST /api/products — ثبت محصول جدید
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    const code = String(body.code ?? '').trim()
    if (!name || !code) {
      return NextResponse.json({ error: 'نام و کود محصول الزامی است' }, { status: 400 })
    }

    const salePrice = toNum(body.salePrice)
    const wholesalePrice = toNum(body.wholesalePrice)
    const costPrice = toNum(body.costPrice)
    const minStock = toNum(body.minStock)
    const stock = toNum(body.stock)
    const checks: [string, number | null][] = [
      ['قیمت فروش', salePrice],
      ['قیمت عمده', wholesalePrice],
      ['قیمت تمام‌شده', costPrice],
      ['حداقل موجودی', minStock],
      ['موجودی', stock],
    ]
    for (const [label, v] of checks) {
      if (v !== null && v < 0) {
        return NextResponse.json({ error: `${label} نمی‌تواند منفی باشد` }, { status: 400 })
      }
    }

    // بررسی وجود دسته‌بندی در صورت ارسال
    let categoryId: string | null = null
    if (body.categoryId) {
      const cat = await db.productCategory.findUnique({ where: { id: String(body.categoryId) } })
      if (!cat) return NextResponse.json({ error: 'دسته‌بندی یافت نشد' }, { status: 400 })
      categoryId = cat.id
    }

    const created = await db.product.create({
      data: {
        name,
        code,
        categoryId,
        unit: body.unit ? String(body.unit) : 'عدد',
        barcode: body.barcode ? String(body.barcode) : null,
        description: body.description ? String(body.description) : null,
        salePrice: salePrice ?? 0,
        wholesalePrice: wholesalePrice ?? 0,
        costPrice: costPrice ?? 0,
        minStock: minStock ?? 0,
        stock: stock ?? 0,
        active: body.active === undefined ? true : !!body.active,
      },
      include: { category: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'کود تکراری است؛ کود دیگری انتخاب کنید' }, { status: 400 })
    }
    console.error('products POST', e)
    return NextResponse.json({ error: 'خطا در ثبت محصول' }, { status: 500 })
  }
}
