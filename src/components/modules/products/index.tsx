'use client'

// ماژول محصولات — CRUD کامل، دسته‌بندی‌ها، قیمت‌گذاری چندسطحی، بارکد، هشدار کم‌موجودی
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Coins,
  Download,
  Package,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react'

import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { formatMoney, formatNumber } from '@/lib/format'
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
import { Switch } from '@/components/ui/switch'
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
interface Category {
  id: string
  name: string
  _count?: { products: number }
}

interface Product {
  id: string
  code: string
  name: string
  categoryId?: string | null
  category?: Category | null
  unit: string
  barcode?: string | null
  description?: string | null
  costPrice: number
  salePrice: number
  wholesalePrice: number
  minStock: number
  stock: number
  active: boolean
}

interface ProductForm {
  name: string
  code: string
  categoryId: string // 'none' = بدون دسته
  unit: string
  salePrice: string
  wholesalePrice: string
  costPrice: string
  minStock: string
  stock: string
  barcode: string
  description: string
  active: boolean
}

const UNITS = ['عدد', 'کیلوگرام', 'لیتر', 'متر', 'بسته']

const emptyProductForm: ProductForm = {
  name: '',
  code: '',
  categoryId: 'none',
  unit: 'عدد',
  salePrice: '',
  wholesalePrice: '',
  costPrice: '',
  minStock: '',
  stock: '',
  barcode: '',
  description: '',
  active: true,
}

// پیشنهاد کود بعدی مثل P-008
function nextCode(list: { code: string }[], prefix: string): string {
  let max = 0
  for (const item of list) {
    const m = item.code.match(new RegExp(`^${prefix}-(\\d+)$`))
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`
}

// بارکد تزئینی CSS — نوارهای با عرض متفاوت بر اساس کود
function BarcodeStrip({ code }: { code: string }) {
  const bars = useMemo(() => {
    const src = code || '000000'
    return Array.from({ length: 34 }, (_, i) => {
      const c = src.charCodeAt(i % src.length)
      return 1 + ((c * (i + 3)) % 4)
    })
  }, [code])
  return (
    <div
      className="inline-flex flex-col items-center gap-1.5 rounded-lg border bg-white px-4 py-2.5 dark:bg-slate-900"
      dir="ltr"
    >
      <div className="flex h-9 items-end gap-[2px]">
        {bars.map((w, i) => (
          <div
            key={i}
            className="h-full bg-slate-900 dark:bg-slate-100"
            style={{ width: `${w}px` }}
          />
        ))}
      </div>
      <span className="font-mono text-xs tracking-[0.3em] text-slate-700 dark:text-slate-300">
        {code || '—————'}
      </span>
    </div>
  )
}

export default function ProductsModule() {
  const { t } = useI18n()
  const products = useFetch<Product[]>('/api/products')
  const categories = useFetch<Category[]>('/api/categories')

  // فیلترها
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('all')
  const [stockFilter, setStockFilter] = useState('all')

  // دیالوگ محصول
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [form, setForm] = useState<ProductForm>(emptyProductForm)
  const [saving, setSaving] = useState(false)

  // حذف محصول
  const [toDelete, setToDelete] = useState<Product | null>(null)

  // دیالوگ دسته‌بندی‌ها
  const [catsOpen, setCatsOpen] = useState(false)
  const [newCat, setNewCat] = useState('')
  const [catBusy, setCatBusy] = useState(false)
  const [editingCatId, setEditingCatId] = useState<string | null>(null)
  const [editingCatName, setEditingCatName] = useState('')
  const [catToDelete, setCatToDelete] = useState<Category | null>(null)

  const setF = (patch: Partial<ProductForm>) => setForm((f) => ({ ...f, ...patch }))

  const list = useMemo(() => {
    const rows = products.data ?? []
    let out = rows
    const s = search.trim().toLowerCase()
    if (s) {
      out = out.filter(
        (p) =>
          p.name.toLowerCase().includes(s) ||
          p.code.toLowerCase().includes(s) ||
          (p.barcode ?? '').toLowerCase().includes(s)
      )
    }
    if (catFilter !== 'all') out = out.filter((p) => p.categoryId === catFilter)
    if (stockFilter === 'low') out = out.filter((p) => p.stock <= p.minStock)
    if (stockFilter === 'out') out = out.filter((p) => p.stock <= 0)
    return out
  }, [products.data, search, catFilter, stockFilter])

  const stats = useMemo(() => {
    const rows = products.data ?? []
    const total = rows.length
    const stockValue = rows.reduce((a, p) => a + p.stock * p.costPrice, 0)
    const low = rows.filter((p) => p.stock <= p.minStock).length
    const active = rows.filter((p) => p.active).length
    return { total, stockValue, low, active, inactive: total - active }
  }, [products.data])

  // ---------- Product dialog ----------
  function openCreate() {
    setEditing(null)
    setForm({
      ...emptyProductForm,
      code: nextCode(products.data ?? [], 'P'),
    })
    setDialogOpen(true)
  }

  function openEdit(p: Product) {
    setEditing(p)
    setForm({
      name: p.name,
      code: p.code,
      categoryId: p.categoryId ?? 'none',
      unit: p.unit || 'عدد',
      salePrice: String(p.salePrice),
      wholesalePrice: String(p.wholesalePrice),
      costPrice: String(p.costPrice),
      minStock: String(p.minStock),
      stock: String(p.stock),
      barcode: p.barcode ?? '',
      description: p.description ?? '',
      active: p.active,
    })
    setDialogOpen(true)
  }

  async function saveProduct() {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error(t('نام و کود محصول الزامی است', 'نوم او کوډ ضروري دي', 'Name and code are required'))
      return
    }
    const salePrice = Number(form.salePrice)
    if (form.salePrice === '' || isNaN(salePrice) || salePrice < 0) {
      toast.error(t('قیمت فروش معتبر وارد کنید', 'قیمت فروش معتبر داخل کړئ', 'Enter a valid sale price'))
      return
    }
    const nums = {
      wholesalePrice: form.wholesalePrice === '' ? 0 : Number(form.wholesalePrice),
      costPrice: form.costPrice === '' ? 0 : Number(form.costPrice),
      minStock: form.minStock === '' ? 0 : Number(form.minStock),
      stock: form.stock === '' ? 0 : Number(form.stock),
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
        categoryId: form.categoryId === 'none' ? null : form.categoryId,
        unit: form.unit,
        salePrice,
        ...nums,
        barcode: form.barcode.trim() || null,
        description: form.description.trim() || null,
        active: form.active,
      }
      const res = await fetch(editing ? `/api/products/${editing.id}` : '/api/products', {
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
      products.refetch()
    } catch {
      toast.error(t('خطای ارتباط با سرور', 'د سرور سره اتصال خطا', 'Server connection error'))
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!toDelete) return
    try {
      const res = await fetch(`/api/products/${toDelete.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('حذف ناموفق بود', 'پاکول ناکام شو', 'Delete failed'))
        return
      }
      toast.success(t('حذف شد', 'پاک شو', 'Deleted'))
      setToDelete(null)
      products.refetch()
    } catch {
      toast.error(t('خطای ارتباط با سرور', 'د سرور سره اتصال خطا', 'Server connection error'))
    }
  }

  // ---------- Categories CRUD ----------
  async function addCategory() {
    const name = newCat.trim()
    if (!name) return
    setCatBusy(true)
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('خطا در ثبت', 'خطا په ثبت کې', 'Save failed'))
        return
      }
      setNewCat('')
      categories.refetch()
      toast.success(t('ثبت شد', 'ثبت شو', 'Saved'))
    } finally {
      setCatBusy(false)
    }
  }

  async function renameCategory() {
    if (!editingCatId) return
    const name = editingCatName.trim()
    if (!name) return
    setCatBusy(true)
    try {
      const res = await fetch(`/api/categories/${editingCatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('خطا در ویرایش', 'خطا په سمون کې', 'Update failed'))
        return
      }
      setEditingCatId(null)
      categories.refetch()
      products.refetch()
      toast.success(t('به‌روزرسانی شد', 'تازه شو', 'Updated'))
    } finally {
      setCatBusy(false)
    }
  }

  async function deleteCategory() {
    if (!catToDelete) return
    try {
      const res = await fetch(`/api/categories/${catToDelete.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        toast.error(json.error ?? t('حذف ناموفق بود', 'پاکول ناکام شو', 'Delete failed'))
        return
      }
      toast.success(t('حذف شد', 'پاک شو', 'Deleted'))
      setCatToDelete(null)
      categories.refetch()
      products.refetch()
    } catch {
      toast.error(t('خطای ارتباط با سرور', 'د سرور سره اتصال خطا', 'Server connection error'))
    }
  }

  // ---------- CSV export ----------
  function exportCsv() {
    if (list.length === 0) {
      toast.error(t('داده‌ای برای دانلود نیست', 'د ډاونلوډ لپاره معلومات نشته', 'Nothing to export'))
      return
    }
    const headers = [
      t('کود', 'کوډ', 'Code'),
      t('نام', 'نوم', 'Name'),
      t('دسته', 'کټګوري', 'Category'),
      t('واحد', 'واحد', 'Unit'),
      t('موجودی', 'موجودي', 'Stock'),
      t('حداقل موجودی', 'لږترلږه موجودي', 'Min stock'),
      t('قیمت تمام‌شده', 'د بشپړېدو قیمت', 'Cost price'),
      t('قیمت فروش', 'د پلور قیمت', 'Sale price'),
      t('قیمت عمده', 'د پرچون قیمت', 'Wholesale price'),
      t('بارکد', 'بارکوډ', 'Barcode'),
      t('وضعیت', 'حالت', 'Status'),
    ]
    const rows = list.map((p) => [
      p.code,
      p.name,
      p.category?.name ?? '',
      p.unit,
      p.stock,
      p.minStock,
      p.costPrice,
      p.salePrice,
      p.wholesalePrice,
      p.barcode ?? '',
      p.active ? t('فعال', 'فعال', 'Active') : t('غیرفعال', 'غیرفعال', 'Inactive'),
    ])
    const csv =
      '\uFEFF' +
      [headers, ...rows]
        .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
        .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `products-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t('فایل دانلود شد', 'فایل ډاونلوډ شو', 'File downloaded'))
  }

  const loading = products.loading
  const catList = categories.data ?? []

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        title={t('محصولات', 'محصولات', 'Products')}
        subtitle={t(
          'مدیریت محصولات، قیمت‌ها و موجودی انبار',
          'د محصولاتو، قیمونو او د ګودام موجودي مدیریت',
          'Manage products, prices and stock'
        )}
        icon={Package}
        actions={
          <>
            <Button variant="outline" onClick={() => setCatsOpen(true)}>
              <Tag className="h-4 w-4" />
              {t('دسته‌بندی‌ها', 'کټګورۍ', 'Categories')}
            </Button>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              {t('محصول جدید', 'نوی محصول', 'New product')}
            </Button>
          </>
        }
      />

      {/* آمار */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('تعداد محصولات', 'د محصولاتو شمېر', 'Total products')}
          value={formatNumber(stats.total)}
          icon={Package}
          tone="green"
        />
        <StatCard
          title={t('ارزش موجودی', 'د موجودي ارزښت', 'Stock value')}
          value={formatMoney(stats.stockValue)}
          icon={Coins}
          tone="blue"
          hint={t('بر اساس قیمت تمام‌شده', 'د بشپړېدو قیمت پر بنسټ', 'Based on cost price')}
        />
        <StatCard
          title={t('کم‌موجودی', 'کم موجودي', 'Low stock')}
          value={formatNumber(stats.low)}
          icon={AlertTriangle}
          tone={stats.low > 0 ? 'amber' : 'green'}
          hint={t('در یا زیر حداقل موجودی', 'په یا تر لږترلږه موجودي', 'At or below minimum')}
        />
        <StatCard
          title={t('فعال / غیرفعال', 'فعال / غیرفعال', 'Active / Inactive')}
          value={`${formatNumber(stats.active)} / ${formatNumber(stats.inactive)}`}
          icon={CheckCircle2}
          tone="slate"
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
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="w-full sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('همه دسته‌ها', 'ټولې کټګورۍ', 'All categories')}</SelectItem>
              {catList.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
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
              <SelectItem value="out">{t('بی‌موجودی', 'بې‌موجودي', 'Out of stock')}</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={exportCsv} className="ms-auto">
            <Download className="h-4 w-4" />
            {t('دانلود', 'ډاونلوډ', 'Download')}
          </Button>
        </CardContent>
      </Card>

      {/* جدول محصولات */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-4 w-4 text-primary" />
            {t('لیست محصولات', 'د محصولاتو لیست', 'Product list')}
            <Badge variant="secondary">{formatNumber(list.length)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <TableSkeleton rows={6} />
          ) : list.length === 0 ? (
            <EmptyState
              label={t(
                'محصولی یافت نشد',
                'هیڅ محصول نه موندل شو',
                'No products found'
              )}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('کود', 'کوډ', 'Code')}</TableHead>
                    <TableHead>{t('نام', 'نوم', 'Name')}</TableHead>
                    <TableHead>{t('دسته', 'کټګوري', 'Category')}</TableHead>
                    <TableHead className="text-end">{t('موجودی', 'موجودي', 'Stock')}</TableHead>
                    <TableHead className="text-end">{t('فروش / عمده', 'پلور / پرچون', 'Sale / Wholesale')}</TableHead>
                    <TableHead>{t('بارکد', 'بارکوډ', 'Barcode')}</TableHead>
                    <TableHead>{t('وضعیت', 'حالت', 'Status')}</TableHead>
                    <TableHead className="text-end">{t('عملیات', 'عمليې', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((p) => {
                    const isLow = p.stock <= p.minStock
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs" dir="ltr">{p.code}</TableCell>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          {p.description && (
                            <div className="max-w-56 truncate text-xs text-muted-foreground" title={p.description}>
                              {p.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.category ? (
                            <Badge variant="secondary">{p.category.name}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              isLow ? 'text-red-600 dark:text-red-400' : ''
                            }`}
                          >
                            {isLow && <AlertTriangle className="h-3.5 w-3.5" />}
                            {formatNumber(p.stock)} {p.unit}
                          </span>
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="font-medium">{formatMoney(p.salePrice)}</div>
                          <div className="text-xs text-muted-foreground">
                            {t('عمده', 'پرچون', 'Wholesale')}: {formatMoney(p.wholesalePrice)}
                          </div>
                        </TableCell>
                        <TableCell>
                          {p.barcode ? (
                            <span className="font-mono text-xs" dir="ltr">{p.barcode}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {p.active ? (
                            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                              {t('فعال', 'فعال', 'Active')}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t('غیرفعال', 'غیرفعال', 'Inactive')}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              title={t('ویرایش', 'سمول', 'Edit')}
                              onClick={() => openEdit(p)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-600 hover:text-red-700 dark:text-red-400"
                              title={t('حذف', 'پاکول', 'Delete')}
                              onClick={() => setToDelete(p)}
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

      {/* دیالوگ محصول */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('ویرایش محصول', 'د محصول سمول', 'Edit product')
                : t('محصول جدید', 'نوی محصول', 'New product')}
            </DialogTitle>
            <DialogDescription>
              {t('مشخصات محصول را کامل کنید', 'د محصول مشخصات بشپړ کړئ', 'Fill in the product details')}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>{t('نام محصول *', 'د محصول نوم *', 'Product name *')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setF({ name: e.target.value })}
                placeholder={t('مثال: شیر پاستوریزه ۱ لیتر', 'بېلګه: پاستوریزه شیدو ۱ لیتر', 'e.g. Pasteurized milk 1L')}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('کود *', 'کوډ *', 'Code *')}</Label>
              <Input
                value={form.code}
                onChange={(e) => setF({ code: e.target.value })}
                className="font-mono"
                dir="ltr"
                placeholder="P-008"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('دسته‌بندی', 'کټګوري', 'Category')}</Label>
              <Select value={form.categoryId} onValueChange={(v) => setF({ categoryId: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('بدون دسته', 'بې کټګورۍ', 'No category')}</SelectItem>
                  {catList.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label>{t('قیمت فروش (خرده) *', 'د پلور قیمت (لږ پلور) *', 'Sale price *')}</Label>
              <Input
                type="number"
                min={0}
                value={form.salePrice}
                onChange={(e) => setF({ salePrice: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('قیمت عمده', 'د پرچون قیمت', 'Wholesale price')}</Label>
              <Input
                type="number"
                min={0}
                value={form.wholesalePrice}
                onChange={(e) => setF({ wholesalePrice: e.target.value })}
                dir="ltr"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t('قیمت تمام‌شده', 'د بشپړېدو قیمت', 'Cost price')}</Label>
              <Input
                type="number"
                min={0}
                value={form.costPrice}
                onChange={(e) => setF({ costPrice: e.target.value })}
                dir="ltr"
              />
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
              <Label>{t('موجودی اولیه', 'لومړنی موجودي', 'Initial stock')}</Label>
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
                    'موجودی از طریق تولید/انبار تغییر می‌کند',
                    'موجودي د تولید/ګودام له لارې بدلیږي',
                    'Stock changes via production/inventory'
                  )}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t('بارکد', 'بارکوډ', 'Barcode')}</Label>
              <Input
                value={form.barcode}
                onChange={(e) => setF({ barcode: e.target.value })}
                className="font-mono"
                dir="ltr"
                placeholder="1000008"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t('توضیحات', 'تفصیلات', 'Description')}</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setF({ description: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          {/* بارکد تزئینی */}
          {(form.barcode || form.code) && (
            <div className="flex justify-center py-1">
              <BarcodeStrip code={form.barcode || form.code} />
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t('فعال', 'فعال', 'Active')}</Label>
              <p className="text-xs text-muted-foreground">
                {t('محصول غیرفعال در فروش نمایش داده نمی‌شود', 'غیرفعال محصول په پلور کې نه ښکاري', 'Inactive products are hidden from sales')}
              </p>
            </div>
            <Switch checked={form.active} onCheckedChange={(v) => setF({ active: v })} />
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('لغو', 'لغوه', 'Cancel')}
            </Button>
            <Button onClick={saveProduct} disabled={saving}>
              {saving && <LoadingIcon />}
              {t('ذخیره', 'خوندي', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* دیالوگ دسته‌بندی‌ها */}
      <Dialog open={catsOpen} onOpenChange={setCatsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('دسته‌بندی محصولات', 'د محصولاتو کټګورۍ', 'Product categories')}</DialogTitle>
            <DialogDescription>
              {t('افزودن، تغییر نام و حذف دسته‌بندی‌ها', 'اضافه کول، نوم بدلول او پاکول', 'Add, rename and delete categories')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              placeholder={t('نام دسته‌بندی جدید', 'د نوي کټګورۍ نوم', 'New category name')}
              onKeyDown={(e) => e.key === 'Enter' && addCategory()}
            />
            <Button onClick={addCategory} disabled={catBusy || !newCat.trim()}>
              <Plus className="h-4 w-4" />
              {t('افزودن', 'اضافه', 'Add')}
            </Button>
          </div>

          <Separator />

          <div className="max-h-96 space-y-2 overflow-y-auto pe-1">
            {catList.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('دسته‌بندی ثبت نشده است', 'کټګوري نه ده ثبت شوې', 'No categories yet')}
              </p>
            )}
            {catList.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg border p-2"
              >
                {editingCatId === c.id ? (
                  <>
                    <Input
                      value={editingCatName}
                      onChange={(e) => setEditingCatName(e.target.value)}
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && renameCategory()}
                    />
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={renameCategory} disabled={catBusy}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setEditingCatId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                    <Badge variant="secondary">
                      {formatNumber(c._count?.products ?? 0)} {t('محصول', 'محصول', 'products')}
                    </Badge>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      title={t('تغییر نام', 'نوم بدلول', 'Rename')}
                      onClick={() => {
                        setEditingCatId(c.id)
                        setEditingCatName(c.name)
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-red-600 hover:text-red-700 dark:text-red-400"
                      title={t('حذف', 'پاکول', 'Delete')}
                      onClick={() => setCatToDelete(c)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* تأیید حذف محصول */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف محصول', 'د محصول پاکول', 'Delete product')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'آیا از حذف',
                'ایا د پاکولو څخه ډاډه یاست',
                'Are you sure you want to delete'
              )}{' '}
              <span className="font-bold text-foreground">«{toDelete?.name}»</span>{' '}
              {t(
                'مطمئن هستید؟ این عمل قابل بازگشت نیست.',
                'یاست؟ دا عمل بېرته نه شي راوړل کېدلی.',
                '? This action cannot be undone.'
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

      {/* تأیید حذف دسته‌بندی */}
      <AlertDialog open={!!catToDelete} onOpenChange={(o) => !o && setCatToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف دسته‌بندی', 'د کټګورۍ پاکول', 'Delete category')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'اگر محصولات در این دسته ثبت شده باشد، حذف ممکن نیست.',
                'که محصولات په دې کټګورۍ کې ثبت شوي وي، پاکول ناشونې ده.',
                'Deletion is blocked if products exist in this category.'
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault()
                deleteCategory()
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

// آیکن بارگذاری کوچک داخل دکمه
function LoadingIcon() {
  return (
    <span className="me-1 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent align-[-2px]" />
  )
}
