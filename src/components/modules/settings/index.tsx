'use client'

// ماژول تنظیمات — اطلاعات شرکت، نرخ ارز، مالیات پیش‌فرض + پشتیبان‌گیری خودکار
import { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, Building2, Coins, Percent, Save, Calendar, Languages, DatabaseBackup, Download, Trash2, RefreshCw, HardDriveDownload, Upload, RotateCcw, Wifi, WifiOff, ArrowLeftRight, Smartphone, FileJson, Server, FileDown, BookOpen, FolderOpen, ExternalLink, Database } from 'lucide-react'
import { PageHeader, LoadingBlock } from '@/components/shared/common'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
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
import { useI18n } from '@/lib/i18n'
import { formatNumber } from '@/lib/format'
import { useAppStore } from '@/lib/store'
import { useFetch } from '@/lib/hooks'
import { apiGet, apiPut, apiDelete, apiPost } from '@/lib/api'
import { clearOfflineCache } from '@/lib/offline-client'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

// ---------- اتصال برنامه دسکتاپ به هاست (Electron IPC — نسخه ۱.۰.۳ به بعد) ----------
interface DbConnInfoT {
  ok: boolean
  path: string
  active: boolean
  host: string | null
  port: string
  database: string | null
  user: string | null
}

interface DbConnApiT {
  info: () => Promise<DbConnInfoT>
  save: (payload: { host: string; port: string; database: string; user: string; password: string }) => Promise<{ ok: boolean; path?: string; maskedUrl?: string; error?: string }>
  reset: () => Promise<{ ok: boolean; path?: string; error?: string }>
  openFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
  relaunch: () => Promise<{ ok: boolean }>
}

// پاسخ GET /api/system/db-info — وضعیت واقعی اتصال دیتابیس
interface DbInfoT {
  ok: boolean
  mode: 'host-mysql' | 'local-sqlite'
  host?: string
  port?: string
  database?: string
  version?: string
  tableCount?: number
  expectedCount?: number
  missingTables?: string[]
  schemaComplete?: boolean
  error?: string
}

declare global {
  interface Window {
    dbConnection?: DbConnApiT
  }
}

interface BackupFileT {
  name: string
  size: number
  createdAt: string
}

// پاسخ API نرخ لحظه‌ای — همان ساختار src/lib/exchange-rate.ts (سرور)
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

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fa-AF')
  } catch {
    return iso
  }
}

export default function SettingsModule() {
  const { t } = useI18n()
  const lang = useAppStore((s) => s.lang)
  const setLang = useAppStore((s) => s.setLang)
  const user = useAppStore((s) => s.user)
  const { data, loading, refetch } = useFetch<Record<string, string>>('/api/settings')

  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // ---------- پشتیبان‌گیری خودکار (فقط ادمین) ----------
  const isAdmin = user?.role === 'admin'
  const backup = useFetch<{ files: BackupFileT[]; intervalHours: number; keep: number; dbType?: 'sqlite' | 'mysql' }>(isAdmin ? '/api/admin/backup' : null)
  const [bInterval, setBInterval] = useState('24')
  const [bKeep, setBKeep] = useState('10')
  const [bSaving, setBSaving] = useState(false)
  const [bCreating, setBCreating] = useState(false)
  const [bDeleting, setBDeleting] = useState<string | null>(null)

  // ---------- اتصال به هاست از داخل برنامه (فقط نسخه ویندوز جدید) ----------
  const [connApi] = useState<DbConnApiT | null>(() => (typeof window !== 'undefined' ? window.dbConnection ?? null : null))
  const [connInfo, setConnInfo] = useState<DbConnInfoT | null>(null)
  const [connForm, setConnForm] = useState({ host: '', port: '3306', database: '', user: '', password: '' })
  const [connSaving, setConnSaving] = useState(false)
  const [connResetting, setConnResetting] = useState(false)

  // ---------- وضعیت واقعی دیتابیس (کدام حالت؟ وصل است؟ جدول‌ها کامل؟) ----------
  const [dbInfo, setDbInfo] = useState<DbInfoT | null>(null)
  const [dbInfoLoading, setDbInfoLoading] = useState(false)

  async function refreshDbInfo() {
    setDbInfoLoading(true)
    try {
      setDbInfo(await apiGet<DbInfoT>('/api/system/db-info'))
    } catch {
      /* بی‌صدا — کارت وضعیت فقط اطلاع‌رسانی است */
    } finally {
      setDbInfoLoading(false)
    }
  }

  useEffect(() => {
    void refreshDbInfo()
  }, [])

  useEffect(() => {
    if (!connApi) return
    let cancelled = false
    connApi
      .info()
      .then((info) => {
        if (cancelled) return
        setConnInfo(info)
        if (info.active) {
          setConnForm((c) => ({
            ...c,
            host: info.host || '',
            port: info.port || '3306',
            database: info.database || '',
            user: info.user || '',
          }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [connApi])

  async function saveHostConnection() {
    if (!connApi) return
    if (!connForm.host.trim() || !connForm.database.trim() || !connForm.user.trim()) {
      toast.error(t('آدرس هاست، نام دیتابیس و نام کاربری الزامی است', 'د هوسټ پته، د ډاټابیس نوم او د کاروونکي نوم اړین دي', 'Host, database and username are required'))
      return
    }
    setConnSaving(true)
    try {
      const res = await connApi.save({
        host: connForm.host.trim(),
        port: connForm.port.trim() || '3306',
        database: connForm.database.trim(),
        user: connForm.user.trim(),
        password: connForm.password,
      })
      if (!res.ok) {
        throw new Error(res.error === 'MISSING_FIELDS'
          ? t('فیلدهای الزامی را کامل کنید', 'فیلدهای الزامی را کامل کنید', 'Missing required fields')
          : res.error || t('خطای نامشخص', 'ناڅرګنده ستونزه', 'Unknown error'))
      }
      toast.success(t('اتصال به هاست ذخیره شد — برنامه دوباره باز می‌شود…', 'اتصال ذخیره شو — پروګرام بیا پرانیستل کېږي…', 'Host connection saved — the app will restart…'))
      setTimeout(() => {
        void connApi.relaunch()
      }, 1500)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در ذخیره اتصال', 'د اتصال د خوندي کولو ستونزه', 'Save connection failed'))
    } finally {
      setConnSaving(false)
    }
  }

  async function resetToLocalDb() {
    if (!connApi) return
    setConnResetting(true)
    try {
      const res = await connApi.reset()
      if (!res.ok) throw new Error(res.error || 'failed')
      toast.success(t('به حالت دیتابیس محلی برگشتید — برنامه دوباره باز می‌شود…', 'ځایی حالت ته ورګرځېدل — پروګرام بیا پرانیستل کېږي…', 'Switched to local database — the app will restart…'))
      setTimeout(() => {
        void connApi.relaunch()
      }, 1500)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در تغییر حالت', 'د بدلون ستونزه', 'Switch failed'))
    } finally {
      setConnResetting(false)
    }
  }

  useEffect(() => {
    if (backup.data) {
      setBInterval(String(backup.data.intervalHours))
      setBKeep(String(backup.data.keep))
    }
  }, [backup.data])

  async function saveBackupConfig() {
    setBSaving(true)
    try {
      await apiPut('/api/admin/backup', { intervalHours: Number(bInterval) || 0, keep: Number(bKeep) || 10 })
      toast.success(t('تنظیمات پشتیبان‌گیری ذخیره شد', 'د بیک اپ امستنې خوندي شوې', 'Backup settings saved'))
      backup.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در ذخیره', 'د خوندي کولو ستونزه', 'Save failed'))
    } finally {
      setBSaving(false)
    }
  }

  async function createBackupNow() {
    setBCreating(true)
    try {
      const created = await apiPost<BackupFileT>('/api/admin/backup', {})
      toast.success(t(`نسخه پشتیبان ${created.name} ایجاد شد`, `بیک اپ ${created.name} جوړ شو`, `Backup ${created.name} created`))
      backup.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در تهیه نسخه پشتیبان', 'د بیک اپ ستونزه', 'Backup failed'))
    } finally {
      setBCreating(false)
    }
  }

  async function downloadBackupFile(name: string) {
    try {
      const res = await fetch(`/api/admin/backup?download=${encodeURIComponent(name)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || t('خطا در دانلود', 'د ښکته کولو ستونزه', 'Download failed'))
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = name
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در دانلود', 'د ښکته کولو ستونزه', 'Download failed'))
    }
  }

  async function exportJsonSnapshot() {
    try {
      const res = await fetch('/api/admin/backup?export=json')
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || t('خطا در تهیه خروجی', 'د صادرولو ستونزه', 'Export failed'))
      }
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success(
        t('خروجی JSON آماده شد — برای انتقال دیتا به هاست استفاده کنید', 'د JSON خپلوونکی چمتو شو', 'JSON export ready')
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در تهیه خروجی', 'د صادرولو ستونزه', 'Export failed'))
    }
  }

  async function removeBackupFile(name: string) {
    setBDeleting(name)
    try {
      await apiDelete(`/api/admin/backup?file=${encodeURIComponent(name)}`)
      toast.success(t('فایل پشتیبان حذف شد', 'د بیک اپ فایل له منځه ولاړ', 'Backup file deleted'))
      backup.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در حذف', 'د حذف ستونزه', 'Delete failed'))
    } finally {
      setBDeleting(null)
    }
  }

  // ---------- بازیابی (از فایل موجود یا آپلود) ----------
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null) // نام فایل پشتیبان موجود
  const [restoreFile, setRestoreFile] = useState<File | null>(null) // فایل آپلودی
  const [restoring, setRestoring] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  function pickRestoreFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null
    e.target.value = ''
    if (f) setRestoreFile(f)
  }

  async function doRestore(payload: { restore?: string; file?: File }) {
    setRestoring(true)
    try {
      let res: Response
      if (payload.file) {
        const fd = new FormData()
        fd.append('file', payload.file)
        res = await fetch('/api/admin/backup', { method: 'POST', body: fd })
      } else {
        res = await fetch('/api/admin/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ restore: payload.restore }),
        })
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string; safetyBackup?: string }
      if (!res.ok) throw new Error(body.error || t('بازیابی ناموفق بود', 'بیا رغونه ناکامې شوه', 'Restore failed'))
      toast.success(
        t(
          `بازیابی انجام شد — بکاپ امنیتی ${body.safetyBackup} گرفته شد`,
          `بیا رغونه ترسره شوه — خوندي بیک اپ ${body.safetyBackup}`,
          `Restored — safety backup ${body.safetyBackup} created`
        ),
        { duration: 6000 }
      )
      setRestoreTarget(null)
      setRestoreFile(null)
      clearOfflineCache()
      setTimeout(() => window.location.reload(), 900)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('بازیابی ناموفق بود', 'بیا رغونه ناکامې شوه', 'Restore failed'), { duration: 7000 })
    } finally {
      setRestoring(false)
    }
  }

  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  function set(key: string, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  // ---------- نرخ ارز لحظه‌ای از API واقعی ----------
  const [rateFetching, setRateFetching] = useState(false)
  const [liveInfo, setLiveInfo] = useState<LiveRatesT | null>(null)

  async function fetchLiveRates() {
    setRateFetching(true)
    try {
      const r = await apiGet<LiveRatesT>('/api/exchange-rate?refresh=1')
      setLiveInfo(r)
      setForm((f) => ({
        ...f,
        usdRate: String(r.usd),
        pkrRate: String(r.pkr),
        ratesUpdatedAt: r.updatedAt,
        ratesSource: r.source,
      }))
      if (r.stale) {
        toast.warning(
          t(
            'اینترنت در دسترس نیست — آخرین نرخ ذخیره‌شده نمایش داده می‌شود',
            'انټرنټ نه لري — وروستنی ذخیره شوې نرخ ښودل کیږي',
            'No internet — showing last stored rates'
          )
        )
      } else {
        toast.success(
          t(
            `نرخ لحظه‌ای دریافت شد: ۱ دالر = ${r.usd} افغانی`,
            `لحظه يي نرخ ترلاسه شو: ۱ ډالر = ${r.usd} افغانۍ`,
            `Live rates fetched: 1 USD = ${r.usd} AFN`
          )
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در دریافت نرخ', 'د نرخ اخیستنې ستونزه', 'Failed to fetch rates'))
    } finally {
      setRateFetching(false)
    }
  }

  async function toggleAutoSync(enabled: boolean) {
    set('ratesAutoSync', enabled ? '1' : '0')
    try {
      await apiPut('/api/settings', { ratesAutoSync: enabled ? '1' : '0' })
      toast.success(
        enabled
          ? t('بروزرسانی خودکار نرخ فعال شد', 'اتوماتیک بروز رسانی فعال شو', 'Auto rate sync enabled')
          : t('بروزرسانی خودکار نرخ غیرفعال شد — نرخ‌ها دستی مدیریت می‌شوند', 'اتوماتیک بروز رسانی بند شو — نرخونه لاسي اداره کیږي', 'Auto rate sync disabled — rates are managed manually')
      )
    } catch {
      set('ratesAutoSync', enabled ? '0' : '1')
      toast.error(t('خطا در ذخیره', 'د خوندي کولو ستونزه', 'Save failed'))
    }
  }

  async function save() {
    setSaving(true)
    try {
      await apiPut('/api/settings', {
        companyName: form.companyName ?? '',
        companyAddress: form.companyAddress ?? '',
        companyPhone: form.companyPhone ?? '',
        usdRate: form.usdRate ?? '1',
        pkrRate: form.pkrRate ?? '1',
        defaultTax: form.defaultTax ?? '2',
        ratesAutoSync: form.ratesAutoSync ?? '1',
      })
      toast.success(t('تنظیمات ذخیره شد', 'امستنې خوندي شوې', 'Settings saved'))
      refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در ذخیره', 'د خوندي کولو ستونزه', 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) return <LoadingBlock />

  const langs: { id: 'fa' | 'ps' | 'en'; label: string; note: string }[] = [
    { id: 'fa', label: 'دری', note: t('فارسی دری — پیش‌فرض', 'دری — اساس', 'Dari — default') },
    { id: 'ps', label: 'پښتو', note: t('پشتو', 'پښتو', 'Pashto') },
    { id: 'en', label: 'English', note: t('انگلیسی (چپ‌چین)', 'انګلیسي', 'English (LTR)') },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('تنظیمات سیستم', 'د سیسټم امستنې', 'System Settings')}
        subtitle={t('اطلاعات شرکت، نرخ ارز و مالیات', 'د شرکت معلومات، د اسعارو نرخ او مالیه', 'Company info, exchange rates & tax')}
        icon={SettingsIcon}
        actions={
          <Button onClick={save} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? t('در حال ذخیره...', 'خوندي کول...', 'Saving...') : t('ذخیره تغییرات', 'بدلونونه خوندي کړئ', 'Save changes')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* اطلاعات شرکت */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              {t('اطلاعات شرکت', 'د شرکت معلومات', 'Company Information')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="companyName">{t('نام شرکت', 'د شرکت نوم', 'Company name')}</Label>
              <Input id="companyName" value={form.companyName ?? ''} onChange={(e) => set('companyName', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyAddress">{t('آدرس', 'پته', 'Address')}</Label>
              <Input id="companyAddress" value={form.companyAddress ?? ''} onChange={(e) => set('companyAddress', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="companyPhone">{t('تلفن', 'ټیلیفون', 'Phone')}</Label>
              <Input id="companyPhone" dir="ltr" className="text-end" value={form.companyPhone ?? ''} onChange={(e) => set('companyPhone', e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('این اطلاعات در سربرگ فاکتورهای فروش نمایش داده می‌شود.', 'دا معلومات د پلورنې فاکتورونو سربرګ کې ښکاري.', 'Shown on sales invoice headers.')}
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* نرخ ارز */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Coins className="h-4 w-4 text-primary" />
                {t('نرخ ارز (نسبت به افغانی)', 'د اسعارو نرخ (په افغانۍ)', 'Exchange rates (vs AFN)')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* دریافت نرخ لحظه‌ای از API واقعی */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border bg-muted/30 p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {liveInfo?.stale ? (
                      <WifiOff className="h-4 w-4 shrink-0 text-amber-600" />
                    ) : (
                      <Wifi className="h-4 w-4 shrink-0 text-emerald-600" />
                    )}
                    {t('نرخ لحظه‌ای از اینترنت', 'لحظه يي نرخ له انټرنټ', 'Live rates from the internet')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {form.ratesUpdatedAt
                      ? t(
                          `آخرین بروزرسانی: ${fmtDate(form.ratesUpdatedAt)} — منبع: ${form.ratesSource || liveInfo?.source || '—'}`,
                          `وروستنی بروز رسانی: ${fmtDate(form.ratesUpdatedAt)} — سرچینه: ${form.ratesSource || liveInfo?.source || '—'}`,
                          `Last update: ${fmtDate(form.ratesUpdatedAt)} — source: ${form.ratesSource || liveInfo?.source || '—'}`
                        )
                      : t('هنوز نرخ از اینترنت دریافت نشده — دکمه را بزنید', 'تر اوسه نرخ له انټرنټ نه دی اخیستل شوی', 'No rate fetched yet — click refresh')}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchLiveRates} disabled={rateFetching} className="gap-1.5 shrink-0">
                  <RefreshCw className={`h-3.5 w-3.5 ${rateFetching ? 'animate-spin' : ''}`} />
                  {rateFetching ? t('در حال دریافت...', 'اخیستل...', 'Fetching...') : t('بروزرسانی لحظه‌ای', 'لحظه يي بروز رسانی', 'Refresh live rates')}
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="usdRate">1 USD = ? AFN</Label>
                  <Input id="usdRate" dir="ltr" type="number" min="0" step="0.01" className="text-end" value={form.usdRate ?? ''} onChange={(e) => set('usdRate', e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pkrRate">1 PKR = ? AFN</Label>
                  <Input id="pkrRate" dir="ltr" type="number" min="0" step="0.01" className="text-end" value={form.pkrRate ?? ''} onChange={(e) => set('pkrRate', e.target.value)} />
                </div>
              </div>

              {/* تبدیل سریع دالر و افغانی */}
              {Number(form.usdRate) > 0 && (
                <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg border border-dashed p-2.5">
                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p dir="ltr" className="text-start">1 USD = {formatNumber(Number(form.usdRate), 2)} AFN</p>
                    <p dir="ltr" className="text-start">1 AFN = {formatNumber(1 / Number(form.usdRate), 4)} USD</p>
                  </div>
                </div>
              )}

              {/* بروزرسانی خودکار */}
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <Label htmlFor="ratesAutoSync" className="cursor-pointer">{t('بروزرسانی خودکار نرخ‌ها', 'اتوماتیک بروز رسانی نرخونه', 'Auto-update rates')}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('نرخ‌ها هر ساعت از اینترنت گرفته و ذخیره می‌شوند؛ در قطعی اینترنت آخرین نرخ استفاده می‌شود.', 'نرخونه هر ساعت له انټرنټ اخیستل او ذخیره کیږي؛ د انټرنټ پرېکېدو کې وروستنی نرخ کارول کیږي.', 'Rates are fetched hourly and stored; last known rates are used when offline.')}
                  </p>
                </div>
                <Switch id="ratesAutoSync" checked={form.ratesAutoSync !== '0'} onCheckedChange={(v) => void toggleAutoSync(v)} />
              </div>

              <p className="text-xs text-muted-foreground">
                {t('در فروش‌های دالری و کلداری، این نرخ‌ها به‌صورت خودکار پیشنهاد می‌شود.', 'په ډالري او کلداري پلورنې کې دا نرخونه په اتوماتيک ډول وړاندیز کیږي.', 'Suggested automatically for USD/PKR sales.')}
              </p>
            </CardContent>
          </Card>

          {/* مالیات پیش‌فرض */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Percent className="h-4 w-4 text-primary" />
                {t('مالیات پیش‌فرض', 'اساسيه مالیه', 'Default tax')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="defaultTax">{t('درصد مالیات', 'د مالیې فیصده', 'Tax percent')}</Label>
                <Input id="defaultTax" dir="ltr" type="number" min="0" max="100" className="text-end" value={form.defaultTax ?? ''} onChange={(e) => set('defaultTax', e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">{t('۲٪ مالیات خدمات', '۲٪ د خدماتو مالیه', '2% services')}</Badge>
                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200">{t('۱۰٪ مالیات تماس', '۱۰٪ تماس مالیه', '10% telecom')}</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* زبان و تقویم */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Languages className="h-4 w-4 text-primary" />
            {t('زبان و تقویم', 'ژبه او تقویم', 'Language & calendar')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {langs.map((l) => (
              <button
                key={l.id}
                onClick={() => setLang(l.id)}
                className={`rounded-xl border p-3 text-start transition-colors ${
                  lang === l.id ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                }`}
              >
                <p className="font-bold text-sm">{l.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{l.note}</p>
              </button>
            ))}
          </div>
          <Separator />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {t('تقویم سیستم شمسی (هجری شمسی) است و در همه گزارش‌ها و فاکتورها استفاده می‌شود؛ تاریخ میلادی نیز در دسترس است.', 'د سیسټم تقویم هجري شمسي دی او په ټولو راپورونو کې کارول کیږي؛ میلادي نېټه هم شتون لري.', 'System uses the Shamsi (Jalali) calendar everywhere; Gregorian is also available.')}
          </div>
        </CardContent>
      </Card>

      {/* نسخه اندروید */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="h-4 w-4 text-primary" />
            {t('نسخه اندروید (APK)', 'د اندروید نسخه (APK)', 'Android app (APK)')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="text-sm text-muted-foreground flex-1">
              {t(
                'برای نصب روی گوشی، فایل APK را دانلود کنید. کارکنان می‌توانند با باز کردن همین آدرس در مرورگر گوشی (همان شبکه وای‌فای) فایل را دانلود و نصب کنند.',
                'د په ټیلیفون نصبولو لپاره APK فایل ښکته کړئ. کارکوونکي کولی شي په ورته پته د ټیلیفون په براوزر کې فایل ښکته او نصب کړي.',
                'Download the APK to install on phones. Staff can open the same address in their phone browser (same Wi-Fi) to download and install.'
              )}
            </p>
            <a href="/mfg-erp.apk" download className="shrink-0">
              <Button className="gap-2 w-full sm:w-auto">
                <Download className="h-4 w-4" />
                {t('دانلود فایل APK', 'APK فایل ښکته کړئ', 'Download APK')}
              </Button>
            </a>
          </div>
          <p className="text-xs text-muted-foreground" dir="ltr" >
            http://&lt;server-ip&gt;:3000/mfg-erp.apk
          </p>
        </CardContent>
      </Card>

      {/* پشتیبان‌گیری — فقط ادمین */}
      {isAdmin && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseBackup className="h-4 w-4 text-primary" />
              {t('پشتیبان‌گیری خودکار و دستی', 'اتوماتیک او لاسي بیک اپ', 'Automatic & manual backup')}
              <Badge variant="outline" className="ms-2">{t('مخصوص ادمین', 'ځانګړی ادمین', 'Admin only')}</Badge>
              {backup.data?.dbType === 'mysql' ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
                  {t('ذخیره‌سازی: هاست MySQL', 'ساتنه: MySQL هوسټ', 'Storage: MySQL host')}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {t('ذخیره‌سازی: SQLite محلی', 'ساتنه: ځایی SQLite', 'Storage: local SQLite')}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* فایل‌های هاست اشتراکی — ذخیره دیتا در MySQL هاست */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
              <Server className="h-4 w-4 shrink-0 text-amber-600" />
              <p className="flex-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
                {t(
                  'برای ذخیره دیتا در هاست اشتراکی: فایل SQL را در phpMyAdmin هاست ایمپورت کنید، سپس طبق راهنما برنامه را به دیتابیس هاست وصل کرده و بکاپ JSON را بازیابی کنید.',
                  'د ډاټا د هوسټ کې ساتلو لپاره: د SQL فایل په phpMyAdmin کې داخل کړئ، بیا د لارښود له مخې پروګرام وصل او بیک اپ بیا رغوئ.',
                  'To store data on your shared host: import the SQL file in phpMyAdmin, then connect the app to the host database and restore the JSON backup.'
                )}
              </p>
              <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5 border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40">
                <a href="/mysql-schema.sql" download>
                  <FileDown className="h-3.5 w-3.5" />
                  {t('فایل SQL هاست', 'د SQL فایل', 'Host SQL file')}
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="shrink-0 gap-1.5 border-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40">
                <a href="/hosting-guide.md" download>
                  <BookOpen className="h-3.5 w-3.5" />
                  {t('راهنمای گام‌به‌گام', 'ګام په ګام لارښود', 'Step-by-step guide')}
                </a>
              </Button>
            </div>

            {/* تنظیمات خودکار */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="bInterval">{t('فاصله پشتیبان‌گیری خودکار', 'د اتوماتیک بیک اپ فاصله', 'Auto-backup interval')}</Label>
                <select
                  id="bInterval"
                  value={bInterval}
                  onChange={(e) => setBInterval(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="0">{t('غیرفعال', 'ناروښان', 'Disabled')}</option>
                  <option value="1">{t('هر ۱ ساعت', 'هر ۱ ساعت', 'Every hour')}</option>
                  <option value="6">{t('هر ۶ ساعت', 'هر ۶ ساعته', 'Every 6 hours')}</option>
                  <option value="12">{t('هر ۱۲ ساعت', 'هر ۱۲ ساعته', 'Every 12 hours')}</option>
                  <option value="24">{t('روزانه', 'ورځنی', 'Daily')}</option>
                  <option value="168">{t('هفتگی', 'اونیز', 'Weekly')}</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bKeep">{t('تعداد نگهداری', 'د ساتنې شمېر', 'Versions to keep')}</Label>
                <Input id="bKeep" dir="ltr" type="number" min="1" max="100" className="text-end" value={bKeep} onChange={(e) => setBKeep(e.target.value)} />
              </div>
              <Button onClick={saveBackupConfig} disabled={bSaving} variant="secondary" className="gap-2">
                <Save className="h-4 w-4" />
                {bSaving ? t('در حال ذخیره...', 'خوندي کول...', 'Saving...') : t('ذخیره تنظیمات', 'امستنې خوندي کړئ', 'Save settings')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                'سیستم به‌صورت خودکار در فواصل انتخابی از کل دیتابیس نسخه پشتیبان می‌گیرد و نسخه‌های قدیمی‌تر را خودکار حذف می‌کند. فایل‌ها کنار دیتابیس در پوشه backups نگهداری می‌شوند.',
                'سیسټم په ټاکل شوو فاصلو کې له ټولې ډاټابیس څخه اتوماتیک بیک اپ اخلي او زړې نسخې اتوماتیک حذفوي.',
                'The system automatically backs up the whole database at the chosen interval and prunes old versions. Files are stored in the backups folder next to the database.'
              )}
            </p>

            <Separator />

            {/* فهرست نسخه‌های پشتیبان */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="text-sm text-muted-foreground flex-1">
                {t(
                  `${(backup.data?.files.length ?? 0)} نسخه پشتیبان ذخیره شده است. برای انتقال به کامپیوتر دیگر، فایل را دانلود کنید.`,
                  `${(backup.data?.files.length ?? 0)} بیک اپ فایلونه ساتل شوي دي.`,
                  `${(backup.data?.files.length ?? 0)} backup files stored. Download to move to another computer.`
                )}
              </p>
              <div className="flex gap-2 shrink-0">
                <Button onClick={backup.refetch} variant="outline" size="sm" className="gap-1.5" aria-label="refresh">
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button onClick={() => uploadInputRef.current?.click()} variant="outline" size="sm" className="gap-2">
                  <Upload className="h-4 w-4" />
                  {t('آپلود و بازیابی', 'پورته کول او بیا رغونه', 'Upload & restore')}
                </Button>
                <Button onClick={exportJsonSnapshot} variant="outline" size="sm" className="gap-2">
                  <FileJson className="h-4 w-4" />
                  {t('خروجی JSON (انتقال به هاست)', 'د JSON صادرول (هوسټ ته لېږد)', 'JSON export (host migration)')}
                </Button>
                <Button onClick={createBackupNow} disabled={bCreating} size="sm" className="gap-2">
                  <HardDriveDownload className="h-4 w-4" />
                  {bCreating ? t('در حال تهیه...', 'چمتو کول...', 'Creating...') : t('پشتیبان بگیر', 'بیک اپ واخله', 'Backup now')}
                </Button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border">
              {backup.loading && !backup.data ? (
                <p className="p-4 text-sm text-muted-foreground text-center">{t('در حال بارگذاری...', 'بارول...', 'Loading...')}</p>
              ) : (backup.data?.files.length ?? 0) === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">
                  {t('هنوز نسخه پشتیبانی وجود ندارد', 'تر اوسه بیک اپ نشته', 'No backups yet')}
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-start px-3 py-2 font-medium">{t('فایل', 'فایل', 'File')}</th>
                      <th className="text-start px-3 py-2 font-medium">{t('حجم', 'اندازه', 'Size')}</th>
                      <th className="text-start px-3 py-2 font-medium">{t('تاریخ', 'نېټه', 'Date')}</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(backup.data?.files ?? []).map((f) => (
                      <tr key={f.name} className="border-t">
                        <td className="px-3 py-2 font-mono text-xs rtl:text-right" dir="ltr">{f.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtSize(f.size)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{fmtDate(f.createdAt)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 justify-start">
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-amber-600 hover:text-amber-600" onClick={() => setRestoreTarget(f.name)} disabled={restoring}>
                              <RotateCcw className="h-3.5 w-3.5" />
                              {t('بازیابی', 'بیا رغونه', 'Restore')}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => downloadBackupFile(f.name)}>
                              <Download className="h-3.5 w-3.5" />
                              {t('دانلود', 'ښکته کړئ', 'Download')}
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => removeBackupFile(f.name)} disabled={bDeleting === f.name} aria-label={t('حذف', 'حذف', 'Delete')}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              {t('توصیه: فایل پشتیبان را به‌صورت دوره‌ای دانلود و در فلش یا محل امن نگه‌داری کنید.', 'مشوره: د بیک اپ فایل په دوره يي ډول ښکته کړئ او په خوندي ځای کې یې وساتئ.', 'Tip: periodically download a backup file and keep it on a USB drive or safe location.')}
            </p>

            {/* اینپوت مخفی آپلود بکاپ */}
            <input ref={uploadInputRef} type="file" accept=".db,.sqlite,.sqlite3" className="hidden" onChange={pickRestoreFile} />

            {/* تأیید بازیابی — از فایل موجود یا آپلودی */}
            <AlertDialog open={!!restoreTarget || !!restoreFile} onOpenChange={(o) => { if (!o && !restoring) { setRestoreTarget(null); setRestoreFile(null) } }}>
              <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-destructive" />
                    {t('بازیابی نسخه پشتیبان', 'بیک اپ بیا رغونه', 'Restore backup')}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2 text-sm">
                    <span className="block">
                      {restoreFile ? (
                        <>
                          {t('فایل انتخاب‌شده', 'غوره شوی فایل', 'Selected file')}:{' '}
                          <b dir="ltr">{restoreFile.name}</b>
                        </>
                      ) : (
                        <>
                          {t('بازیابی از فایل', 'له فایل څخه بیا رغونه', 'Restore from file')}:{' '}
                          <b dir="ltr">{restoreTarget}</b>
                        </>
                      )}
                    </span>
                    <span className="block font-medium text-destructive">
                      {t('تمام دیتای فعلی با محتوای این فایل جایگزین می‌شود!', 'ټول اوسني معلومات د دې فایل سره بدلېږي!', 'All current data will be replaced with this file!')}
                    </span>
                    <span className="block text-muted-foreground">
                      {t('قبل از بازیابی، به‌صورت خودکار از دیتای فعلی یک بکاپ امنیتی گرفته می‌شود.', 'له بیا رغونې دمخه له اوسني معلوماتو اتوماتیک خوندي بیک اپ اخیستل کېږي.', 'A safety backup of current data is created automatically first.')}
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={restoring}>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault()
                      if (restoreFile) void doRestore({ file: restoreFile })
                      else if (restoreTarget) void doRestore({ restore: restoreTarget })
                    }}
                    disabled={restoring}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {restoring ? t('در حال بازیابی…', 'په بیا رغولو…', 'Restoring…') : t('بازیابی و تعویض دیتا', 'بیا رغونه او بدلون', 'Restore & replace data')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}

      {/* اتصال برنامه به هاست اشتراکی — بدون جستجوی دستی فایل db-connection.txt */}
      {isAdmin && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-primary" />
              {t('اتصال برنامه به هاست (ذخیره دیتا در MySQL)', 'پروګرام له هوسټ سره نښلول (د ډاټا ساتل په MySQL کې)', 'Connect app to host (store data in MySQL)')}
              {connInfo?.active ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">{t('متصل به هاست', 'له هوسټ سره نښلول شوی', 'Connected to host')}</Badge>
              ) : (
                <Badge variant="secondary">{t('دیتابیس محلی', 'ځایی ډاټابیس', 'Local database')}</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* وضعیت واقعی اتصال — پاسخ مستقیم از دیتابیس، نه فقط فایل تنظیمات */}
            <div
              className={
                'rounded-lg border p-3 text-xs leading-6 ' +
                (dbInfoLoading
                  ? 'border-border bg-muted/40 text-muted-foreground'
                  : dbInfo?.ok && dbInfo.mode === 'host-mysql' && dbInfo.schemaComplete
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
                    : dbInfo?.ok && dbInfo.mode === 'host-mysql' && !dbInfo.schemaComplete
                      ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                      : dbInfo && !dbInfo.ok && dbInfo.mode === 'host-mysql'
                        ? 'border-destructive/40 bg-destructive/10 text-destructive'
                        : 'border-border bg-muted/40 text-muted-foreground')
              }
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold">
                  <Database className="h-3.5 w-3.5" />
                  {t('وضعیت فعلی دیتابیس', 'د ډاټابیس اوسنی حالت', 'Current database status')}
                </span>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2" onClick={() => { void refreshDbInfo() }} disabled={dbInfoLoading}>
                  <RefreshCw className={'h-3 w-3' + (dbInfoLoading ? ' animate-spin' : '')} />
                  {t('بررسی مجدد', 'بیا ازمویل', 'Re-check')}
                </Button>
              </div>
              {dbInfoLoading ? (
                <p>{t('در حال بررسی اتصال…', 'د نښلولو ازمویل…', 'Checking connection…')}</p>
              ) : dbInfo ? (
                <div className="mt-1 space-y-1">
                  {dbInfo.mode === 'host-mysql' ? (
                    dbInfo.ok && dbInfo.schemaComplete ? (
                      <p>
                        ✅ {t('برنامه واقعاً به هاست وصل است و ذخیرهٔ داده فعال است.', 'پروګرام رښتیا له هوسټ سره نښلی او خوندي کول فعال دي.', 'The app is genuinely connected to the host and saving works.')}
                        {' — '}<span dir="ltr" className="font-mono">MySQL {dbInfo.version || '?'} · {dbInfo.host}{dbInfo.port ? `:${dbInfo.port}` : ''} · {dbInfo.database}</span>
                        {' — '}{t(`جدول‌ها: ${dbInfo.tableCount ?? 0}/${dbInfo.expectedCount ?? 19}`, `جدولونه: ${dbInfo.tableCount ?? 0}/${dbInfo.expectedCount ?? 19}`, `Tables: ${dbInfo.tableCount ?? 0}/${dbInfo.expectedCount ?? 19}`)}
                      </p>
                    ) : dbInfo.ok && !dbInfo.schemaComplete ? (
                      <div>
                        <p>
                          ⚠️ {t(
                            `اتصال به هاست برقرار است ولی جدول‌ها کامل نیست (${dbInfo.tableCount ?? 0} از ${dbInfo.expectedCount ?? 19}) — تا زمانی که همهٔ جدول‌ها ساخته نشوند، ذخیرهٔ داده کار نمی‌کند.`,
                            `له هوسټ سره نښلون برقرار دی خو جدولونه بشپړ نه دي (${dbInfo.tableCount ?? 0} له ${dbInfo.expectedCount ?? 19}) — تر هغه چې ټول جدولونه جوړ نشي، خوندي کول کار نه کوي.`,
                            `Host reachable but tables are incomplete (${dbInfo.tableCount ?? 0} of ${dbInfo.expectedCount ?? 19}) — saving will not work until all tables exist.`
                          )}
                        </p>
                        <p className="mt-1">
                          {t('جدول‌های گمشده:', 'ورک جدولونه:', 'Missing tables:')} <span dir="ltr" className="font-mono">{(dbInfo.missingTables || []).join(', ')}</span>
                        </p>
                        <p className="mt-1">
                          {t('راه‌حل: فایل SQL هاست (دکمه «دانلود فایل SQL هاست» در بخش پشتیبان‌گیری) را در phpMyAdmin هاست ایمپورت کنید.', 'حل: د SQL هوسټ فایل په phpMyAdmin کې وارد کړئ.', 'Fix: import the host SQL file (backup section) in your hosting phpMyAdmin.')}
                        </p>
                      </div>
                    ) : (
                      <p>
                        ❌ {t('اتصال به هاست برقرار نمی‌شود:', 'له هوسټ سره نښلون نه کېږي:', 'Cannot reach the host:')}
                        {' '}<span dir="ltr" className="font-mono">{dbInfo.error || 'unknown error'}</span>
                        <br />
                        {t('بررسی کنید: Remote MySQL فعال باشد، پورت 3306 باز باشد و اطلاعات دیتابیس درست وارد شده باشد.', 'وګورئ: Remote MySQL فعال وي، بورډ 3306 خلاص وي او معلومات سم وي.', 'Check: Remote MySQL enabled, port 3306 open, credentials correct.')}
                      </p>
                    )
                  ) : (
                    <p>
                      {t('حالت محلی (SQLite) — دیتا فقط در همین دستگاه ذخیره می‌شود. برای ذخیره در هاست، اطلاعات بالا را پر و ذخیره کنید.', 'ځایی حالت (SQLite) — ډاټا یوازې په همدې ماشین کې خوندي کېږي.', 'Local mode (SQLite) — data is stored only on this device. Fill the form below to store data on your host.')}
                      {dbInfo.ok && dbInfo.tableCount != null ? ` (${t(`${dbInfo.tableCount} جدول`, `${dbInfo.tableCount} جدولونه`, `${dbInfo.tableCount} tables`)})` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p>{t('وضعیت نامشخص — دکمه «بررسی مجدد» را بزنید.', 'حالت نامعلوم — «بیا ازمویل» کلیک کړئ.', 'Status unknown — press Re-check.')}</p>
              )}
            </div>
            {connApi ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'نیازی به جستجوی فایل تنظیمات نیست — اطلاعات هاست خود را همین‌جا وارد کنید؛ برنامه فایل db-connection.txt را خودکار می‌نویسد و دوباره باز می‌شود.',
                    'له فایل پلټنې ته اړتیا نشته — د هوسټ معلومات دلته داخل کړئ؛ پروګرام فایل اتوماتیک لیکي او بیا پرانیستل کېږي.',
                    'No need to hunt for the config file — enter your host details here; the app writes db-connection.txt automatically and restarts.'
                  )}
                </p>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {t(
                    'مهم: دیتای محلی به‌صورت خودکار به هاست منتقل نمی‌شود. اول دکمه «خروجی JSON (انتقال به هاست)» را بزنید، بعد اینجا وصل شوید و در بخش پشتیبان‌گیری همان فایل را بازیابی کنید.',
                    'مهم: ځایی ډاټا اتوماتیک هوسټ ته نه لېږدول کېږي. لومړی «د JSON صادرول» کلیک کړئ، بیا دلته وصل شئ او هماغه فایل بیا رغوئ.',
                    'Important: local data is not moved automatically. First export the JSON backup, connect here, then restore that file from the backup section.'
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="hHost">{t('آدرس هاست', 'د هوسټ پته', 'Host address')}</Label>
                    <Input id="hHost" dir="ltr" placeholder="yourdomain.com" autoComplete="off" value={connForm.host} onChange={(e) => setConnForm({ ...connForm, host: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hPort">{t('پورت (معمولاً 3306)', 'بورډ (معمولاً 3306)', 'Port (usually 3306)')}</Label>
                    <Input id="hPort" dir="ltr" inputMode="numeric" placeholder="3306" value={connForm.port} onChange={(e) => setConnForm({ ...connForm, port: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hDb">{t('نام دیتابیس', 'د ډاټابیس نوم', 'Database name')}</Label>
                    <Input id="hDb" dir="ltr" placeholder="cpuser_erp" autoComplete="off" value={connForm.database} onChange={(e) => setConnForm({ ...connForm, database: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="hUser">{t('نام کاربری دیتابیس', 'د ډاټابیس کاروونکی', 'Database username')}</Label>
                    <Input id="hUser" dir="ltr" placeholder="cpuser_erp" autoComplete="off" value={connForm.user} onChange={(e) => setConnForm({ ...connForm, user: e.target.value })} />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="hPass">{t('رمز دیتابیس', 'د ډاټابیس پاسورد', 'Database password')}</Label>
                    <Input id="hPass" dir="ltr" type="password" autoComplete="new-password" value={connForm.password} onChange={(e) => setConnForm({ ...connForm, password: e.target.value })} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveHostConnection} disabled={connSaving} className="gap-2">
                    <Save className="h-4 w-4" />
                    {connSaving ? t('در حال ذخیره…', 'خوندي کول…', 'Saving…') : t('ذخیره و اتصال به هاست', 'خوندي او نښلول', 'Save & connect to host')}
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => { void connApi.openFolder() }}>
                    <FolderOpen className="h-4 w-4" />
                    {t('باز کردن پوشه تنظیمات', 'د امستنې فولډر پرانیستل', 'Open settings folder')}
                  </Button>
                  {connInfo?.active && (
                    <Button variant="ghost" className="gap-2 text-destructive hover:text-destructive" onClick={resetToLocalDb} disabled={connResetting}>
                      <RotateCcw className="h-4 w-4" />
                      {connResetting ? t('در حال تغییر…', 'په بدلون…', 'Switching…') : t('بازگشت به دیتابیس محلی', 'ځایی ډاټابیس ته بیرته‌ګرځېدل', 'Back to local database')}
                    </Button>
                  )}
                </div>
                {connInfo?.path && (
                  <p className="text-xs text-muted-foreground break-all" dir="ltr">
                    {t('فایل تنظیمات:', 'د امستنې فایل:', 'Config file:')} <span className="font-mono">{connInfo.path}</span>
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {t(
                    'توجه: در cPanel هاست باید Remote MySQL فعال باشد (IP دستگاه یا علامت % اضافه شده باشد). اگر بعد از ذخیره برنامه وصل نشد، پورت 3306 ممکن است در هاست شما بسته باشد — از پشتیبانی هاست بپرسید.',
                    'پاملرنه: په cPanel کې باید Remote MySQL فعال وي. که وصل نشو، بورډ 3306 به تړلی وي — له هوسټ ملاتړ پوښتنه وکړئ.',
                    'Note: Remote MySQL must be enabled in cPanel (add your IP or %). If the app cannot connect afterwards, port 3306 may be blocked — ask your hosting support.'
                  )}
                </p>
              </>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'این بخش فقط در نسخه ویندوز (اپلیکیشن دسکتاپ) فعال است. روش دستی پیدا کردن فایل db-connection.txt:',
                    'دا برخه یوازې په د وینډوز نسخه کې فعال دی. لاسي لار:',
                    'This section only works in the Windows desktop app. Manual way to find db-connection.txt:'
                  )}
                </p>
                <ol className="list-decimal ms-5 space-y-1.5 text-sm">
                  <li>
                    {t('کلیدهای', 'تڼۍ', 'Press')} <b dir="ltr">Win + R</b> {t('را فشار دهید و تایپ کنید:', 'وګړئ او ولیکئ:', 'and type:')}&nbsp;
                    <span dir="ltr" className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">%APPDATA%\ManufacturingERP</span>
                  </li>
                  <li>{t('فایل db-connection.txt را با Notepad باز کنید و طبق راهنمای داخل آن، خط mysql:// را ویرایش کنید.', 'د db-connection.txt فایل په Notepad کې پرانیزئ او د mysql:// کرښه سم کړئ.', 'Open db-connection.txt in Notepad and edit the mysql:// line as guided inside.')}</li>
                  <li>{t('اگر فایل وجود ندارد یعنی نسخه برنامه شما قدیمی است — نسخه جدید را دانلود و نصب کنید.', 'که فایل نشته، نو ستاسو نسخه زړه ده — نوی نسخه ښکته او نصب کړئ.', 'If the file does not exist, your app version is old — download and install the latest release.')}</li>
                </ol>
                <a href="https://github.com/M-1-hashim/manufacturing-management-system/releases/latest" target="_blank" rel="noreferrer" className="inline-block">
                  <Button variant="outline" className="gap-2">
                    <ExternalLink className="h-4 w-4" />
                    {t('دانلود آخرین نسخه ویندوز (تنظیمات آسان)', 'تر ټولو نوی وینډوز نسخه (اسانه امستنې)', 'Download latest Windows version (easy setup)')}
                  </Button>
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
