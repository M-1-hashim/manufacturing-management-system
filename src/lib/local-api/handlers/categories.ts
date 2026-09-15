'use client'

/**
 * هندلرهای کتگوری محصولات — آینهٔ src/app/api/categories/**
 * همهٔ پاسخ‌ها _count.products دارند (include: { _count: { select: { products: true } } })
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalCategory extends Row {
  name: string
}

/** کتگوری همراه تعداد محصولات */
function withCount(c: LocalCategory): LocalCategory & { _count: { products: number } } {
  const count = readCol<Row>('products').filter((p) => p.categoryId === c.id).length
  return { ...c, _count: { products: count } }
}

/** مرتب‌سازی صعودی نام — مطابق orderBy: { name: 'asc' } پریمایز */
function byNameAsc(a: LocalCategory, b: LocalCategory): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

export const routes: RouteDef[] = [
  // GET /api/categories
  route('GET', '/api/categories', () =>
    readCol<LocalCategory>('productCategories').sort(byNameAsc).map(withCount)
  ),

  // POST /api/categories — ثبت کتگوری (نام یکتا)
  route('POST', '/api/categories', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    if (!name) throw new ApiError(400, 'نام کتگوری الزامی است')

    const cats = readCol<LocalCategory>('productCategories')
    // شبیه‌سازی خطای یکتایی نام (P2002)
    if (cats.some((c) => c.name === name)) throw new ApiError(400, 'نام کتگوری تکراری است')

    const created: LocalCategory = newRow({ name })
    cats.push(created)
    writeCol('productCategories', cats)
    return withCount(created)
  }),

  // PUT /api/categories/:id — تغییر نام کتگوری
  route('PUT', '/api/categories/:id', (ctx, params) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    if (!name) throw new ApiError(400, 'نام کتگوری الزامی است')

    const cats = readCol<LocalCategory>('productCategories')
    const existing = cats.find((c) => c.id === params[0])
    if (!existing) throw new ApiError(404, 'کتگوری یافت نشد')
    if (cats.some((c) => c.name === name && c.id !== existing.id)) {
      throw new ApiError(400, 'نام کتگوری تکراری است')
    }

    const updated = withUpdate(existing, { name })
    writeCol('productCategories', cats.map((c) => (c.id === existing.id ? updated : c)))
    return withCount(updated)
  }),

  // DELETE /api/categories/:id — حذف فقط اگر خالی باشد
  route('DELETE', '/api/categories/:id', (_ctx, params) => {
    const cats = readCol<LocalCategory>('productCategories')
    const existing = cats.find((c) => c.id === params[0])
    if (!existing) throw new ApiError(404, 'کتگوری یافت نشد')

    const count = readCol<Row>('products').filter((p) => p.categoryId === existing.id).length
    if (count > 0) throw new ApiError(400, 'قابل حذف نیست؛ محصولات در این کتگوری ثبت شده‌اند')

    writeCol('productCategories', cats.filter((c) => c.id !== existing.id))
    return { ok: true }
  }),
]
