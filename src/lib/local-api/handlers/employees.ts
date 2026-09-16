'use client'

/**
 * هندلرهای کارکنان — آینهٔ src/app/api/employees/route.ts و [id]/route.ts
 * _count.attendance / _count.salaries در GET مثل include هاست ضمیمه می‌شود.
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

interface LocalEmployee extends Row {
  name: string
  position: string
  phone: string | null
  salary: number
  hireDate: string
  active: boolean
}
interface LocalAttendance extends Row {
  employeeId: string
}
interface LocalSalaryPayment extends Row {
  employeeId: string
}

function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

function withCounts(e: LocalEmployee, att: LocalAttendance[], sal: LocalSalaryPayment[]) {
  return {
    ...e,
    _count: {
      attendance: att.filter((a) => a.employeeId === e.id).length,
      salaries: sal.filter((s) => s.employeeId === e.id).length,
    },
  }
}

export const routes: RouteDef[] = [
  // GET /api/employees — فهرست کارکنان با تعداد سوابق (قدیم به جدید)
  route('GET', '/api/employees', () => {
    const employees = readCol<LocalEmployee>('employees')
    employees.sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
    const att = readCol<LocalAttendance>('attendance')
    const sal = readCol<LocalSalaryPayment>('salaries')
    return employees.map((e) => withCounts(e, att, sal))
  }),

  // POST /api/employees — کارمند جدید
  route('POST', '/api/employees', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const name = String(body.name ?? '').trim()
    const position = String(body.position ?? '').trim()
    const phone = body.phone ? String(body.phone) : null
    const salary = Number(body.salary)
    const active = body.active === undefined ? true : Boolean(body.active)

    // ترتیب validation مثل هاست — name → position → salary → hireDate
    if (!name) throw new ApiError(400, 'نام کارمند الزامی است')
    if (!position) throw new ApiError(400, 'وظیفه الزامی است')
    if (!salary || isNaN(salary) || salary <= 0) {
      throw new ApiError(400, 'معاش باید زیادتر از صفر باشد')
    }
    let hireDate: Date | undefined = undefined
    if (body.hireDate) {
      hireDate = new Date(String(body.hireDate))
      if (isNaN(hireDate.getTime())) {
        throw new ApiError(400, 'تاریخ استخدام نامعتبر است')
      }
    }

    const row = newRow({
      name,
      position,
      phone,
      salary,
      active,
      // بدون تاریخ استخدام — پیش‌فرض «اکنون» مثل @default(now())
      hireDate: (hireDate ?? new Date()).toISOString(),
    })
    writeCol('employees', [...readCol<LocalEmployee>('employees'), row])
    return row
  }),

  // PUT /api/employees/:id — تصحیح کارمند
  route('PUT', '/api/employees/:id', (ctx, params) => {
    const id = params[0]
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const employees = readCol<LocalEmployee>('employees')
    const existing = employees.find((e) => e.id === id)
    if (!existing) throw new ApiError(404, 'کارمند یافت نشد')

    const patch: Partial<LocalEmployee> = {}
    if (body.name !== undefined) patch.name = String(body.name).trim()
    if (body.position !== undefined) patch.position = String(body.position).trim()
    if (body.phone !== undefined) patch.phone = body.phone ? String(body.phone) : null
    if (body.salary !== undefined) {
      const salary = Number(body.salary)
      if (!salary || isNaN(salary) || salary <= 0) {
        throw new ApiError(400, 'معاش باید زیادتر از صفر باشد')
      }
      patch.salary = salary
    }
    if (body.hireDate !== undefined && body.hireDate !== null && body.hireDate !== '') {
      const hireDate = new Date(String(body.hireDate))
      if (isNaN(hireDate.getTime())) {
        throw new ApiError(400, 'تاریخ استخدام نامعتبر است')
      }
      patch.hireDate = hireDate.toISOString()
    }
    if (body.active !== undefined) patch.active = Boolean(body.active)

    if (patch.name === '') throw new ApiError(400, 'نام کارمند الزامی است')
    if (patch.position === '') throw new ApiError(400, 'وظیفه الزامی است')

    const updated = withUpdate(existing, patch)
    writeCol('employees', employees.map((e) => (e.id === id ? updated : e)))
    return updated
  }),

  // DELETE /api/employees/:id — حذف (مسدود اگر سوابق حضور/معاش داشته باشد)
  route('DELETE', '/api/employees/:id', (_ctx, params) => {
    const id = params[0]
    // مثل هاست — اول شمارش سوابق، بعد بررسی وجود
    const attCount = readCol<LocalAttendance>('attendance').filter((a) => a.employeeId === id).length
    const salCount = readCol<LocalSalaryPayment>('salaries').filter((s) => s.employeeId === id).length
    if (attCount > 0 || salCount > 0) {
      throw new ApiError(400, 'سوابق دارد؛ آن را غیرفعال کنید')
    }

    const employees = readCol<LocalEmployee>('employees')
    const existing = employees.find((e) => e.id === id)
    if (!existing) throw new ApiError(404, 'کارمند یافت نشد')

    writeCol('employees', employees.filter((e) => e.id !== id))
    return { ok: true }
  }),
]
