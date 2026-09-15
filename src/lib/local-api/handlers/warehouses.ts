'use client'

/**
 * هندلرهای انبارها (گدام‌ها) — آینهٔ src/app/api/warehouses/**
 * GET با _count.transactions؛ DELETE برای انبار دارای گردش مسدود است
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalWarehouse extends Row {
  name: string
  location: string | null
}

/** انبار همراه تعداد گردش‌ها */
function withCount(w: LocalWarehouse): LocalWarehouse & { _count: { transactions: number } } {
  const count = readCol<Row>('inventoryTransactions').filter((t) => t.warehouseId === w.id).length
  return { ...w, _count: { transactions: count } }
}

/** مرتب‌سازی صعودی نام — مطابق orderBy: { name: 'asc' } پریمایز */
function byNameAsc(a: LocalWarehouse, b: LocalWarehouse): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

export const routes: RouteDef[] = [
  // GET /api/warehouses
  route('GET', '/api/warehouses', () =>
    readCol<LocalWarehouse>('warehouses').sort(byNameAsc).map(withCount)
  ),

  // POST /api/warehouses — انبار جدید
  route('POST', '/api/warehouses', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    const location = body.location ? String(body.location) : null
    if (!name) throw new ApiError(400, 'نام انبار الزامی است')

    const whs = readCol<LocalWarehouse>('warehouses')
    const created: LocalWarehouse = newRow({ name, location })
    whs.push(created)
    writeCol('warehouses', whs)
    return created
  }),

  // PUT /api/warehouses/:id — تصحیح انبار
  route('PUT', '/api/warehouses/:id', (ctx, params) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    const location = body.location ? String(body.location) : null
    if (!name) throw new ApiError(400, 'نام انبار الزامی است')

    const whs = readCol<LocalWarehouse>('warehouses')
    const existing = whs.find((w) => w.id === params[0])
    if (!existing) throw new ApiError(404, 'انبار یافت نشد')

    const updated = withUpdate(existing, { name, location })
    writeCol('warehouses', whs.map((w) => (w.id === existing.id ? updated : w)))
    return updated
  }),

  // DELETE /api/warehouses/:id — حذف (مسدود اگر گردش داشته باشد — ترتیب بررسی مطابق هاست)
  route('DELETE', '/api/warehouses/:id', (_ctx, params) => {
    const id = params[0]
    const hasTx = readCol<Row>('inventoryTransactions').some((t) => t.warehouseId === id)
    if (hasTx) throw new ApiError(400, 'این انبار دارای گردش انبار است و قابل حذف نیست')

    const whs = readCol<LocalWarehouse>('warehouses')
    if (!whs.some((w) => w.id === id)) throw new ApiError(404, 'انبار یافت نشد')
    writeCol('warehouses', whs.filter((w) => w.id !== id))
    return { ok: true }
  }),
]
