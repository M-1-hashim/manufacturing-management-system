// فرمت‌دهی اعداد، ارز و تاریخ (شمسی و میلادی)
import * as jalaali from 'jalaali-js' // jalaali-js v2 (ESM) — بدون export پیش‌فرض

export type Currency = 'AFN' | 'USD' | 'PKR'

export const CURRENCY_LABELS: Record<Currency, string> = {
  AFN: '؋ افغانی',
  USD: '$ دالر',
  PKR: '₨ کلدار',
}

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  AFN: '؋',
  USD: '$',
  PKR: '₨',
}

/** فرمت عدد با جداکننده هزارگان */
export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || isNaN(n)) return '0'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** فرمت مبلغ با علامت ارز */
export function formatMoney(n: number | null | undefined, currency: Currency = 'AFN'): string {
  return `${formatNumber(n)} ${CURRENCY_SYMBOLS[currency]}`
}

/** تاریخ شمسی به‌صورت ۱۴۰۳/۱۲/۱۵ */
export function toJalaliStr(date: Date | string | null | undefined, withTime = false): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  try {
    const j = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate())
    const pad = (x: number) => String(x).padStart(2, '0')
    const base = `${j.jy}/${pad(j.jm)}/${pad(j.jd)}`
    if (!withTime) return base
    return `${base} - ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return d.toLocaleDateString('en-CA')
  }
}

/** تاریخ میلادی YYYY/MM/DD */
export function toGregorianStr(date: Date | string | null | undefined, withTime = false): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  if (isNaN(d.getTime())) return '—'
  const pad = (x: number) => String(x).padStart(2, '0')
  const base = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
  if (!withTime) return base
  return `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const MONTHS_FA = [
  'حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله',
  'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت',
]

/** نام ماه شمسی برای چارتها */
export function jalaliMonthName(jm: number): string {
  return MONTHS_FA[jm - 1] ?? String(jm)
}

/** برچسب کوتاه برای چارتها بر اساس تاریخ */
export function shortDateLabel(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  try {
    const j = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate())
    return `${jalaliMonthName(j.jm)} ${j.jd}`
  } catch {
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
}

/** درصد */
export function formatPercent(n: number, digits = 1): string {
  return `${formatNumber(n, digits)}٪`
}

/** وضعیت به رنگ badge */
export const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  partial: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  unpaid: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  in_progress: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  completed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  passed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  present: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  absent: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  leave: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  cash: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  credit: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  transfer: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  in: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  out: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  adjust: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  transfer_: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
}

/** نام واحد پول برای نمایش */
export function currencyName(c: string): string {
  return CURRENCY_LABELS[c as Currency] ?? c
}
