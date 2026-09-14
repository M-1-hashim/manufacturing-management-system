'use client'

// ماژول داشبورد — نمای کلی فروش، تولید، مالی و انبار
import { toJalaali } from 'jalaali-js'
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CheckCircle2,
  Factory,
  LayoutDashboard,
  Package,
  RotateCcw,
  ShoppingCart,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import {
  STATUS_COLORS,
  formatMoney,
  formatNumber,
  jalaliMonthName,
  shortDateLabel,
  toJalaliStr,
} from '@/lib/format'
import {
  EmptyState,
  LoadingBlock,
  PageHeader,
  StatCard,
  TableSkeleton,
} from '@/components/shared/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------------- تایپ‌ها ----------------
interface DashboardData {
  stats: {
    salesThisMonth: number
    salesToday: number
    productionActive: number
    productionCompleted: number
    productsCount: number
    lowStockProductsCount: number
    lowStockMaterialsCount: number
    expensesThisMonth: number
    receivables: number
    inventoryValue: number
  }
  salesTrend: { date: string; label: string; total: number }[]
  productionTrend: { label: string; planned: number; produced: number }[]
  topProducts: { name: string; qty: number; revenue: number }[]
  recentSales: {
    invoiceNumber: string
    customerName: string
    total: number
    status: string
    date: string
    itemsCount: number
  }[]
  lowStock: { type: 'product' | 'material'; name: string; stock: number; minStock: number; unit: string }[]
  statusCounts: Record<string, number>
}

// برچسب وضعیت پرداخت
const SALE_STATUS: Record<string, [string, string, string]> = {
  paid: ['پرداخت‌شده', 'پرداخت شوی', 'Paid'],
  partial: ['نیمه‌پرداخت', 'نیمه پرداخت', 'Partial'],
  unpaid: ['پرداخت‌نشده', 'ناپرداخت', 'Unpaid'],
}

// برچسب وضعیت تولید
const PROD_STATUS: Record<string, [string, string, string]> = {
  pending: ['در انتظار', 'انتظار', 'Pending'],
  in_progress: ['در جریان', 'په جریان کې', 'In Progress'],
  completed: ['تکمیل‌شده', 'بشپړ شوی', 'Completed'],
  cancelled: ['لغو‌شده', 'لغو شوی', 'Cancelled'],
}

// تبدیل برچسب میلادی YYYY/MM به نام ماه شمسی
function jalaliMonthLabel(gregLabel: string): string {
  const [y, m] = gregLabel.split('/').map(Number)
  try {
    const j = toJalaali(y, m, 15)
    return `${jalaliMonthName(j.jm)} ${j.jy}`
  } catch {
    return gregLabel
  }
}

// اعداد فشرده برای محور چارت
function compact(n: number): string {
  if (Math.abs(n) >= 1000000) return `${formatNumber(Math.round(n / 100000) / 10)}م`
  if (Math.abs(n) >= 1000) return `${formatNumber(Math.round(n / 100) / 10)}k`
  return formatNumber(n)
}

export default function DashboardModule() {
  const { t } = useI18n()
  const { data, loading, error, refetch } = useFetch<DashboardData>('/api/dashboard')
  const { data: settings } = useFetch<Record<string, string>>('/api/settings')

  const companyName = settings?.companyName ?? t('صنایع افغانستان', 'د افغانستان صنعتونه', 'Afghan Industry')

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={LayoutDashboard}
          title={t('داشبورد', 'معلوماتي پاڼه', 'Dashboard')}
          subtitle={companyName}
        />
        <LoadingBlock label={t('در حال بارگیری داشبورد...', 'داشبورد بارېږي...', 'Loading dashboard...')} />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={LayoutDashboard}
          title={t('داشبورد', 'معلوماتي پاڼه', 'Dashboard')}
          subtitle={companyName}
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <AlertTriangle className="h-9 w-9 text-red-500" />
            <p className="text-sm text-muted-foreground">
              {t('خطا در بارگیری داشبورد', 'د داشبورد په بارولو کې ستونزه', 'Failed to load dashboard')}
            </p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RotateCcw className="me-2 h-4 w-4" />
              {t('کوشش مجدد', 'بیا هڅه', 'Retry')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) return <LoadingBlock />

  const { stats } = data
  const lowStockTotal = stats.lowStockProductsCount + stats.lowStockMaterialsCount

  // داده‌های چارتها با برچسب شمسی
  const salesTrendData = data.salesTrend.map((d) => ({ ...d, jalali: shortDateLabel(d.date) }))
  const productionTrendData = data.productionTrend.map((d) => ({ ...d, jalali: jalaliMonthLabel(d.label) }))
  const maxTopQty = Math.max(1, ...data.topProducts.map((p) => p.qty))

  return (
    <div className="space-y-6">
      <PageHeader
        icon={LayoutDashboard}
        title={t('داشبورد', 'معلوماتي پاڼه', 'Dashboard')}
        subtitle={companyName}
      />

      {/* ردیف اول — کارت‌های اصلی */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          title={t('فروش این ماه', 'د میاشتې پلورنه', 'Sales this month')}
          value={formatMoney(stats.salesThisMonth)}
          hint={`${t('امروز', 'نن', 'Today')}: ${formatMoney(stats.salesToday)}`}
          icon={ShoppingCart}
          tone="green"
        />
        <StatCard
          title={t('مطالبات وصول‌نشده', 'ناوړې شوې پیسې', 'Receivables')}
          value={formatMoney(stats.receivables)}
          hint={t('بدهی مشتریان', 'د پیرودونکو بدهی', 'Customer debts')}
          icon={Wallet}
          tone="amber"
        />
        <StatCard
          title={t('تولید فعال', 'فعال تولید', 'Active production')}
          value={formatNumber(stats.productionActive)}
          hint={`${t('تکمیل‌شده', 'بشپړ شوی', 'Completed')}: ${formatNumber(stats.productionCompleted)}`}
          icon={Factory}
          tone="blue"
        />
        <StatCard
          title={t('هشدار موجودی', 'د موجودي خبرداری', 'Low-stock alerts')}
          value={formatNumber(lowStockTotal)}
          hint={`${t('محصولات', 'محصولات', 'Products')}: ${formatNumber(stats.lowStockProductsCount)} · ${t('مواد', 'خام مواد', 'Materials')}: ${formatNumber(stats.lowStockMaterialsCount)}`}
          icon={AlertTriangle}
          tone="red"
        />
      </div>

      {/* ردیف دوم — کارت‌های تکمیلی */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          title={t('ارزش کل انبار', 'د ګدام ټول ارزښت', 'Inventory value')}
          value={formatMoney(stats.inventoryValue)}
          icon={Boxes}
          tone="blue"
        />
        <StatCard
          title={t('مصارف این ماه', 'د میاشتې لگښتونه', 'Expenses this month')}
          value={formatMoney(stats.expensesThisMonth)}
          icon={Banknote}
          tone="amber"
        />
        <StatCard
          title={t('تعداد محصولات', 'د محصولاتو شمېر', 'Products count')}
          value={formatNumber(stats.productsCount)}
          icon={Package}
          tone="green"
        />
        <StatCard
          title={t('فروش امروز', 'د نن پلورنه', 'Sales today')}
          value={formatMoney(stats.salesToday)}
          icon={TrendingUp}
          tone="slate"
        />
      </div>

      {/* چارتها */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              {t('روند فروش ۱۴ روز اخیر', 'د ۱۴ ورځو پلورنې بهیر', 'Sales trend — last 14 days')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 md:h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesTrendData} key="sales-trend" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} vertical={false} />
                  <XAxis
                    dataKey="jalali"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={18}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={54}
                    tickFormatter={(v) => compact(Number(v))}
                  />
                  <Tooltip
                    formatter={(value) => formatMoney(Number(value))}
                    contentStyle={{ borderRadius: 10, borderColor: '#10b98140', direction: 'rtl', fontSize: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    name={t('فروش', 'پلورنه', 'Sales')}
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#salesGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Factory className="h-4 w-4 text-sky-600" />
                {t('روند تولید ۶ ماه اخیر', 'د ۶ میاشتو تولید بهیر', 'Production trend — last 6 months')}
              </CardTitle>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Object.entries(data.statusCounts).map(([status, count]) =>
                  count > 0 ? (
                    <Badge key={status} variant="outline" className={STATUS_COLORS[status] ?? ''}>
                      {(() => {
                        const l = PROD_STATUS[status]
                        return `${l ? t(l[0], l[1], l[2]) : status}: ${formatNumber(count)}`
                      })()}
                    </Badge>
                  ) : null
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64 md:h-72" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={productionTrendData} key="production-trend" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} vertical={false} />
                  <XAxis dataKey="jalali" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={54}
                    tickFormatter={(v) => compact(Number(v))}
                  />
                  <Tooltip
                    formatter={(value) => formatNumber(Number(value))}
                    contentStyle={{ borderRadius: 10, borderColor: '#0ea5e940', direction: 'rtl', fontSize: 12 }}
                  />
                  <Bar dataKey="planned" name={t('پلان', 'پلان', 'Planned')} fill="#64748b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="produced" name={t('تولیدشده', 'تولید شوی', 'Produced')} fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* محصولات پرفروش + هشدار موجودی */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-emerald-600" />
              {t('محصولات پرفروش (۹۰ روز)', 'پر پلورنه محصولات (۹۰ ورځې)', 'Top products (90 days)')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topProducts.length === 0 ? (
              <EmptyState label={t('فروشی ثبت نشده است', 'پلورنه نه ده ثبت شوې', 'No sales recorded')} />
            ) : (
              <div className="space-y-4">
                {data.topProducts.map((p) => (
                  <div key={p.name} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatNumber(p.qty)} × · {formatMoney(p.revenue)}
                      </span>
                    </div>
                    <Progress
                      value={(p.qty / maxTopQty) * 100}
                      className="h-2 [&>div]:bg-emerald-500"
                    />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                {t('هشدار موجودی کم', 'د کم موجودي خبرداری', 'Low-stock alerts')}
              </CardTitle>
              {lowStockTotal > 0 && (
                <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                  {formatNumber(lowStockTotal)}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {data.lowStock.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                <span className="text-sm">
                  {t('موجودی همه اقلام مناسب است', 'د ټولو توکو موجودي سم ده', 'All stock levels are fine')}
                </span>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {data.lowStock.map((item) => {
                  const critical = item.stock <= 0 || item.stock <= item.minStock * 0.5
                  return (
                    <div
                      key={`${item.type}-${item.name}`}
                      className="flex items-center justify-between gap-2 rounded-lg border p-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium truncate">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.type === 'product'
                            ? t('محصول', 'محصول', 'Product')
                            : t('ماده خام', 'خام ماده', 'Material')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`text-xs font-semibold ${critical ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}
                          dir="ltr"
                        >
                          {formatNumber(item.stock)} / {formatNumber(item.minStock)} {item.unit}
                        </span>
                        <Badge
                          variant="outline"
                          className={
                            critical
                              ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                          }
                        >
                          {critical
                            ? t('بحرانی', 'بحراني', 'Critical')
                            : t('کم', 'کم', 'Low')}
                        </Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* آخرین فروش‌ها */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-emerald-600" />
            {t('آخرین فروش‌ها', 'وروستي پلورنې', 'Recent sales')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableSkeleton rows={5} />
          ) : data.recentSales.length === 0 ? (
            <EmptyState label={t('هنوز فروشی ثبت نشده است', 'تر اوسه پلورنه نه ده ثبت شوې', 'No sales yet')} />
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-md border">
              <Table>
                <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                  <TableRow>
                    <TableHead>{t('فاکتور', 'فاکتورونه', 'Invoice')}</TableHead>
                    <TableHead>{t('مشتری', 'پیرودونکی', 'Customer')}</TableHead>
                    <TableHead>{t('مبلغ', 'مبلغ', 'Total')}</TableHead>
                    <TableHead>{t('وضعیت', 'حالت', 'Status')}</TableHead>
                    <TableHead>{t('اقلام', 'توکي', 'Items')}</TableHead>
                    <TableHead>{t('تاریخ', 'نېټه', 'Date')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.recentSales.map((s) => {
                    const l = SALE_STATUS[s.status]
                    return (
                      <TableRow key={s.invoiceNumber}>
                        <TableCell className="font-mono text-xs rtl:text-right" dir="ltr">
                          {s.invoiceNumber}
                        </TableCell>
                        <TableCell className="max-w-40 truncate">{s.customerName}</TableCell>
                        <TableCell className="font-semibold">{formatMoney(s.total)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_COLORS[s.status] ?? ''}>
                            {l ? t(l[0], l[1], l[2]) : s.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatNumber(s.itemsCount)}</TableCell>
                        <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                          {toJalaliStr(s.date)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
