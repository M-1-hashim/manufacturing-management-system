'use client'

/**
 * هندلرهای تأمین‌کننده‌ها — آینهٔ src/app/api/suppliers/**
 * همهٔ پاسخ‌ها _count.materials دارند؛ DELETE برای تأمین‌کنندهٔ دارای ماده مسدود است
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalSupplier extends Row {
  name: string
  phone: string | null
  address: string | null
  notes: string | null
}

interface MaterialRef extends Row {
  supplierId: string | null
}

/** تأمین‌کننده همراه تعداد مواد خام */
function withCount(s: LocalSupplier): LocalSupplier & { _count: { materials: number } } {
  const count = readCol<MaterialRef>('rawMaterials').filter((m) => m.supplierId === s.id).length
  return { ...s, _count: { materials: count } }
}

/** مرتب‌سازی صعودی نام — مطابق orderBy: { name: 'asc' } پریمایز */
function byNameAsc(a: LocalSupplier, b: LocalSupplier): number {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

export const routes: RouteDef[] = [
  // GET /api/suppliers
  route('GET', '/api/suppliers', () =>
    readCol<LocalSupplier>('suppliers').sort(byNameAsc).map(withCount)
  ),

  // POST /api/suppliers — ثبت تأمین‌کننده جدید
  route('POST', '/api/suppliers', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    if (!name) throw new ApiError(400, 'نام تأمین‌کننده الزامی است')

    const sups = readCol<LocalSupplier>('suppliers')
    const created: LocalSupplier = newRow({
      name,
      phone: body.phone ? String(body.phone) : null,
      address: body.address ? String(body.address) : null,
      notes: body.notes ? String(body.notes) : null,
    })
    sups.push(created)
    writeCol('suppliers', sups)
    return withCount(created)
  }),

  // PUT /api/suppliers/:id — تصحیح جزئی (فیلدهای ارسال‌شده)
  route('PUT', '/api/suppliers/:id', (ctx, params) => {
    const sups = readCol<LocalSupplier>('suppliers')
    const existing = sups.find((s) => s.id === params[0])
    if (!existing) throw new ApiError(404, 'تأمین‌کننده یافت نشد')

    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const data: Partial<LocalSupplier> = {}
    if ('name' in body) {
      const v = String(body.name ?? '').trim()
      if (!v) throw new ApiError(400, 'نام تأمین‌کننده الزامی است')
      data.name = v
    }
    if ('phone' in body) data.phone = body.phone ? String(body.phone) : null
    if ('address' in body) data.address = body.address ? String(body.address) : null
    if ('notes' in body) data.notes = body.notes ? String(body.notes) : null

    const updated = withUpdate(existing, data)
    writeCol('suppliers', sups.map((s) => (s.id === existing.id ? updated : s)))
    return withCount(updated)
  }),

  // DELETE /api/suppliers/:id — حذف فقط اگر ماده خامی به او ثبت نشده باشد
  route('DELETE', '/api/suppliers/:id', (_ctx, params) => {
    const sups = readCol<LocalSupplier>('suppliers')
    const existing = sups.find((s) => s.id === params[0])
    if (!existing) throw new ApiError(404, 'تأمین‌کننده یافت نشد')

    const count = readCol<MaterialRef>('rawMaterials').filter((m) => m.supplierId === existing.id).length
    if (count > 0) throw new ApiError(400, 'قابل حذف نیست؛ مواد خام به این تأمین‌کننده ثبت شده است')

    writeCol('suppliers', sups.filter((s) => s.id !== existing.id))
    return { ok: true }
  }),
]
