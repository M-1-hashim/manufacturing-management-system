// کسر خودکار غیبت از معاش — اشتراکی بین مسیرهای /api/salaries (هاست) و حالت محلی
// قانون: تعداد روزهای «غایب» ثبت‌شده در حاضریِ همان ماه شمسی × نرخ روزانه.
// نرخ روزانه: تنظیم absentDeductionPerDay (افغانی به‌ازای هر روز غیبت)؛
// اگر تنظیم خالی/صفر باشد → یک‌سی‌ام معاش ماهانهٔ همان کارمند (نرخ خودکار پیش‌فرض).
import * as jalaali from 'jalaali-js'

const round2 = (n: number) => Math.round(n * 100) / 100

/** بازهٔ میلادی یک ماه شمسی به‌شکل «1403-01» → [start، end) — نتیجهٔ نامعتبر = null */
export function jalaliMonthRange(month: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month ?? '').trim())
  if (!m) return null
  const jy = Number(m[1])
  const jm = Number(m[2])
  if (jm < 1 || jm > 12) return null
  const gs = jalaali.toGregorian(jy, jm, 1)
  const start = new Date(gs.gy, gs.gm - 1, gs.gd, 0, 0, 0, 0)
  const njy = jm === 12 ? jy + 1 : jy
  const njm = jm === 12 ? 1 : jm + 1
  const ge = jalaali.toGregorian(njy, njm, 1)
  const end = new Date(ge.gy, ge.gm - 1, ge.gd, 0, 0, 0, 0)
  return { start, end }
}

export interface AbsentStats {
  absentDays: number
  presentDays: number
  leaveDays: number
  rangeOk: boolean
}

interface StatusRow {
  status: string
  date: Date | string
}

/** شمارش حاضری/غیبت/رخصتی از ردیف‌های حاضری داخل بازهٔ ماه شمسی */
export function tallyAttendance(rows: StatusRow[], month: string): AbsentStats {
  const range = jalaliMonthRange(month)
  if (!range) return { absentDays: 0, presentDays: 0, leaveDays: 0, rangeOk: false }
  let absentDays = 0
  let presentDays = 0
  let leaveDays = 0
  for (const r of rows) {
    const d = new Date(r.date)
    if (isNaN(d.getTime()) || d < range.start || d >= range.end) continue
    if (r.status === 'absent') absentDays++
    else if (r.status === 'present') presentDays++
    else if (r.status === 'leave') leaveDays++
  }
  return { absentDays, presentDays, leaveDays, rangeOk: true }
}

/** نرخ کسر روزانه — تنظیم مستقیم یا ۱/۳۰ معاش (خالی → خودکار) */
export function deductionPerDay(
  monthlySalary: number,
  settingValue: string | number | null | undefined
): number {
  const v = Number(settingValue)
  if (Number.isFinite(v) && v > 0) return v
  return monthlySalary > 0 ? monthlySalary / 30 : 0
}

/** کسر کل غیبت — { perDay، deduction } (گرد به ۲ رقم) */
export function absenceDeduction(
  monthlySalary: number,
  absentDays: number,
  settingValue: string | number | null | undefined
): { perDay: number; deduction: number } {
  const perDay = deductionPerDay(monthlySalary, settingValue)
  const deduction = absentDays > 0 && perDay > 0 ? round2(perDay * absentDays) : 0
  return { perDay: round2(perDay), deduction }
}
