'use client'

/**
 * هندلرهای محصولات — آینهٔ src/app/api/products/**
 * GET لیست با فیلترها (search/categoryId/active/stock) و کتگوری توکار؛
 * POST با بررسی یکتایی کود؛ PUT جزئی؛ DELETE با حفاظت سوابق فروش/فورمولا/تولید
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { byDateDesc, newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalCategory extends Row {
  name: string
}

interface LocalProduct extends Row {
  code: string
  name: string
  categoryId: string | null
  unit: string
  barcode: string | null
  description: string | null
  costPrice: number
  salePrice: number
  wholesalePrice: number
  minStock: number
  stock: number
  active: boolean
}

function toNum(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = Number(v)
  return Number.isNaN(n) ? null : n
}

/** محصول همراه کتگوری — مطابق include: { category: true } پریمایز */
function withCategory(p: LocalProduct): LocalProduct & { category: LocalCategory | null } {
  const cat = readCol<LocalCategory>('productCategories').find((c) => c.id === p.categoryId) ?? null
  return { ...p, category: cat }
}

export const routes: RouteDef[] = [
  // GET /api/products — فیلترهای اختیاری: search، categoryId، active، stock
  route('GET', '/api/products', (ctx) => {
    const sp = ctx.url.searchParams
    const search = (sp.get('search') ?? '').trim().toLowerCase()
    const categoryId = sp.get('categoryId') ?? ''
    const active = sp.get('active') ?? ''
    const stock = sp.get('stock') ?? ''

    let out = readCol<LocalProduct>('products').sort(byDateDesc('createdAt'))
    if (search) {
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(search) ||
          p.code.toLowerCase().includes(search) ||
          String(p.barcode ?? '').toLowerCase().includes(search)
      )
    }
    if (categoryId) out = out.filter((p) => p.categoryId === categoryId)
    if (active === 'true') out = out.filter((p) => p.active)
    if (active === 'false') out = out.filter((p) => !p.active)
    if (stock === 'low') out = out.filter((p) => Number(p.stock) <= Number(p.minStock))
    if (stock === 'out') out = out.filter((p) => Number(p.stock) <= 0)
    return out.map(withCategory)
  }),

  // POST /api/products — ثبت محصول جدید (کود یکتا + مقادیر غیرمنفی)
  route('POST', '/api/products', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    const code = String(body.code ?? '').trim()
    if (!name || !code) throw new ApiError(400, 'نام و کود محصول الزامی است')

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
      if (v !== null && v < 0) throw new ApiError(400, `${label} نمی‌تواند منفی باشد`)
    }

    let categoryId: string | null = null
    if (body.categoryId) {
      const cat = readCol<LocalCategory>('productCategories').find((c) => c.id === String(body.categoryId))
      if (!cat) throw new ApiError(400, 'کتگوری یافت نشد')
      categoryId = cat.id
    }

    const prods = readCol<LocalProduct>('products')
    // شبیه‌سازی خطای یکتایی کود (P2002)
    if (prods.some((p) => p.code === code)) {
      throw new ApiError(400, 'کود تکراری است؛ کود دیگری انتخاب کنید')
    }

    const created: LocalProduct = newRow({
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
    })
    prods.push(created)
    writeCol('products', prods)
    return withCategory(created)
  }),

  // GET /api/products/:id — یک محصول همراه کتگوری
  route('GET', '/api/products/:id', (_ctx, params) => {
    const p = readCol<LocalProduct>('products').find((x) => x.id === params[0])
    if (!p) throw new ApiError(404, 'محصول یافت نشد')
    return withCategory(p)
  }),

  // PUT /api/products/:id — تصحیح جزئی (فیلدهای ارسال‌شده)
  route('PUT', '/api/products/:id', (ctx, params) => {
    const id = params[0]
    const prods = readCol<LocalProduct>('products')
    const existing = prods.find((p) => p.id === id)
    if (!existing) throw new ApiError(404, 'محصول یافت نشد')

    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const data: Partial<LocalProduct> = {}

    if ('name' in body) {
      const v = String(body.name ?? '').trim()
      if (!v) throw new ApiError(400, 'نام محصول الزامی است')
      data.name = v
    }
    if ('code' in body) {
      const v = String(body.code ?? '').trim()
      if (!v) throw new ApiError(400, 'کود محصول الزامی است')
      data.code = v
    }
    if ('categoryId' in body) {
      const cid = body.categoryId ? String(body.categoryId) : ''
      if (cid) {
        const cat = readCol<LocalCategory>('productCategories').find((c) => c.id === cid)
        if (!cat) throw new ApiError(400, 'کتگوری یافت نشد')
        data.categoryId = cat.id
      } else {
        data.categoryId = null
      }
    }
    if ('unit' in body) data.unit = String(body.unit ?? 'عدد')
    if ('barcode' in body) data.barcode = body.barcode ? String(body.barcode) : null
    if ('description' in body) data.description = body.description ? String(body.description) : null

    const numFields = ['salePrice', 'wholesalePrice', 'costPrice', 'minStock', 'stock'] as const
    for (const f of numFields) {
      if (f in body) {
        const n = Number(body[f])
        if (Number.isNaN(n) || n < 0) throw new ApiError(400, 'مقادیر عددی نمی‌توانند منفی باشند')
        data[f] = n
      }
    }
    if ('active' in body) data.active = !!body.active

    // شبیه‌سازی خطای یکتایی کود (P2002) — استثنای خود رکورد
    const dupCode = data.code ?? existing.code
    if (prods.some((p) => p.code === dupCode && p.id !== id)) {
      throw new ApiError(400, 'کود تکراری است؛ کود دیگری انتخاب کنید')
    }

    const updated = withUpdate(existing, data)
    writeCol('products', prods.map((p) => (p.id === id ? updated : p)))
    return withCategory(updated)
  }),

  // DELETE /api/products/:id — حذف فقط اگر سوابق فروش/فورمولا/تولید نداشته باشد
  route('DELETE', '/api/products/:id', (_ctx, params) => {
    const id = params[0]
    const used =
      readCol<Row>('saleItems').some((s) => s.productId === id) ||
      readCol<Row>('formulas').some((f) => f.productId === id) ||
      readCol<Row>('productionOrders').some((o) => o.productId === id)
    if (used) throw new ApiError(400, 'قابل حذف نیست؛ سوابق فروش/تولید دارد')

    const prods = readCol<LocalProduct>('products')
    if (!prods.some((p) => p.id === id)) throw new ApiError(404, 'محصول یافت نشد')
    writeCol('products', prods.filter((p) => p.id !== id))
    return { ok: true }
  }),
]
