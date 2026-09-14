'use client'

// ماژول گزارشات — فروش، تولید، مالی و انبار با انتخاب بازه زمانی و خروجی CSV
import { useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Download,
  Factory,
  PieChart as PieChartIcon,
  RotateCcw,
  ShoppingCart,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { STATUS_COLORS, formatMoney, formatNumber, shortDateLabel, toJalaliStr } from '@/lib/format'
import { LoadingBlock, PageHeader, StatCard } from '@/components/shared/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ---------------- تایپ‌ها ----------------
interface ReportsData {
  range: number
  salesByDay: { date: string; label: string; total: number; count: number }[]
  salesByMonth: { label: string; total: number }[]
  salesByCustomer: { name: string; total: number; orders: number }[]
  topProducts: { name: string; qty: number; revenue: number }[]
  salesByPayment: { method: string; total: number; count: number }[]
  expensesByCategory: { category: string; total: number }[]
  productionSummary: {
    byStatus: { status: string; count: number }[]
    byProduct: { productName: string; produced: number; waste: number }[]
  }
  inventoryValuation: {
    productsValue: number
    materialsValue: number
    total: number
    topProducts: { name: string; stock: number; unit: string; value: number }[]
    topMaterials: { name: string; stock: number; unit: string; value: number }[]
  }
  taxReport: {
    tax2Count: number
    tax2Amount: number
    tax10Count: number
    tax10Amount: number
    totalTax: number
  }
}

const PROD_STATUS: Record<string, [string, string, string]> = {
  pending: ['در انتظار', 'انتظار', 'Pending'],
  in_progress: ['در جریان', 'په جریان کې', 'In Progress'],
  completed: ['تکمیل‌شده', 'بشپړ شوی', 'Completed'],
  cancelled: ['لغو‌شده', 'لغو شوی', 'Cancelled'],
}

const PIE_COLORS = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#64748b', '#34d399', '#38bdf8', '#fbbf24', '#f87171', '#94a3b8']

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

// اعداد فشرده برای محور چارت
function compact(n: number): string {
  if (Math.abs(n) >= 1000000) return `${formatNumber(Math.round(n / 100000) / 10)}م`
  if (Math.abs(n) >= 1000) return `${formatNumber(Math.round(n / 100) / 10)}k`
  return formatNumber(n)
}

export default function ReportsModule() {
  const { t } = useI18n()
  const [range, setRange] = useState(90)
  const { data, loading, error, refetch } = useFetch<ReportsData>(`/api/reports?range=${range}`)

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader icon={BarChart3} title={t('گزارشات', 'راپورونه', 'Reports')} />
        <LoadingBlock label={t('در حال تولید گزارش...', 'راپور جوړېږي...', 'Generating report...')} />
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={BarChart3}
          title={t('گزارشات', 'راپورونه', 'Reports')}
          actions={
            <Select value={String(range)} onValueChange={(v) => setRange(Number(v))}>
              <SelectTrigger className="w-32 h-9" aria-label={t('بازه زمانی', 'مهال ویش', 'Time range')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">{t('۷ روز', '۷ ورځې', '7 days')}</SelectItem>
                <SelectItem value="30">{t('۳۰ روز', '۳۰ ورځې', '30 days')}</SelectItem>
                <SelectItem value="90">{t('۹۰ روز', '۹۰ ورځې', '90 days')}</SelectItem>
                <SelectItem value="365">{t('۳۶۵ روز', '۳۶۵ ورځې', '365 days')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <AlertTriangle className="h-9 w-9 text-red-500" />
            <p className="text-sm text-muted-foreground">
              {t('خطا در تولید گزارش', 'د راپور په جوړولو کې ستونزه', 'Failed to generate report')}
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

  const { productionSummary, inventoryValuation, taxReport } = data
  const statusMap = new Map(productionSummary.byStatus.map((s) => [s.status, s.count]))
  const totalOrders = productionSummary.byStatus.reduce((a, s) => a + s.count, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart3}
        title={t('گزارشات', 'راپورونه', 'Reports')}
        subtitle={t(`تحلیل ${data.range} روز اخیر`, `د ${data.range} ورځو تحلیل`, `Last ${data.range} days analysis`)}
        actions={
          <Select value={String(range)} onValueChange={(v) => setRange(Number(v))}>
            <SelectTrigger className="w-32 h-9" aria-label={t('بازه زمانی', 'مهال ویش', 'Time range')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">{t('۷ روز', '۷ ورځې', '7 days')}</SelectItem>
              <SelectItem value="30">{t('۳۰ روز', '۳۰ ورځې', '30 days')}</SelectItem>
              <SelectItem value="90">{t('۹۰ روز', '۹۰ ورځې', '90 days')}</SelectItem>
              <SelectItem value="365">{t('۳۶۵ روز', '۳۶۵ ورځې', '365 days')}</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      <Tabs defaultValue="sales" dir="rtl">
        <TabsList className="grid w-full grid-cols-4 max-w-lg">
          <TabsTrigger value="sales">{t('فروش', 'پلورنه', 'Sales')}</TabsTrigger>
          <TabsTrigger value="production">{t('تولید', 'تولید', 'Production')}</TabsTrigger>
          <TabsTrigger value="finance">{t('مالی', 'مالي', 'Finance')}</TabsTrigger>
          <TabsTrigger value="inventory">{t('انبار', 'ګدام', 'Inventory')}</TabsTrigger>
        </TabsList>

        {/* ---------------- تب فروش ---------------- */}
        <TabsContent value="sales" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-emerald-600" />
                  {t('روند فروش روزانه', 'ورځنی پلورنې بهیر', 'Daily sales trend')}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCSV('sales-report.csv', [
                      [
                        t('تاریخ میلادی', 'میلادي نېټه', 'Gregorian date'),
                        t('تاریخ شمسی', 'شمسي نېټه', 'Jalali date'),
                        t('فروش (افغانی)', 'پلورنه (افغانی)', 'Sales (AFN)'),
                        t('تعداد بل', 'د بلونو شمېر', 'Invoice count'),
                      ],
                      ...data.salesByDay.map((d) => [
                        d.date.slice(0, 10),
                        toJalaliStr(d.date),
                        d.total,
                        d.count,
                      ]),
                    ])
                  }
                >
                  <Download className="me-2 h-4 w-4" />
                  {t('دانلود CSV', 'CSV ډاونلوډ', 'Download CSV')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-64 md:h-72" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.salesByDay} key="sales-by-day" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                      minTickGap={24}
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
                    <Line
                      type="monotone"
                      dataKey="total"
                      name={t('فروش', 'پلورنه', 'Sales')}
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t('فروش ماهانه (۱۲ ماه)', 'میاشتنۍ پلورنه (۱۲ میاشتې)', 'Monthly sales (12 months)')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64 md:h-72" dir="ltr">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.salesByMonth} key="sales-by-month" margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={54}
                        tickFormatter={(v) => compact(Number(v))}
                      />
                      <Tooltip
                        formatter={(value) => formatMoney(Number(value))}
                        contentStyle={{ borderRadius: 10, borderColor: '#0ea5e940', direction: 'rtl', fontSize: 12 }}
                      />
                      <Bar dataKey="total" name={t('فروش', 'پلورنه', 'Sales')} fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {t('محصولات پرفروش', 'پر پلورنه محصولات', 'Top products')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('محصول', 'محصول', 'Product')}</TableHead>
                        <TableHead>{t('مقدار', 'مقدار', 'Qty')}</TableHead>
                        <TableHead>{t('عواید', 'عواید', 'Revenue')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.topProducts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                            {t('موردی ثبت نشده', 'مورد نه دی ثبت شوی', 'No data')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        data.topProducts.map((p) => (
                          <TableRow key={p.name}>
                            <TableCell className="max-w-44 truncate">{p.name}</TableCell>
                            <TableCell>{formatNumber(p.qty)}</TableCell>
                            <TableCell className="font-semibold">{formatMoney(p.revenue)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-muted-foreground mb-2">
              {t('فروش به تفکیک روش پرداخت', 'د پرداخت له لارې پلورنه', 'Sales by payment method')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {data.salesByPayment.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('موردی ثبت نشده', 'مورد نه دی ثبت شوی', 'No data')}</p>
              ) : (
                data.salesByPayment.map((p) => (
                  <div key={p.method} className="rounded-xl border bg-card p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm text-muted-foreground">{p.method}</p>
                      <Badge variant="outline" className={STATUS_COLORS[p.method] ?? ''}>
                        {formatNumber(p.count)} {t('بل', 'بلونه', 'invoices')}
                      </Badge>
                    </div>
                    <p className="text-xl font-bold mt-1">{formatMoney(p.total)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t('مشتریان برتر', 'غوره پیرودونکي', 'Top customers')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-72 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('مشتری', 'پیرودونکی', 'Customer')}</TableHead>
                      <TableHead>{t('تعداد خرید', 'د اخیستنو شمېر', 'Orders')}</TableHead>
                      <TableHead>{t('مجموع خرید', 'ټوله پیرود', 'Total')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.salesByCustomer.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                          {t('موردی ثبت نشده', 'مورد نه دی ثبت شوی', 'No data')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      data.salesByCustomer.map((c) => (
                        <TableRow key={c.name}>
                          <TableCell className="max-w-52 truncate">{c.name}</TableCell>
                          <TableCell>{formatNumber(c.orders)}</TableCell>
                          <TableCell className="font-semibold">{formatMoney(c.total)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- تب تولید ---------------- */}
        <TabsContent value="production" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <StatCard
              title={t('کل سفارشات', 'ټول فرمایې', 'Total orders')}
              value={formatNumber(totalOrders)}
              icon={Factory}
              tone="slate"
            />
            <StatCard
              title={t('در انتظار', 'انتظار', 'Pending')}
              value={formatNumber(statusMap.get('pending') ?? 0)}
              icon={Factory}
              tone="amber"
            />
            <StatCard
              title={t('در جریان', 'په جریان کې', 'In progress')}
              value={formatNumber(statusMap.get('in_progress') ?? 0)}
              icon={Factory}
              tone="blue"
            />
            <StatCard
              title={t('تکمیل‌شده', 'بشپړ شوی', 'Completed')}
              value={formatNumber(statusMap.get('completed') ?? 0)}
              icon={Factory}
              tone="green"
            />
            <StatCard
              title={t('لغو‌شده', 'لغو شوی', 'Cancelled')}
              value={formatNumber(statusMap.get('cancelled') ?? 0)}
              icon={Factory}
              tone="red"
            />
          </div>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Factory className="h-4 w-4 text-emerald-600" />
                  {t('تولید در مقابل ضایعات', 'تولید او ضایعات', 'Produced vs waste')}
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCSV('production-report.csv', [
                      [
                        t('محصول', 'محصول', 'Product'),
                        t('تولیدشده', 'تولید شوی', 'Produced'),
                        t('ضایعات', 'ضایعات', 'Waste'),
                      ],
                      ...productionSummary.byProduct.map((p) => [p.productName, p.produced, p.waste]),
                    ])
                  }
                >
                  <Download className="me-2 h-4 w-4" />
                  {t('دانلود CSV', 'CSV ډاونلوډ', 'Download CSV')}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="max-h-96 overflow-y-auto rounded-md border">
                <Table>
                  <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                    <TableRow>
                      <TableHead>{t('محصول', 'محصول', 'Product')}</TableHead>
                      <TableHead>{t('تولیدشده', 'تولید شوی', 'Produced')}</TableHead>
                      <TableHead>{t('ضایعات', 'ضایعات', 'Waste')}</TableHead>
                      <TableHead>{t('نسبت ضایعات', 'د ضایعاتو تناسب', 'Waste %')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {productionSummary.byProduct.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          {t('در این بازه سفارشی ثبت نشده', 'په دې موده کې فرمایې نه دي ثبت شوې', 'No orders in this range')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      productionSummary.byProduct.map((p) => {
                        const total = p.produced + p.waste
                        const pct = total > 0 ? (p.waste / total) * 100 : 0
                        return (
                          <TableRow key={p.productName}>
                            <TableCell className="max-w-52 truncate">{p.productName}</TableCell>
                            <TableCell>{formatNumber(p.produced)}</TableCell>
                            <TableCell className={`${pct > 5 ? 'text-red-600 dark:text-red-400 font-semibold' : ''}`}>
                              {formatNumber(p.waste)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatNumber(pct, 1)}٪
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- تب مالی ---------------- */}
        <TabsContent value="finance" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-amber-600" />
                    {t('مصارف به تفکیک کتگوری', 'لگښتونه په کټګوریو', 'Expenses by category')}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadCSV('finance-report.csv', [
                        [t('کتگوری', 'کټګوری', 'Category'), t('مبلغ (افغانی)', 'مبلغ (افغانی)', 'Amount (AFN)')],
                        ...data.expensesByCategory.map((e) => [e.category, e.total]),
                      ])
                    }
                  >
                    <Download className="me-2 h-4 w-4" />
                    {t('دانلود CSV', 'CSV ډاونلوډ', 'Download CSV')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {data.expensesByCategory.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-12 text-center">
                    {t('مصرفی ثبت نشده', 'لگښتونه نه دي ثبت شوي', 'No expenses recorded')}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                    <div className="h-56" dir="ltr">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart key="expense-pie">
                          <Pie
                            data={data.expensesByCategory}
                            dataKey="total"
                            nameKey="category"
                            innerRadius="55%"
                            outerRadius="85%"
                            paddingAngle={2}
                          >
                            {data.expensesByCategory.map((e, i) => (
                              <Cell key={e.category} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value) => formatMoney(Number(value))}
                            contentStyle={{ borderRadius: 10, direction: 'rtl', fontSize: 12 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {data.expensesByCategory.map((e, i) => (
                        <div key={e.category} className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            <span className="truncate">{e.category}</span>
                          </div>
                          <span className="font-semibold shrink-0">{formatMoney(e.total)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {t('گزارش مالیات فروش', 'د پلورنې مالیه راپور', 'Sales tax report')}
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                <StatCard
                  title={t('مالیات ۲٪', '۲٪ مالیه', '2% tax')}
                  value={formatMoney(taxReport.tax2Amount)}
                  hint={`${t('بل', 'بلونه', 'Invoices')}: ${formatNumber(taxReport.tax2Count)}`}
                  icon={Wallet}
                  tone="blue"
                />
                <StatCard
                  title={t('مالیات ۱۰٪', '۱۰٪ مالیه', '10% tax')}
                  value={formatMoney(taxReport.tax10Amount)}
                  hint={`${t('بل', 'بلونه', 'Invoices')}: ${formatNumber(taxReport.tax10Count)}`}
                  icon={Wallet}
                  tone="amber"
                />
                <StatCard
                  title={t('کل مالیات', 'ټوله مالیه', 'Total tax')}
                  value={formatMoney(taxReport.totalTax)}
                  icon={Wallet}
                  tone="green"
                />
              </div>
              <Card>
                <CardContent className="p-4">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t(
                      'مجموع مالیات از بل‌های فروش در بازه انتخابی محاسبه شده است. نرخ‌های ۲٪ و ۱۰٪ طبق قانون مالیات فروش افغانستان درج می‌گردد.',
                      'د پلورنې بلونو ټوله مالیه په ټاکلې موده کې محاسبه شوې ده.',
                      'Total sales tax from invoices in the selected range. 2% and 10% rates per Afghan sales tax law.'
                    )}
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ---------------- تب انبار ---------------- */}
        <TabsContent value="inventory" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            <StatCard
              title={t('ارزش محصولات', 'د محصولاتو ارزښت', 'Products value')}
              value={formatMoney(inventoryValuation.productsValue)}
              icon={Boxes}
              tone="green"
            />
            <StatCard
              title={t('ارزش مواد خام', 'د خامو موادو ارزښت', 'Materials value')}
              value={formatMoney(inventoryValuation.materialsValue)}
              icon={Boxes}
              tone="blue"
            />
            <StatCard
              title={t('ارزش کل انبار', 'د ګدام ټول ارزښت', 'Total inventory value')}
              value={formatMoney(inventoryValuation.total)}
              icon={Boxes}
              tone="amber"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-emerald-600" />
                    {t('زیادترین ارزش — محصولات', 'ډېر ارزښت — محصولات', 'Highest value — products')}
                  </CardTitle>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      downloadCSV('inventory-report.csv', [
                        [
                          t('نوع', 'ډول', 'Type'),
                          t('نام', 'نوم', 'Name'),
                          t('موجودی', 'موجودي', 'Stock'),
                          t('واحد', 'واحد', 'Unit'),
                          t('ارزش (افغانی)', 'ارزښت (افغانی)', 'Value (AFN)'),
                        ],
                        ...inventoryValuation.topProducts.map((p) => [
                          t('محصول', 'محصول', 'Product'),
                          p.name,
                          p.stock,
                          p.unit,
                          p.value,
                        ]),
                        ...inventoryValuation.topMaterials.map((m) => [
                          t('ماده خام', 'خام ماده', 'Material'),
                          m.name,
                          m.stock,
                          m.unit,
                          m.value,
                        ]),
                      ])
                    }
                  >
                    <Download className="me-2 h-4 w-4" />
                    {t('دانلود CSV', 'CSV ډاونلوډ', 'Download CSV')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                      <TableRow>
                        <TableHead>{t('محصول', 'محصول', 'Product')}</TableHead>
                        <TableHead>{t('موجودی', 'موجودي', 'Stock')}</TableHead>
                        <TableHead>{t('ارزش', 'ارزښت', 'Value')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventoryValuation.topProducts.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                            {t('موردی ثبت نشده', 'مورد نه دی ثبت شوی', 'No data')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        inventoryValuation.topProducts.map((p) => (
                          <TableRow key={p.name}>
                            <TableCell className="max-w-44 truncate">{p.name}</TableCell>
                            <TableCell className="text-muted-foreground rtl:text-right" dir="ltr">
                              {formatNumber(p.stock)} {p.unit}
                            </TableCell>
                            <TableCell className="font-semibold">{formatMoney(p.value)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Boxes className="h-4 w-4 text-sky-600" />
                  {t('زیادترین ارزش — مواد خام', 'ډېر ارزښت — خام مواد', 'Highest value — materials')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur z-10">
                      <TableRow>
                        <TableHead>{t('ماده', 'ماده', 'Material')}</TableHead>
                        <TableHead>{t('موجودی', 'موجودي', 'Stock')}</TableHead>
                        <TableHead>{t('ارزش', 'ارزښت', 'Value')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inventoryValuation.topMaterials.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                            {t('موردی ثبت نشده', 'مورد نه دی ثبت شوی', 'No data')}
                          </TableCell>
                        </TableRow>
                      ) : (
                        inventoryValuation.topMaterials.map((m) => (
                          <TableRow key={m.name}>
                            <TableCell className="max-w-44 truncate">{m.name}</TableCell>
                            <TableCell className="text-muted-foreground rtl:text-right" dir="ltr">
                              {formatNumber(m.stock)} {m.unit}
                            </TableCell>
                            <TableCell className="font-semibold">{formatMoney(m.value)}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
