'use client'

// ================= سیستم چاپ اسناد مشترک =================
// برگهٔ چاپ استاندارد برای همهٔ ماژول‌ها:
//   بل فروش، صورت‌حساب مشتری، صورت‌حساب تأمین‌کننده، ورک‌آردر تولید،
//   فورمولا، گزارش موجودی انبار، لیست قیمت، فیش معاش، حاضری، مصارف و...
// استفاده:
//   <PrintDocDialog open onClose docType="صورت‌حساب مشتری" docTypeEn="CUSTOMER STATEMENT"
//     docNumber="CS-0001" meta={[[{label, value}], ...]}>
//     <DocTable head={[...]}>{rows}</DocTable>
//   </PrintDocDialog>

import type { ReactNode } from 'react'
import { Factory, MapPin, Phone, Printer } from 'lucide-react'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { toJalaliStr, toGregorianStr } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

// ---------------- تنظیمات شرکت (نام، آدرس، تیلیفون) ----------------
export function useCompanySettings(): Record<string, string> | null {
  const settings = useFetch<Record<string, string>>('/api/settings')
  return settings.data
}

// ---------------- ردیف‌های مشخصات سند ----------------
export interface DocMetaItem {
  label: string
  value: ReactNode
  /** برای اعداد/تاریخ‌های لاتین */
  ltr?: boolean
}
export type DocMetaSection = DocMetaItem[]

// ---------------- جدول چاپی استاندارد ----------------
export function DocTable({
  head,
  children,
  minWidth = 520,
}: {
  head: { label: string; className?: string }[]
  children: ReactNode
  minWidth?: number
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200">
      <table className="w-full border-collapse text-xs sm:text-sm" style={{ minWidth }}>
        <thead>
          <tr className="bg-primary text-primary-foreground">
            {head.map((h, i) => (
              <th key={i} className={`py-2.5 px-2.5 font-semibold whitespace-nowrap ${h.className ?? ''}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

// ---------------- ردیف جدول چاپی (زیگزاگ ملایم) ----------------
export function DocRow({ children, index = 0 }: { children: ReactNode; index?: number }) {
  return (
    <tr className={index % 2 === 1 ? 'bg-neutral-50' : ''}>{children}</tr>
  )
}

// ---------------- سلول جدول چاپی ----------------
export function DocCell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`border-t border-neutral-200 py-2 px-2.5 align-middle ${className}`}>{children}</td>
}

// ---------------- بلوک مجموع‌ها ----------------
export function DocTotals({
  rows,
  grandLabel,
  grandValue,
}: {
  rows: { label: string; value: ReactNode; tone?: 'normal' | 'danger' | 'success' }[]
  grandLabel: string
  grandValue: ReactNode
}) {
  const toneCls = (tone?: string) =>
    tone === 'danger' ? 'font-bold text-red-600' : tone === 'success' ? 'font-semibold text-emerald-700' : 'font-medium'
  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 text-sm">
      <div className="space-y-1.5 bg-white p-3.5">
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between">
            <span className="text-neutral-500">{r.label}</span>
            <span className={toneCls(r.tone)}>{r.value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between bg-primary px-3.5 py-2.5 text-primary-foreground">
        <span className="font-bold">{grandLabel}</span>
        <span className="text-base font-extrabold">{grandValue}</span>
      </div>
    </div>
  )
}

// ---------------- مبلغ به حروف (کادر نقطه‌چین) ----------------
export function DocAmountWords({ text }: { text: string }) {
  const { t } = useI18n()
  if (!text) return null
  return (
    <div className="min-h-16 space-y-1.5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3.5">
      <p className="text-[10px] font-bold tracking-[0.2em] text-neutral-500">
        {t('مبلغ به حروف', 'مبلغ په ليکل', 'AMOUNT IN WORDS')}
      </p>
      <p className="text-sm font-semibold leading-7">{text}</p>
    </div>
  )
}

// ---------------- یادداشت سند ----------------
export function DocNotes({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  if (!children) return null
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
      <span className="font-bold">{t('یادداشت', 'یادښت', 'Notes')}: </span>
      {children}
    </div>
  )
}

// ================= دیالوگ سند چاپی =================
export function PrintDocDialog({
  open,
  onClose,
  docType,
  docTypeEn,
  docNumber,
  date,
  meta = [],
  settings,
  children,
  footerNote,
}: {
  open: boolean
  onClose: () => void
  /** نوع سند — «بل فروش»، «صورت‌حساب مشتری»، «ورک‌آردر»... */
  docType: string
  /** زیرنویز لاتین زیر نوع سند — SALES INVOICE */
  docTypeEn: string
  /** نمبر سند — بدون این مخفی می‌شود */
  docNumber?: string
  /** تاریخ سند — پیش‌فرض امروز */
  date?: string | Date | null
  /** بخش‌های مشخصات (مشتری، وضعیت و...) — هر آرایه یک گرید دومنظره */
  meta?: DocMetaSection[]
  settings?: Record<string, string> | null
  children?: ReactNode
  /** متن پایین سند — شرایط و... */
  footerNote?: string
}) {
  const { t } = useI18n()
  const auto = useCompanySettings()
  const s = settings ?? auto

  const companyName = s?.companyName || t('شرکت تولیدی', 'تولیدي شرکت', 'Manufacturing Co.')
  const companyAddress = s?.companyAddress || ''
  const companyPhone = s?.companyPhone || ''

  const signatureLabels = [
    t('امضای گیرنده', 'د اخیستونکي لاسلیک', 'Receiver signature'),
    t('حسابدار', 'محاسب', 'Accountant'),
    t('مدیر / مهر شرکت', 'مدیر / مهر شرکت', 'Manager / Company seal'),
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-3xl flex flex-col gap-0 p-0 max-h-[94vh] overflow-hidden rounded-xl border-0 bg-transparent shadow-none [&_[data-slot=dialog-close]]:no-print print:static print:translate-x-0 print:translate-y-0 print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:bg-transparent print:p-0 print:shadow-none print:max-w-none"
      >
        <DialogTitle className="sr-only">{docType}</DialogTitle>

        {/* ناحیه اسکرول */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6 print:overflow-visible print:p-0">
          {/* برگهٔ سند — همیشه سفید مثل کاغذ واقعی */}
          <div className="print-area mx-auto w-full overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-xl [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:rounded-none print:border-0 print:shadow-none">
            {/* نوار رنگی بالای سند */}
            <div className="h-2 w-full bg-gradient-to-l from-emerald-700 via-emerald-500 to-teal-500" />

            <div className="space-y-5 p-4 sm:p-8">
              {/* ---------- سرلوحهٔ شرکت + نوع سند ---------- */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white shadow-sm">
                    <Factory className="h-7 w-7" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h2 className="text-lg font-extrabold leading-tight tracking-tight sm:text-xl">{companyName}</h2>
                    {companyAddress && (
                      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span className="min-w-0 truncate">{companyAddress}</span>
                      </p>
                    )}
                    {companyPhone && (
                      <p className="flex items-center gap-1.5 text-xs text-neutral-500">
                        <Phone className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        <span dir="ltr">{companyPhone}</span>
                      </p>
                    )}
                  </div>
                </div>
                <div className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-center">
                  <p className="text-base font-extrabold text-emerald-700 sm:text-lg">{docType}</p>
                  <p className="text-[9px] font-bold tracking-[0.35em] text-emerald-600/70">{docTypeEn}</p>
                  {docNumber && (
                    <p className="mt-1.5 inline-block rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold text-neutral-800 shadow-sm" dir="ltr">
                      {docNumber}
                    </p>
                  )}
                </div>
              </div>

              {/* ---------- تاریخ سند ---------- */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-2.5 text-xs sm:text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-neutral-500">{t('تاریخ شمسی', 'نېټه (شمسي)', 'Date (Jalali)')}:</span>
                  <span className="font-semibold">{toJalaliStr(date ?? new Date())}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-neutral-500">{t('تاریخ میلادی', 'نېټه (میلادي)', 'Date (Gregorian)')}:</span>
                  <span className="font-semibold" dir="ltr">{toGregorianStr(date ?? new Date())}</span>
                </span>
              </div>

              {/* ---------- بخش‌های مشخصات ---------- */}
              {meta.map((section, si) => (
                <div key={si} className="grid gap-3 sm:grid-cols-2">
                  {section.map((m, mi) => (
                    <div
                      key={mi}
                      className={
                        section.length % 2 === 1 && mi === section.length - 1
                          ? 'rounded-lg border border-neutral-200 p-3.5 sm:col-span-2'
                          : 'rounded-lg border border-neutral-200 p-3.5'
                      }
                    >
                      <p className="mb-1.5 text-[10px] font-bold tracking-[0.15em] text-emerald-700">{m.label}</p>
                      <div className="text-sm font-semibold" dir={m.ltr ? 'ltr' : undefined}>
                        {m.value}
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {/* ---------- محتوای سند (جدول و مجموع‌ها) ---------- */}
              {children}

              {/* ---------- امضاها ---------- */}
              <div className="grid grid-cols-3 gap-4 pt-2 sm:gap-6">
                {signatureLabels.map((label) => (
                  <div key={label} className="space-y-1.5 text-center">
                    <div className="h-9 border-b border-dashed border-neutral-400 sm:h-10" />
                    <p className="text-[10px] font-medium text-neutral-500 sm:text-[11px]">{label}</p>
                  </div>
                ))}
              </div>

              {/* ---------- پاورقی ---------- */}
              <div className="space-y-1 border-t border-neutral-200 pt-3 text-center">
                <p className="text-sm font-bold text-emerald-700">
                  {t('با تشکر از اعتماد شما', 'ستاسو له باور مننه', 'Thank you for your trust')}
                </p>
                {footerNote && <p className="text-[10px] text-neutral-400">{footerNote}</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="no-print flex justify-end gap-2 px-3 pb-3 sm:px-6 sm:pb-6">
          <Button variant="outline" onClick={() => onClose()}>
            {t('بستن', 'بندول', 'Close')}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            {t('چاپ', 'چاپ', 'Print')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
