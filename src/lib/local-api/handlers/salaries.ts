'use client'

/**
 * هندلرهای پرداخت معاش — آینهٔ src/app/api/salaries/route.ts و [id]/route.ts
 * GET با ضمیمهٔ کارمند {name} — ترتیب date و سپس createdAt نزولی (حداکثر 500)
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, writeCol, type Row } from '../db'

interface LocalSalaryPayment extends Row {
  employeeId: string
  month: string
  amount: number
  date: string
  notes: string | null
}
interface LocalEmployee extends Row {
  name: string
}

function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

function withEmployee(s: LocalSalaryPayment, employees: LocalEmployee[]) {
  const emp = employees.find((e) => e.id === s.employeeId)
  return { ...s, employee: emp ? { name: emp.name } : null }
}

export const routes: RouteDef[] = [
  // GET /api/salaries?employeeId= — پرداخت‌های معاش
  route('GET', '/api/salaries', (ctx) => {
    const employeeId = ctx.url.searchParams.get('employeeId') || undefined
    const rows = readCol<LocalSalaryPayment>('salaries').filter(
      (s) => !employeeId || s.employeeId === employeeId
    )
    rows.sort((a, b) => timeOf(b.date) - timeOf(a.date) || timeOf(b.createdAt) - timeOf(a.createdAt))

    const employees = readCol<LocalEmployee>('employees')
    return rows.slice(0, 500).map((s) => withEmployee(s, employees))
  }),

  // POST /api/salaries — ثبت پرداخت معاش
  route('POST', '/api/salaries', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const employeeId = String(body.employeeId ?? '')
    const month = String(body.month ?? '').trim()
    const amount = Number(body.amount)
    const notes = body.notes ? String(body.notes) : null

    if (!employeeId) throw new ApiError(400, 'کارمند انتخاب نشده است')
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new ApiError(400, 'ماه باید به شکل 1403-01 باشد')
    }
    if (!amount || isNaN(amount) || amount <= 0) {
      throw new ApiError(400, 'مبلغ باید زیادتر از صفر باشد')
    }

    const employees = readCol<LocalEmployee>('employees')
    const employee = employees.find((e) => e.id === employeeId)
    if (!employee) throw new ApiError(404, 'کارمند یافت نشد')

    // مثل هاست — تاریخ نامعتبر خطای ثبت می‌دهد
    let date = new Date()
    if (body.date) {
      const parsed = new Date(String(body.date))
      if (isNaN(parsed.getTime())) throw new ApiError(500, 'خطا در ثبت پرداخت معاش')
      date = parsed
    }

    const row = newRow({
      employeeId,
      month,
      amount,
      date: date.toISOString(),
      notes,
    })
    writeCol('salaries', [...readCol<LocalSalaryPayment>('salaries'), row])
    return withEmployee(row, employees)
  }),

  // DELETE /api/salaries/:id — حذف پرداخت معاش
  route('DELETE', '/api/salaries/:id', (_ctx, params) => {
    const id = params[0]
    const rows = readCol<LocalSalaryPayment>('salaries')
    const existing = rows.find((s) => s.id === id)
    if (!existing) throw new ApiError(404, 'پرداخت یافت نشد')
    writeCol('salaries', rows.filter((s) => s.id !== id))
    return { ok: true }
  }),
]
