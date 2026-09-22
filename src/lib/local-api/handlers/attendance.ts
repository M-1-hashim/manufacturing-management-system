'use client'

/**
 * هندلرهای حاضری — آینهٔ src/app/api/attendance/route.ts و [id]/route.ts
 * GET ?employeeId=&days=N — پنجرهٔ N روز اخیر (پیش‌فرض ۷) + ضمیمهٔ کارمند {name, position}
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

export interface LocalAttendance extends Row {
  employeeId: string
  date: string
  status: string
  shift: string | null
  notes: string | null
}
interface LocalEmployee extends Row {
  name: string
  position: string
}

function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

/** ضمیمهٔ کارمند — فقط نام و وظیفه مثل select هاست */
function withEmployee(a: LocalAttendance, employees: LocalEmployee[]) {
  const emp = employees.find((e) => e.id === a.employeeId)
  return { ...a, employee: emp ? { name: emp.name, position: emp.position } : null }
}

export const routes: RouteDef[] = [
  // GET /api/attendance?employeeId=&days= — سابقهٔ حاضری (جدید به قدیم، حداکثر 500)
  route('GET', '/api/attendance', (ctx) => {
    const employeeId = ctx.url.searchParams.get('employeeId') || undefined
    const days = Number(ctx.url.searchParams.get('days')) || 7
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const rows = readCol<LocalAttendance>('attendance').filter(
      (a) => timeOf(a.date) >= since.getTime() && (!employeeId || a.employeeId === employeeId)
    )
    rows.sort((a, b) => timeOf(b.date) - timeOf(a.date))

    const employees = readCol<LocalEmployee>('employees')
    return rows.slice(0, 500).map((a) => withEmployee(a, employees))
  }),

  // POST /api/attendance — ثبت حاضری
  route('POST', '/api/attendance', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const employeeId = String(body.employeeId ?? '')
    const status = String(body.status ?? '')
    const date = body.date ? new Date(String(body.date)) : new Date()
    const shift = body.shift ? String(body.shift) : null
    const notes = body.notes ? String(body.notes) : null

    if (!employeeId) throw new ApiError(400, 'کارمند انتخاب نشده است')
    if (!['present', 'absent', 'leave'].includes(status)) {
      throw new ApiError(400, 'وضعیت نامعتبر است')
    }
    if (isNaN(date.getTime())) throw new ApiError(400, 'تاریخ نامعتبر است')

    const employees = readCol<LocalEmployee>('employees')
    const employee = employees.find((e) => e.id === employeeId)
    if (!employee) throw new ApiError(404, 'کارمند یافت نشد')

    const row = newRow({
      employeeId,
      date: date.toISOString(),
      status,
      shift,
      notes,
    })
    writeCol('attendance', [...readCol<LocalAttendance>('attendance'), row])
    return withEmployee(row, employees)
  }),

  // PUT /api/attendance/:id — تصحیح رکورد حاضری
  route('PUT', '/api/attendance/:id', (ctx, params) => {
    const id = params[0]
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const rows = readCol<LocalAttendance>('attendance')
    const existing = rows.find((a) => a.id === id)
    if (!existing) throw new ApiError(404, 'رکورد یافت نشد')

    const employees = readCol<LocalEmployee>('employees')
    const patch: Partial<LocalAttendance> = {}
    if (body.employeeId !== undefined && body.employeeId !== existing.employeeId) {
      const emp = employees.find((e) => e.id === String(body.employeeId))
      if (!emp) throw new ApiError(404, 'کارمند یافت نشد')
      patch.employeeId = String(body.employeeId)
    }
    if (body.status !== undefined) {
      const status = String(body.status)
      if (!['present', 'absent', 'leave'].includes(status)) {
        throw new ApiError(400, 'وضعیت نامعتبر است')
      }
      patch.status = status
    }
    if (body.date !== undefined && body.date !== null && body.date !== '') {
      const date = new Date(String(body.date))
      if (isNaN(date.getTime())) throw new ApiError(400, 'تاریخ نامعتبر است')
      patch.date = date.toISOString()
    }
    if (body.shift !== undefined) patch.shift = body.shift ? String(body.shift) : null
    if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes) : null

    const updated = withUpdate(existing, patch)
    writeCol('attendance', rows.map((a) => (a.id === id ? updated : a)))
    return withEmployee(updated, employees)
  }),

  // DELETE /api/attendance/:id — حذف رکورد حاضری
  route('DELETE', '/api/attendance/:id', (_ctx, params) => {
    const id = params[0]
    const rows = readCol<LocalAttendance>('attendance')
    const existing = rows.find((a) => a.id === id)
    if (!existing) throw new ApiError(404, 'رکورد یافت نشد')
    writeCol('attendance', rows.filter((a) => a.id !== id))
    return { ok: true }
  }),
]
