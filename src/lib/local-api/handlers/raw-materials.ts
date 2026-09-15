'use client'

/**
 * هندلرهای مواد خام — آینهٔ src/app/api/raw-materials/**
 * GET/POST/PUT همیشه با تأمین‌کنندهٔ توکار (include: { supplier: true })؛
 * DELETE فقط اگر ماده در فورمولاهای تولید استفاده نشده باشد
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { byDateDesc, newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalSupplier extends Row {
  name: string
}

interface LocalMaterial extends Row {
  code: string
  name: string
  unit: string
  purchasePrice: number
  stock: number
  minStock: number
  maxStock: number
  expiryDate: string | null
  supplierId: string | null
  notes: string | null
}

interface FormulaItemRef extends Row {
  rawMaterialId: string
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

function toDateISO(v: unknown): string | null {
  if (!v || typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** ماده خام همراه تأمین‌کننده — مطابق include: { supplier: true } پریمایز */
function withSupplier(m: LocalMaterial): LocalMaterial & { supplier: LocalSupplier | null } {
  const supplier = m.supplierId
    ? readCol<LocalSupplier>('suppliers').find((s) => s.id === m.supplierId) ?? null
    : null
  return { ...m, supplier }
}

export const routes: RouteDef[] = [
  // GET /api/raw-materials — فیلترهای اختیاری: search، supplierId، stock=low
  route('GET', '/api/raw-materials', (ctx) => {
    const sp = ctx.url.searchParams
    const search = (sp.get('search') ?? '').trim().toLowerCase()
    const supplierId = sp.get('supplierId') ?? ''
    const stock = sp.get('stock') ?? ''

    let out = readCol<LocalMaterial>('rawMaterials').sort(byDateDesc('createdAt'))
    if (search) {
      out = out.filter(
        (m) => m.name.toLowerCase().includes(search) || m.code.toLowerCase().includes(search)
      )
    }
    if (supplierId) out = out.filter((m) => m.supplierId === supplierId)
    if (stock === 'low') out = out.filter((m) => Number(m.stock) <= Number(m.minStock))
    return out.map(withSupplier)
  }),

  // POST /api/raw-materials — ثبت ماده خام جدید (کود یکتا + قیمت خرید الزامی)
  route('POST', '/api/raw-materials', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    const code = String(body.code ?? '').trim()
    if (!name || !code) throw new ApiError(400, 'نام و کود ماده خام الزامی است')

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
      if (v !== null && v < 0) throw new ApiError(400, `${label} نمی‌تواند منفی باشد`)
    }
    if (purchasePrice === null) throw new ApiError(400, 'قیمت خرید الزامی است')

    let supplierId: string | null = null
    if (body.supplierId) {
      const sup = readCol<LocalSupplier>('suppliers').find((s) => s.id === String(body.supplierId))
      if (!sup) throw new ApiError(400, 'تأمین‌کننده یافت نشد')
      supplierId = sup.id
    }

    const mats = readCol<LocalMaterial>('rawMaterials')
    // شبیه‌سازی خطای یکتایی کود (P2002)
    if (mats.some((m) => m.code === code)) {
      throw new ApiError(400, 'کود تکراری است؛ کود دیگری انتخاب کنید')
    }

    const created: LocalMaterial = newRow({
      name,
      code,
      unit: body.unit ? String(body.unit) : 'کیلوگرام',
      purchasePrice,
      stock: stock ?? 0,
      minStock: minStock ?? 0,
      maxStock: maxStock ?? 0,
      expiryDate: toDateISO(body.expiryDate),
      supplierId,
      notes: body.notes ? String(body.notes) : null,
    })
    mats.push(created)
    writeCol('rawMaterials', mats)
    return withSupplier(created)
  }),

  // GET /api/raw-materials/:id — یک ماده خام همراه تأمین‌کننده
  route('GET', '/api/raw-materials/:id', (_ctx, params) => {
    const m = readCol<LocalMaterial>('rawMaterials').find((x) => x.id === params[0])
    if (!m) throw new ApiError(404, 'ماده خام یافت نشد')
    return withSupplier(m)
  }),

  // PUT /api/raw-materials/:id — تصحیح جزئی (فیلدهای ارسال‌شده)
  route('PUT', '/api/raw-materials/:id', (ctx, params) => {
    const id = params[0]
    const mats = readCol<LocalMaterial>('rawMaterials')
    const existing = mats.find((m) => m.id === id)
    if (!existing) throw new ApiError(404, 'ماده خام یافت نشد')

    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const data: Partial<LocalMaterial> = {}

    if ('name' in body) {
      const v = String(body.name ?? '').trim()
      if (!v) throw new ApiError(400, 'نام ماده خام الزامی است')
      data.name = v
    }
    if ('code' in body) {
      const v = String(body.code ?? '').trim()
      if (!v) throw new ApiError(400, 'کود ماده خام الزامی است')
      data.code = v
    }
    if ('unit' in body) data.unit = String(body.unit ?? 'کیلوگرام')
    if ('supplierId' in body) {
      const sid = body.supplierId ? String(body.supplierId) : ''
      if (sid) {
        const sup = readCol<LocalSupplier>('suppliers').find((s) => s.id === sid)
        if (!sup) throw new ApiError(400, 'تأمین‌کننده یافت نشد')
        data.supplierId = sup.id
      } else {
        data.supplierId = null
      }
    }
    if ('expiryDate' in body) {
      data.expiryDate =
        body.expiryDate && typeof body.expiryDate === 'string' ? toDateISO(body.expiryDate) : null
    }
    if ('notes' in body) data.notes = body.notes ? String(body.notes) : null

    const numFields = ['purchasePrice', 'stock', 'minStock', 'maxStock'] as const
    for (const f of numFields) {
      if (f in body) {
        const n = Number(body[f])
        if (Number.isNaN(n) || n < 0) throw new ApiError(400, 'مقادیر عددی نمی‌توانند منفی باشند')
        data[f] = n
      }
    }

    // شبیه‌سازی خطای یکتایی کود (P2002) — استثنای خود رکورد
    const dupCode = data.code ?? existing.code
    if (mats.some((m) => m.code === dupCode && m.id !== id)) {
      throw new ApiError(400, 'کود تکراری است؛ کود دیگری انتخاب کنید')
    }

    const updated = withUpdate(existing, data)
    writeCol('rawMaterials', mats.map((m) => (m.id === id ? updated : m)))
    return withSupplier(updated)
  }),

  // DELETE /api/raw-materials/:id — حذف فقط اگر در فورمولاها استفاده نشده باشد
  route('DELETE', '/api/raw-materials/:id', (_ctx, params) => {
    const id = params[0]
    const used = readCol<FormulaItemRef>('formulaItems').some((it) => it.rawMaterialId === id)
    if (used) throw new ApiError(400, 'قابل حذف نیست؛ در فورمولاهای تولید استفاده شده است')

    const mats = readCol<LocalMaterial>('rawMaterials')
    if (!mats.some((m) => m.id === id)) throw new ApiError(404, 'ماده خام یافت نشد')
    writeCol('rawMaterials', mats.filter((m) => m.id !== id))
    return { ok: true }
  }),
]
