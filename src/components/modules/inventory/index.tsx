'use client'

// ماژول انبار — گردش انبار، موجودی فعلی، انبارها
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  MapPin,
  Pencil,
  Plus,
  Trash2,
  Warehouse,
} from 'lucide-react'
import { toast } from 'sonner'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { formatMoney, formatNumber, STATUS_COLORS, toJalaliStr } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  EmptyState,
  PageHeader,
  StatCard,
  TableSkeleton,
} from '@/components/shared/common'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ---------- انواع ----------
interface Wh {
  id: string
  name: string
  location?: string | null
}
interface InvTx {
  id: string
  date: string
  type: string
  itemType: string
  itemId: string
  itemName: string
  unit: string
  quantity: number
  reference?: string | null
  notes?: string | null
  warehouse?: Wh | null
}
interface StockProduct {
  id: string
  name: string
  unit: string
  stock: number
  minStock: number
  value: number
}
interface StockMaterial {
  id: string
  name: string
  unit: string
  stock: number
  minStock: number
  maxStock: number
  purchasePrice: number
  value: number
  expiryDate: string | null
}
interface InvResponse {
  transactions: InvTx[]
  products: StockProduct[]
  materials: StockMaterial[]
}
interface WarehouseRow extends Wh {
  _count?: { transactions: number }
}
interface ItemOpt {
  id: string
  name: string
  unit: string
}

// درخواست JSON با پیام خطای دری
async function jsonReq(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || `خطا در عملیات (${res.status})`)
  return json
}

const TYPE_LABELS: Record<string, string> = {
  in: 'ورود',
  out: 'خروج',
  adjust: 'اصلاح',
  transfer: 'انتقال',
}
const EXPIRY_BADGES = {
  near: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  expired: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}

export default function InventoryModule() {
  const { t } = useI18n()

  const [tab, setTab] = useState('tx')
  const [fType, setFType] = useState('all')
  const [fItemType, setFItemType] = useState('all')
  const [fDays, setFDays] = useState('30')

  const invUrl = `/api/inventory?days=${fDays}${fType !== 'all' ? `&type=${fType}` : ''}${
    fItemType !== 'all' ? `&itemType=${fItemType}` : ''
  }`
  const { data: inv, loading: invLoading, refetch: refetchInv } = useFetch<InvResponse>(invUrl)

  const { data: whData, refetch: refetchWh } = useFetch<WarehouseRow[]>('/api/warehouses')
  const warehouses = Array.isArray(whData) ? whData : []

  // گزینه‌های قلم برای دیالوگ حرکت — از دو endpoint اصلی، با fallback روی خلاصه موجودی
  const { data: prodsData } = useFetch<ItemOpt[]>('/api/products')
  const { data: matsData } = useFetch<ItemOpt[]>('/api/raw-materials')
  const productOpts: ItemOpt[] = Array.isArray(prodsData)
    ? prodsData
    : (inv?.products ?? []).map((p) => ({ id: p.id, name: p.name, unit: p.unit }))
  const materialOpts: ItemOpt[] = Array.isArray(matsData)
    ? matsData
    : (inv?.materials ?? []).map((m) => ({ id: m.id, name: m.name, unit: m.unit }))

  // ---------- فرم حرکت جدید ----------
  const [moveOpen, setMoveOpen] = useState(false)
  const [mType, setMType] = useState('in')
  const [mItemType, setMItemType] = useState('product')
  const [mItemId, setMItemId] = useState('')
  const [mQty, setMQty] = useState('')
  const [mWh, setMWh] = useState('none')
  const [mRef, setMRef] = useState('')
  const [mNotes, setMNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const mUnit =
    mItemType === 'product'
      ? productOpts.find((o) => o.id === mItemId)?.unit
      : materialOpts.find((o) => o.id === mItemId)?.unit
  const mCurrentStock = useMemo(() => {
    if (!mItemId) return null
    if (mItemType === 'product') return inv?.products.find((p) => p.id === mItemId) ?? null
    return inv?.materials.find((m) => m.id === mItemId) ?? null
  }, [inv, mItemType, mItemId])

  function resetMove() {
    setMType('in')
    setMItemType('product')
    setMItemId('')
    setMQty('')
    setMWh('none')
    setMRef('')
    setMNotes('')
  }

  async function submitMove() {
    if (!mItemId) {
      toast.error(t('قلم را انتخاب کنید', 'قلم وټاکنئ', 'Select an item'))
      return
    }
    const q = Number(mQty)
    if (!q || isNaN(q) || q <= 0) {
      toast.error(t('مقدار باید بزرگ‌تر از صفر باشد', 'اندازه باید له صفر لوی وي', 'Quantity must be greater than zero'))
      return
    }
    setSaving(true)
    try {
      await jsonReq('/api/inventory', 'POST', {
        type: mType,
        itemType: mItemType,
        itemId: mItemId,
        quantity: q,
        warehouseId: mWh === 'none' ? null : mWh,
        reference: mRef || null,
        notes: mNotes || null,
      })
      toast.success(
        t('حرکت انبار ثبت شد', 'د انبار حرکت ثبت شو', 'Inventory movement recorded')
      )
      setMoveOpen(false)
      resetMove()
      refetchInv()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در ثبت', 'خطا په ثبت کې', 'Error saving'))
    } finally {
      setSaving(false)
    }
  }

  // ---------- انبارها ----------
  const [whOpen, setWhOpen] = useState(false)
  const [whEditing, setWhEditing] = useState<WarehouseRow | null>(null)
  const [whName, setWhName] = useState('')
  const [whLoc, setWhLoc] = useState('')
  const [delWh, setDelWh] = useState<WarehouseRow | null>(null)

  function openNewWh() {
    setWhEditing(null)
    setWhName('')
    setWhLoc('')
    setWhOpen(true)
  }
  function openEditWh(w: WarehouseRow) {
    setWhEditing(w)
    setWhName(w.name)
    setWhLoc(w.location ?? '')
    setWhOpen(true)
  }
  async function submitWh() {
    if (!whName.trim()) {
      toast.error(t('نام انبار الزامی است', 'د انبار نوم ضروري دی', 'Warehouse name is required'))
      return
    }
    try {
      if (whEditing) {
        await jsonReq(`/api/warehouses/${whEditing.id}`, 'PUT', {
          name: whName,
          location: whLoc || null,
        })
        toast.success(t('انبار ویرایش شد', 'انبار سمون شو', 'Warehouse updated'))
      } else {
        await jsonReq('/api/warehouses', 'POST', { name: whName, location: whLoc || null })
        toast.success(t('انبار ثبت شد', 'انبار ثبت شو', 'Warehouse created'))
      }
      setWhOpen(false)
      refetchWh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در ثبت', 'خطا په ثبت کې', 'Error saving'))
    }
  }
  async function deleteWh() {
    if (!delWh) return
    try {
      await jsonReq(`/api/warehouses/${delWh.id}`, 'DELETE')
      toast.success(t('انبار حذف شد', 'انبار ړنګ شو', 'Warehouse deleted'))
      setDelWh(null)
      refetchWh()
      refetchInv()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در حذف', 'خطا په ړنګولو کې', 'Error deleting'))
      setDelWh(null)
    }
  }

  // ---------- محاسبات ----------
  const txs = inv?.transactions ?? []
  const products = useMemo(() => inv?.products ?? [], [inv])
  const materials = useMemo(() => inv?.materials ?? [], [inv])
  const isToday = (d: string) => new Date(d).toDateString() === new Date().toDateString()
  const inToday = txs.filter((x) => x.type === 'in' && isToday(x.date))
  const outToday = txs.filter((x) => x.type === 'out' && isToday(x.date))
  const totalValue =
    products.reduce((s, p) => s + p.value, 0) + materials.reduce((s, m) => s + m.value, 0)
  const maxProductStock = Math.max(1, ...products.map((p) => p.stock))
  const maxMaterialList = Math.max(1, ...materials.map((m) => m.stock))

  const expiryInfo = (d: string | null) => {
    if (!d) return null
    const time = new Date(d).getTime()
    if (time < Date.now())
      return { label: t('منقضی', 'ناړه', 'Expired'), cls: EXPIRY_BADGES.expired }
    if (time - Date.now() <= 7 * 86400_000)
      return { label: t('نزدیک انقضا', 'نږدې د پای', 'Expiring soon'), cls: EXPIRY_BADGES.near }
    return null
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('مدیریت انبار', 'د انبار مدیریت', 'Inventory Management')}
        subtitle={t(
          'گردش کالاها، موجودی فعلی و انبارهای کارخانه',
          'د توکو حرکت، اوسنی موجودي او د فابریکې انبارونه',
          'Item movements, current stock and factory warehouses'
        )}
        icon={Warehouse}
        actions={
          <Button onClick={() => setMoveOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('ثبت حرکت جدید', 'نوی حرکت ثبت کړه', 'New Movement')}
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-3 sm:w-[440px]">
          <TabsTrigger value="tx">{t('گردش انبار', 'د انبار حرکت', 'Movements')}</TabsTrigger>
          <TabsTrigger value="stock">{t('موجودی فعلی', 'اوسنۍ موجودي', 'Current Stock')}</TabsTrigger>
          <TabsTrigger value="wh">{t('انبارها', 'انبارونه', 'Warehouses')}</TabsTrigger>
        </TabsList>

        {/* ================= گردش انبار ================= */}
        <TabsContent value="tx" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard
              title={t('ورود امروز', 'د نن ورود', "Today's In")}
              value={`${formatNumber(inToday.reduce((s, x) => s + x.quantity, 0))} ${inToday[0]?.unit ?? ''}`}
              hint={t(`${inToday.length} حرکت`, `${inToday.length} حرکت`, `${inToday.length} movements`)}
              icon={ArrowDownToLine}
              tone="green"
            />
            <StatCard
              title={t('خروج امروز', 'د نن وتلو', "Today's Out")}
              value={`${formatNumber(outToday.reduce((s, x) => s + x.quantity, 0))} ${outToday[0]?.unit ?? ''}`}
              hint={t(`${outToday.length} حرکت`, `${outToday.length} حرکت`, `${outToday.length} movements`)}
              icon={ArrowUpFromLine}
              tone="red"
            />
            <StatCard
              title={t('ارزش کل موجودی', 'د ټولې موجودي ارزښت', 'Total Stock Value')}
              value={formatMoney(totalValue)}
              hint={t(`${products.length + materials.length} قلم`, `${products.length + materials.length} قلم`, `${products.length + materials.length} items`)}
              icon={Coins}
              tone="amber"
            />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-base">
                  {t('آخرین گردش‌ها', 'وروستي حرکتونه', 'Recent Movements')}
                </CardTitle>
                <div className="ms-auto flex flex-wrap items-center gap-2">
                  <Select value={fType} onValueChange={setFType}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('همه انواع', 'ټول ډولونه', 'All types')}</SelectItem>
                      <SelectItem value="in">{t('ورود', 'ورود', 'In')}</SelectItem>
                      <SelectItem value="out">{t('خروج', 'وتلو', 'Out')}</SelectItem>
                      <SelectItem value="adjust">{t('اصلاح', 'سمون', 'Adjust')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={fItemType} onValueChange={setFItemType}>
                    <SelectTrigger className="w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('همه اقلام', 'ټول اقلام', 'All items')}</SelectItem>
                      <SelectItem value="product">{t('محصول', 'محصول', 'Product')}</SelectItem>
                      <SelectItem value="material">{t('ماده‌خام', 'خام ماده', 'Raw Material')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={fDays} onValueChange={setFDays}>
                    <SelectTrigger className="w-[110px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7">{t('۷ روز', '۷ ورځې', '7 days')}</SelectItem>
                      <SelectItem value="30">{t('۳۰ روز', '۳۰ ورځې', '30 days')}</SelectItem>
                      <SelectItem value="90">{t('۹۰ روز', '۹۰ ورځې', '90 days')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {invLoading && !inv ? (
                <TableSkeleton rows={6} />
              ) : txs.length === 0 ? (
                <EmptyState label={t('گردشی ثبت نشده است', 'حرکت نه دی ثبت شوی', 'No movements recorded')} />
              ) : (
                <div className="max-h-96 overflow-y-auto overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('تاریخ', 'نېټه', 'Date')}</TableHead>
                        <TableHead>{t('نوع', 'ډول', 'Type')}</TableHead>
                        <TableHead>{t('قلم', 'قلم', 'Item')}</TableHead>
                        <TableHead>{t('مقدار', 'اندازه', 'Qty')}</TableHead>
                        <TableHead>{t('انبار', 'انبار', 'Warehouse')}</TableHead>
                        <TableHead>{t('مرجع', 'حواله', 'Reference')}</TableHead>
                        <TableHead>{t('یادداشت', 'یادښت', 'Notes')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {txs.map((x) => (
                        <TableRow key={x.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {toJalaliStr(x.date)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={STATUS_COLORS[x.type] ?? ''}>
                              {TYPE_LABELS[x.type] ?? x.type}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{x.itemName}</span>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'text-xs',
                                  x.itemType === 'product'
                                    ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
                                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                )}
                              >
                                {x.itemType === 'product'
                                  ? t('محصول', 'محصول', 'Product')
                                  : t('ماده‌خام', 'خام ماده', 'Material')}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className="font-semibold">{formatNumber(x.quantity)}</span>{' '}
                            <span className="text-xs text-muted-foreground">{x.unit}</span>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {x.warehouse?.name ?? '—'}
                          </TableCell>
                          <TableCell className="font-mono text-xs rtl:text-right" dir="ltr">
                            {x.reference ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-40 truncate">
                            {x.notes ?? '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= موجودی فعلی ================= */}
        <TabsContent value="stock" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* محصولات */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>{t('محصولات', 'محصولات', 'Products')}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {products.length} {t('قلم', 'قلم', 'items')} • {formatMoney(products.reduce((s, p) => s + p.value, 0))}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {invLoading && !inv ? (
                  <TableSkeleton rows={4} />
                ) : products.length === 0 ? (
                  <EmptyState label={t('محصولی ثبت نشده', 'محصول نه دی ثبت شوی', 'No products')} />
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {products.map((p) => {
                      const low = p.stock <= p.minStock
                      return (
                        <div key={p.id} className="flex items-center gap-3 rounded-lg border p-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-sm truncate">{p.name}</span>
                              {low && (
                                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {t('حداقل', 'لږترلږه', 'Min')}: {formatNumber(p.minStock)} {p.unit} •{' '}
                              {formatMoney(p.value)}
                            </div>
                            <Progress
                              value={Math.min(100, (p.stock / maxProductStock) * 100)}
                              className={cn('h-1.5 mt-2', low && '[&>div]:bg-red-500')}
                            />
                          </div>
                          <div className="text-end shrink-0">
                            <div
                              className={cn(
                                'font-bold',
                                low && 'text-red-600 dark:text-red-400'
                              )}
                            >
                              {formatNumber(p.stock)}
                            </div>
                            <div className="text-xs text-muted-foreground">{p.unit}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* مواد خام */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between gap-2">
                  <span>{t('مواد خام', 'خام مواد', 'Raw Materials')}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {materials.length} {t('قلم', 'قلم', 'items')} • {formatMoney(materials.reduce((s, m) => s + m.value, 0))}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {invLoading && !inv ? (
                  <TableSkeleton rows={4} />
                ) : materials.length === 0 ? (
                  <EmptyState label={t('ماده‌ای ثبت نشده', 'ماده نه ده ثبت شوې', 'No materials')} />
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {materials.map((m) => {
                      const low = m.stock <= m.minStock
                      const exp = expiryInfo(m.expiryDate)
                      const share =
                        m.maxStock > 0
                          ? Math.min(100, (m.stock / m.maxStock) * 100)
                          : Math.min(100, (m.stock / maxMaterialList) * 100)
                      return (
                        <div key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{m.name}</span>
                              {low && <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />}
                              {exp && (
                                <Badge variant="outline" className={cn('text-xs', exp.cls)}>
                                  {exp.label}
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {t('حداقل', 'لږترلږه', 'Min')}: {formatNumber(m.minStock)} •{' '}
                              {t('انقضا', 'پای', 'Expiry')}: {toJalaliStr(m.expiryDate)} •{' '}
                              {formatMoney(m.value)}
                            </div>
                            <Progress
                              value={share}
                              className={cn('h-1.5 mt-2', low && '[&>div]:bg-red-500')}
                            />
                          </div>
                          <div className="text-end shrink-0">
                            <div
                              className={cn(
                                'font-bold',
                                low && 'text-red-600 dark:text-red-400'
                              )}
                            >
                              {formatNumber(m.stock)}
                            </div>
                            <div className="text-xs text-muted-foreground">{m.unit}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================= انبارها ================= */}
        <TabsContent value="wh" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              {t('فهرست انبارها', 'د انبارونو لیست', 'Warehouse List')}
            </h3>
            <Button variant="outline" size="sm" onClick={openNewWh}>
              <Plus className="h-4 w-4" />
              {t('انبار جدید', 'نوی انبار', 'New Warehouse')}
            </Button>
          </div>
          {warehouses.length === 0 ? (
            <EmptyState label={t('انباری ثبت نشده', 'انبار نه دی ثبت شوی', 'No warehouses')} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {warehouses.map((w) => (
                <Card key={w.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-9 w-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                          <Warehouse className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{w.name}</p>
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3" />
                            {w.location || t('بدون موقعیت', 'بې موقعیت', 'No location')}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditWh(w)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-red-500 hover:text-red-600"
                          onClick={() => setDelWh(w)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 pt-3 border-t">
                      <Badge variant="outline" className="bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300">
                        {formatNumber(w._count?.transactions ?? 0)}{' '}
                        {t('گردش ثبت‌شده', 'ثبت شوي حرکتونه', 'transactions')}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ---------- دیالوگ حرکت جدید ---------- */}
      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('ثبت حرکت انبار', 'د انبار حرکت ثبت', 'Record Inventory Movement')}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t('نوع حرکت', 'د حرکت ډول', 'Movement Type')}</Label>
                <Select value={mType} onValueChange={setMType}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">{t('ورود', 'ورود', 'In')}</SelectItem>
                    <SelectItem value="out">{t('خروج', 'وتلو', 'Out')}</SelectItem>
                    <SelectItem value="adjust">{t('اصلاح موجودی', 'سمون', 'Adjust')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('نوع قلم', 'د قلم ډول', 'Item Type')}</Label>
                <Select
                  value={mItemType}
                  onValueChange={(v) => {
                    setMItemType(v)
                    setMItemId('')
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">{t('محصول', 'محصول', 'Product')}</SelectItem>
                    <SelectItem value="material">{t('ماده‌خام', 'خام ماده', 'Raw Material')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('قلم', 'قلم', 'Item')}</Label>
              <Select value={mItemId} onValueChange={setMItemId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('قلم را انتخاب کنید', 'قلم وټاکنئ', 'Select an item')} />
                </SelectTrigger>
                <SelectContent className="max-h-56">
                  {(mItemType === 'product' ? productOpts : materialOpts).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {mType !== 'in' && mCurrentStock && (
                <p
                  className={cn(
                    'text-xs',
                    mType === 'adjust'
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-muted-foreground'
                  )}
                >
                  {t('موجودی فعلی', 'اوسنۍ موجودي', 'Current stock')}:{' '}
                  <span className="font-bold">{formatNumber(mCurrentStock.stock)}</span>{' '}
                  {mCurrentStock.unit}
                  {mType === 'adjust'
                    ? ` — ${t('مقدار جدید را وارد کنید', 'نوی اندازه داخل کړئ', 'enter the new amount')}`
                    : ''}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  {mType === 'adjust'
                    ? t('مقدار جدید (مطلق)', 'نوی اندازه', 'New Amount (absolute)')
                    : t('مقدار', 'اندازه', 'Quantity')}
                </Label>
                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    dir="ltr"
                    value={mQty}
                    onChange={(e) => setMQty(e.target.value)}
                    placeholder="0"
                  />
                  {mUnit && (
                    <span className="absolute end-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">
                      {mUnit}
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t('انبار', 'انبار', 'Warehouse')}</Label>
                <Select value={mWh} onValueChange={setMWh}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t('بدون انبار', 'بې انباره', 'None')}</SelectItem>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{t('مرجع (اختیاری)', 'حواله (اختیاري)', 'Reference (optional)')}</Label>
              <Input
                dir="ltr"
                value={mRef}
                onChange={(e) => setMRef(e.target.value)}
                placeholder={t('شماره فاکتور / سفارش', 'د بل شمېره', 'Invoice / order no.')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('یادداشت', 'یادښت', 'Notes')}</Label>
              <Textarea rows={2} value={mNotes} onChange={(e) => setMNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>
              {t('لغو', 'لغوه', 'Cancel')}
            </Button>
            <Button onClick={submitMove} disabled={saving}>
              {saving
                ? t('در حال ثبت...', 'په ثبت کې...', 'Saving...')
                : t('ثبت حرکت', 'حرکت ثبت کړه', 'Save Movement')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- دیالوگ انبار جدید/ویرایش ---------- */}
      <Dialog open={whOpen} onOpenChange={setWhOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {whEditing
                ? t('ویرایش انبار', 'د انبار سمون', 'Edit Warehouse')
                : t('انبار جدید', 'نوی انبار', 'New Warehouse')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label>{t('نام انبار *', 'د انبار نوم *', 'Warehouse Name *')}</Label>
              <Input value={whName} onChange={(e) => setWhName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('موقعیت', 'موقعیت', 'Location')}</Label>
              <Input value={whLoc} onChange={(e) => setWhLoc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWhOpen(false)}>
              {t('لغو', 'لغوه', 'Cancel')}
            </Button>
            <Button onClick={submitWh}>
              {whEditing ? t('ذخیره', 'خوندي کړه', 'Save') : t('ثبت', 'ثبت', 'Create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- تأیید حذف انبار ---------- */}
      <AlertDialog open={!!delWh} onOpenChange={(o) => !o && setDelWh(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف انبار', 'د انبار ړنګول', 'Delete Warehouse')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('آیا از حذف', 'له ړنګولو ډاډه یاست', 'Are you sure you want to delete')} «
              {delWh?.name}» {t('مطمئن هستید؟', '؟', '?')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteWh}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {t('حذف', 'ړنګ کړه', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
