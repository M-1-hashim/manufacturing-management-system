'use client'

/**
 * هندلرهای مصارف — آینهٔ src/app/api/expenses/route.ts و [id]/route.ts
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalExpense extends Row {
  date: string
  category: string
  description: string
  amount: number
  currency: string
}

function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

export const routes: RouteDef[] = [
  // GET /api/expenses?category= — لیست مصارف (جدید به قدیم)
  route('GET', '/api/expenses', (ctx) => {
    const category = ctx.url.searchParams.get('category') || undefined
    const expenses = readCol<LocalExpense>('expenses').filter(
      (e) => !category || e.category === category
    )
    expenses.sort((a, b) => timeOf(b.date) - timeOf(a.date))
    return expenses
  }),

  // POST /api/expenses — ثبت مصرف جدید
  route('POST', '/api/expenses', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const description = String(body.description || '').trim()
    const amount = Number(body.amount)
    if (!description) throw new ApiError(400, 'توضیح مصرف ضروری است')
    if (isNaN(amount) || amount <= 0) {
      throw new ApiError(400, 'مقدار مصرف باید زیادتر از صفر باشد')
    }
    const currency = ['AFN', 'USD', 'PKR'].includes(String(body.currency)) ? String(body.currency) : 'AFN'
    let date = body.date ? new Date(String(body.date)) : new Date()
    if (isNaN(date.getTime())) date = new Date()

    const expense = newRow({
      date: date.toISOString(),
      category: body.category ? String(body.category) : 'عمومی',
      description,
      amount,
      currency,
    })
    writeCol('expenses', [...readCol<LocalExpense>('expenses'), expense])
    return expense
  }),

  // PUT /api/expenses/:id — تصحیح مصرف (فیلدهای فرستاده‌شده عوض می‌شوند)
  route('PUT', '/api/expenses/:id', (ctx, params) => {
    const id = params[0]
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const expenses = readCol<LocalExpense>('expenses')
    const existing = expenses.find((e) => e.id === id)
    if (!existing) throw new ApiError(404, 'مصرف یافت نشد')

    const description =
      body.description !== undefined ? String(body.description).trim() : existing.description
    if (!description) throw new ApiError(400, 'توضیح مصرف ضروری است')

    const amount = body.amount !== undefined ? Number(body.amount) : existing.amount
    if (isNaN(amount) || amount <= 0) {
      throw new ApiError(400, 'مقدار مصرف باید زیادتر از صفر باشد')
    }

    const currency = ['AFN', 'USD', 'PKR'].includes(String(body.currency))
      ? String(body.currency)
      : existing.currency
    let date = existing.date
    if (body.date) {
      const parsed = new Date(String(body.date))
      if (!isNaN(parsed.getTime())) date = parsed.toISOString()
    }
    const category = body.category !== undefined ? String(body.category) : existing.category

    const updated = withUpdate(existing, { date, category, description, amount, currency })
    writeCol('expenses', expenses.map((e) => (e.id === id ? updated : e)))
    return updated
  }),

  // DELETE /api/expenses/:id — حذف مصرف
  route('DELETE', '/api/expenses/:id', (_ctx, params) => {
    const id = params[0]
    const expenses = readCol<LocalExpense>('expenses')
    const existing = expenses.find((e) => e.id === id)
    if (!existing) throw new ApiError(404, 'مصرف یافت نشد')
    writeCol('expenses', expenses.filter((e) => e.id !== id))
    return { ok: true }
  }),
]
