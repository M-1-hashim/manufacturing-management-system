'use client'

// ماژول فروش — بل‌ها، مشتریان، چاپ بل، ثبت پرداخت
import { useMemo, useState } from 'react'
import { toJalaali } from 'jalaali-js'
import { toast } from 'sonner'
import {
  ShoppingCart,
  Users,
  Plus,
  Printer,
  Eye,
  Banknote,
  Trash2,
  Search,
  ReceiptText,
  X,
  Pencil,
  Loader2,
  Factory,
  MapPin,
  Phone,
  Wifi,
  WifiOff,
  RefreshCw,
} from 'lucide-react'
import {
  PageHeader,
  StatCard,
  LoadingBlock,
  EmptyState,
  TableSkeleton,
} from '@/components/shared/common'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import {
  formatNumber,
  formatMoney,
  toJalaliStr,
  toGregorianStr,
  STATUS_COLORS,
  CURRENCY_LABELS,
} from '@/lib/format'
import type { Currency } from '@/lib/format'
import { amountToWords } from '@/lib/amount-words'
import {
  PrintDocDialog,
  DocTable,
  DocRow,
  DocCell,
  DocTotals,
  DocAmountWords,
} from '@/components/shared/print-doc'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

// ----------------- انواع -----------------
type ProductRow = {
  id: string
  code: string
  name: string
  unit: string
  stock: number
  salePrice: number
  wholesalePrice: number
}
type CustomerRow = {
  id: string
  name: string
  phone: string | null
  address: string | null
  type: string // retail | wholesale
  balance: number
  notes: string | null
  _count: { sales: number }
}
type SaleItemRow = {
  id: string
  productId: string
  product?: ProductRow | null
  quantity: number
  unitPrice: number
  discount: number
  total: number
}
type SaleRow = {
  id: string
  invoiceNumber: string
  customerId: string | null
  customer?: { id: string; name: string; type: string } | null
  customerName: string | null
  date: string
  currency: string
  exchangeRate: number
  subtotal: number
  discount: number
  taxRate: number
  taxAmount: number
  total: number
  paidAmount: number
  paymentMethod: string
  status: string
  notes: string | null
  items: SaleItemRow[]
}

const NONE = '__none__'
const ALL = '__all__'
const CURRENCIES: Currency[] = ['AFN', 'USD', 'PKR']

// پاسخ API نرخ لحظه‌ای — همان ساختار src/lib/exchange-rate.ts (هاست)
interface LiveRatesT {
  usd: number
  pkr: number
  source: string
  updatedAt: string
  fetchedAt: string
  cached: boolean
  stale: boolean
  nextUpdate?: string
}

// کلاینت ساده API با استخراج پیام خطای دری
async function callApi<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
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

function customerLabel(c: CustomerRow, t: (fa: string, ps: string, en: string) => string): string {
  return c.type === 'wholesale'
    ? `${c.name} — ${t('عمده', 'پرچونۍ', 'Wholesale')}`
    : `${c.name} — ${t('خرده', 'لږ', 'Retail')}`
}

// ================= ماژول اصلی =================
export default function SalesModule() {
  const { t } = useI18n()
  const sales = useFetch<SaleRow[]>('/api/sales')
  const customers = useFetch<CustomerRow[]>('/api/customers')
  const products = useFetch<ProductRow[]>('/api/products?active=true')
  const settings = useFetch<Record<string, string>>('/api/settings')

  const [search, setSearch] = useState('')
  const [statusF, setStatusF] = useState(ALL)
  const [methodF, setMethodF] = useState(ALL)

  const [newOpen, setNewOpen] = useState(false)
  const [customersOpen, setCustomersOpen] = useState(false)
  const [invoiceSale, setInvoiceSale] = useState<SaleRow | null>(null)
  const [paySale, setPaySale] = useState<SaleRow | null>(null)
  const [delSale, setDelSale] = useState<SaleRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const list = sales.data ?? []
  const customerList = customers.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return list.filter((s) => {
      if (statusF !== ALL && s.status !== statusF) return false
      if (methodF !== ALL && s.paymentMethod !== methodF) return false
      if (q) {
        const name = s.customer?.name ?? s.customerName ?? ''
        if (!s.invoiceNumber.toLowerCase().includes(q) && !name.toLowerCase().includes(q))
          return false
      }
      return true
    })
  }, [list, search, statusF, methodF])

  const stats = useMemo(() => {
    const today = new Date()
    const todayKey = today.toDateString()
    const monthKey = jMonthKey(today)
    let todaySum = 0
    let monthSum = 0
    let receivable = 0
    for (const s of list) {
      const d = new Date(s.date)
      const afn = (s.total || 0) * (s.exchangeRate || 1)
      if (d.toDateString() === todayKey) todaySum += afn
      if (jMonthKey(d) === monthKey) monthSum += afn
      if (s.status !== 'paid') receivable += Math.max(0, s.total - s.paidAmount) * (s.exchangeRate || 1)
    }
    return { todaySum, monthSum, receivable, count: list.length }
  }, [list])

  function handleCreated(sale: SaleRow) {
    setNewOpen(false)
    sales.refetch()
    customers.refetch()
    products.refetch()
    // پاسخ ترکیبی حالت آفلاین — بل در صف همگام‌سازی است و نمایش ندارد
    if ((sale as unknown as { offlineQueued?: boolean }).offlineQueued) {
      toast.success(
        t(
          'بل به‌صورت آفلاین ذخیره شد و پس از اتصال همگام می‌شود',
          'بل افلاین خوندي شو او له نښلېدو وروسته همغه کیږي',
          'Invoice saved offline — syncs when back online'
        )
      )
      return
    }
    setInvoiceSale(sale)
    toast.success(
      t('بل ثبت شد: ', 'بل ثبت شو: ', 'Invoice created: ') + sale.invoiceNumber
    )
  }

  async function handleDelete() {
    if (!delSale) return
    setDeleting(true)
    const res = await callApi<{ ok: boolean }>(`/api/sales/${delSale.id}`, 'DELETE')
    setDeleting(false)
    if (!res.ok) {
      toast.error(res.error || t('خطا در حذف بل', 'د بل په ړنګولو کې ستونزه', 'Delete failed'))
      return
    }
    toast.success(t('بل حذف شد و موجودی برگشت داده شد', 'بل ړنګ او موجودي بیرته ورکړل شو', 'Invoice deleted, stock restored'))
    setDelSale(null)
    sales.refetch()
    customers.refetch()
    products.refetch()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('فروشات', 'پلورنه', 'Sales')}
        subtitle={t('مدیریت بل‌های فروش و مشتریان', 'د پلورنې بلونو او پیرودونکو مدیریت', 'Sales invoices & customers')}
        icon={ShoppingCart}
        actions={
          <>
            <Button variant="outline" onClick={() => setCustomersOpen(true)}>
              <Users className="h-4 w-4" />
              {t('مشتریان', 'پیرودونکي', 'Customers')}
            </Button>
            <Button onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" />
              {t('فروش جدید', 'نوی پلورنه', 'New sale')}
            </Button>
          </>
        }
      />

      {/* آمار */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title={t('فروش امروز', 'د نن پلورنه', "Today's sales")}
          value={formatMoney(stats.todaySum)}
          icon={ShoppingCart}
          tone="green"
        />
        <StatCard
          title={t('فروش این ماه', 'د میاشتې پلورنه', "This month's sales")}
          value={formatMoney(stats.monthSum)}
          icon={ReceiptText}
          tone="blue"
        />
        <StatCard
          title={t('قرض ها', 'ناکړل شوې مطالبات', 'Unpaid receivables')}
          value={formatMoney(stats.receivable)}
          icon={Banknote}
          tone="amber"
        />
        <StatCard
          title={t('تعداد بل‌ها', 'د بلونو شمېر', 'Invoices count')}
          value={formatNumber(stats.count)}
          icon={Users}
          tone="slate"
        />
      </div>

      {/* ابزارک جستجو و فیلتر */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('جستجوی نمبر بل یا مشتری...', 'د بل یا پیرودونکي لټون...', 'Search invoice / customer...')}
            className="ps-8"
          />
        </div>
        <Select value={statusF} onValueChange={setStatusF}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('همه وضعیت‌ها', 'ټول حالتونه', 'All statuses')}</SelectItem>
            <SelectItem value="paid">{t('پرداخت‌شده', 'پرداخت شوی', 'Paid')}</SelectItem>
            <SelectItem value="partial">{t('پرداخت جزئی', 'نیمه پرداخت', 'Partial')}</SelectItem>
            <SelectItem value="unpaid">{t('پرداخت‌نشده', 'ناپرداخت', 'Unpaid')}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={methodF} onValueChange={setMethodF}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('همه روش‌ها', 'ټولې لارې', 'All methods')}</SelectItem>
            <SelectItem value="cash">{t('نقد', 'نغدي', 'Cash')}</SelectItem>
            <SelectItem value="credit">{t('نسیه', 'پور', 'Credit')}</SelectItem>
            <SelectItem value="transfer">{t('حواله', 'بانکي', 'Transfer')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* جدول بل‌ها */}
      <div className="rounded-xl border bg-card">
        {sales.loading ? (
          <div className="p-4">
            <TableSkeleton rows={6} />
          </div>
        ) : sales.error ? (
          <LoadingBlock label={sales.error} />
        ) : filtered.length === 0 ? (
          <EmptyState label={t('هیچ بلی ثبت نشده است', 'بل نه دی ثبت شوی', 'No invoices yet')} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('بل', 'بل', 'Invoice')}</TableHead>
                  <TableHead>{t('مشتری', 'پیرودونکی', 'Customer')}</TableHead>
                  <TableHead>{t('تاریخ', 'نېټه', 'Date')}</TableHead>
                  <TableHead>{t('اقلام', 'توکي', 'Items')}</TableHead>
                  <TableHead>{t('مبلغ', 'مبلغ', 'Total')}</TableHead>
                  <TableHead>{t('پرداخت‌شده', 'پرداخت شوی', 'Paid')}</TableHead>
                  <TableHead>{t('روش', 'طریقه', 'Method')}</TableHead>
                  <TableHead>{t('وضعیت', 'حالت', 'Status')}</TableHead>
                  <TableHead>{t('اجراؤات', 'کړنې', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.invoiceNumber}</TableCell>
                    <TableCell>{s.customer?.name ?? s.customerName ?? t('مشتری متفرقه', 'عام پیرودونکی', 'Walk-in')}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap">{toJalaliStr(s.date)}</TableCell>
                    <TableCell>{formatNumber(s.items?.length ?? 0)}</TableCell>
                    <TableCell className="font-semibold whitespace-nowrap">
                      {formatMoney(s.total, s.currency as Currency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatMoney(s.paidAmount, s.currency as Currency)}
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[s.paymentMethod] ?? ''}>
                        {s.paymentMethod === 'cash'
                          ? t('نقد', 'نغدي', 'Cash')
                          : s.paymentMethod === 'credit'
                            ? t('نسیه', 'پور', 'Credit')
                            : t('حواله', 'بانکي', 'Transfer')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[s.status] ?? ''}>
                        {s.status === 'paid'
                          ? t('پرداخت‌شده', 'پرداخت شوی', 'Paid')
                          : s.status === 'partial'
                            ? t('جزئی', 'نیمه', 'Partial')
                            : t('پرداخت‌نشده', 'ناپرداخت', 'Unpaid')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-start gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('چاپ / مشاهده', 'چاپ / لیدل', 'Print / view')}
                          onClick={() => setInvoiceSale(s)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {s.status !== 'paid' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('دریافت پرداخت', 'پیسې اخیستل', 'Receive payment')}
                            onClick={() => setPaySale(s)}
                          >
                            <Banknote className="h-4 w-4 text-emerald-600" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('حذف', 'ړنګول', 'Delete')}
                          onClick={() => setDelSale(s)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* دیالوگ‌ها */}
      {newOpen && (
        <NewSaleDialog
          open
          onOpenChange={setNewOpen}
          customers={customerList}
          products={products.data ?? []}
          settings={settings.data}
          onCreated={handleCreated}
        />
      )}

      <CustomersDialog
        open={customersOpen}
        onOpenChange={setCustomersOpen}
        customers={customerList}
        sales={list}
        onChanged={customers.refetch}
      />

      <InvoiceDialog
        sale={invoiceSale}
        settings={settings.data}
        customers={customerList}
        onClose={() => setInvoiceSale(null)}
      />

      {/* دیالوگ دریافت پرداخت */}
      {paySale && (
        <PayDialog
          key={paySale.id}
          sale={paySale}
          onClose={() => setPaySale(null)}
          onSaved={() => {
            sales.refetch()
            customers.refetch()
          }}
        />
      )}

      {/* تصدیق حذف بل */}
      <AlertDialog open={!!delSale} onOpenChange={(o) => !o && setDelSale(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف بل', 'د بل ړنګول', 'Delete invoice')}</AlertDialogTitle>
            <AlertDialogDescription>
              {delSale && (
                <>
                  {t(
                    'بل ',
                    'بل ',
                    'Invoice '
                  )}
                  <span className="font-mono">{delSale.invoiceNumber}</span>
                  {t(
                    ' حذف شود؟ موجودی انبار برگشت داده شده و قرض مشتری تعدیل می‌گردد.',
                    ' ړنګ شي؟ موجودي بیرته ورکړل کیږي او د پیرودونکي پور تعدیل کیږي.',
                    ' will be deleted. Stock will be restored and customer balance adjusted.'
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault()
                handleDelete()
              }}
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('حذف', 'ړنګول', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ================= دیالوگ فروش جدید =================
type DraftRow = {
  key: number
  productId: string
  quantity: string
  unitPrice: string
  discount: string
}

function NewSaleDialog({
  open,
  onOpenChange,
  customers,
  products,
  settings,
  onCreated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  customers: CustomerRow[]
  products: ProductRow[]
  settings: Record<string, string> | null
  onCreated: (sale: SaleRow) => void
}) {
  const { t } = useI18n()
  const [customerId, setCustomerId] = useState(NONE)
  const [quickName, setQuickName] = useState('')
  const [currency, setCurrency] = useState<Currency>('AFN')
  const [exchangeRate, setExchangeRate] = useState('1')
  const [discount, setDiscount] = useState('0')
  const [taxRate, setTaxRate] = useState<'0' | '2' | '10'>('0')
  const [paidAmount, setPaidAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit' | 'transfer'>('cash')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [rowSeq, setRowSeq] = useState(1)
  // هر بار که دیالوگ از والد مونت می‌شود، فورم تازه است
  const [rows, setRows] = useState<DraftRow[]>([
    { key: 0, productId: '', quantity: '', unitPrice: '', discount: '0' },
  ])

  const selectedCustomer = customers.find((c) => c.id === customerId) || null

  // نرخ لحظه‌ای تبدیل ارز از API واقعی — هر بار باز شدن دیالوگ گرفته می‌شود
  const live = useFetch<LiveRatesT>(open ? '/api/exchange-rate' : null)

  function autoPrice(productId: string): string {
    const p = products.find((x) => x.id === productId)
    if (!p) return ''
    const price = selectedCustomer?.type === 'wholesale' ? p.wholesalePrice : p.salePrice
    return String(price || 0)
  }

  function addRow() {
    setRows((r) => [
      ...r,
      { key: Date.now() + rowSeq, productId: '', quantity: '', unitPrice: '', discount: '0' },
    ])
    setRowSeq((n) => n + 1)
  }

  function updateRow(key: number, patch: Partial<DraftRow>) {
    setRows((r) => r.map((row) => (row.key === key ? { ...row, ...patch } : row)))
  }

  // انتخاب مشتری → قیمت‌های خودکار تجدید می‌شوند
  function handleCustomerChange(v: string) {
    setCustomerId(v)
    const type = customers.find((c) => c.id === v)?.type
    setRows((r) =>
      r.map((row) => {
        if (!row.productId) return row
        const p = products.find((x) => x.id === row.productId)
        if (!p) return row
        const price = type === 'wholesale' ? p.wholesalePrice : p.salePrice
        return { ...row, unitPrice: String(price || 0) }
      })
    )
  }

  // تغییر ارز → نرخ پیش‌فرض: اول نرخ لحظه‌ای از API، بعد تنظیمات
  function handleCurrencyChange(v: string) {
    const cur = v as Currency
    setCurrency(cur)
    if (cur === 'AFN') setExchangeRate('1')
    else if (cur === 'USD') setExchangeRate(String(live.data?.usd || Number(settings?.usdRate) || 70))
    else setExchangeRate(String(live.data?.pkr || Number(settings?.pkrRate) || 0.25))
  }

  // وقتی نرخ لحظه‌ای رسید → اگر کاربر هنوز نرخ دستی وارد نکرده، فیلد با نرخ زنده همگام می‌شود
  // (الگوی رسمی React: تنظیم state هنگام رندر هنگام تغییر داده بیرونی — بدون useEffect)
  const [syncedLive, setSyncedLive] = useState<LiveRatesT | null>(null)
  if (live.data !== syncedLive) {
    setSyncedLive(live.data)
    if (live.data && currency !== 'AFN') {
      const fallback = currency === 'USD' ? Number(settings?.usdRate) || 70 : Number(settings?.pkrRate) || 0.25
      const current = Number(exchangeRate)
      if (!current || Math.abs(current - fallback) < 0.001) {
        const target = currency === 'USD' ? live.data.usd : live.data.pkr
        if (target > 0) setExchangeRate(String(target))
      }
    }
  }

  // محاسبات
  const subtotal = rows.reduce(
    (acc, r) => acc + ((Number(r.quantity) || 0) * (Number(r.unitPrice) || 0) - (Number(r.discount) || 0)),
    0
  )
  const discVal = Number(discount) || 0
  const taxable = Math.max(0, subtotal - discVal)
  const taxAmount = (taxable * Number(taxRate)) / 100
  const total = taxable + taxAmount
  const paidVal = Number(paidAmount) || 0
  const remaining = total - paidVal

  async function submit() {
    const items = rows
      .filter((r) => r.productId && Number(r.quantity) > 0)
      .map((r) => ({
        productId: r.productId,
        quantity: Number(r.quantity),
        unitPrice: Number(r.unitPrice) || 0,
        discount: Number(r.discount) || 0,
      }))
    if (items.length === 0) {
      toast.error(t('حداقل یک کالا با مقدار معتبر علاوه کنید', 'لږ تر لږه یو توک اضافه کړئ', 'Add at least one valid item'))
      return
    }
    // اعتبارسنجی سمت کلاینت — همان پیام‌های سرور (به همان ترتیب)
    if (items.some((it) => it.discount < 0)) {
      toast.error(t('تخفیف نمی‌تواند منفی باشد', 'ټکۍ نه شي منفي', 'Discount cannot be negative'))
      return
    }
    if (discVal < 0) {
      toast.error(t('تخفیف نمی‌تواند منفی باشد', 'ټکۍ نه شي منفي', 'Discount cannot be negative'))
      return
    }
    if (paidVal < 0) {
      toast.error(t('مبلغ پرداخت نمی‌تواند منفی باشد', 'د تادیې مبلغ نه شي منفي', 'Paid amount cannot be negative'))
      return
    }
    setSaving(true)
    const res = await callApi<SaleRow>('/api/sales', 'POST', {
      customerId: customerId !== NONE ? customerId : undefined,
      customerName: customerId === NONE && quickName ? quickName : undefined,
      currency,
      exchangeRate: Number(exchangeRate) || 1,
      discount: discVal,
      taxRate: Number(taxRate),
      paidAmount: paidVal,
      paymentMethod,
      notes: notes || undefined,
      items,
    })
    setSaving(false)
    if (!res.ok || !res.data) {
      toast.error(res.error || t('خطا در ثبت فروش', 'د پلورنې ستونزه', 'Failed to save sale'))
      return
    }
    onCreated(res.data)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('فروش جدید', 'نوی پلورنه', 'New sale')}</DialogTitle>
          <DialogDescription>
            {t('بل فروش جدید ثبت کنید', 'نوی پلورنې بل ثبت کړئ', 'Create a new sales invoice')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* ستون راست: مشتری و اقلام */}
          <div className="md:col-span-3 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('مشتری', 'پیرودونکی', 'Customer')}</Label>
                <Select value={customerId} onValueChange={handleCustomerChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t('انتخاب مشتری', 'پیرودونکی غوره کړئ', 'Select customer')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>
                      {t('مشتری سریع (بدون ثبت)', 'ژر پیرودونکی', 'Quick customer')}
                    </SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {customerLabel(c, t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {customerId === NONE ? (
                <div className="space-y-1.5">
                  <Label>{t('نام مشتری سریع', 'د پیرودونکي نوم', 'Quick customer name')}</Label>
                  <Input
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                    placeholder={t('مثلاً: احمد', 'بېلګه: احمد', 'e.g. Ahmad')}
                  />
                </div>
              ) : (
                selectedCustomer && (
                  <div className="space-y-1.5">
                    <Label>{t('باقیات فعلی', 'اوسنی پور', 'Current balance')}</Label>
                    <div className="h-9 flex items-center text-sm text-amber-600 font-medium">
                      {formatMoney(selectedCustomer.balance)}
                    </div>
                  </div>
                )
              )}
            </div>

            <Separator />

            {/* تصحیحگر اقلام */}
            <div className="space-y-2">
              <div className="hidden md:grid grid-cols-12 gap-2 text-xs text-muted-foreground px-1">
                <div className="col-span-5">{t('کالا', 'توک', 'Product')}</div>
                <div className="col-span-2">{t('مقدار', 'مقدار', 'Qty')}</div>
                <div className="col-span-2">{t('فی', 'فی', 'Unit price')}</div>
                <div className="col-span-2">{t('تخفیف', 'ټکۍ', 'Discount')}</div>
                <div className="col-span-1" />
              </div>
              {rows.map((row) => {
                const p = products.find((x) => x.id === row.productId)
                const qty = Number(row.quantity) || 0
                const overStock = !!p && qty > p.stock
                return (
                  <div key={row.key} className="grid grid-cols-2 md:grid-cols-12 gap-2 items-start">
                    <div className="col-span-2 md:col-span-5 space-y-1">
                      <Select
                        value={row.productId || undefined}
                        onValueChange={(v) => updateRow(row.key, { productId: v, unitPrice: autoPrice(v) })}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t('انتخاب کالا...', 'توک غوره کړئ...', 'Pick product...')} />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((pr) => (
                            <SelectItem key={pr.id} value={pr.id}>
                              {pr.name} ({formatNumber(pr.stock)} {pr.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2">
                      <Input
                        type="number"
                        min="0"
                        value={row.quantity}
                        onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
                        placeholder={t('مقدار', 'مقدار', 'Qty')}
                        className={cn(overStock && 'border-red-500 focus-visible:ring-red-300')}
                      />
                      {p && (
                        <p className={cn('text-[10px] mt-1', overStock ? 'text-red-600' : 'text-muted-foreground')}>
                          {t('موجودی', 'موجودي', 'Stock')}: {formatNumber(p.stock)} {p.unit}
                          {overStock && ` — ${t('بیش از موجودی!', 'له موجودي زیات!', 'Over stock!')}`}
                        </p>
                      )}
                    </div>
                    <div className="md:col-span-2">
                      <Input
                        type="number"
                        min="0"
                        value={row.unitPrice}
                        onChange={(e) => updateRow(row.key, { unitPrice: e.target.value })}
                        placeholder={t('فی', 'فی', 'Price')}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <Input
                        type="number"
                        min="0"
                        value={row.discount}
                        onChange={(e) => updateRow(row.key, { discount: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                    <div className="col-span-1 md:col-span-1 flex items-center justify-between md:justify-center gap-1 h-9">
                      <span className="text-xs font-medium md:hidden">
                        {formatNumber(qty * (Number(row.unitPrice) || 0) - (Number(row.discount) || 0))}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-600"
                        title={t('حذف سطر', 'قطار ړنګول', 'Remove row')}
                        onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
              <Button variant="outline" size="sm" onClick={addRow} className="w-full sm:w-auto">
                <Plus className="h-4 w-4" />
                {t('علاوه کردن کالا', 'توک اضافه کول', 'Add item')}
              </Button>
            </div>
          </div>

          {/* ستون چپ: ارز و مجموع */}
          <div className="md:col-span-2 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('ارز', 'اسعارو', 'Currency')}</Label>
                <Select value={currency} onValueChange={handleCurrencyChange}>
                  <SelectTrigger className="w-full">
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
              <div className="space-y-1.5">
                <Label>{t('نرخ به AFG', 'د AFG نرخ', 'Rate to AFG')}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  disabled={currency === 'AFN'}
                />
                {currency !== 'AFN' && live.data && (
                  <div className="flex items-center gap-1.5 text-[11px] leading-tight">
                    {live.data.stale ? (
                      <>
                        <WifiOff className="h-3 w-3 shrink-0 text-amber-600" />
                        <span className="text-amber-700 dark:text-amber-500">
                          {t('آفلاین — آخرین نرخ ذخیره‌شده', 'انټرنټ نشته — وروستنی ذخیره شوې نرخ', 'Offline — last stored rate')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Wifi className="h-3 w-3 shrink-0 text-emerald-600" />
                        <span className="text-emerald-700 dark:text-emerald-500">
                          {t(
                            `نرخ لحظه‌ای: 1 ${currency === 'USD' ? 'دالر' : 'کلدار'} = ${formatNumber(currency === 'USD' ? live.data.usd : live.data.pkr, 2)} AFG`,
                            `لحظه يي نرخ: 1 ${currency === 'USD' ? 'ډالر' : 'کلدار'} = ${formatNumber(currency === 'USD' ? live.data.usd : live.data.pkr, 2)} AFG`,
                            `Live rate: 1 ${currency} = ${formatNumber(currency === 'USD' ? live.data.usd : live.data.pkr, 2)} AFN`
                          )}
                        </span>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => live.refetch()}
                      className="ms-auto shrink-0 rounded p-0.5 hover:bg-accent"
                      aria-label={t('تجدید نرخ', 'نرخ بروز کړئ', 'Refresh rate')}
                    >
                      <RefreshCw className={`h-3 w-3 ${live.loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('جمع اقلام', 'د توکو مجموع', 'Subtotal')}</span>
                <span className="font-medium">{formatNumber(subtotal, 2)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('تخفیف کلی', 'ټوله ټکۍ', 'Discount')}</span>
                <Input
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="w-28 h-8 text-end"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('مالیات', 'مالیه', 'Tax')}</span>
                <Select value={taxRate} onValueChange={(v) => setTaxRate(v as '0' | '2' | '10')}>
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0٪</SelectItem>
                    <SelectItem value="2">2٪</SelectItem>
                    <SelectItem value="10">10٪</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('مبلغ مالیات', 'د مالیه مبلغ', 'Tax amount')}</span>
                <span className="font-medium">{formatNumber(taxAmount, 2)}</span>
              </div>
              <Separator />
              <div className="flex justify-between items-center">
                <span className="font-semibold">{t('مبلغ نهایی', 'ټول مبلغ', 'TOTAL')}</span>
                <span className="text-xl font-bold text-primary">
                  {formatNumber(total, 2)} {CURRENCY_LABELS[currency]}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('پرداخت‌شده', 'پرداخت شوی', 'Paid')}</span>
                <Input
                  type="number"
                  min="0"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                  placeholder="0"
                  className="w-28 h-8 text-end"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t('روش پرداخت', 'د تادیې طریقه', 'Payment method')}</span>
                <Select
                  value={paymentMethod}
                  onValueChange={(v) => setPaymentMethod(v as 'cash' | 'credit' | 'transfer')}
                >
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{t('نقد', 'نغدي', 'Cash')}</SelectItem>
                    <SelectItem value="credit">{t('نسیه', 'پور', 'Credit')}</SelectItem>
                    <SelectItem value="transfer">{t('حواله', 'بانکي', 'Transfer')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div
                className={cn(
                  'flex justify-between rounded-md p-2',
                  remaining > 0.001 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                )}
              >
                <span className="text-sm">{t('باقیات', 'پاتې', 'Remaining')}</span>
                <span className="font-bold">{formatNumber(remaining, 2)}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{t('یادداشت', 'یادښت', 'Notes')}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('اختیاری', 'اختیاري', 'Optional')} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('لغو', 'لغوه', 'Cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('ثبت بل', 'بل ثبت', 'Save invoice')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}



// ================= دیالوگ بل (پیش‌نمایش و چاپ حرفه‌ای) =================
function InvoiceDialog({
  sale,
  settings,
  customers,
  onClose,
}: {
  sale: SaleRow | null
  settings: Record<string, string> | null
  customers: CustomerRow[]
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  if (!sale) return null

  const companyName = settings?.companyName || t('شرکت تولیدی', 'تولیدي شرکت', 'Manufacturing Co.')
  const companyAddress = settings?.companyAddress || ''
  const companyPhone = settings?.companyPhone || ''
  const customerName = sale.customer?.name ?? sale.customerName ?? t('مشتری متفرقه', 'عام پیرودونکی', 'Walk-in customer')
  const fullCustomer = sale.customerId ? customers.find((c) => c.id === sale.customerId) : undefined
  const remaining = sale.total - sale.paidAmount
  const currency = sale.currency as Currency
  const items = sale.items ?? []

  const methodLabel =
    sale.paymentMethod === 'cash'
      ? t('نقد', 'نغدي', 'Cash')
      : sale.paymentMethod === 'credit'
        ? t('نسیه', 'پور', 'Credit')
        : t('حواله', 'بانکي', 'Transfer')
  const methodCls =
    sale.paymentMethod === 'cash'
      ? 'bg-emerald-100 text-emerald-800'
      : sale.paymentMethod === 'credit'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-teal-100 text-teal-800'

  const statusLabel =
    sale.status === 'paid'
      ? t('پرداخت‌شده', 'پرداخت شوی', 'Paid')
      : sale.status === 'partial'
        ? t('جزئی', 'نیمه', 'Partial')
        : t('پرداخت‌نشده', 'ناپرداخت', 'Unpaid')
  const statusCls =
    sale.status === 'paid' ? 'bg-emerald-600 text-white' : sale.status === 'partial' ? 'bg-amber-500 text-white' : 'bg-red-500 text-white'

  const badgeBase = 'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap'
  const customerTypeLabel =
    (sale.customer?.type ?? fullCustomer?.type) === 'wholesale'
      ? t('عمده', 'پرچونۍ', 'Wholesale')
      : t('خرده', 'لږ', 'Retail')

  const signatureLabels = [
    t('امضای خریدار', 'د اخیستونکي لاسلیک', 'Customer signature'),
    t('حسابدار', 'محاسب', 'Accountant'),
    t('مدیر / مهر شرکت', 'مدیر / مهر شرکت', 'Manager / Company seal'),
  ]

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-3xl flex flex-col gap-0 p-0 max-h-[94vh] overflow-hidden rounded-xl border-0 bg-transparent shadow-none [&_[data-slot=dialog-close]]:no-print print:static print:translate-x-0 print:translate-y-0 print:max-h-none print:overflow-visible print:rounded-none print:border-0 print:bg-transparent print:p-0 print:shadow-none print:max-w-none"
      >
        {/* عنوان برای دسترسی‌پذیری صفحه‌خوان‌ها (در چاپ دیده نمی‌شود) */}
        <DialogTitle className="sr-only">{t('پیش‌نمایش بل', 'د بل مخکتنه', 'Invoice preview')}</DialogTitle>

        {/* ناحیه اسکرول */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6 print:overflow-visible print:p-0">
          {/* برگه بل — همیشه سفید مثل کاغذ واقعی */}
          <div className="print-area mx-auto w-full overflow-hidden rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-xl [print-color-adjust:exact] [-webkit-print-color-adjust:exact] print:rounded-none print:border-0 print:shadow-none">
            {/* نوار رنگی بالای بل */}
            <div className="h-2 w-full bg-gradient-to-l from-emerald-700 via-emerald-500 to-teal-500" />

            <div className="space-y-5 p-4 sm:p-8">
              {/* ---------- سرلوحه ---------- */}
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
                  <p className="text-base font-extrabold text-emerald-700 sm:text-lg">
                    {t('بل فروش', 'د پلورنې بل', 'Sales Invoice')}
                  </p>
                  <p className="text-[9px] font-bold tracking-[0.35em] text-emerald-600/70">SALES INVOICE</p>
                  <p className="mt-1.5 inline-block rounded-md bg-white px-2.5 py-1 font-mono text-sm font-bold text-neutral-800 shadow-sm" dir="ltr">
                    {sale.invoiceNumber}
                  </p>
                </div>
              </div>

              {/* ---------- معلومات مشتری و بل ---------- */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-neutral-200 p-3.5">
                  <p className="mb-2 text-[10px] font-bold tracking-[0.2em] text-emerald-700">
                    {t('به نام', 'پیرودونکي ته', 'BILL TO')}
                  </p>
                  <p className="font-bold">{customerName}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                    <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-medium text-neutral-600">
                      {customerTypeLabel}
                    </span>
                    {fullCustomer?.phone && <span dir="ltr">{fullCustomer.phone}</span>}
                    {fullCustomer?.address && <span className="min-w-0 truncate">{fullCustomer.address}</span>}
                  </div>
                </div>
                <div className="rounded-lg border border-neutral-200 p-3.5 text-sm">
                  <p className="mb-2 text-[10px] font-bold tracking-[0.2em] text-emerald-700">
                    {t('مشخصات بل', 'د بل معلومات', 'INVOICE DETAILS')}
                  </p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <span className="text-neutral-500">{t('تاریخ شمسی', 'نېټه (شمسي)', 'Date (Jalali)')}</span>
                    <span className="text-end font-semibold">{toJalaliStr(sale.date)}</span>
                    <span className="text-neutral-500">{t('تاریخ میلادی', 'نېټه (میلادي)', 'Date (Gregorian)')}</span>
                    <span className="text-end font-semibold" dir="ltr">
                      {toGregorianStr(sale.date)}
                    </span>
                    <span className="text-neutral-500">{t('روش پرداخت', 'د تادیې طریقه', 'Payment method')}</span>
                    <span className="text-end">
                      <span className={`${badgeBase} ${methodCls}`}>{methodLabel}</span>
                    </span>
                    <span className="text-neutral-500">{t('وضعیت', 'حالت', 'Status')}</span>
                    <span className="text-end">
                      <span className={`${badgeBase} ${statusCls}`}>{statusLabel}</span>
                    </span>
                    <span className="text-neutral-500">{t('ارز', 'اسعارو', 'Currency')}</span>
                    <span className="text-end font-semibold">{CURRENCY_LABELS[currency] ?? currency}</span>
                  </div>
                </div>
              </div>

              {/* ---------- جدول اقلام ---------- */}
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="w-full min-w-[540px] border-collapse text-xs sm:text-sm">
                  <thead>
                    <tr className="bg-emerald-600 text-white">
                      <th className="w-8 py-2.5 text-center font-semibold">#</th>
                      <th className="py-2.5 ps-3 text-start font-semibold">{t('کالا', 'توک', 'Product')}</th>
                      <th className="py-2.5 text-center font-semibold">{t('مقدار', 'مقدار', 'Qty')}</th>
                      <th className="py-2.5 text-center font-semibold">{t('فی واحد', 'فی واحد', 'Unit price')}</th>
                      <th className="py-2.5 text-center font-semibold">{t('تخفیف', 'ټکۍ', 'Disc')}</th>
                      <th className="py-2.5 pe-3 text-end font-semibold">{t('مبلغ کل', 'ټول مبلغ', 'Line total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="border-t border-neutral-200 py-4 text-center text-neutral-400">
                          —
                        </td>
                      </tr>
                    ) : (
                      items.map((it, i) => (
                        <tr key={it.id} className={i % 2 === 1 ? 'bg-neutral-50' : ''}>
                          <td className="border-t border-neutral-200 py-2 text-center text-neutral-400">{formatNumber(i + 1)}</td>
                          <td className="border-t border-neutral-200 py-2 ps-3">
                            <span className="font-medium">{it.product?.name ?? '—'}</span>
                            {it.product?.unit && (
                              <span className="ms-1.5 text-[10px] text-neutral-400">({it.product.unit})</span>
                            )}
                          </td>
                          <td className="border-t border-neutral-200 py-2 text-center">{formatNumber(it.quantity)}</td>
                          <td className="border-t border-neutral-200 py-2 text-center">{formatNumber(it.unitPrice, 2)}</td>
                          <td className="border-t border-neutral-200 py-2 text-center text-neutral-500">
                            {it.discount ? formatNumber(it.discount, 2) : '—'}
                          </td>
                          <td className="border-t border-neutral-200 py-2 pe-3 text-end font-semibold">{formatNumber(it.total, 2)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* ---------- مبلغ به حروف + مجموع‌ها ---------- */}
              <div className="grid items-start gap-3 sm:grid-cols-2">
                <div className="min-h-24 space-y-1.5 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3.5">
                  <p className="text-[10px] font-bold tracking-[0.2em] text-neutral-500">
                    {t('مبلغ به حروف', 'مبلغ په ليکل', 'AMOUNT IN WORDS')}
                  </p>
                  <p className="text-sm font-semibold leading-7">{amountToWords(sale.total, currency, lang)}</p>
                </div>
                <div className="overflow-hidden rounded-lg border border-neutral-200 text-sm">
                  <div className="space-y-1.5 bg-white p-3.5">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">{t('جمع اقلام', 'د توکو مجموع', 'Subtotal')}</span>
                      <span className="font-medium">{formatNumber(sale.subtotal, 2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">{t('تخفیف', 'ټکۍ', 'Discount')}</span>
                      <span className="font-medium">{formatNumber(sale.discount, 2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">
                        {t('مالیات', 'مالیه', 'Tax')} ({formatNumber(sale.taxRate)}٪)
                      </span>
                      <span className="font-medium">{formatNumber(sale.taxAmount, 2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between bg-emerald-600 px-3.5 py-2.5 text-white">
                    <span className="font-bold">{t('مبلغ نهایی', 'ټول مبلغ', 'GRAND TOTAL')}</span>
                    <span className="text-base font-extrabold">{formatMoney(sale.total, currency)}</span>
                  </div>
                  <div className="space-y-1.5 bg-neutral-50 p-3.5">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">{t('پرداخت‌شده', 'پرداخت شوی', 'Paid')}</span>
                      <span className="font-semibold text-emerald-700">{formatMoney(sale.paidAmount, currency)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">{t('باقیات', 'پاتې', 'Remaining')}</span>
                      <span className={remaining > 0.001 ? 'font-bold text-red-600' : 'font-semibold text-emerald-700'}>
                        {formatMoney(remaining, currency)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ---------- یادداشت ---------- */}
              {sale.notes && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <span className="font-bold">{t('یادداشت', 'یادښت', 'Notes')}: </span>
                  {sale.notes}
                </div>
              )}

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
                <p className="text-[10px] text-neutral-400">
                  {t(
                    'کالای فروش‌شده در صورت نداشتن عیب تولیدی قابل بازگشت نیست',
                    'پلورل شوی توکي پرته له تولیدي عیب بیرته نه راګرځي',
                    'Sold goods are non-returnable unless manufacturing defects'
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="no-print gap-2 px-3 pb-3 sm:px-6 sm:pb-6">
          <Button variant="outline" onClick={() => onClose()}>
            {t('بستن', 'بندول', 'Close')}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            {t('چاپ', 'چاپ', 'Print')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================= دیالوگ دریافت پرداخت =================
function PayDialog({
  sale,
  onClose,
  onSaved,
}: {
  sale: SaleRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  // مقدار اولیه = کل باقیات (دیالوگ با هر بل از نو مونت می‌شود) — ورودی = پول دریافتی «همین حالا»
  const [amount, setAmount] = useState(() =>
    sale ? String(Math.max(0, Number((sale.total - sale.paidAmount).toFixed(2)))) : ''
  )
  const [saving, setSaving] = useState(false)

  // پیش‌نمایش باقیات «بعد از» این پرداخت — paidAmount سرور تجمیعی است
  const val = Number(amount) || 0
  const remainingAfter = sale ? Math.max(0, sale.total - (sale.paidAmount + val)) : 0

  async function submit() {
    if (!sale) return
    const val = Number(amount)
    if (isNaN(val)) {
      toast.error(t('مبلغ نامعتبر است', 'مبلغ ناسم دی', 'Invalid amount'))
      return
    }
    if (val < 0) {
      toast.error(t('مبلغ پرداخت نمی‌تواند منفی باشد', 'د تادیې مبلغ نه شي منفي', 'Paid amount cannot be negative'))
      return
    }
    setSaving(true)
    // سرور paidAmount را به‌عنوان «مجموع پرداخت‌شدهٔ تجمیعی» ثبت می‌کند → پرداخت این مرحله جمع می‌شود
    const res = await callApi<SaleRow>(`/api/sales/${sale.id}`, 'PUT', {
      paidAmount: sale.paidAmount + val,
    })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error || t('خطا در ثبت پرداخت', 'د تادیې ستونزه', 'Payment failed'))
      return
    }
    toast.success(t('پرداخت ثبت شد', 'تادیه ثبت شوه', 'Payment recorded'))
    onClose()
    onSaved()
  }

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('دریافت پرداخت', 'پیسې اخیستل', 'Receive payment')}</DialogTitle>
          <DialogDescription>
            {sale && (
              <>
                <span className="font-mono">{sale.invoiceNumber}</span> —{' '}
                {sale.customer?.name ?? sale.customerName ?? t('مشتری متفرقه', 'عام پیرودونکی', 'Walk-in')}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        {sale && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-muted p-2">
                <p className="text-xs text-muted-foreground">{t('مبلغ کل', 'ټول مبلغ', 'Total')}</p>
                <p className="font-semibold">{formatMoney(sale.total, sale.currency as Currency)}</p>
              </div>
              <div className="rounded-md bg-amber-500/10 p-2">
                <p className="text-xs text-muted-foreground">{t('باقیات بعد از این پرداخت', 'پاتې وروسته له دې تادیې', 'Remaining after this payment')}</p>
                <p className="font-semibold text-amber-700 dark:text-amber-400">
                  {formatMoney(remainingAfter, sale.currency as Currency)}
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('مبلغ پرداختی در این مرحله', 'تادیه په دې مرحله کې', 'Amount received now')}</Label>
              <Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('لغو', 'لغوه', 'Cancel')}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('ثبت پرداخت', 'تادیه ثبت', 'Save payment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ================= دیالوگ مشتریان =================
function CustomersDialog({
  open,
  onOpenChange,
  customers,
  sales,
  onChanged,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  customers: CustomerRow[]
  sales: SaleRow[]
  onChanged: () => void
}) {
  const { t } = useI18n()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [statementCustomer, setStatementCustomer] = useState<CustomerRow | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [type, setType] = useState<'retail' | 'wholesale'>('retail')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [delCustomer, setDelCustomer] = useState<CustomerRow | null>(null)
  const [deletingCustomer, setDeletingCustomer] = useState(false)

  function resetForm() {
    setEditingId(null)
    setName('')
    setPhone('')
    setAddress('')
    setType('retail')
    setNotes('')
  }

  function startEdit(c: CustomerRow) {
    setEditingId(c.id)
    setName(c.name)
    setPhone(c.phone ?? '')
    setAddress(c.address ?? '')
    setType(c.type === 'wholesale' ? 'wholesale' : 'retail')
    setNotes(c.notes ?? '')
  }

  async function submit() {
    if (!name.trim()) {
      toast.error(t('نام مشتری ضروری است', 'د پیرودونکي نوم اړین دی', 'Name is required'))
      return
    }
    setSaving(true)
    const payload = { name, phone, address, type, notes }
    const res = editingId
      ? await callApi<CustomerRow>(`/api/customers/${editingId}`, 'PUT', payload)
      : await callApi<CustomerRow>('/api/customers', 'POST', payload)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error || t('خطا در ذخیره مشتری', 'د پیرودونکي ستونزه', 'Save failed'))
      return
    }
    toast.success(editingId ? t('مشتری تصحیح شد', 'پیرودونکی سم شو', 'Customer updated') : t('مشتری ثبت شد', 'پیرودونکی ثبت شو', 'Customer added'))
    resetForm()
    onChanged()
  }

  async function handleDeleteCustomer(c: CustomerRow) {
    setDeletingCustomer(true)
    const res = await callApi<{ ok: boolean }>(`/api/customers/${c.id}`, 'DELETE')
    setDeletingCustomer(false)
    if (!res.ok) {
      toast.error(res.error || t('خطا در حذف مشتری', 'د پیرودونکي د ړنګولو ستونزه', 'Delete failed'))
      return
    }
    toast.success(t('مشتری حذف شد', 'پیرودونکی ړنګ شو', 'Customer deleted'))
    setDelCustomer(null)
    if (editingId === c.id) resetForm()
    onChanged()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('مشتریان', 'پیرودونکي', 'Customers')}</DialogTitle>
          <DialogDescription>
            {t('مدیریت مشتریان و باقیات قرض ها', 'د پیرودونکو او پورونو مدیریت', 'Manage customers & balances')}
          </DialogDescription>
        </DialogHeader>

        {/* فورم علاوه کردن / تصحیح */}
        <div className="rounded-lg border p-3 space-y-3">
          <p className="text-sm font-medium">
            {editingId ? t('تصحیح مشتری', 'پیرودونکی سمول', 'Edit customer') : t('مشتری جدید', 'نوی پیرودونکی', 'New customer')}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('نام *', 'نوم *', 'Name *')} />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t('تیلیفون', 'تیلیفون', 'Phone')} dir="ltr" />
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t('آدرس', 'پته', 'Address')} />
            <Select value={type} onValueChange={(v) => setType(v as 'retail' | 'wholesale')}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="retail">{t('خرده', 'لږ', 'Retail')}</SelectItem>
                <SelectItem value="wholesale">{t('عمده', 'پرچونۍ', 'Wholesale')}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('یادداشت', 'یادښت', 'Notes')}
              className="sm:col-span-2"
            />
            <div className="flex gap-2 sm:col-span-2">
              {editingId && (
                <Button variant="outline" className="flex-1" onClick={resetForm}>
                  {t('لغو', 'لغوه', 'Cancel')}
                </Button>
              )}
              <Button className="flex-1" onClick={submit} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? t('ذخیره تغییرات', 'بدلونونه خوندي', 'Save changes') : t('علاوه کردن مشتری', 'پیرودونکی اضافه', 'Add customer')}
              </Button>
            </div>
          </div>
        </div>

        {/* لیست مشتریان */}
        <div className="max-h-96 overflow-y-auto rounded-lg border">
          {customers.length === 0 ? (
            <EmptyState label={t('مشتری ثبت نشده است', 'پیرودونکی نه دی ثبت شوی', 'No customers yet')} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('نام', 'نوم', 'Name')}</TableHead>
                  <TableHead>{t('نوع', 'ډول', 'Type')}</TableHead>
                  <TableHead>{t('تیلیفون', 'تیلیفون', 'Phone')}</TableHead>
                  <TableHead>{t('باقیات قرض', 'پور', 'Balance')}</TableHead>
                  <TableHead>{t('بل‌ها', 'بلونه', 'Sales')}</TableHead>
                  <TableHead>{t('اجراؤات', 'کړنې', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          c.type === 'wholesale'
                            ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                        }
                      >
                        {c.type === 'wholesale' ? t('عمده', 'پرچونۍ', 'Wholesale') : t('خرده', 'لږ', 'Retail')}
                      </Badge>
                    </TableCell>
                    <TableCell dir="ltr" className="text-xs rtl:text-right">{c.phone || '—'}</TableCell>
                    <TableCell className={cn('whitespace-nowrap', c.balance > 0.001 && 'text-amber-600 font-medium')}>
                      {formatMoney(c.balance)}
                    </TableCell>
                    <TableCell>{formatNumber(c._count?.sales ?? 0)}</TableCell>
                    <TableCell>
                      <div className="flex items-center justify-start gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('چاپ صورت‌حساب مشتری', 'د مشتري صورت‌حساب چاپ', 'Print customer statement')}
                          onClick={() => setStatementCustomer(c)}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title={t('تصحیح', 'سمول', 'Edit')} onClick={() => startEdit(c)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t('حذف', 'ړنګول', 'Delete')}
                          onClick={() => setDelCustomer(c)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        </DialogContent>
      </Dialog>

      {/* دیالوگ صورت‌حساب مشتری */}
      <CustomerStatementDialog
        customer={statementCustomer}
        sales={sales}
        onClose={() => setStatementCustomer(null)}
      />

      {/* تصدیق حذف مشتری — همان الگوی حذف بل */}
      <AlertDialog open={!!delCustomer} onOpenChange={(o) => !o && setDelCustomer(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف مشتری', 'د پیرودونکي ړنګول', 'Delete customer')}</AlertDialogTitle>
            <AlertDialogDescription>
              {delCustomer && (
                <>
                  {t('مشتری ', 'پیرودونکی ', 'Customer ')}
                  <span className="font-medium">{delCustomer.name}</span>
                  {t(
                    ' حذف شود؟ این عمل قابل بازگشت نیست.',
                    ' ړنګ شي؟ دا کړنه بیرته نه ګرځي.',
                    ' will be deleted? This action cannot be undone.'
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={deletingCustomer}
              onClick={(e) => {
                e.preventDefault()
                if (delCustomer) handleDeleteCustomer(delCustomer)
              }}
            >
              {deletingCustomer && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('حذف', 'ړنګول', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ================= دیالوگ صورت‌حساب مشتری (چاپ) =================
function CustomerStatementDialog({
  customer,
  sales,
  onClose,
}: {
  customer: CustomerRow | null
  sales: SaleRow[]
  onClose: () => void
}) {
  const { t, lang } = useI18n()
  if (!customer) return null

  // بل‌های همین مشتری — مرتب بر اساس تاریخ (قدیمی به جدید)
  const rows = sales
    .filter((s) => s.customerId === customer.id)
    .slice()
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // بل‌ها ممکن است ارزهای مختلف داشته باشند → مجموع‌ها با نرخ هر بل به افغانی تبدیل می‌شود
  const sumTotal = rows.reduce((acc, s) => acc + (s.total || 0) * (s.exchangeRate || 1), 0)
  const sumPaid = rows.reduce((acc, s) => acc + (s.paidAmount || 0) * (s.exchangeRate || 1), 0)
  const remaining = Math.round((sumTotal - sumPaid) * 100) / 100

  const statusLabel = (st: string) =>
    st === 'paid'
      ? t('پرداخت‌شده', 'پرداخت شوی', 'Paid')
      : st === 'partial'
        ? t('جزئی', 'نیمه', 'Partial')
        : t('پرداخت‌نشده', 'ناپرداخت', 'Unpaid')

  return (
    <PrintDocDialog
      open
      onClose={onClose}
      docType={t('صورت‌حساب مشتری', 'د مشتري صورت‌حساب', 'Customer Statement')}
      docTypeEn="CUSTOMER STATEMENT"
      docNumber={`CS-${customer.id.slice(-6).toUpperCase()}`}
      meta={[
        [
          { label: t('نام مشتری', 'د پیرودونکي نوم', 'Customer name'), value: customer.name },
          { label: t('تیلیفون', 'تیلیفون', 'Phone'), value: customer.phone || '—', ltr: true },
          { label: t('آدرس', 'پته', 'Address'), value: customer.address || '—' },
          {
            label: t('نوع مشتری', 'د پیرودونکي ډول', 'Customer type'),
            value:
              customer.type === 'wholesale'
                ? t('عمده', 'پرچونۍ', 'Wholesale')
                : t('خرده', 'لږ', 'Retail'),
          },
        ],
        [
          {
            label: t('قرض باقیات فعلی (دفتر)', 'اوسنی پور (دفتر)', 'Current book balance'),
            value: formatMoney(customer.balance),
          },
          { label: t('تعداد بل‌ها', 'د بلونو شمېر', 'Invoices count'), value: formatNumber(rows.length) },
        ],
      ]}
    >
      <DocTable
        head={[
          { label: t('بل', 'بل', 'Invoice') },
          { label: t('تاریخ', 'نېټه', 'Date') },
          { label: t('مبلغ', 'مبلغ', 'Total'), className: 'text-end' },
          { label: t('پرداخت‌شده', 'پرداخت شوی', 'Paid'), className: 'text-end' },
          { label: t('باقیات', 'پاتې', 'Remaining'), className: 'text-end' },
          { label: t('وضعیت', 'حالت', 'Status') },
        ]}
      >
        {rows.length === 0 ? (
          <tr>
            <td colSpan={6} className="border-t border-neutral-200 py-4 text-center text-neutral-400">
              {t('برای این مشتری بلی ثبت نشده است', 'د دې پیرودونکي لپاره بل نه دی ثبت شوی', 'No invoices for this customer')}
            </td>
          </tr>
        ) : (
          rows.map((s, i) => {
            const rem = s.total - s.paidAmount
            return (
              <DocRow key={s.id} index={i}>
                <DocCell className="font-mono text-xs">{s.invoiceNumber}</DocCell>
                <DocCell className="text-xs whitespace-nowrap">{toJalaliStr(s.date)}</DocCell>
                <DocCell className="text-end whitespace-nowrap">
                  {formatMoney(s.total, s.currency as Currency)}
                </DocCell>
                <DocCell className="text-end whitespace-nowrap">
                  {formatMoney(s.paidAmount, s.currency as Currency)}
                </DocCell>
                <DocCell className={`text-end whitespace-nowrap ${rem > 0.001 ? 'font-semibold text-red-600' : ''}`}>
                  {formatMoney(rem, s.currency as Currency)}
                </DocCell>
                <DocCell className="text-xs whitespace-nowrap">{statusLabel(s.status)}</DocCell>
              </DocRow>
            )
          })
        )}
      </DocTable>

      <div className="mt-4">
        <DocTotals
          rows={[
            {
              label: t('مجموع فروش (AFG)', 'ټوله پلورنه (AFG)', 'Total sales (AFG)'),
              value: formatMoney(sumTotal),
            },
            {
              label: t('مجموع پرداخت‌شده (AFG)', 'ټوله پرداخت شوی (AFG)', 'Total paid (AFG)'),
              value: formatMoney(sumPaid),
              tone: 'success',
            },
          ]}
          grandLabel={t('باقیات قرض مشتری', 'پاتې پور', 'Outstanding balance')}
          grandValue={formatMoney(remaining)}
        />
      </div>

      {Math.abs(remaining) > 0.001 && (
        <div className="mt-4">
          <DocAmountWords text={amountToWords(Math.abs(remaining), 'AFN', lang)} />
        </div>
      )}
    </PrintDocDialog>
  )
}
