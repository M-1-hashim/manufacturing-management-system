'use client'
// ماژول فورمولا‌نویسی (BOM) — نسخه‌بندی فورمولاها، مواد تشکیل‌دهنده و برآورد مصرف
import { useMemo, useState } from 'react'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { toast } from 'sonner'
import { formatMoney, formatNumber } from '@/lib/format'
import { PageHeader, LoadingBlock, EmptyState } from '@/components/shared/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FlaskConical, Plus, Pencil, Trash2, CopyPlus, Search, X, Package, Calculator } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------- انواع ----------
interface ProductLite { id: string; code: string; name: string; unit: string; stock: number }
interface RawMaterialLite { id: string; code: string; name: string; unit: string; purchasePrice: number; stock: number }
interface FormulaItemT { id: string; rawMaterialId: string; quantity: number; percentage?: number | null; rawMaterial: RawMaterialLite }
interface FormulaT {
  id: string; productId: string; name: string; version: number; outputQty: number
  laborCost: number; overheadCost: number; notes: string | null; isActive: boolean
  product: ProductLite; items: FormulaItemT[]
}
interface ItemDraft { key: string; rawMaterialId: string; quantity: string }

const fmtQty = (n: number) => (Number.isInteger(n) ? formatNumber(n) : formatNumber(n, 2))

async function errFrom(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return j?.error || 'خطا در ارتباط با هاست'
  } catch {
    return 'خطا در ارتباط با هاست'
  }
}

const materialCostOf = (f: FormulaT) =>
  f.items.reduce((a, i) => a + i.quantity * (i.rawMaterial?.purchasePrice ?? 0), 0)

export default function FormulasModule() {
  const { t } = useI18n()
  const { data: formulas, loading, refetch } = useFetch<FormulaT[]>('/api/formulas')
  const { data: products } = useFetch<ProductLite[]>('/api/products')
  const { data: materials } = useFetch<RawMaterialLite[]>('/api/raw-materials')

  const [search, setSearch] = useState('')

  // حالت دیالوگ ثبت/تصحیح
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<FormulaT | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    productId: '', name: '', version: '1', outputQty: '1', laborCost: '0', overheadCost: '0', notes: '',
  })
  const [items, setItems] = useState<ItemDraft[]>([])

  // حذف و نسخه جدید
  const [deleteTarget, setDeleteTarget] = useState<FormulaT | null>(null)
  const [versionTarget, setVersionTarget] = useState<FormulaT | null>(null)
  const [busy, setBusy] = useState(false)

  const materialsById = useMemo(() => {
    const m: Record<string, RawMaterialLite> = {}
    for (const mt of materials ?? []) m[mt.id] = mt
    return m
  }, [materials])

  const nextVersion = (productId: string) => {
    const vs = (formulas ?? []).filter((f) => f.productId === productId).map((f) => f.version)
    return vs.length ? Math.max(...vs) + 1 : 1
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return formulas ?? []
    return (formulas ?? []).filter(
      (f) =>
        f.product?.name?.toLowerCase().includes(q) ||
        f.name?.toLowerCase().includes(q),
    )
  }, [formulas, search])

  // ---------- باز کردن دیالوگ ----------
  function openCreate() {
    setEditing(null)
    setForm({ productId: '', name: '', version: '1', outputQty: '1', laborCost: '0', overheadCost: '0', notes: '' })
    setItems([{ key: crypto.randomUUID(), rawMaterialId: '', quantity: '' }])
    setOpen(true)
  }

  function openEdit(f: FormulaT) {
    setEditing(f)
    setForm({
      productId: f.productId,
      name: f.name,
      version: String(f.version),
      outputQty: String(f.outputQty),
      laborCost: String(f.laborCost),
      overheadCost: String(f.overheadCost),
      notes: f.notes ?? '',
    })
    setItems(
      f.items.map((it) => ({ key: it.id, rawMaterialId: it.rawMaterialId, quantity: String(it.quantity) })),
    )
    setOpen(true)
  }

  function onProductChange(pid: string) {
    setForm((prev) => ({
      ...prev,
      productId: pid,
      version: editing ? prev.version : String(nextVersion(pid)),
      name: prev.name.trim() || (editing ? prev.name : ''),
    }))
  }

  // ---------- آیتم‌ها ----------
  const sumQty = items.reduce((a, it) => a + (Number(it.quantity) || 0), 0)
  const usedMaterialIds = new Set(items.map((it) => it.rawMaterialId).filter(Boolean))
  const draftMatCost = items.reduce(
    (a, it) => a + (Number(it.quantity) || 0) * (materialsById[it.rawMaterialId]?.purchasePrice ?? 0),
    0,
  )
  const draftTotal = draftMatCost + (Number(form.laborCost) || 0) + (Number(form.overheadCost) || 0)
  const draftOutput = Number(form.outputQty) > 0 ? Number(form.outputQty) : 0
  const draftUnitCost = draftOutput > 0 ? draftTotal / draftOutput : 0

  function addItem() {
    setItems((prev) => [...prev, { key: crypto.randomUUID(), rawMaterialId: '', quantity: '' }])
  }
  function removeItem(key: string) {
    setItems((prev) => (prev.length > 1 ? prev.filter((it) => it.key !== key) : prev))
  }
  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  // ---------- ذخیره ----------
  async function submit() {
    if (!form.productId) {
      toast.error(t('انتخاب محصول الزامی است', 'د محصول ټولنه اړینه ده', 'Product is required'))
      return
    }
    if (!form.name.trim()) {
      toast.error(t('نام فورمولا را وارد کنید', 'د فورمول نوم ولیکئ', 'Formula name is required'))
      return
    }
    const validItems = items.filter((it) => it.rawMaterialId && Number(it.quantity) > 0)
    if (validItems.length === 0) {
      toast.error(t('حداقل یک ماده با مقدار معتبر لازم است', 'لږ تر لږه یوه ماده د سمو مقدار سره اړینه ده', 'At least one valid material is required'))
      return
    }
    if (validItems.length !== items.length) {
      toast.error(t('همه ردیف‌ها باید ماده و مقدار داشته باشند', 'ټېل ردیفونه باید ماده او مقدار ولري', 'All rows need a material and quantity'))
      return
    }

    setSaving(true)
    try {
      const payload = {
        productId: form.productId,
        name: form.name.trim(),
        version: Number(form.version) || 1,
        outputQty: Number(form.outputQty) || 1,
        laborCost: Number(form.laborCost) || 0,
        overheadCost: Number(form.overheadCost) || 0,
        notes: form.notes,
        ...(editing ? {} : { isActive: true }),
        items: validItems.map((it) => ({ rawMaterialId: it.rawMaterialId, quantity: Number(it.quantity) })),
      }
      const res = await fetch(editing ? `/api/formulas/${editing.id}` : '/api/formulas', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        toast.error(await errFrom(res))
        return
      }
      toast.success(editing
        ? t('فورمولا تجدید شد', 'فورمول تازه شو', 'Formula updated')
        : t('فورمولا جدید ثبت شد', 'نوی فورمول ثبت شو', 'Formula created'))
      setOpen(false)
      refetch()
    } finally {
      setSaving(false)
    }
  }

  // ---------- اجراؤات کارت ----------
  async function toggleActive(f: FormulaT, next: boolean) {
    const res = await fetch(`/api/formulas/${f.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: next }),
    })
    if (!res.ok) {
      toast.error(await errFrom(res))
      return
    }
    toast.success(next
      ? t('فورمولا فعال شد', 'فورمول فعال شو', 'Formula activated')
      : t('فورمولا غیرفعال شد', 'فورمول غیرفعال شو', 'Formula deactivated'))
    refetch()
  }

  async function makeNewVersion(f: FormulaT) {
    setBusy(true)
    try {
      const res = await fetch(`/api/formulas/${f.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ createNewVersion: true }),
      })
      if (!res.ok) {
        toast.error(await errFrom(res))
        return
      }
      const created = await res.json()
      const ver = (created as { version?: number; offlineQueued?: boolean }).version
        ?? ((created as { offlineQueued?: boolean }).offlineQueued ? 0 : undefined)
      toast.success(
        ver === 0
          ? t('نسخه جدید به‌صورت آفلاین در صف همگام‌سازی قرار گرفت', 'نوی نسخه افلاین په لیکه کې دی', 'New version saved offline — pending sync')
          : t(`نسخه ${ver} ساخته شد و فعال گردید`, `د ${ver} نسخه جوړه شوه`, `Version ${ver} created and activated`)
      )
      setVersionTarget(null)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  async function doDelete(f: FormulaT) {
    setBusy(true)
    try {
      const res = await fetch(`/api/formulas/${f.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(await errFrom(res))
        return
      }
      toast.success(t('فورمولا حذف شد', 'فورمول ړنګ شو', 'Formula deleted'))
      setDeleteTarget(null)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  // ---------- نمایش ----------
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('فورمولا‌نویسی (BOM)', 'فورمول جوړونه (BOM)', 'Formulation (BOM)')}
        subtitle={t('تعریف ترکیب مواد اولیه و مصارفی هر محصول', 'د هر محصول خامو موادو ترکیب او لګښتونه', 'Define material composition and costs per product')}
        icon={FlaskConical}
        actions={
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {t('فورمولا جدید', 'نوی فورمول', 'New Formula')}
          </Button>
        }
      />

      {/* جستجو */}
      <div className="relative max-w-sm">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('جستجوی محصول یا نام فورمولا...', 'د محصول یا فورمول لټون...', 'Search product or formula name...')}
          className="ps-9"
        />
      </div>

      {loading ? (
        <LoadingBlock />
      ) : !products || products.length === 0 ? (
        <EmptyState label={t('ابتدا محصولات را در ماژول محصولات ثبت کنید', 'لومړی په محصولاتو ماډل کې محصولات ثبت کړئ', 'Register products first in the Products module')} />
      ) : !formulas || formulas.length === 0 ? (
        <EmptyState label={t('فرمولی ثبت نشده است', 'هیڅ فورمول ثبت شوی نه دی', 'No formulas yet')} />
      ) : filtered.length === 0 ? (
        <EmptyState label={t('نتیجه‌ای یافت نشد', 'نتیجه و نه موندل شو', 'No results found')} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((f) => {
            const matCost = materialCostOf(f)
            const batchTotal = matCost + f.laborCost + f.overheadCost
            const unitCost = f.outputQty > 0 ? batchTotal / f.outputQty : 0
            return (
              <Card key={f.id} className={cn('overflow-hidden hover:shadow-md transition-shadow', !f.isActive && 'opacity-70')}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base truncate" title={f.product.name}>{f.product.name}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={f.name}>{f.name}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="font-mono text-xs">v{f.version}</Badge>
                      <Switch
                        checked={f.isActive}
                        onCheckedChange={(v) => toggleActive(f, v)}
                        aria-label={t('فعال', 'فعال', 'Active')}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Package className="h-4 w-4 text-sky-500 shrink-0" />
                    <span className="text-muted-foreground">{t('خروجی هر بچ:', 'د هرې بچې محصول:', 'Output per batch:')}</span>
                    <span className="font-semibold">{fmtQty(f.outputQty)} {f.product.unit}</span>
                  </div>

                  <Separator />

                  {/* مواد تشکیل‌دهنده */}
                  <div className="space-y-2.5">
                    {f.items.map((it) => {
                      const pct = it.percentage ?? (it.quantity > 0 && sumOfItems(f) > 0 ? (it.quantity / sumOfItems(f)) * 100 : 0)
                      return (
                        <div key={it.id}>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate">{it.rawMaterial?.name}</span>
                            <span className="font-mono text-xs text-muted-foreground shrink-0">
                              {fmtQty(it.quantity)} {it.rawMaterial?.unit} · {formatNumber(pct, 1)}٪
                            </span>
                          </div>
                          <Progress value={Math.min(pct, 100)} className="h-1.5 mt-1" />
                        </div>
                      )
                    })}
                  </div>

                  <Separator />

                  {/* تفکیک مصرف */}
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('مواد', 'مواد', 'Materials')}</span>
                      <span className="font-medium">{formatMoney(matCost)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('دستمزد', 'مزد', 'Labor')}</span>
                      <span className="font-medium">{formatMoney(f.laborCost)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('سربار', 'سربار', 'Overhead')}</span>
                      <span className="font-medium">{formatMoney(f.overheadCost)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('مصرف هر واحد', 'د هرې واحدې لګښت', 'Cost per unit')}</span>
                      <span className="font-medium">{formatMoney(unitCost)}</span>
                    </div>
                  </div>

                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t('مصرف کل برای یک بچ', 'د یوې بچې ټول لګښت', 'Total cost per batch')}</span>
                      <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{formatMoney(batchTotal)}</span>
                    </div>
                  </div>

                  {f.notes && (
                    <p className="text-xs text-muted-foreground line-clamp-2" title={f.notes}>📝 {f.notes}</p>
                  )}

                  <div className="flex items-center gap-1.5 pt-1">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => openEdit(f)}>
                      <Pencil className="h-3.5 w-3.5" />
                      {t('تصحیح', 'سمول', 'Edit')}
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => setVersionTarget(f)}>
                      <CopyPlus className="h-3.5 w-3.5" />
                      {t('نسخه جدید', 'نوی نسخه', 'New version')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 ms-auto"
                      onClick={() => setDeleteTarget(f)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('حذف', 'ړنګول', 'Delete')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ---------- دیالوگ فورمولا ---------- */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('تصحیح فورمولا', 'د فورمول سمول', 'Edit Formula')
                : t('فورمولا جدید', 'نوی فورمول', 'New Formula')}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            {/* ستون اصلی */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('محصول', 'محصول', 'Product')} *</Label>
                  <Select value={form.productId} onValueChange={onProductChange} disabled={!!editing}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t('انتخاب محصول', 'د محصول ټاکنه', 'Select product')} /></SelectTrigger>
                    <SelectContent>
                      {(products ?? []).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t('نام فورمولا', 'د فورمول نوم', 'Formula name')} *</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('مثال: فورمولا شیر پاستوریزه', 'بېلګه: د پاستوریزه شیدو فورمول', 'e.g. Pasteurized milk formula')} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('نسخه', 'نسخه', 'Version')}</Label>
                    <Input type="number" min={1} value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('خروجی بچ', 'د بچې محصول', 'Output qty')} *</Label>
                    <Input type="number" min={0} step="any" value={form.outputQty} onChange={(e) => setForm({ ...form, outputQty: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>{t('دستمزد (؋)', 'مزد (؋)', 'Labor (؋)')}</Label>
                    <Input type="number" min={0} step="any" value={form.laborCost} onChange={(e) => setForm({ ...form, laborCost: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t('سربار (؋)', 'سربار (؋)', 'Overhead (؋)')}</Label>
                    <Input type="number" min={0} step="any" value={form.overheadCost} onChange={(e) => setForm({ ...form, overheadCost: e.target.value })} />
                  </div>
                </div>
              </div>

              {/* تصحیحگر مواد */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t('مواد اولیه', 'خام مواد', 'Raw materials')} *</Label>
                  <Button type="button" size="sm" variant="outline" className="gap-1 h-8" onClick={addItem}>
                    <Plus className="h-3.5 w-3.5" />
                    {t('علاوه کردن ماده', 'ماده زیاتول', 'Add material')}
                  </Button>
                </div>
                <div className="space-y-2">
                  {items.map((it) => {
                    const pct = sumQty > 0 && Number(it.quantity) > 0 ? ((Number(it.quantity) || 0) / sumQty) * 100 : 0
                    return (
                      <div key={it.key} className="flex items-center gap-2">
                        <Select value={it.rawMaterialId} onValueChange={(v) => updateItem(it.key, { rawMaterialId: v })}>
                          <SelectTrigger className="flex-1 min-w-0"><SelectValue placeholder={t('انتخاب ماده', 'د مادې ټاکنه', 'Select material')} /></SelectTrigger>
                          <SelectContent>
                            {(materials ?? []).map((m) => (
                              <SelectItem key={m.id} value={m.id} disabled={usedMaterialIds.has(m.id) && m.id !== it.rawMaterialId}>
                                {m.name} ({m.unit})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Input
                          type="number" min={0} step="any" placeholder={t('مقدار', 'مقدار', 'Qty')}
                          className="w-24 shrink-0"
                          value={it.quantity}
                          onChange={(e) => updateItem(it.key, { quantity: e.target.value })}
                        />
                        <span className="w-14 text-xs font-mono text-muted-foreground shrink-0 text-center">
                          {formatNumber(pct, 1)}٪
                        </span>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 shrink-0" onClick={() => removeItem(it.key)} disabled={items.length <= 1}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )
                  })}
                </div>
                {items.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t('حداقل یک ماده اضافه کنید', 'لږ تر لږه یوه ماده زیاته کړئ', 'Add at least one material')}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>{t('یادداشت', 'یادښت', 'Notes')}</Label>
                <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('توضیحات فورمولا...', 'د فورمول توضیحات...', 'Formula notes...')} />
              </div>
            </div>

            {/* پنل پیش‌نمایش مصرف */}
            <div className="rounded-xl border bg-muted/40 p-3 space-y-2.5 self-start">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Calculator className="h-4 w-4 text-emerald-600" />
                {t('پیش‌نمایش مصرف', 'د لګښت مخکتنه', 'Cost preview')}
              </p>
              <Separator />
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('مواد', 'مواد', 'Materials')}</span>
                  <span className="font-medium">{formatMoney(draftMatCost)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('دستمزد', 'مزد', 'Labor')}</span>
                  <span className="font-medium">{formatMoney(Number(form.laborCost) || 0)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('سربار', 'سربار', 'Overhead')}</span>
                  <span className="font-medium">{formatMoney(Number(form.overheadCost) || 0)}</span>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t('جمع هر بچ', 'د هرې بچې مجموع', 'Total per batch')}</span>
                <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatMoney(draftTotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">{t('مصرف هر واحد', 'د هرې واحدې لګښت', 'Cost per unit')}</span>
                <span className="font-semibold">{formatMoney(draftUnitCost)}</span>
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                {t('بر اساس قیمت خرید فعلی مواد', 'د موادو د اوسني د خرید پریس پر بنسټ', 'Based on current material purchase prices')}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-start gap-2 pt-2">
            <Button onClick={submit} disabled={saving} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {saving ? t('در حال ذخیره...', 'په ذخیره کې...', 'Saving...') : editing ? t('ذخیره تغییرات', 'بدلونونه ذخیره', 'Save changes') : t('ثبت فورمولا', 'د فورمول ثبت', 'Create formula')}
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>{t('انصراف', 'لغوه', 'Cancel')}</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- تصدیق نسخه جدید ---------- */}
      <AlertDialog open={!!versionTarget} onOpenChange={(v) => !v && setVersionTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ساخت نسخه جدید فورمولا', 'د فورمول نوی نسخه جوړول', 'Create new formula version?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `نسخه جدیدی از «${versionTarget?.name ?? ''}» ساخته می‌شود و فورمولا فعلی غیرفعال خواهد شد. آیا مطمئن هستید؟`,
                `«${versionTarget?.name ?? ''}» نوی نسخه جوړېږي او اوسنی فورمول غیرفعال کېږي. ډاډه یاست؟`,
                `A new version of "${versionTarget?.name ?? ''}" will be created and the current formula will be deactivated. Are you sure?`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('انصراف', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); if (versionTarget) makeNewVersion(versionTarget) }}>
              {t('ساخت نسخه', 'نسخه جوړول', 'Create version')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- تصدیق حذف ---------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف فورمولا', 'د فورمول ړنګول', 'Delete formula?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `فورمولا «${deleteTarget?.name ?? ''}» برای همیشه حذف می‌شود. این عمل قابل بازگشت نیست.`,
                `فورمول «${deleteTarget?.name ?? ''}» د تل لپاره ړنګېږي. دا عمل بېرته نه ګرځي.`,
                `Formula "${deleteTarget?.name ?? ''}" will be permanently deleted. This cannot be undone.`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('انصراف', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => { e.preventDefault(); if (deleteTarget) doDelete(deleteTarget) }}
            >
              {t('حذف', 'ړنګول', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// مجموع مقادیر مواد یک فورمولا (برای درصد نمایشی)
function sumOfItems(f: FormulaT): number {
  return f.items.reduce((a, i) => a + i.quantity, 0)
}
