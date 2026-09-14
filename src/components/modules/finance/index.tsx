'use client'

// ماژول مالی — صورت سود و زیان، قرض مشتریان، مصارف، خلاصه مالیات
import { useMemo, useState } from 'react'
import { toJalaali } from 'jalaali-js'
import { toast } from 'sonner'
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  ReceiptText,
  Factory,
  Banknote,
  Landmark,
  Plus,
  Trash2,
  Loader2,
  AlertTriangle,
} from 'lucide-react'
import { PageHeader, StatCard, EmptyState } from '@/components/shared/common'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { formatNumber, formatMoney, toJalaliStr, CURRENCY_LABELS } from '@/lib/format'
import type { Currency } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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
import { cn } from '@/lib/utils'

// ----------------- انواع -----------------
type SaleRow = {
  id: string
  invoiceNumber: string
  customer?: { name: string } | null
  customerName: string | null
  date: string
  currency: string
  exchangeRate: number
  total: number
  paidAmount: number
  taxRate: number
  taxAmount: number
  status: string
}
type ExpenseRow = {
  id: string
  date: string
  category: string
  description: string
  amount: number
  currency: string
}
type ProductionRow = {
  id: string
  status: string
  totalCost: number
}
type CustomerRow = {
  id: string
  name: string
  balance: number
}

const CATEGORIES = ['معاش', 'کرایه', 'برق', 'سوخت', 'حمل‌ونقل', 'تعمیرات', 'عمومی']
const OTHER = '__other__'
const CURRENCIES: Currency[] = ['AFN', 'USD', 'PKR']
const ALL = '__all__'

async function callApi<T>(
  url: string,
  method: 'POST' | 'DELETE',
  body?: unknown
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    if (!res.ok) return { ok: false, error: json.error || `خطا (${res.status})` }
    return { ok: true, data: json as T }
  } catch {
    return { ok: false, error: 'خطا در اتصال به هاست' }
  }
}

function jMonthKey(d: Date): string {
  try {
    const j = toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate())
    return `${j.jy}-${j.jm}`
  } catch {
    return ''
  }
}

// ================= ماژول =================
export default function FinanceModule() {
  const { t } = useI18n()
  const sales = useFetch<SaleRow[]>('/api/sales')
  const expenses = useFetch<ExpenseRow[]>('/api/expenses')
  const production = useFetch<ProductionRow[]>('/api/production')
  const customers = useFetch<CustomerRow[]>('/api/customers')
  const settings = useFetch<Record<string, string>>('/api/settings')

  const saleList = sales.data ?? []
  const expenseList = expenses.data ?? []
  const customerList = customers.data ?? []
  const usdRate = Number(settings.data?.usdRate) || 70
  const pkrRate = Number(settings.data?.pkrRate) || 0.25

  function toAfn(amount: number, currency: string): number {
    if (currency === 'USD') return amount * usdRate
    if (currency === 'PKR') return amount * pkrRate
    return amount
  }

  // ---- محاسبات مالی ----
  const fin = useMemo(() => {
    const sList = sales.data ?? []
    const eList = expenses.data ?? []
    let revenue = 0
    const byCurrency: Record<string, number> = { AFN: 0, USD: 0, PKR: 0 }
    let tax2 = 0
    let tax10 = 0
    let receivable = 0
    for (const s of sList) {
      const afn = (s.total || 0) * (s.exchangeRate || 1)
      revenue += afn
      byCurrency[s.currency] = (byCurrency[s.currency] || 0) + (s.total || 0)
      if (s.taxRate === 2) tax2 += (s.taxAmount || 0) * (s.exchangeRate || 1)
      if (s.taxRate === 10) tax10 += (s.taxAmount || 0) * (s.exchangeRate || 1)
      if (s.status !== 'paid') receivable += (s.total - s.paidAmount) * (s.exchangeRate || 1)
    }
    const productionCosts = (production.data ?? [])
      .filter((p) => p.status === 'completed')
      .reduce((acc, p) => acc + (p.totalCost || 0), 0)
    const opex = eList.reduce((acc, e) => {
      const rate = e.currency === 'USD' ? usdRate : e.currency === 'PKR' ? pkrRate : 1
      return acc + (e.amount || 0) * rate
    }, 0)
    const grossProfit = revenue - productionCosts
    const netProfit = grossProfit - opex
    return { revenue, byCurrency, tax2, tax10, receivable, productionCosts, opex, grossProfit, netProfit }
  }, [sales.data, expenses.data, production.data, usdRate, pkrRate])

  const debtCustomers = customerList.filter((c) => c.balance > 0.001)
  const receivableSales = saleList.filter((s) => s.status !== 'paid')

  // ---- مصارف ----
  const monthKey = jMonthKey(new Date())
  const monthlyExpenses = expenseList
    .filter((e) => jMonthKey(new Date(e.date)) === monthKey)
    .reduce((acc, e) => acc + toAfn(e.amount || 0, e.currency), 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('مدیریت مالی', 'مالي', 'Finance')}
        subtitle={t('سود و زیان، قرض ها، مصارف و مالیات', 'ګټه او زیان، پورونه، لګښتونه او مالیه', 'P&L, receivables, expenses & tax')}
        icon={Wallet}
      />

      {/* درآمد به تفکیک ارز */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={t('درآمد افغانی', 'افغانۍ عاید', 'Revenue AFN')} value={formatMoney(fin.byCurrency.AFN || 0)} icon={Banknote} tone="green" />
        <StatCard title={t('درآمد دالر', 'دالر عاید', 'Revenue USD')} value={formatMoney(fin.byCurrency.USD || 0, 'USD')} icon={Banknote} tone="blue" />
        <StatCard title={t('درآمد کلدار', 'کلدار عاید', 'Revenue PKR')} value={formatMoney(fin.byCurrency.PKR || 0, 'PKR')} icon={Banknote} tone="amber" />
        <StatCard
          title={t('سود ناخالص تقریبی', 'تقریبي ناټوله ګټه', 'Gross profit (approx.)')}
          value={formatMoney(fin.grossProfit)}
          icon={fin.grossProfit >= 0 ? TrendingUp : TrendingDown}
          tone={fin.grossProfit >= 0 ? 'green' : 'red'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* صورت سود و زیان مختصر */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4 text-primary" />
              {t('صورت سود و زیان مختصر', 'لنډه ګټه او زیان', 'Brief P&L statement')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label={t('درآمد فروش', 'د پلورنې عاید', 'Sales revenue')} value={formatMoney(fin.revenue)} tone="text-emerald-600" />
            <Row label={t('مصارف تولید (سفارش‌های تکمیل‌شده)', 'د تولید لګښتونه', 'Production costs (completed)')} value={`− ${formatMoney(fin.productionCosts)}`} tone="text-red-600" icon={<Factory className="h-3.5 w-3.5" />} />
            <Separator />
            <Row label={t('سود ناخالص تقریبی', 'تقریبي ناټوله ګټه', 'Gross profit (approx.)')} value={formatMoney(fin.grossProfit)} bold tone={fin.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
            <Row label={t('مصارف عملیاتی', 'عملیاتي لګښتونه', 'Operating expenses')} value={`− ${formatMoney(fin.opex)}`} tone="text-red-600" icon={<ReceiptText className="h-3.5 w-3.5" />} />
            <Separator />
            <Row
              label={t('سود خالص تقریبی', 'تقریبي خالصه ګټه', 'Net profit (approx.)')}
              value={formatMoney(fin.netProfit)}
              bold
              tone={fin.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}
            />
            {fin.netProfit >= 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                <TrendingUp className="h-3.5 w-3.5" />
                {t('وضعیت مالی مثبت است', 'مالي حالت مثبت دی', 'Financial position is positive')}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('مصارف از درآمد زیادتر است', 'لګښتونه له عاید ډېر دي', 'Expenses exceed revenue')}
              </p>
            )}
          </CardContent>
        </Card>

        {/* خلاصه مالیات + قرض کلی */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ReceiptText className="h-4 w-4 text-primary" />
              {t('خلاصه مالیات فروش', 'د پلورنې مالیه', 'Sales tax summary')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Row label={t('مالیات ۲٪ جمع‌شده', 'ټول شوی ۲٪ مالیه', 'Collected 2% tax')} value={formatMoney(fin.tax2)} tone="text-amber-600" />
            <Row label={t('مالیات ۱۰٪ جمع‌شده', 'ټول شوی ۱۰٪ مالیه', 'Collected 10% tax')} value={formatMoney(fin.tax10)} tone="text-amber-600" />
            <Separator />
            <Row label={t('جمع مالیات', 'ټوله مالیه', 'Total tax')} value={formatMoney(fin.tax2 + fin.tax10)} bold />
            <Separator />
            <Row
              label={t('قرض ها', 'ناکړل شوې مطالبات', 'Unpaid receivables')}
              value={formatMoney(fin.receivable)}
              tone="text-amber-600"
              bold
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'مبالغ به افغانی با نرخ ثبت‌شده هر بل تبدیل شده است.',
              'مبالغ افغانۍ ته د هر بل په ثبت شوې نرخ بدل شوي دي.',
                'Amounts converted to AFN using each invoice rate.'
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* قرض مشتریان */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Banknote className="h-4 w-4 text-amber-600" />
              {t('قرض مشتریان', 'د پیرودونکو پورونه', 'Customer receivables')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-h-72 overflow-y-auto rounded-lg border">
              {receivableSales.length === 0 ? (
                <EmptyState label={t('بل پرداخت‌نشده وجود ندارد', 'پرداخت شوی بل نشته', 'No unpaid invoices')} />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('بل', 'بل', 'Invoice')}</TableHead>
                      <TableHead>{t('مشتری', 'پیرودونکی', 'Customer')}</TableHead>
                      <TableHead>{t('مبلغ', 'مبلغ', 'Total')}</TableHead>
                      <TableHead>{t('باقیات', 'پاتې', 'Remaining')}</TableHead>
                      <TableHead>{t('تاریخ', 'نېټه', 'Date')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivableSales.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.invoiceNumber}</TableCell>
                        <TableCell className="text-xs">{s.customer?.name ?? s.customerName ?? t('متفرقه', 'عام', 'Walk-in')}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatMoney(s.total, s.currency as Currency)}</TableCell>
                        <TableCell className="text-xs font-semibold text-amber-600 whitespace-nowrap">
                          {formatMoney(s.total - s.paidAmount, s.currency as Currency)}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{toJalaliStr(s.date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <div className="flex items-center justify-between text-sm font-semibold">
              <span>{t('جمع باقیات', 'ټوله پاتې', 'Total remaining')}</span>
              <span className="text-amber-600">{formatMoney(fin.receivable)}</span>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium mb-2">
                {t('باقیات قرض مشتریان (دفتر)', 'د پیرودونکو پور (دفتر)', 'Customer book balances')}
              </p>
              {debtCustomers.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t('مشتری بدهکار وجود ندارد', 'پوروړی پیرودونکی نشته', 'No debtors')}
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {debtCustomers.map((c) => (
                    <Badge key={c.id} variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">
                      {c.name}: {formatMoney(c.balance)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* مصارف */}
        <ExpensesCard
          expenses={expenseList}
          onChanged={expenses.refetch}
          monthlyTotal={monthlyExpenses}
          loading={expenses.loading}
        />
      </div>
    </div>
  )
}

// سطر ساده صورت حساب
function Row({
  label,
  value,
  tone,
  bold,
  icon,
}: {
  label: string
  value: string
  tone?: string
  bold?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className={cn('text-muted-foreground flex items-center gap-1.5', bold && 'font-semibold text-foreground')}>
        {icon}
        {label}
      </span>
      <span className={cn('font-medium', bold && 'font-bold text-base', tone)}>{value}</span>
    </div>
  )
}

// ================= کارت مصارف =================
function ExpensesCard({
  expenses,
  onChanged,
  monthlyTotal,
  loading,
}: {
  expenses: ExpenseRow[]
  onChanged: () => void
  monthlyTotal: number
  loading: boolean
}) {
  const { t } = useI18n()
  const [category, setCategory] = useState(CATEGORIES[0])
  const [customCategory, setCustomCategory] = useState('')
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>('AFN')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [filterCat, setFilterCat] = useState(ALL)

  const filtered = useMemo(
    () => (filterCat === ALL ? expenses : expenses.filter((e) => e.category === filterCat)),
    [expenses, filterCat]
  )
  const usedCategories = useMemo(() => Array.from(new Set(expenses.map((e) => e.category))), [expenses])

  async function submit() {
    const desc = description.trim()
    const val = Number(amount)
    if (!desc) {
      toast.error(t('توضیح مصرف ضروری است', 'د لګښت تشریح اړینه ده', 'Description required'))
      return
    }
    if (!val || val <= 0) {
      toast.error(t('مقدار باید زیادتر از صفر باشد', 'مقدار باید له صفر ډېر وي', 'Amount must be > 0'))
      return
    }
    const finalCategory = category === OTHER ? customCategory.trim() : category
    if (!finalCategory) {
      toast.error(t('نام کتگوری را بنویسید', 'د کټګورۍ نوم ولیکه', 'Enter category name'))
      return
    }
    setSaving(true)
    const res = await callApi<ExpenseRow>('/api/expenses', 'POST', {
      category: finalCategory,
      description: desc,
      amount: val,
      currency,
      date: date ? new Date(date).toISOString() : undefined,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error || t('خطا در ثبت مصرف', 'د لګښت ثبت ستونزه', 'Save failed'))
      return
    }
    toast.success(t('مصرف ثبت شد', 'لګښت ثبت شو', 'Expense added'))
    setDescription('')
    setAmount('')
    setCustomCategory('')
    onChanged()
  }

  async function remove(e: ExpenseRow) {
    const res = await callApi<{ ok: boolean }>(`/api/expenses/${e.id}`, 'DELETE')
    if (!res.ok) {
      toast.error(res.error || t('خطا در حذف مصرف', 'د لګښت د ړنګولو ستونزه', 'Delete failed'))
      return
    }
    toast.success(t('مصرف حذف شد', 'لګښت ړنګ شو', 'Expense deleted'))
    onChanged()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-primary" />
            {t('مصارف عملیاتی', 'عملیاتي لګښتونه', 'Operating expenses')}
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            {t('این ماه', 'دا میاشت', 'This month')}:{' '}
            <span className="font-bold text-red-600">{formatMoney(monthlyTotal)}</span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* فورم ثبت مصرف */}
        <div className="rounded-lg border p-3 space-y-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('کتگوری', 'کټګوري', 'Category')}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>{t('سایر...', 'نور...', 'Other...')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('مقدار', 'مقدار', 'Amount')}</Label>
              <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('ارز', 'اسعارو', 'Currency')}</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CURRENCY_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {category === OTHER && (
              <div className="space-y-1">
                <Label className="text-xs">{t('نام کتگوری', 'د کټګورۍ نوم', 'Category name')}</Label>
                <Input value={customCategory} onChange={(e) => setCustomCategory(e.target.value)} className="h-8" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">{t('تاریخ', 'نېټه', 'Date')}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8" />
            </div>
            <div className="space-y-1 col-span-2 sm:col-span-1">
              <Label className="text-xs">{t('توضیح *', 'تشریح *', 'Description *')}</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} className="h-8" />
            </div>
          </div>
          <Button size="sm" onClick={submit} disabled={saving} className="w-full sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('ثبت مصرف', 'لګښت ثبت', 'Add expense')}
          </Button>
        </div>

        {/* فیلتر دسته */}
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger size="sm" className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('همه کتگوری‌ها', 'ټولې کټګورۍ', 'All categories')}</SelectItem>
            {usedCategories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* لیست مصارف */}
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          {loading ? (
            <p className="text-sm text-muted-foreground p-4 text-center">{t('در حال بارگیری...', 'بارېږي...', 'Loading...')}</p>
          ) : filtered.length === 0 ? (
            <EmptyState label={t('مصرفی ثبت نشده است', 'لګښت نه دی ثبت شوی', 'No expenses yet')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('تاریخ', 'نېټه', 'Date')}</TableHead>
                  <TableHead>{t('کتگوری', 'کټګوري', 'Category')}</TableHead>
                  <TableHead>{t('توضیح', 'تشریح', 'Description')}</TableHead>
                  <TableHead>{t('مقدار', 'مقدار', 'Amount')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs whitespace-nowrap">{toJalaliStr(e.date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{e.category}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">{e.description}</TableCell>
                    <TableCell className="text-xs font-semibold whitespace-nowrap text-red-600">
                      {formatMoney(e.amount, e.currency as Currency)}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8" title={t('حذف', 'ړنګول', 'Delete')} onClick={() => remove(e)}>
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
