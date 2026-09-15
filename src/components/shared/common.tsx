'use client'

// کامپوننت‌های مشترک — سرلوحه ماژول، کارت آماری، حالت خالی و بارگیری
import { Loader2, Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { LucideIcon } from 'lucide-react'

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  actions,
}: {
  title: string
  subtitle?: string
  icon?: LucideIcon
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Icon className="h-4.5 w-4.5" />
          </div>
        )}
        <div>
          <h1 className="text-lg md:text-xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-[13px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

export function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  tone = 'green',
  className,
}: {
  title: string
  value: string
  icon?: LucideIcon
  hint?: string
  tone?: 'green' | 'blue' | 'amber' | 'red' | 'slate'
  className?: string
}) {
  // انیمیشن اختصاصی هر لحن (مطابق طراحی card.html):
  // سبز/پول → تاب خوردن | آبی/جعبه → تکان آرام | کهربایی/سرخ/هشدار → لرزش
  const anims: Record<string, string> = {
    green: 'stat-anim-swing',
    blue: 'stat-anim-sway',
    amber: 'stat-anim-shake',
    red: 'stat-anim-shake',
    slate: '',
  }
  return (
    <div className={cn('stat-card', className)}>
      {/* لایهٔ ۱ — کارت سفید زیرین */}
      <div className="stat-bottom" aria-hidden="true" />
      {/* لایهٔ ۲ — آیکون شناور بالای گوشهٔ بریده */}
      {Icon && (
        <div className={cn('stat-icon', anims[tone])} aria-hidden="true">
          <Icon className="h-11 w-11" strokeWidth={1.75} />
        </div>
      )}
      {/* لایهٔ ۳ — گرادیان تم با گوشهٔ بریده */}
      <div className="stat-top-clip" aria-hidden="true">
        <div className="stat-top" />
      </div>
      {/* متن‌ها */}
      <div className="stat-content">
        <h2 className="stat-title truncate">{title}</h2>
        <p className="stat-value truncate" title={value}>{value}</p>
        {hint && <p className="stat-hint truncate">{hint}</p>}
      </div>
    </div>
  )
}

export function LoadingBlock({ label = 'در حال بارگیری...' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
      <span className="text-[13px]">{label}</span>
    </div>
  )
}

export function EmptyState({ label = 'موردی ثبت نشده است' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
      <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center">
        <Inbox className="h-5 w-5 opacity-50" />
      </div>
      <span className="text-[13px]">{label}</span>
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full rounded-md" />
      ))}
    </div>
  )
}
