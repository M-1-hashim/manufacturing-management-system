import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/raw-materials/[id] — یک ماده خام همراه تأمین‌کننده
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const material = await db.rawMaterial.findUnique({
      where: { id },
      include: { supplier: true },
    })
    if (!material) {
      return NextResponse.json({ error: 'ماده خام یافت نشد' }, { status: 404 })
    }
    return NextResponse.json(material)
  } catch (e) {
    console.error('raw-material GET', e)
    return NextResponse.json({ error: 'خطا در دریافت ماده خام' }, { status: 500 })
  }
}

// PUT /api/raw-materials/[id] — تصحیح ماده خام (فیلدهای ارسال‌شده)
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const existing = await db.rawMaterial.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'ماده خام یافت نشد' }, { status: 404 })
    }

    const body = (await req.json()) as Record<string, unknown>
    const data: Record<string, unknown> = {}

    if ('name' in body) {
      const v = String(body.name ?? '').trim()
      if (!v) return NextResponse.json({ error: 'نام ماده خام الزامی است' }, { status: 400 })
      data.name = v
    }
    if ('code' in body) {
      const v = String(body.code ?? '').trim()
      if (!v) return NextResponse.json({ error: 'کود ماده خام الزامی است' }, { status: 400 })
      data.code = v
    }
    if ('unit' in body) data.unit = String(body.unit ?? 'کیلوگرام')
    if ('supplierId' in body) {
      const sid = body.supplierId ? String(body.supplierId) : ''
      if (sid) {
        const sup = await db.supplier.findUnique({ where: { id: sid } })
        if (!sup) return NextResponse.json({ error: 'تأمین‌کننده یافت نشد' }, { status: 400 })
        data.supplierId = sup.id
      } else {
        data.supplierId = null
      }
    }
    if ('expiryDate' in body) {
      if (body.expiryDate && typeof body.expiryDate === 'string') {
        const d = new Date(body.expiryDate)
        data.expiryDate = isNaN(d.getTime()) ? null : d
      } else {
        data.expiryDate = null
      }
    }
    if ('notes' in body) data.notes = body.notes ? String(body.notes) : null

    const numFields = ['purchasePrice', 'stock', 'minStock', 'maxStock'] as const
    for (const f of numFields) {
      if (f in body) {
        const n = Number(body[f])
        if (isNaN(n) || n < 0) {
          return NextResponse.json({ error: 'مقادیر عددی نمی‌توانند منفی باشند' }, { status: 400 })
        }
        data[f] = n
      }
    }

    const updated = await db.rawMaterial.update({
      where: { id },
      data,
      include: { supplier: true },
    })
    return NextResponse.json(updated)
  } catch (e) {
    if ((e as { code?: string })?.code === 'P2002') {
      return NextResponse.json({ error: 'کود تکراری است؛ کود دیگری انتخاب کنید' }, { status: 400 })
    }
    console.error('raw-material PUT', e)
    return NextResponse.json({ error: 'خطا در تصحیح ماده خام' }, { status: 500 })
  }
}

// DELETE /api/raw-materials/[id] — حذف ماده خام (اگر در فورمولاها استفاده نشده باشد)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const used = await db.formulaItem.count({ where: { rawMaterialId: id } })
    if (used > 0) {
      return NextResponse.json(
        { error: 'قابل حذف نیست؛ در فورمولاهای تولید استفاده شده است' },
        { status: 400 }
      )
    }
    await db.rawMaterial.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('raw-material DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف ماده خام' }, { status: 500 })
  }
}
