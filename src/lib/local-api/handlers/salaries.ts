'use client'

/**
 * هندلرهای پرداخت معاش — آینهٔ src/app/api/salaries/route.ts، preview/route.ts و [id]/route.ts
 * GET با ضمیمهٔ کارمند {name} — ترتیب date و سپس createdAt نزولی (حداکثر 500)
 * کسر خودکار غیبت مثل هاست: روزهای غایب ماه شمسی × نرخ روزانه (absentDeductionPerDay یا ۱/۳۰ معاش)
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, writeCol, getSetting, type Row } from '../db'
import { tallyAttendance, absenceDeduction } from '@/lib/salary-deduction'
import type { LocalAttendance } from './attendance'

interface LocalSalaryPayment extends Row {
  employeeId: string
  month: string
  amount: number
  absentDays: number
  deduction: number
  date: string
  notes: string | null
}
interface LocalEmployee extends Row {
  name: string
  salary?: number
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
  // GET /api/salaries/preview?employeeId=&month= — پیش‌نمایش کسر غیبت (قبل از /api/salaries/:id)
  route('GET', '/api/salaries/preview', (ctx) => {
    const employeeId = String(ctx.url.searchParams.get('employeeId') ?? '')
    const month = String(ctx.url.searchParams.get('month') ?? '').trim()
    if (!employeeId) throw new ApiError(400, 'کارمند انتخاب نشده است')
    if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError(400, 'ماه باید به شکل 1403-01 باشد')

    const employees = readCol<LocalEmployee>('employees')
    const employee = employees.find((e) => e.id === employeeId)
    if (!employee) throw new ApiError(404, 'کارمند یافت نشد')
    const salary = Number(employee.salary) || 0

    const attRows = readCol<LocalAttendance>('attendance').filter(
      (a) => a.employeeId === employeeId
    )
    const stats = tallyAttendance(attRows, month)
    const { perDay, deduction } = absenceDeduction(
      salary,
      stats.absentDays,
      getSetting('absentDeductionPerDay')
    )
    const suggestedAmount = Math.max(0, Math.round((salary - deduction) * 100) / 100)

    const paid = readCol<LocalSalaryPayment>('salaries').find(
      (s) => s.employeeId === employeeId && s.month === month
    )

    return {
      salary,
      absentDays: stats.absentDays,
      presentDays: stats.presentDays,
      leaveDays: stats.leaveDays,
      rangeOk: stats.rangeOk,
      perDay,
      deduction,
      suggestedAmount,
      alreadyPaid: paid ? paid.amount : null,
    }
  }),

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

    // کسر خودکار غیبت — مثل هاست (applyDeduction=false → پرداخت کامل دستی)
    const attRows = readCol<LocalAttendance>('attendance').filter(
      (a) => a.employeeId === employeeId
    )
    const stats = tallyAttendance(attRows, month)
    const applyDeduction = body.applyDeduction !== false
    const { deduction } = absenceDeduction(
      Number(employee.salary) || 0,
      stats.absentDays,
      getSetting('absentDeductionPerDay')
    )

    const row = newRow({
      employeeId,
      month,
      amount,
      absentDays: stats.absentDays,
      deduction: applyDeduction ? deduction : 0,
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
