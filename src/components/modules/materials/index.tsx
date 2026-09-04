'use client'

// ماژول مواد خام — CRUD، تأمین‌کننده‌ها، موجودی زنده، هشدار کم‌موجودی و انقضا
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  Check,
  Coins,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
  X,
} from 'lucide-react'

import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { formatMoney, formatNumber, toJalaliStr } from '@/lib/format'
import {
  EmptyState,
  PageHeader,
  StatCard,
  TableSkeleton,
} from '@/components/shared/common'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

// ---------------- Types ----------------
interface Supplier {
  id: string
  name: string
  phone?: string | null
  address?: string | null
  _count?: { materials: number }
}

interface RawMaterial {
  id: string
  code: string
  name: string
  unit: string
  purchasePrice: number
  stock: number
  minStock: number
  maxStock: number
  expiryDate?: string | null
  supplierId?: string | null
  supplier?: Supplier | null
  notes?: string | null
}

interface MaterialForm {
  name: string
  code: string
  unit: string
  purchasePrice: string
  stock: string
  minStock: string
  maxStock: string
  expiryDate: string // YYYY-MM-DD
  supplierId: string // 'none' = بدون تأمین‌کننده
  notes: string
}

interface SupplierForm {
  name: string
  phone: string
  address: string
}

const UNITS = ['کیلوگرام', 'لیتر', 'متر', 'عدد']

const emptyMaterialForm: MaterialForm = {
  name: '',
  code: '',
  unit: 'کیلوگرام',
  purchasePrice: '',
  stock: '',
  minStock: '',
  maxStock: '',
  expiryDate: '',
  supplierId: 'none',
  notes: '',
}

const emptySupplierForm: SupplierForm = { name: '', phone: '', address: '' }

// پیشنهاد کود بعدی مثل M-011
function nextCode(list: { code: string }[], prefix: string): string {
  let max = 0
  for (const item of list) {
    const m = item.code.match(new RegExp(`^${prefix}-(\\d+)$`))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

// تاریخ ISO → فرمت input date به وقت محلی
function toDateInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// روزهای باقی‌مانده تا انقضا (null = بدون تاریخ)
function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(d)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86400000)
}

// دکمه بارگذاری کوچک
function LoadingIcon() {
  return (
    <span className="me-1 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />
  )
}

export default function MaterialsModule() {
  const { t } = useI18n()
  const materials = useFetch<RawMaterial[]>('/api/raw-materials')
  const suppliers = useFetch<Supplier[]>('/api/suppliers')

  // فیلترها
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')

  // دیالوگ ماده خام
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<RawMaterial | null>(null)
  const [form, setForm] = useState<MaterialForm>(emptyMaterialForm)
  const [saving, setSaving] = useState(false)

  // حذف ماده
  const [toDelete, setToDelete] = useState<RawMaterial | null>(null)

  // دیالوگ تأمین‌کننده‌ها
  const [supsOpen, setSupsOpen] = useState(false)
  const [supFormOpen, setSupFormOpen] = useState(false)
  const [editingSup, setEditingSup] = useState<Supplier | null>(null)
  const [supForm, setSupForm] = useState<SupplierForm>(emptySupplierForm)
  const [supBusy, setSupBusy] = useState(false)
  const [supToDelete, setSupToDelete] = useState<Supplier | null>(null)

  const setF = (patch: Partial<MaterialForm>) => setForm((f) => ({ ...f, ...patch }))
  const setSupF = (patch: Partial<SupplierForm>) => setSupForm((f) => ({ ...f, ...patch }))

  const list = useMemo(() => {
    const rows = materials.data ?? []
    let out = rows
    const s = search.trim().toLowerCase()
    if (s) {
      out = out.filter(
        (m) => m.name.toLowerCase().includes(s) || m.code.toLowerCase().includes(s)
      )
    }
    if (supplierFilter !== 'all') out = out.filter((m) => m.supplierId === supplierFilter)
    if (stockFilter === 'low') out = out.filter((m) => m.stock <= m.minStock)
    return out
  }, [materials.data, search, supplierFilter, stockFilter])

  const stats = useMemo(() => {
    const rows = materials.data ?? []
    const total = rows.length
    const value = rows.reduce((a, m) => a + m.stock * m.purchasePrice, 0)
    const low = rows.filter((m) => m.stock <= m.minStock).length
    const expiring = rows.filter((m) => {
      const d = daysUntil(m.expiryDate)
      return d !== null && d >= 0 && d <= 7
    }).length
    return { total, value, low, expiring }
  }, [materials.data])

  // ---------- Material dialog ----------
  function openCreate() {
    setEditing(null)
    setForm({
      ...emptyMaterialForm,
      code: nextCode(materials.data ?? [], 'M'),
    })
    setDialogOpen(true)
  }

  function openEdit(m: RawMaterial) {
    setEditing(m)
    setForm({
      name: m.name,
      code: m.code,
      unit: m.unit || 'کیلوگرام',
      purchasePrice: String(m.purchasePrice),
      stock: String(m.stock),
      minStock: String(m.minStock),
      maxStock: String(m.maxStock),
      expiryDate: toDateInput(m.expiryDate),
      supplierId: m.supplierId ?? 'none',
      notes: m.notes ?? '',
    })
    setDialogOpen(true)
  }

  async function saveMaterial() {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error(t('نام و کود الزامی است', 'نوم او کوډ ضروري دي', 'Name and code are required'))
      return
    }
    const purchasePrice = Number(form.purchasePrice)
    if (form.purchasePrice === '' || isNaN(purchasePrice) || purchasePrice < 0) {
      toast.error(t('قیمت خرید معتبر وارد کنید', 'د اخیستو معتبر قیمت داخل کړئ', 'Enter a valid purchase price'))
      return
    }
    const nums = {
      stock: form.stock === '' ? 0 : Number(form.stock),
      minStock: form.minStock === '' ? 0 : Number(form.minStock),
      maxStock: form.maxStock === '' ? 0 : Number(form.maxStock),
    }
    for (const v of Object.values(nums)) {
      if (isNaN(v) || v < 0) {
        toast.error(t('اعداد نمی‌توانند منفی باشند', 'عددونه نه‌شي منفي کېدلی', 'Numbers cannot be negative'))
        return
      }
    }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        code: form.code.trim(),
        unit: form.unit,
        purchasePrice,
        ...nums,
        expiryDate: form.expiryDate ? new Date(`${form.expiryDate}T00:00:00`).toISOString() : null,
        supplierId: form.supplierId === 'none' ? null : form.supplierId,
        notes: form.notes.trim() || null,
      }
      const res = await fetch(editing ? `/api/raw-materials/${editing.id}` : '/api/raw-materials', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('خطا در ثبت', 'خطا په ثبت کې', 'Save failed'))
        return
      }
      toast.success(editing
        ? t('به‌روزرسانی شد', 'تازه شو', 'Updated')
        : t('ثبت شد', 'ثبت شو', 'Saved'))
      setDialogOpen(false)
      materials.refetch()
    } catch {
      toast.error(t('خطای ارتباط با سرور', 'د سرور سره اتصال خطا', 'Server connection error'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      const res = await fetch(`/api/raw-materials/${toDelete.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('حذف ناموفق بود', 'پاکول ناکام شو', 'Delete failed'))
        return
      }
      toast.success(t('حذف شد', 'پاک شو', 'Deleted'))
      setToDelete(null)
      materials.refetch()
    } catch {
      toast.error(t('خطای ارتباط با سرور', 'د سرور سره اتصال خطا', 'Server connection error'))
    }
  }

  // ---------- Suppliers CRUD ----------
  function openSupCreate() {
    setEditingSup(null)
    setSupForm(emptySupplierForm)
    setSupFormOpen(true)
  }

  function openSupEdit(s: Supplier) {
    setEditingSup(s)
    setSupForm({ name: s.name, phone: s.phone ?? '', address: s.address ?? '' })
    setSupFormOpen(true)
  }

  async function saveSupplier() {
    if (!supForm.name.trim()) {
      toast.error(t('نام تأمین‌کننده الزامی است', 'د تأمین‌کننده نوم ضروري دی', 'Supplier name is required'))
      return
    }
    setSupBusy(true)
    try {
      const body = {
        name: supForm.name.trim(),
        phone: supForm.phone.trim() || null,
        address: supForm.address.trim() || null,
      }
      const res = await fetch(
        editingSup ? `/api/suppliers/${editingSup.id}` : '/api/suppliers',
        {
          method: editingSup ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('خطا در ثبت', 'خطا په ثبت کې', 'Save failed'))
        return
      }
      toast.success(editingSup
        ? t('به‌روزرسانی شد', 'تازه شو', 'Updated')
        : t('ثبت شد', 'ثبت شو', 'Saved'))
      setSupFormOpen(false)
      suppliers.refetch()
      materials.refetch()
    } finally {
      setSupBusy(false)
    }
  }

  async function deleteSupplier() {
    if (!supToDelete) return
    try {
      const res = await fetch(`/api/suppliers/${supToDelete.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('حذف ناموفق بود', 'پاکول ناکام شو', 'Delete failed'))
        return
      }
      toast.success(t('حذف شد', 'پاک شو', 'Deleted'))
      setSupToDelete(null)
      suppliers.refetch()
      materials.refetch()
    } catch {
      toast.error(t('خطای ارتباط با سرور', 'د سرور سره اتصال خطا', 'Server connection error'))
    }
  }

  const loading = materials.loading
  const supList = suppliers.data ?? []

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title={t('مواد خام', 'خام مواد', 'Raw materials')}
        subtitle={t(
          'مدیریت مواد اولیه، تأمین‌کنندگان و انقضا',
          'د خامو موادو، تأمین‌کونکو او د پای نېټې مدیریت',
          'Manage materials, suppliers and expiry'
        )}
        icon={Boxes}
        actions={
          <>
            <Button variant="outline" onClick={() => setSupsOpen(true)}>
              <Truck className="h-4 w-4" />
              {t('تأمین‌کننده‌ها', 'تأمین‌کونکي', 'Suppliers')}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('ماده خام جدید', 'نوی خام ماده', 'New material')}
            </Button>
          </>
        }
      />

      {/* آمار */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('تعداد مواد', 'د موادو شمېر', 'Total materials')}
          value={formatNumber(stats.total)}
          icon={Boxes}
          tone="green"
        />
        <StatCard
          title={t('ارزش انبار مواد', 'د موادو ګودام ارزښت', 'Materials stock value')}
          value={formatMoney(stats.value)}
          icon={Coins}
          tone="blue"
          hint={t('بر اساس قیمت خرید', 'د اخیستو قیمت پر بنسټ', 'Based on purchase price')}
        />
        <StatCard
          title={t('کم‌موجودی', 'کم موجودي', 'Low stock')}
          value={formatNumber(stats.low)}
          icon={AlertTriangle}
          tone={stats.low > 0 ? 'amber' : 'green'}
          hint={t('در یا زیر حداقل موجودی', 'په یا تر لږترلږه موجودي', 'At or below minimum')}
        />
        <StatCard
          title={t('نزدیک انقضا', 'د پای نېټې نږدې', 'Near expiry')}
          value={formatNumber(stats.expiring)}
          icon={CalendarClock}
          tone={stats.expiring > 0 ? 'amber' : 'green'}
          hint={t('ظرف ۷ روز آینده', 'په راتلونکو ۷ ورځو کې', 'Within the next 7 days')}
        />
      </div>

      {/* ابزارها */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-2 p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('جستجو بر اساس نام یا کود...', 'د نوم یا کوډ پر بنسټ لټون...', 'Search by name or code...')}
              className="ps-9"
            />
          </div>
          <Select value={supplierFilter} onValueChange={setSupplierFilter}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('همه تأمین‌کننده‌ها', 'ټول تأمین‌کونکي', 'All suppliers')}</SelectItem>
              {supList.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={stockFilter} onValueChange={setStockFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('همه موجودی‌ها', 'ټول موجودي', 'All stock')}</SelectItem>
              <SelectItem value="low">{t('کم‌موجودی', 'کم موجودي', 'Low stock')}</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* جدول مواد */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-4 w-4 text-primary" />
            {t('لیست مواد خام', 'د خامو موادو لیست', 'Material list')}
            <Badge variant="secondary">{formatNumber(list.length)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableSkeleton rows={6} />
          ) : list.length === 0 ? (
            <EmptyState
              label={t('ماده‌ای یافت نشد', 'هیڅ ماده نه موندل شوه', 'No materials found')}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('کود', 'کوډ', 'Code')}</TableHead>
                    <TableHead>{t('نام', 'نوم', 'Name')}</TableHead>
                    <TableHead>{t('واحد', 'واحد', 'Unit')}</TableHead>
                    <TableHead className="text-end">{t('موجودی', 'موجودي', 'Stock')}</TableHead>
                    <TableHead className="text-end">{t('قیمت خرید', 'د اخیستو قیمت', 'Purchase price')}</TableHead>
                    <TableHead>{t('تأمین‌کننده', 'تأمین‌کونکی', 'Supplier')}</TableHead>
                    <TableHead>{t('انقضا', 'پای نېټه', 'Expiry')}</TableHead>
                    <TableHead className="text-end">{t('عملیات', 'عمليې', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((m) => {
                    const isLow = m.stock <= m.minStock
                    const d = daysUntil(m.expiryDate)
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-xs" dir="ltr">{m.code}</TableCell>
                        <TableCell>
                          <div className="font-medium">{m.name}</div>
                          {m.notes && (
                            <div className="max-w-56 truncate text-xs text-muted-foreground" title={m.notes}>
                              {m.notes}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>{m.unit}</TableCell>
                        <TableCell className="text-end">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              isLow ? 'text-red-600 dark:text-red-400' : ''
                            }`}
                          >
                            {isLow && <AlertTriangle className="h-3.5 w-3.5" />}
                            {formatNumber(m.stock)} {m.unit}
                          </span>
                        </TableCell>
                        <TableCell className="text-end font-medium">
                          {formatMoney(m.purchasePrice)}
                        </TableCell>
                        <TableCell>
                          {m.supplier ? (
                            m.supplier.name
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col items-start gap-1">
                            <span>{toJalaliStr(m.expiryDate)}</span>
                            {d !== null && d < 0 && (
                              <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                                {t('منقضی', 'پای شوی', 'Expired')}
                              </Badge>
                            )}
                            {d !== null && d >= 0 && d <= 7 && (
                              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                {t('نزدیک انقضا', 'د پای نږدې', 'Near expiry')}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={t('ویرایش', 'سمول', 'Edit')}
                              onClick={() => openEdit(m)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:text-red-700 dark:text-red-400"
                              title={t('حذف', 'پاکول', 'Delete')}
                              onClick={() => setToDelete(m)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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

      {/* دیالوگ ماده خام */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('ویرایش ماده خام', 'د خامې مادې سمول', 'Edit material')
                : t('ماده خام جدید', 'نوی خام ماده', 'New material')}
            </DialogTitle>
            <DialogDescription>
              {t('مشخصات ماده را کامل کنید', 'د مادې مشخصات بشپړ کړئ', 'Fill in the material details')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('نام ماده *', 'د مادې نوم *', 'Material name *')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setF({ name: e.target.value })}
                placeholder={t('مثال: شیر خام', 'بېلګه: خامې شیدې', 'e.g. Raw milk')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('کود *', 'کوډ *', 'Code *')}</Label>
              <Input
                value={form.code}
                onChange={(e) => setF({ code: e.target.value })}
                className="font-mono"
                dir="ltr"
                placeholder="M-011"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('واحد', 'واحد', 'Unit')}</Label>
              <Select value={form.unit} onValueChange={(v) => setF({ unit: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t('قیمت خرید *', 'د اخیستو قیمت *', 'Purchase price *')}</Label>
              <Input
                type="number"
                min={0}
                value={form.purchasePrice}
                onChange={(e) => setF({ purchasePrice: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('موجودی فعلی', 'اوسنی موجودي', 'Current stock')}</Label>
              <Input
                type="number"
                min={0}
                value={form.stock}
                onChange={(e) => setF({ stock: e.target.value })}
                dir="ltr"
                disabled={!!editing}
              />
              {editing && (
                <p className="text-xs text-muted-foreground">
                  {t(
                    'موجودی از طریق خرید/تولید تغییر می‌کند',
                    'موجودي د اخیستنې/تولید له لارې بدلیږي',
                    'Stock changes via purchase/production'
                  )}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t('حداقل موجودی (هشدار)', 'لږترلږه موجودي (خبرداری)', 'Min stock (alert)')}</Label>
              <Input
                type="number"
                min={0}
                value={form.minStock}
                onChange={(e) => setF({ minStock: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('حداکثر موجودی', 'اعظمي موجودي', 'Max stock')}</Label>
              <Input
                type="number"
                min={0}
                value={form.maxStock}
                onChange={(e) => setF({ maxStock: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('تاریخ انقضا', 'د پای نېټه', 'Expiry date')}</Label>
              <Input
                type="date"
                value={form.expiryDate}
                onChange={(e) => setF({ expiryDate: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('تأمین‌کننده', 'تأمین‌کونکی', 'Supplier')}</Label>
              <Select value={form.supplierId} onValueChange={(v) => setF({ supplierId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('بدون تأمین‌کننده', 'بې تأمین‌کونکي', 'No supplier')}</SelectItem>
                  {supList.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('یادداشت‌ها', 'یادښتونه', 'Notes')}</Label>
              <Textarea
                value={form.notes}
                onChange={(e) => setF({ notes: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('لغو', 'لغوه', 'Cancel')}
            </Button>
            <Button onClick={saveMaterial} disabled={saving}>
              {saving && <LoadingIcon />}
              {t('ذخیره', 'خوندي', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ تأمین‌کننده‌ها */}
      <Dialog open={supsOpen} onOpenChange={setSupsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('تأمین‌کننده‌ها', 'تأمین‌کونکي', 'Suppliers')}</DialogTitle>
            <DialogDescription>
              {t('مدیریت تأمین‌کنندگان مواد خام', 'د خامو موادو تأمین‌کونکي مدیریت', 'Manage raw material suppliers')}
            </DialogDescription>
          </DialogHeader>

          {supFormOpen ? (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="space-y-1.5">
                <Label>{t('نام *', 'نوم *', 'Name *')}</Label>
                <Input
                  value={supForm.name}
                  onChange={(e) => setSupF({ name: e.target.value })}
                  placeholder={t('مثال: تجارتخانه رحیمی', 'بېلګه: رحیمي سوداګري', 'e.g. Rahimi Trading')}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('تلفن', 'تلیفون', 'Phone')}</Label>
                <Input
                  value={supForm.phone}
                  onChange={(e) => setSupF({ phone: e.target.value })}
                  className="font-mono"
                  dir="ltr"
                  placeholder="0790123456"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('آدرس', 'پته', 'Address')}</Label>
                <Input
                  value={supForm.address}
                  onChange={(e) => setSupF({ address: e.target.value })}
                  placeholder={t('مثال: کابل، منطقه تجارتی', 'بېلګه: کابل، سوداګریزه سیمه', 'e.g. Kabul, business district')}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setSupFormOpen(false)}
                  disabled={supBusy}
                >
                  {t('لغو', 'لغوه', 'Cancel')}
                </Button>
                <Button onClick={saveSupplier} disabled={supBusy}>
                  {supBusy && <LoadingIcon />}
                  {editingSup ? t('ذخیره تغییرات', 'بدلونونه خوندي کړئ', 'Save changes') : t('افزودن', 'اضافه کول', 'Add')}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={openSupCreate} className="w-full">
              <Plus className="h-4 w-4" />
              {t('تأمین‌کننده جدید', 'نوی تأمین‌کونکی', 'New supplier')}
            </Button>
          )}

          <Separator />

          <div className="max-h-96 space-y-2 overflow-y-auto pe-1">
            {supList.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('تأمین‌کننده‌ای ثبت نشده است', 'تأمین‌کونکی نه دی ثبت شوی', 'No suppliers yet')}
              </p>
            )}
            {supList.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border p-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{s.name}</div>
                  {s.phone && (
                    <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                      {s.phone}
                    </div>
                  )}
                </div>
                <Badge variant="secondary">
                  {formatNumber(s._count?.materials ?? 0)} {t('ماده', 'ماده', 'materials')}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  title={t('ویرایش', 'سمول', 'Edit')}
                  onClick={() => openSupEdit(s)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-red-600 hover:text-red-700 dark:text-red-400"
                  title={t('حذف', 'پاکول', 'Delete')}
                  onClick={() => setSupToDelete(s)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف ماده */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف ماده خام', 'د خامې مادې پاکول', 'Delete material')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'آیا از حذف',
                'ایا د پاکولو څخه ډاډه یاست',
                'Are you sure you want to delete'
              )}{' '}
              <span className="font-bold text-foreground">«{toDelete?.name}»</span>{' '}
              {t(
                'مطمئن هستید؟ اگر ماده در فرمول‌ها استفاده شده باشد، حذف ممکن نیست.',
                'یاست؟ که ماده په فورمولونو کې کارېدلې وي، پاکول ناشونې ده.',
                '? Deletion is blocked if the material is used in formulas.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
            >
              {t('حذف', 'پاکول', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* تأیید حذف تأمین‌کننده */}
      <AlertDialog open={!!supToDelete} onOpenChange={(o) => !o && setSupToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف تأمین‌کننده', 'د تأمین‌کونکي پاکول', 'Delete supplier')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'اگر مواد خام به این تأمین‌کننده ثبت شده باشد، حذف ممکن نیست.',
                'که خام مواد دې تأمین‌کونکي ته ثبت شوي وي، پاکول ناشونې ده.',
                'Deletion is blocked if materials are linked to this supplier.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault()
                deleteSupplier()
              }}
            >
              {t('حذف', 'پاکول', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
