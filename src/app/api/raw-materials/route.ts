import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/raw-materials — مواد خام همراه تأمین‌کننده (فیلترهای اختیاری: search, supplierId, stock)
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const search = (searchParams.get('search') ?? '').trim()
    const supplierId = searchParams.get('supplierId') ?? ''
    const stock = searchParams.get('stock') ?? ''

    // دیتاست کوچک است — همه را می‌گیریم و در JS فیلتر می‌کنیم
    const rows = await db.rawMaterial.findMany({
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
    })

    let out = rows
    if (search) {
      const s = search.toLowerCase()
      out = out.filter(
        (m) => m.name.toLowerCase().includes(s) || m.code.toLowerCase().includes(s)
      )
    }
    if (supplierId) out = out.filter((m) => m.supplierId === supplierId)
    if (stock === 'low') out = out.filter((m) => m.stock <= m.minStock)

    return NextResponse.json(out)
  } catch (e) {
    console.error('raw-materials GET', e)
    return NextResponse.json({ error: 'خطا در دریافت مواد خام' }, { status: 500 })
  }
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function toDate(v: unknown): Date | null {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// POST /api/raw-materials — ثبت ماده خام جدید
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>
    const name = String(body.name ?? '').trim()
    const code = String(body.code ?? '').trim()
    if (!name || !code) {
      return NextResponse.json({ error: 'نام و کود ماده خام الزامی است' }, { status: 400 })
    }

    const purchasePrice = toNum(body.purchasePrice)
    const stock = toNum(body.stock)
    const minStock = toNum(body.minStock)
    const maxStock = toNum(body.maxStock)
    const checks: [string, number | null][] = [
      ['قیمت خرید', purchasePrice],
      ['موجودی', stock],
      ['حداقل موجودی', minStock],
      ['حداکثر موجودی', maxStock],
    ]
    for (const [label, v] of checks) {
      if (v !== null && v < 0) {
        return NextResponse.json({ error: `${label} نمی‌تواند منفی باشد` }, { status: 400 })
      }
    }
    if (purchasePrice === null) {
      return NextResponse.json({ error: 'قیمت خرید الزامی است' }, { status: 400 })
    }

    // بررسی وجود تأمین‌کننده در صورت ارسال
    let supplierId: string | null = null
    if (body.supplierId) {
      const sup = await db.supplier.findUnique({ where: { id: String(body.supplierId) } })
      if (!sup) return NextResponse.json({ error: 'تأمین‌کننده یافت نشد' }, { status: 400 })
      supplierId = sup.id
    }

    const created = await db.rawMaterial.create({
      data: {
        name,
        code,
        unit: body.unit ? String(body.unit) : 'کیلوگرام',
        purchasePrice,
        stock: stock ?? 0,
        minStock: minStock ?? 0,
        maxStock: maxStock ?? 0,
        expiryDate: toDate(body.expiryDate),
        supplierId,
        notes: body.notes ? String(body.notes) : null,
      },
      include: { supplier: true },
    })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'کود تکراری است؛ کود دیگری انتخاب کنید' }, { status: 400 })
    }
    console.error('raw-materials POST', e)
    return NextResponse.json({ error: 'خطا در ثبت ماده خام' }, { status: 500 })
  }
}
