'use client'

// ماژول تنظیمات — اطلاعات شرکت، نرخ ارز، مالیات پیش‌فرض + پشتیبان‌گیری خودکار
import { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, Building2, Coins, Percent, Save, Calendar, Languages, DatabaseBackup, Download, Trash2, RefreshCw, HardDriveDownload, Upload, RotateCcw } from 'lucide-react'
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
import { useAppStore } from '@/lib/store'
import { useFetch } from '@/lib/hooks'
import { apiPut, apiDelete, apiPost } from '@/lib/api'
import { clearOfflineCache } from '@/lib/offline-client'
import { toast } from 'sonner'

interface BackupFileT {
  name: string
  size: number
  createdAt: string
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
  const backup = useFetch<{ files: BackupFileT[]; intervalHours: number; keep: number }>(isAdmin ? '/api/admin/backup' : null)
  const [bInterval, setBInterval] = useState('24')
  const [bKeep, setBKeep] = useState('10')
  const [bSaving, setBSaving] = useState(false)
  const [bCreating, setBCreating] = useState(false)
  const [bDeleting, setBDeleting] = useState<string | null>(null)

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

      {/* پشتیبان‌گیری — فقط ادمین */}
      {isAdmin && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseBackup className="h-4 w-4 text-primary" />
              {t('پشتیبان‌گیری خودکار و دستی', 'اتوماتیک او لاسي بیک اپ', 'Automatic & manual backup')}
              <Badge variant="outline" className="ms-2">{t('مخصوص ادمین', 'ځانګړی ادمین', 'Admin only')}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
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
    </div>
  )
}
