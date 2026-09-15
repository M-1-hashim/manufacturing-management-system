'use client'
// ماژول تولید — جادوگر ثبت سفارش تولید (۳ مرحله) + پیگیری سفارش‌ها و تکمیل تولید با کسر خودکار انبار
import { useMemo, useState } from 'react'
import { useFetch } from '@/lib/hooks'
import { useI18n } from '@/lib/i18n'
import { toast } from 'sonner'
import { formatMoney, formatNumber, toJalaliStr, STATUS_COLORS } from '@/lib/format'
import { PageHeader, StatCard, LoadingBlock, EmptyState } from '@/components/shared/common'
import { PrintDocDialog, DocTotals, DocNotes } from '@/components/shared/print-doc'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Factory, Plus, CheckCircle2, Play, Ban, Trash2, AlertTriangle, Boxes, ClipboardList, Loader2, ChevronRight, ChevronLeft, Printer } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------- انواع ----------
interface ProductLite { id: string; code: string; name: string; unit: string; stock: number }
interface RawMaterialLite { id: string; code: string; name: string; unit: string; purchasePrice: number; stock: number }
interface FormulaItemT { id: string; rawMaterialId: string; quantity: number; rawMaterial: RawMaterialLite }
interface FormulaT {
  id: string; productId: string; name: string; version: number; outputQty: number
  laborCost: number; overheadCost: number; isActive: boolean
  product: ProductLite; items: FormulaItemT[]
}
interface ProductionOrderT {
  id: string; orderNumber: string; quantity: number; producedQty: number; wasteQty: number
  status: string; qcStatus: string | null; qcNotes: string | null
  materialCost: number; laborCost: number; overheadCost: number; totalCost: number
  startDate: string; endDate: string | null; notes: string | null
  product: ProductLite; formula: FormulaT
}

const fmtQty = (n: number) => (Number.isInteger(n) ? formatNumber(n) : formatNumber(n, 2))

async function errFrom(res: Response): Promise<string> {
  try {
    const j = await res.json()
    return j?.error || 'خطا در ارتباط با هاست'
  } catch {
    return 'خطا در ارتباط با هاست'
  }
}

export default function ProductionModule() {
  const { t } = useI18n()
  const { data: orders, loading, refetch } = useFetch<ProductionOrderT[]>('/api/production')
  const { data: formulas } = useFetch<FormulaT[]>('/api/formulas')
  const { data: products } = useFetch<ProductLite[]>('/api/products')

  const [filter, setFilter] = useState('all')

  // ---------- جادوگر ----------
  const [wizardOpen, setWizardOpen] = useState(false)
  const [step, setStep] = useState(1)
  const [wProductId, setWProductId] = useState('')
  const [wFormulaId, setWFormulaId] = useState('')
  const [wQty, setWQty] = useState('')
  const [wNotes, setWNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // ---------- تکمیل تولید ----------
  const [completeTarget, setCompleteTarget] = useState<ProductionOrderT | null>(null)
  const [cProduced, setCProduced] = useState('')
  const [cWaste, setCWaste] = useState('0')
  const [cQc, setCIc] = useState('pending')
  const [cQcNotes, setCIcNotes] = useState('')
  const [completing, setCompleting] = useState(false)

  // ---------- لغو و حذف ----------
  const [cancelTarget, setCancelTarget] = useState<ProductionOrderT | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProductionOrderT | null>(null)
  const [busy, setBusy] = useState(false)

  // ---------- چاپ ورک‌آردر ----------
  const [printTarget, setPrintTarget] = useState<ProductionOrderT | null>(null)

  const list = orders ?? []

  // ---------- آمار ----------
  const stats = useMemo(() => {
    const inProgress = list.filter((o) => o.status === 'in_progress').length
    const completed = list.filter((o) => o.status === 'completed').length
    const waste = list.reduce((a, o) => a + (o.status === 'completed' ? o.wasteQty : 0), 0)
    return { total: list.length, inProgress, completed, waste }
  }, [list])

  const filtered = useMemo(
    () => (filter === 'all' ? list : list.filter((o) => o.status === filter)),
    [list, filter],
  )

  // ---------- جادوگر: محاسبات ----------
  const wProductFormulas = useMemo(
    () => (formulas ?? []).filter((f) => f.productId === wProductId),
    [formulas, wProductId],
  )
  const wFormula = useMemo(() => (formulas ?? []).find((f) => f.id === wFormulaId) ?? null, [formulas, wFormulaId])
  const wQtyNum = Number(wQty) > 0 ? Number(wQty) : 0
  const wScale = wFormula && wFormula.outputQty > 0 ? wQtyNum / wFormula.outputQty : 0
  const wPreview = useMemo(() => {
    if (!wFormula) return []
    return wFormula.items.map((it) => {
      const req = it.quantity * wScale
      return {
        id: it.id,
        name: it.rawMaterial?.name ?? '—',
        unit: it.rawMaterial?.unit ?? '',
        price: it.rawMaterial?.purchasePrice ?? 0,
        req,
        stock: it.rawMaterial?.stock ?? 0,
        insufficient: req > (it.rawMaterial?.stock ?? 0),
      }
    })
  }, [wFormula, wScale])
  const wInsufficient = wPreview.filter((r) => r.insufficient)
  const wMatCost = wPreview.reduce((a, r) => a + r.req * r.price, 0)
  const wLabor = (wFormula?.laborCost ?? 0) * wScale
  const wOverhead = (wFormula?.overheadCost ?? 0) * wScale
  const wTotal = wMatCost + wLabor + wOverhead

  function openWizard() {
    setStep(1)
    setWProductId('')
    setWFormulaId('')
    setWQty('')
    setWNotes('')
    setWizardOpen(true)
  }

  async function submitWizard() {
    if (!wFormulaId || !(wQtyNum > 0)) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formulaId: wFormulaId, quantity: wQtyNum, notes: wNotes }),
      })
      if (!res.ok) {
        toast.error(await errFrom(res))
        return
      }
      const created = await res.json()
      const orderNo = (created as { orderNumber?: string; offlineQueued?: boolean }).orderNumber
        ?? ((created as { offlineQueued?: boolean }).offlineQueued ? t('آفلاین', 'افلاین', 'Offline') : '—')
      toast.success(t(`سفارش ${orderNo} ثبت شد و در جریان است`, `سفارش ${orderNo} ثبت شو`, `Order ${orderNo} created and in progress`))
      setWizardOpen(false)
      refetch()
    } finally {
      setSubmitting(false)
    }
  }

  // ---------- اجراؤات ----------
  async function startOrder(o: ProductionOrderT) {
    const res = await fetch(`/api/production/${o.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    })
    if (!res.ok) {
      toast.error(await errFrom(res))
      return
    }
    toast.success(t('تولید شروع شد', 'تولید پیل شو', 'Production started'))
    refetch()
  }

  async function cancelOrder(o: ProductionOrderT) {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/${o.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      })
      if (!res.ok) {
        toast.error(await errFrom(res))
        return
      }
      toast.success(t('سفارش لغو شد', 'سفارش لغوه شو', 'Order cancelled'))
      setCancelTarget(null)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  async function deleteOrder(o: ProductionOrderT) {
    setBusy(true)
    try {
      const res = await fetch(`/api/production/${o.id}`, { method: 'DELETE' })
      if (!res.ok) {
        toast.error(await errFrom(res))
        return
      }
      toast.success(t('سفارش حذف شد', 'سفارش ړنګ شو', 'Order deleted'))
      setDeleteTarget(null)
      refetch()
    } finally {
      setBusy(false)
    }
  }

  function openComplete(o: ProductionOrderT) {
    setCompleteTarget(o)
    setCProduced(String(o.quantity))
    setCWaste('0')
    setCIc('pending')
    setCIcNotes('')
  }

  async function submitComplete() {
    if (!completeTarget) return
    const produced = Number(cProduced)
    const waste = Number(cWaste) || 0
    if (!(produced > 0)) {
      toast.error(t('مقدار تولیدشده باید زیادتر از صفر باشد', 'د تولید مقدار باید له صفر څخه زیات وي', 'Produced quantity must be greater than zero'))
      return
    }
    if (waste > produced) {
      toast.error(t('ضایعات نمی‌تواند زیادتر از مقدار تولید باشد', 'ضایعات نه شي کولی له تولید مقدار څخه زیات وي', 'Waste cannot exceed produced quantity'))
      return
    }
    const goodQty = produced - waste
    setCompleting(true)
    try {
      const res = await fetch(`/api/production/${completeTarget.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ producedQty: produced, wasteQty: waste, qcStatus: cQc, qcNotes: cQcNotes }),
      })
      if (!res.ok) {
        toast.error(await errFrom(res))
        return
      }
      toast.success(
        t(
          `تکمیل شد — مواد از انبار کسر و ${fmtQty(goodQty)} ${completeTarget.product.unit} خالص به انبار علاوه شد${waste > 0 ? ` (${fmtQty(waste)} ضایعات به انبار علاوه نشد)` : ''}`,
          `بشپړ شو — مواد کم شول او ${fmtQty(goodQty)} ${completeTarget.product.unit} خالص انبار ته زیات شو${waste > 0 ? ` (${fmtQty(waste)} ضایعات انبار ته نه زیاتېدل)` : ''}`,
          `Completed — materials deducted and net ${fmtQty(goodQty)} ${completeTarget.product.unit} added to stock${waste > 0 ? ` (${fmtQty(waste)} waste not added)` : ''}`,
        ),
      )
      setCompleteTarget(null)
      refetch()
    } finally {
      setCompleting(false)
    }
  }

  // ---------- برچسب‌ها ----------
  const statusLabel = (s: string) =>
    s === 'pending' ? t('در انتظار', 'په تمه', 'Pending')
      : s === 'in_progress' ? t('در جریان', 'په جریان کې', 'In progress')
      : s === 'completed' ? t('تکمیل', 'بشپړ', 'Completed')
      : s === 'cancelled' ? t('لغو', 'لغوه', 'Cancelled') : s

  const qcLabel = (q: string | null) =>
    q === 'passed' ? t('قبول', 'منل شوی', 'Passed')
      : q === 'failed' ? t('رد', 'رد شوی', 'Failed')
      : q === 'pending' ? t('در انتظار', 'په تمه', 'Awaiting')
      : '—'

  const steps = [
    t('انتخاب محصول و فورمولا', 'د محصول او فورمول ټاکنه', 'Product & formula'),
    t('مقدار و پیش‌نمایش مواد', 'مقدار او د موادو مخکتنه', 'Quantity & materials'),
    t('تصدیق و ثبت', 'تصدیق او ثبت', 'Confirm & submit'),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('تولید', 'تولید', 'Production')}
        subtitle={t('مدیریت سفارش‌های تولید و کسر خودکار مواد از انبار', 'د تولید سفارشونو مدیریت او د انبار اتوماتیک کمښت', 'Manage production orders with automatic stock deduction')}
        icon={Factory}
        actions={
          <Button onClick={openWizard} className="gap-1.5" disabled={!products || products.length === 0 || !formulas || formulas.length === 0}>
            <Plus className="h-4 w-4" />
            {t('سفارش تولید جدید', 'نوی تولید سفارش', 'New production order')}
          </Button>
        }
      />

      {/* آمار */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title={t('کل سفارشات', 'ټول سفارشونه', 'Total orders')} value={formatNumber(stats.total)} icon={ClipboardList} tone="blue" />
        <StatCard title={t('در جریان', 'په جریان کې', 'In progress')} value={formatNumber(stats.inProgress)} icon={Loader2} tone="amber" />
        <StatCard title={t('تکمیل‌شده', 'بشپړ شوی', 'Completed')} value={formatNumber(stats.completed)} icon={CheckCircle2} tone="green" />
        <StatCard title={t('ضایعات کل', 'ټولې ضایعات', 'Total waste')} value={fmtQty(stats.waste)} icon={AlertTriangle} tone="red" />
      </div>

      {/* فیلتر */}
      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="all">{t('همه', 'ټول', 'All')}</TabsTrigger>
          <TabsTrigger value="pending">{t('در انتظار', 'په تمه', 'Pending')}</TabsTrigger>
          <TabsTrigger value="in_progress">{t('در جریان', 'په جریان کې', 'In progress')}</TabsTrigger>
          <TabsTrigger value="completed">{t('تکمیل‌شده', 'بشپړ شوی', 'Completed')}</TabsTrigger>
          <TabsTrigger value="cancelled">{t('لغوشده', 'لغوه شوی', 'Cancelled')}</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* جدول سفارش‌ها */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <LoadingBlock />
          ) : filtered.length === 0 ? (
            <EmptyState label={t('سفارش تولیدی ثبت نشده است', 'هیچ تولید سفارش ثبت شوی نه دی', 'No production orders yet')} />
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>{t('نمبر', 'شمېره', 'Number')}</TableHead>
                    <TableHead>{t('محصول', 'محصول', 'Product')}</TableHead>
                    <TableHead>{t('مقدار پلان‌شده', 'پلان شوی مقدار', 'Planned qty')}</TableHead>
                    <TableHead>{t('تولیدشده / ضایعات', 'تولید / ضایعات', 'Produced / waste')}</TableHead>
                    <TableHead>{t('مصرف کل', 'ټول لګښت', 'Total cost')}</TableHead>
                    <TableHead>{t('وضعیت', 'وضعیت', 'Status')}</TableHead>
                    <TableHead>{t('کنترل کیفیت', 'کیفیت کنټرول', 'QC')}</TableHead>
                    <TableHead>{t('تاریخ', 'نېټه', 'Date')}</TableHead>
                    <TableHead>{t('اجراؤات', 'کړنې', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((o) => (
                    <TableRow key={o.id} className={cn(o.status === 'cancelled' && 'opacity-60')}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">{o.orderNumber}</TableCell>
                      <TableCell className="font-medium max-w-40 truncate" title={o.product?.name}>{o.product?.name}</TableCell>
                      <TableCell className="whitespace-nowrap">{fmtQty(o.quantity)} {o.product?.unit}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {o.status === 'completed' ? (
                          <div className="leading-tight">
                            <div>
                              <span className="font-medium text-emerald-600 dark:text-emerald-400">{fmtQty(o.producedQty)}</span>
                              <span className="text-muted-foreground"> / </span>
                              <span className="text-red-600 dark:text-red-400">{fmtQty(o.wasteQty)}</span>
                            </div>
                            {o.wasteQty > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                {t('خالص به گدام:', 'خالص ګدام ته:', 'Net to warehouse:')} <b className="text-foreground">{fmtQty(o.producedQty - o.wasteQty)}</b>
                              </div>
                            )}
                          </div>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="font-medium whitespace-nowrap">{formatMoney(o.totalCost)}</TableCell>
                      <TableCell>
                        <Badge className={cn('border-transparent', STATUS_COLORS[o.status] ?? '')}>{statusLabel(o.status)}</Badge>
                      </TableCell>
                      <TableCell>
                        {o.qcStatus ? (
                          <Badge className={cn('border-transparent', STATUS_COLORS[o.qcStatus] ?? '')}>{qcLabel(o.qcStatus)}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{toJalaliStr(o.startDate)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 justify-start flex-wrap">
                          {o.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline" className="gap-1 h-8 text-primary hover:text-primary/90 hover:bg-primary/10" onClick={() => startOrder(o)}>
                                <Play className="h-3.5 w-3.5" />
                                {t('شروع', 'پیل', 'Start')}
                              </Button>
                              <Button size="sm" variant="ghost" className="gap-1 h-8 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20" onClick={() => setDeleteTarget(o)}>
                                <Trash2 className="h-3.5 w-3.5" />
                                {t('حذف', 'ړنګول', 'Delete')}
                              </Button>
                            </>
                          )}
                          {o.status === 'in_progress' && (
                            <>
                              <Button size="sm" className="gap-1 h-8" onClick={() => openComplete(o)}>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {t('تکمیل تولید', 'تولید بشپړول', 'Complete')}
                              </Button>
                              <Button size="sm" variant="ghost" className="gap-1 h-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20" onClick={() => setCancelTarget(o)}>
                                <Ban className="h-3.5 w-3.5" />
                                {t('لغو', 'لغوه', 'Cancel')}
                              </Button>
                            </>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                            title={t('چاپ ورک‌آردر', 'د ورک‌آردر چاپ', 'Print work order')}
                            onClick={() => setPrintTarget(o)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ================= جادوگر سفارش تولید ================= */}
      <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('سفارش تولید جدید', 'نوی تولید سفارش', 'New production order')}</DialogTitle>
          </DialogHeader>

          {/* نشانگر مراحل */}
          <div className="flex items-center justify-center py-1">
            {steps.map((label, i) => {
              const n = i + 1
              const active = n === step
              const done = n < step
              return (
                <div key={n} className="flex items-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className={cn(
                      'h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors',
                      done ? 'bg-primary border-primary text-primary-foreground'
                        : active ? 'border-primary text-primary bg-primary/10'
                        : 'border-muted-foreground/30 text-muted-foreground',
                    )}>
                      {done ? <CheckCircle2 className="h-4 w-4" /> : n}
                    </div>
                    <span className={cn('text-[11px] whitespace-nowrap', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{label}</span>
                  </div>
                  {n < 3 && <div className={cn('h-0.5 w-8 sm:w-14 mx-1 -mt-5', done ? 'bg-primary' : 'bg-muted-foreground/20')} />}
                </div>
              )
            })}
          </div>

          <Separator />

          {/* ---------- مرحله ۱ ---------- */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>{t('محصول', 'محصول', 'Product')} *</Label>
                <Select
                  value={wProductId}
                  onValueChange={(v) => { setWProductId(v); setWFormulaId('') }}
                >
                  <SelectTrigger className="w-full"><SelectValue placeholder={t('انتخاب محصول', 'د محصول ټاکنه', 'Select product')} /></SelectTrigger>
                  <SelectContent>
                    {(products ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('فورمولا', 'فورمول', 'Formula')} *</Label>
                {!wProductId ? (
                  <p className="text-sm text-muted-foreground border rounded-lg px-3 py-2.5 bg-muted/40">
                    {t('ابتدا محصول را انتخاب کنید', 'لومړی محصول وټاکه', 'Select a product first')}
                  </p>
                ) : wProductFormulas.length === 0 ? (
                  <p className="text-sm text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-lg px-3 py-2.5 bg-amber-500/10">
                    {t('برای این محصول فورمولایی ثبت نشده است', 'د دې محصول لپاره فورمول نشته', 'No formula registered for this product')}
                  </p>
                ) : (
                  <Select value={wFormulaId} onValueChange={setWFormulaId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={t('انتخاب فورمولا', 'د فورمول ټاکنه', 'Select formula')} /></SelectTrigger>
                    <SelectContent>
                      {wProductFormulas.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          v{f.version} — {f.name} {f.isActive ? '' : t('(غیرفعال)', '(غیرفعال)', '(inactive)')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              {wFormula && (
                <div className="flex items-center gap-2 text-sm rounded-lg border bg-muted/40 px-3 py-2">
                  <Boxes className="h-4 w-4 text-sky-500 shrink-0" />
                  <span className="text-muted-foreground">{t('خروجی هر بچ:', 'د هرې بچې محصول:', 'Output per batch:')}</span>
                  <span className="font-semibold">{fmtQty(wFormula.outputQty)} {wFormula.product.unit}</span>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-muted-foreground">{wFormula.items.length} {t('ماده', 'مادې', 'materials')}</span>
                </div>
              )}
            </div>
          )}

          {/* ---------- مرحله ۲ ---------- */}
          {step === 2 && wFormula && (
            <div className="space-y-4">
              <div className="flex items-end gap-3 flex-wrap">
                <div className="space-y-1.5">
                  <Label>{t('مقدار تولید (پلان)', 'د تولید مقدار (پلان)', 'Planned quantity')} *</Label>
                  <Input
                    type="number" min={0} step="any" className="w-40"
                    value={wQty} onChange={(e) => setWQty(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <p className="text-sm text-muted-foreground pb-2">
                  {t('واحد:', 'واحد:', 'Unit:')} <span className="font-medium text-foreground">{wFormula.product.unit}</span>
                </p>
              </div>

              {wQtyNum > 0 && (
                <>
                  {wInsufficient.length > 0 && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      <span>
                        <b>{t('موجودی کافی نیست', 'موجودی کافي نه ده', 'Insufficient stock')}</b>{' '}
                        — {wInsufficient.map((r) => r.name).join('، ')}.
                        {' '}{t('می‌توانید ادامه دهید ولی موجودی منفی خواهد شد.', 'ته دوام کولی شې خو موجودی منفی کېږي.', 'You can continue but stock will go negative.')}
                      </span>
                    </div>
                  )}

                  <div className="rounded-lg border overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('ماده', 'ماده', 'Material')}</TableHead>
                          <TableHead>{t('مورد نیاز', 'اړین مقدار', 'Required')}</TableHead>
                          <TableHead>{t('موجودی انبار', 'د انبار موجودی', 'In stock')}</TableHead>
                          <TableHead>{t('واحد', 'واحد', 'Unit')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {wPreview.map((r) => (
                          <TableRow key={r.id}>
                            <TableCell className="font-medium">{r.name}</TableCell>
                            <TableCell className={cn('font-mono', r.insufficient && 'text-red-600 dark:text-red-400 font-bold')}>{fmtQty(r.req)}</TableCell>
                            <TableCell className={cn('font-mono', r.insufficient && 'text-red-600 dark:text-red-400')}>
                              {fmtQty(r.stock)}
                              {r.insufficient && <AlertTriangle className="inline h-3.5 w-3.5 ms-1.5 text-red-500" />}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{r.unit}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* پیش‌نمایش مصرف */}
                  <div className="rounded-lg border bg-muted/40 px-3 py-2.5 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('مصرف مواد', 'د موادو لګښت', 'Material cost')}</span>
                      <span className="font-medium">{formatMoney(wMatCost)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('اجرت', 'مزد', 'Labor')}</span>
                      <span className="font-medium">{formatMoney(wLabor)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">{t('سربار', 'سربار', 'Overhead')}</span>
                      <span className="font-medium">{formatMoney(wOverhead)}</span>
                    </div>
                    <Separator />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">{t('مصرف کل تخمینی', 'اټکلي ټول لګښت', 'Estimated total cost')}</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatMoney(wTotal)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ---------- مرحله ۳ ---------- */}
          {step === 3 && wFormula && (
            <div className="space-y-4">
              <div className="rounded-lg border space-y-2.5 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('محصول', 'محصول', 'Product')}</span>
                  <span className="font-medium">{wFormula.product.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('فورمولا', 'فورمول', 'Formula')}</span>
                  <span className="font-medium">v{wFormula.version} — {wFormula.name}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('مقدار تولید', 'د تولید مقدار', 'Quantity')}</span>
                  <span className="font-semibold">{fmtQty(wQtyNum)} {wFormula.product.unit}</span>
                </div>
                <Separator />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('مصرف مواد', 'د موادو لګښت', 'Materials')}</span>
                  <span>{formatMoney(wMatCost)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{t('اجرت + سربار', 'مزد + سربار', 'Labor + overhead')}</span>
                  <span>{formatMoney(wLabor + wOverhead)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">{t('مصرف کل تخمینی', 'اټکلي ټول لګښت', 'Estimated total')}</span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatMoney(wTotal)}</span>
                </div>
                {wInsufficient.length > 0 && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5 pt-1">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    {t('توجه: موجودی برخی مواد کافی نیست.', 'پاملرنه: د ځینو موادو موجودی کافي نه ده.', 'Note: some materials have insufficient stock.')}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t('یادداشت', 'یادښت', 'Notes')}</Label>
                <Textarea rows={2} value={wNotes} onChange={(e) => setWNotes(e.target.value)} placeholder={t('یادداشت سفارش تولید...', 'د تولید سفارش یادښت...', 'Order notes...')} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  'پس از ثبت، سفارش «در جریان» می‌شود. مواد هنگام تکمیل تولید از انبار کسر می‌گردند.',
                  'له ثبت وروسته سفارش «په جریان کې» وي. مواد د تولید په بشپړولو سره له انبار کمېږي.',
                  'After submitting, the order becomes "In progress". Materials are deducted upon completion.',
                )}
              </p>
            </div>
          )}

          {/* دکمه‌های جادوگر */}
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              className="gap-1"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1 || submitting}
            >
              <ChevronRight className="h-4 w-4" />
              {t('قبلی', 'پخوانی', 'Back')}
            </Button>
            {step < 3 ? (
              <Button
                className="gap-1"
                onClick={() => setStep((s) => Math.min(3, s + 1))}
                disabled={(step === 1 && !wFormulaId) || (step === 2 && !(wQtyNum > 0))}
              >
                {t('بعدی', 'بل', 'Next')}
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : (
              <Button className="gap-1.5" onClick={submitWizard} disabled={submitting}>
                <CheckCircle2 className="h-4 w-4" />
                {submitting ? t('در حال ثبت...', 'په ثبت کې...', 'Submitting...') : t('ثبت سفارش تولید', 'د تولید سفارش ثبت', 'Submit order')}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= دیالوگ تکمیل تولید ================= */}
      <Dialog open={!!completeTarget} onOpenChange={(v) => !v && setCompleteTarget(null)}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('تکمیل تولید', 'تولید بشپړول', 'Complete production')}{' '}
              <span className="font-mono text-sm text-muted-foreground">{completeTarget?.orderNumber}</span>
            </DialogTitle>
          </DialogHeader>
          {completeTarget && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 text-sm rounded-lg border bg-muted/40 px-3 py-2">
                <span>{completeTarget.product.name}</span>
                <span className="text-muted-foreground">
                  {t('پلان:', 'پلان:', 'Planned:')} <b className="text-foreground">{fmtQty(completeTarget.quantity)}</b> {completeTarget.product.unit}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{t('مقدار تولید کل', 'ټول تولید شوی مقدار', 'Total produced qty')} *</Label>
                  <Input type="number" min={0} step="any" value={cProduced} onChange={(e) => setCProduced(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t('ضایعات', 'ضایعات', 'Waste qty')}</Label>
                  <Input type="number" min={0} step="any" value={cWaste} onChange={(e) => setCWaste(e.target.value)} />
                </div>
              </div>
              {/* پیش‌نمایش زنده مقدار خالص ورودی به گدام */}
              {Number(cProduced) > 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{t('به گدام علاوه می‌شود:', 'ګدام ته زیاتېږي:', 'To be added to warehouse:')}</span>
                  <span className="font-bold text-primary" dir="ltr">
                    {fmtQty(Math.max(0, Number(cProduced) - (Number(cWaste) || 0)))} {completeTarget.product.unit}
                  </span>
                </div>
              )}
              {(Number(cWaste) || 0) > Number(cProduced) && (
                <p className="text-xs font-medium text-red-600 dark:text-red-400">
                  {t('ضایعات نمی‌تواند زیادتر از مقدار تولید باشد', 'ضایعات نه شي کولی له تولید مقدار څخه زیات وي', 'Waste cannot exceed produced quantity')}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                {t(
                  'مواد معادل مقدار تولید کل کسر و فقط مقدار خالص (منهای ضایعات) به گدام علاوه می‌شود. ضایعات فقط ثبت می‌گردد.',
                  'د ټول تولید سره سم مواد کمېږي او یوازې خالص مقدار (له ضایعاتو پرته) ګدام ته زیاتېږي. ضایعات یوازې ثبت کېږي.',
                  'Materials are deducted for the total produced; only the net quantity (excluding waste) is added to stock. Waste is recorded only.',
                )}
              </p>
              <div className="space-y-1.5">
                <Label>{t('کنترل کیفیت', 'کیفیت کنټرول', 'Quality control')}</Label>
                <Select value={cQc} onValueChange={setCIc}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{t('در انتظار بررسی', 'د بررسی په تمه', 'Awaiting review')}</SelectItem>
                    <SelectItem value="passed">{t('قبول', 'منل شوی', 'Passed')}</SelectItem>
                    <SelectItem value="failed">{t('رد', 'رد شوی', 'Failed')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t('یادداشت QC', 'د QC یادښت', 'QC notes')}</Label>
                <Textarea rows={2} value={cQcNotes} onChange={(e) => setCIcNotes(e.target.value)} placeholder={t('نتیجه کنترل کیفیت...', 'د کیفیت کنټرول نتیجه...', 'QC result...')} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button onClick={submitComplete} disabled={completing} className="gap-1.5">
                  {completing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {completing ? t('در حال تکمیل...', 'په بشپړولو کې...', 'Completing...') : t('تصدیق تکمیل', 'بشپړول تصدیق', 'Confirm completion')}
                </Button>
                <Button variant="outline" onClick={() => setCompleteTarget(null)}>{t('انصراف', 'لغوه', 'Cancel')}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ---------- تصدیق لغو ---------- */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(v) => !v && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('لغو سفارش تولید', 'د تولید سفارش لغوه', 'Cancel production order?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `سفارش ${cancelTarget?.orderNumber ?? ''} لغو می‌شود و دیگر قابل تکمیل نخواهد بود.`,
                `سفارش ${cancelTarget?.orderNumber ?? ''} لغوه کېږي او بیا بشپړ نه شي.`,
                `Order ${cancelTarget?.orderNumber ?? ''} will be cancelled and can no longer be completed.`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('انصراف', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-amber-600 hover:bg-amber-700"
              onClick={(e) => { e.preventDefault(); if (cancelTarget) cancelOrder(cancelTarget) }}
            >
              {t('لغو سفارش', 'سفارش لغوه', 'Cancel order')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- تصدیق حذف ---------- */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('حذف سفارش', 'د سفارش ړنګول', 'Delete order?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                `سفارش ${deleteTarget?.orderNumber ?? ''} برای همیشه حذف می‌شود. فقط سفارش‌های در انتظار قابل حذف هستند.`,
                `سفارش ${deleteTarget?.orderNumber ?? ''} د تل لپاره ړنګېږي. یوازې په تمه سفارشونه ړنګېدلی شي.`,
                `Order ${deleteTarget?.orderNumber ?? ''} will be permanently deleted. Only pending orders can be deleted.`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('انصراف', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteOrder(deleteTarget) }}
            >
              {t('حذف', 'ړنګول', 'Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------- چاپ ورک‌آردر ---------- */}
      <WorkOrderPrintDialog
        order={printTarget}
        statusLabel={statusLabel}
        qcLabel={qcLabel}
        onClose={() => setPrintTarget(null)}
      />
    </div>
  )
}

// ================= دیالوگ چاپ ورک‌آردر تولید =================
function WorkOrderPrintDialog({
  order,
  statusLabel,
  qcLabel,
  onClose,
}: {
  order: ProductionOrderT | null
  statusLabel: (s: string) => string
  qcLabel: (q: string | null) => string
  onClose: () => void
}) {
  const { t } = useI18n()
  const o = order
  const unit = o?.product?.unit ?? ''
  const done = !!o && o.status === 'completed'

  return (
    <PrintDocDialog
      open={!!o}
      onClose={onClose}
      docType={t('ورک‌آردر تولید', 'د تولید ورک‌آردر', 'Production Work Order')}
      docTypeEn="PRODUCTION WORK ORDER"
      docNumber={o?.orderNumber}
      date={o?.startDate}
      meta={
        o
          ? [
              [
                { label: t('محصول', 'محصول', 'Product'), value: o.product?.name ?? '—' },
                { label: t('فورمولا', 'فورمول', 'Formula'), value: o.formula ? `v${o.formula.version} — ${o.formula.name}` : '—' },
                { label: t('مقدار پلان‌شده', 'پلان شوی مقدار', 'Planned qty'), value: `${fmtQty(o.quantity)} ${unit}` },
                { label: t('وضعیت', 'وضعیت', 'Status'), value: statusLabel(o.status) },
                { label: t('مقدار تولیدشده', 'تولید شوی مقدار', 'Produced qty'), value: done ? `${fmtQty(o.producedQty)} ${unit}` : '—' },
                { label: t('ضایعات', 'ضایعات', 'Waste'), value: done ? `${fmtQty(o.wasteQty)} ${unit}` : '—' },
                { label: t('کنترل کیفیت', 'کیفیت کنټرول', 'QC'), value: qcLabel(o.qcStatus) },
              ],
              [
                { label: t('مصرف مواد', 'د موادو لګښت', 'Material cost'), value: formatMoney(o.materialCost) },
                { label: t('اجرت', 'مزد', 'Labor'), value: formatMoney(o.laborCost) },
                { label: t('سربار', 'سربار', 'Overhead'), value: formatMoney(o.overheadCost) },
                { label: t('تاریخ شروع', 'د پیل نېټه', 'Start date'), value: toJalaliStr(o.startDate) },
                { label: t('تاریخ ختم', 'د پای نېټه', 'End date'), value: o.endDate ? toJalaliStr(o.endDate) : '—' },
              ],
            ]
          : []
      }
    >
      {o && (
        <>
          <DocTotals
            rows={[
              { label: t('مصرف مواد', 'د موادو لګښت', 'Material cost'), value: formatMoney(o.materialCost) },
              { label: t('اجرت', 'مزد', 'Labor'), value: formatMoney(o.laborCost) },
              { label: t('سربار', 'سربار', 'Overhead'), value: formatMoney(o.overheadCost) },
            ]}
            grandLabel={t('مصرف کل', 'ټول لګښت', 'Total cost')}
            grandValue={formatMoney(o.totalCost, 'AFN')}
          />
          <DocNotes>{o.notes}</DocNotes>
        </>
      )}
    </PrintDocDialog>
  )
}
