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
}: {
  title: string
  value: string
  icon?: LucideIcon
  hint?: string
  tone?: 'green' | 'blue' | 'amber' | 'red' | 'slate'
}) {
  const tones: Record<string, string> = {
    green: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-400',
  }
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">{title}</p>
          <p className="text-lg md:text-xl font-bold tracking-tight mt-1 truncate" title={value}>{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground mt-1 truncate">{hint}</p>}
        </div>
        {Icon && (
          <div className={cn('h-9 w-9 rounded-lg flex items-center justify-center shrink-0', tones[tone])}>
            <Icon className="h-4.5 w-4.5" />
          </div>
        )}
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
