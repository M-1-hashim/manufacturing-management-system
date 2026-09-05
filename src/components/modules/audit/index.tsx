'use client'

// ماژول گزارش فعالیت‌ها — رخدادهای ورود، ایجاد، ویرایش و حذف سیستم (ادمین/مدیر)
import { useMemo, useState } from 'react'
import {
  CalendarDays,
  Download,
  History,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
} from 'lucide-react'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { formatNumber, toJalaliStr } from '@/lib/format'
import { EmptyState, PageHeader, StatCard, TableSkeleton } from '@/components/shared/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface AuditEvent {
  id: string
  userId: string | null
  userName: string | null
  action: string
  entity: string
  entityId: string | null
  details: string | null
  createdAt: string
}

// برچسب رخدادها: [دری، پشتو، انگلیسی]
const ACTION_LABELS: Record<string, [string, string, string]> = {
  login: ['ورود', 'ننوتل', 'Login'],
  login_failed: ['ورود ناموفق', 'ناکام ننوتل', 'Failed login'],
  logout: ['خروج', 'وتل', 'Logout'],
  create: ['ایجاد', 'جوړول', 'Create'],
  update: ['ویرایش', 'سمون', 'Update'],
  delete: ['حذف', 'ړنګول', 'Delete'],
  complete: ['تکمیل تولید', 'د تولید بشپړول', 'Production complete'],
  payment: ['دریافت پرداخت', 'د پیسو ترلاسه کول', 'Payment received'],
  adjust: ['حرکت انبار', 'د ګدام حرکت', 'Stock adjustment'],
  change_password: ['تغییر رمز', 'د پټ نوم بدلون', 'Password change'],
}

// برچسب بخش‌ها (entity): [دری، پشتو، انگلیسی]
const ENTITY_LABELS: Record<string, [string, string, string]> = {
  auth: ['احراز هویت', 'تصدیق هویت', 'Auth'],
  user: ['کاربران', 'کاروونکي', 'Users'],
  sale: ['فروش', 'پلورنه', 'Sales'],
  production: ['تولید', 'تولید', 'Production'],
  inventory: ['انبار', 'ګدام', 'Inventory'],
}

const EMERALD = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
const SKY = 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
const AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
const RED = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
const SLATE = 'bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300'

// رنگ badge هر رخداد
const ACTION_BADGES: Record<string, string> = {
  login: EMERALD,
  create: EMERALD,
  complete: EMERALD,
  update: SKY,
  payment: SKY,
  adjust: AMBER,
  login_failed: RED,
  delete: RED,
  logout: SLATE,
  change_password: SLATE,
}

// خروجی CSV با BOM برای نمایش درست فارسی در اکسل
function downloadCSV(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = '\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function AuditModule() {
  const { t } = useI18n()

  // ---------- فیلترها ----------
  const [actionFilter, setActionFilter] = useState('all')
  const [entityFilter, setEntityFilter] = useState('all')
  const [limit, setLimit] = useState('150')

  // ساخت query فقط با پارامترهای انتخاب‌شده
  const url = useMemo(() => {
    const params = new URLSearchParams()
    params.set('limit', limit)
    if (actionFilter !== 'all') params.set('action', actionFilter)
    if (entityFilter !== 'all') params.set('entity', entityFilter)
    return `/api/audit?${params.toString()}`
  }, [actionFilter, entityFilter, limit])

  const { data, error, refetch } = useFetch<AuditEvent[]>(url)
  const events = useMemo(() => (Array.isArray(data) ? data : []), [data])
  const accessDenied = !!error && error.includes('403')

  function actionLabel(a: string) {
    const l = ACTION_LABELS[a]
    return l ? t(l[0], l[1], l[2]) : a
  }
  function entityLabel(e: string) {
    const l = ENTITY_LABELS[e]
    return l ? t(l[0], l[1], l[2]) : e
  }

  // ---------- آمار ----------
  const todayKey = toJalaliStr(new Date())
  const todayCount = events.filter((e) => toJalaliStr(e.createdAt) === todayKey).length
  const failedLogins = events.filter((e) => e.action === 'login_failed').length
  const salesEvents = events.filter((e) => e.entity === 'sale').length

  // ---------- خروجی CSV ----------
  function exportCSV() {
    downloadCSV('audit-log.csv', [
      [
        t('زمان', 'وخت', 'Time'),
        t('کاربر', 'کاروونکی', 'User'),
        t('رخداد', 'پیښه', 'Action'),
        t('بخش', 'برخه', 'Entity'),
        t('جزئیات', 'تفصیلات', 'Details'),
      ],
      ...events.map((e) => [
        e.createdAt,
        e.userName ?? '',
        actionLabel(e.action),
        entityLabel(e.entity),
        e.details ?? '',
      ]),
    ])
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('گزارش فعالیت‌ها', 'د فعالیتونو راپور', 'Activity Log')}
        subtitle={t(
          'ثبت تمام رخدادهای ورود، ایجاد، ویرایش و حذف در سیستم',
          'د ننوتل، جوړول، سمون او ړنګولو ټولې پیښې ثبتې دي',
          'All login, create, update and delete events in the system'
        )}
        icon={History}
      />

      {/* ---------- آمار ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          title={t('کل رخدادها', 'ټولې پیښې', 'Total Events')}
          value={formatNumber(events.length)}
          hint={t('در فهرست فعلی', 'په اوسني لیست کې', 'in current list')}
          icon={History}
          tone="blue"
        />
        <StatCard
          title={t('رخدادهای امروز', 'د نن پیښې', "Today's Events")}
          value={formatNumber(todayCount)}
          icon={CalendarDays}
          tone="green"
        />
        <StatCard
          title={t('ورودهای ناموفق', 'ناکام ننوتلې', 'Failed Logins')}
          value={formatNumber(failedLogins)}
          icon={ShieldAlert}
          tone="red"
        />
        <StatCard
          title={t('رخدادهای فروش', 'د پلورنې پیښې', 'Sales Events')}
          value={formatNumber(salesEvents)}
          icon={ShoppingCart}
          tone="slate"
        />
      </div>

      {/* ---------- جدول رخدادها ---------- */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="w-[175px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('همه رخدادها', 'ټولې پیښې', 'All events')}</SelectItem>
                {Object.entries(ACTION_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {t(l[0], l[1], l[2])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={entityFilter} onValueChange={setEntityFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {t('همه بخش‌ها', 'ټولې برخې', 'All entities')}
                </SelectItem>
                {Object.entries(ENTITY_LABELS).map(([k, l]) => (
                  <SelectItem key={k} value={k}>
                    {t(l[0], l[1], l[2])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={limit} onValueChange={setLimit}>
              <SelectTrigger className="w-[110px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="50">۵۰</SelectItem>
                <SelectItem value="100">۱۰۰</SelectItem>
                <SelectItem value="150">۱۵۰</SelectItem>
                <SelectItem value="500">۵۰۰</SelectItem>
              </SelectContent>
            </Select>
            <div className="ms-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                title={t('بازخوانی', 'بیا لوستل', 'Refresh')}
                onClick={refetch}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={exportCSV} disabled={events.length === 0}>
                <Download className="h-4 w-4" />
                {t('خروجی CSV', 'CSV خروجی', 'Export CSV')}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {accessDenied ? (
            <EmptyState label={t('دسترسی محدود', 'محدود لاسرسی', 'Access restricted')} />
          ) : error ? (
            <div className="flex flex-col items-center gap-2 py-8">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <Button variant="outline" size="sm" onClick={refetch}>
                {t('تلاش مجدد', 'بیا هڅه', 'Retry')}
              </Button>
            </div>
          ) : data === null ? (
            <TableSkeleton rows={6} />
          ) : events.length === 0 ? (
            <EmptyState
              label={t('رخدادی ثبت نشده است', 'پیښه نه ده ثبت شوې', 'No events recorded')}
            />
          ) : (
            <div className="max-h-96 overflow-y-auto overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('زمان', 'وخت', 'Time')}</TableHead>
                    <TableHead>{t('کاربر', 'کاروونکی', 'User')}</TableHead>
                    <TableHead>{t('رخداد', 'پیښه', 'Action')}</TableHead>
                    <TableHead>{t('بخش', 'برخه', 'Entity')}</TableHead>
                    <TableHead>{t('جزئیات', 'تفصیلات', 'Details')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs whitespace-nowrap">
                        {toJalaliStr(e.createdAt, true)}
                      </TableCell>
                      <TableCell dir="ltr" className="font-mono text-xs rtl:text-right">
                        {e.userName ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={ACTION_BADGES[e.action] ?? SLATE}>
                          {actionLabel(e.action)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{entityLabel(e.entity)}</Badge>
                      </TableCell>
                      <TableCell
                        className="text-xs text-muted-foreground max-w-[220px] truncate"
                        title={e.details ?? undefined}
                      >
                        {e.details ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
