'use client'

/**
 * هندلرهای مشتریان — آینهٔ src/app/api/customers/route.ts و [id]/route.ts
 * _count.sales (تعداد بل‌ها) در همهٔ پاسخ‌ها مثل هاست ضمیمه می‌شود.
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalCustomer extends Row {
  name: string
  phone: string | null
  address: string | null
  type: string // retail | wholesale
  balance: number
  notes: string | null
}
interface LocalSale extends Row {
  customerId: string | null
}

function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

/** شمارش بل‌های مشتری + ضمیمهٔ _count مثل include هاست */
function withCount(c: LocalCustomer, saleCustomerIds: string[]) {
  return { ...c, _count: { sales: saleCustomerIds.filter((id) => id === c.id).length } }
}

export const routes: RouteDef[] = [
  // GET /api/customers — لیست مشتریان با تعداد بل‌ها (نزولی نبود — قدیم به جدید)
  route('GET', '/api/customers', () => {
    const customers = readCol<LocalCustomer>('customers')
    customers.sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
    const saleCustomerIds = readCol<LocalSale>('sales')
      .map((s) => s.customerId)
      .filter((id): id is string => !!id)
    return customers.map((c) => withCount(c, saleCustomerIds))
  }),

  // POST /api/customers — ثبت مشتری جدید
  route('POST', '/api/customers', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name || '').trim()
    if (!name) throw new ApiError(400, 'نام مشتری ضروری است')
    const type = ['retail', 'wholesale'].includes(String(body.type)) ? String(body.type) : 'retail'
    const customer = newRow({
      name,
      phone: body.phone ? String(body.phone) : null,
      address: body.address ? String(body.address) : null,
      type,
      balance: 0,
      notes: body.notes ? String(body.notes) : null,
    })
    writeCol('customers', [...readCol<LocalCustomer>('customers'), customer])
    return withCount(customer, []) // مشتری جدید — صفر بل
  }),

  // PUT /api/customers/:id — تصحیح مشتری
  route('PUT', '/api/customers/:id', (ctx, params) => {
    const id = params[0]
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name || '').trim()
    if (!name) throw new ApiError(400, 'نام مشتری ضروری است')

    const customers = readCol<LocalCustomer>('customers')
    const existing = customers.find((c) => c.id === id)
    if (!existing) throw new ApiError(404, 'مشتری یافت نشد')

    const type = ['retail', 'wholesale'].includes(String(body.type))
      ? String(body.type)
      : existing.type
    const updated = withUpdate(existing, {
      name,
      phone: body.phone ? String(body.phone) : null,
      address: body.address ? String(body.address) : null,
      type,
      notes: body.notes ? String(body.notes) : null,
    })
    writeCol('customers', customers.map((c) => (c.id === id ? updated : c)))

    const saleCustomerIds = readCol<LocalSale>('sales')
      .map((s) => s.customerId)
      .filter((x): x is string => !!x)
    return withCount(updated, saleCustomerIds)
  }),

  // DELETE /api/customers/:id — حذف مشتری (اگر بل داشته باشد ممنوع)
  route('DELETE', '/api/customers/:id', (_ctx, params) => {
    const id = params[0]
    const customers = readCol<LocalCustomer>('customers')
    const existing = customers.find((c) => c.id === id)
    if (!existing) throw new ApiError(404, 'مشتری یافت نشد')

    const salesCount = readCol<LocalSale>('sales').filter((s) => s.customerId === id).length
    if (salesCount > 0) {
      throw new ApiError(400, 'این مشتری بل فروش دارد و قابل حذف نیست')
    }

    writeCol('customers', customers.filter((c) => c.id !== id))
    return { ok: true }
  }),
]
