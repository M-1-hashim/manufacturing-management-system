'use client'

/**
 * منوی سریع کاپی احتیاطی در هدر — فقط برای مدیر سیستم (ادمین)
 * کاپی احتیاطی فوری / آپلود فایل کاپی احتیاطی و بازیابی / تنظیمات کاپی احتیاطی
 */
import { useRef, useState } from 'react'
import { useAppStore } from '@/lib/store'
import { useI18n } from '@/lib/i18n'
import { apiPost } from '@/lib/api'
import { LOCAL_MODE } from '@/lib/local-api'
import { clearOfflineCache } from '@/lib/offline-client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { DatabaseBackup, Download, Loader2, RotateCcw, Settings, Upload } from 'lucide-react'

interface BackupMenuProps {
  onGoSettings: () => void
}

export default function BackupMenu({ onGoSettings }: BackupMenuProps) {
  const { t } = useI18n()
  const user = useAppStore((s) => s.user)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [creating, setCreating] = useState(false)

  if (user?.role !== 'admin') return null

  // ---------- کاپی احتیاطی فوری ----------
  async function backupNow() {
    setCreating(true)
    try {
      const created = await apiPost<{ name: string }>('/api/admin/backup', {})
      toast.success(
        t(`کاپی احتیاطی ${created.name} ایجاد شد`, `بیک اپ ${created.name} جوړ شو`, `Backup ${created.name} created`)
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در تهیه کاپی احتیاطی', 'د بیک اپ ستونزه', 'Backup failed'))
    } finally {
      setCreating(false)
    }
  }

  // ---------- انتخاب فایل برای آپلود ----------
  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null
    e.target.value = '' // انتخاب دوباره همان فایل هم کار کند
    if (!f) return
    if (LOCAL_MODE) {
      // حالت محلی — بازیابی از خروجی JSON (فایل دیتابیس SQLite معنا ندارد)
      if (!f.name.toLowerCase().endsWith('.json')) {
        toast.error(
          t('فقط فایل کاپی احتیاطی (.json) قابل بازیابی است', 'یوازې د بیک اپ فایل (.json) بیا راغول کېدای شي', 'Only a backup file (.json) can be restored')
        )
        return
      }
    } else if (
      !f.name.toLowerCase().endsWith('.db') &&
      !f.name.toLowerCase().endsWith('.sqlite') &&
      !f.name.toLowerCase().endsWith('.sqlite3')
    ) {
      toast.error(t('فقط فایل کاپی احتیاطی (.db) قابل بازیابی است', 'یوازې د بیک اپ فایل (.db) بیا راغول کېدای شي', 'Only a backup file (.db) can be restored'))
      return
    }
    setPendingFile(f)
  }

  // ---------- آپلود و بازیابی ----------
  // حالت محلی: فایل JSON → FileReader → POST {import} (موتور محلی multipart نمی‌گیرد)
  // هاست: XHR با FormData — از لایهٔ آفلاین عبور می‌کند + درصد پیشرفت
  function uploadAndRestore() {
    if (!pendingFile || uploading) return
    setUploading(true)
    setProgress(0)

    if (LOCAL_MODE) {
      const reader = new FileReader()
      reader.onload = () => {
        let parsed: unknown
        try {
          parsed = JSON.parse(String(reader.result ?? ''))
        } catch {
          setUploading(false)
          toast.error(
            t('فایل JSON قابل خواندن نیست', 'د JSON فایل نه لوستل کېږي', 'File is not readable JSON'),
            { duration: 7000 }
          )
          return
        }
        setProgress(100)
        apiPost<{ safetyBackup?: string }>('/api/admin/backup', { import: parsed })
          .then((body) => {
            setPendingFile(null)
            toast.success(
              t(
                `بازیابی انجام شد — کاپی احتیاطی ${body.safetyBackup} گرفته شد`,
                `بیا رغونه ترسره شوه — خوندي بیک اپ ${body.safetyBackup}`,
                `Restored — safety backup ${body.safetyBackup} created`
              ),
              { duration: 6000 }
            )
            clearOfflineCache()
            setTimeout(() => window.location.reload(), 900)
          })
          .catch((err) => {
            toast.error(
              err instanceof Error ? err.message : t('بازیابی ناموفق بود', 'بیا رغونه ناکامې شوه', 'Restore failed'),
              { duration: 7000 }
            )
          })
          .finally(() => setUploading(false))
      }
      reader.onerror = () => {
        setUploading(false)
        toast.error(t('خواندن فایل ناموفق بود', 'لوستل د فایل ناکام شو', 'Could not read the file'))
      }
      reader.readAsText(pendingFile)
      return
    }

    const form = new FormData()
    form.append('file', pendingFile)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/admin/backup')
    xhr.responseType = 'json'
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100))
    }
    xhr.onload = () => {
      setUploading(false)
      const body = (xhr.response || {}) as { error?: string; safetyBackup?: string }
      if (xhr.status === 200) {
        setPendingFile(null)
        toast.success(
          t(
            `بازیابی انجام شد — کاپی احتیاطی ${body.safetyBackup} گرفته شد`,
            `بیا رغونه ترسره شوه — خوندي بیک اپ ${body.safetyBackup}`,
            `Restored — safety backup ${body.safetyBackup} created`
          ),
          { duration: 6000 }
        )
        clearOfflineCache()
        setTimeout(() => window.location.reload(), 900)
      } else {
        toast.error(
          body.error ||
            t('بازیابی ناموفق بود', 'بیا رغونه ناکامې شوه', 'Restore failed'),
          { duration: 7000 }
        )
      }
    }
    xhr.onerror = () => {
      setUploading(false)
      toast.error(t('خطای شبکه در آپلود', 'د پورته کولو کې د شبکې ستونزه', 'Network error during upload'))
    }
    xhr.send(form)
  }

  const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`)

  return (
    <>
      <input ref={fileInputRef} type="file" accept={LOCAL_MODE ? '.json' : '.db,.sqlite,.sqlite3'} className="hidden" onChange={handleFilePicked} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            disabled={creating}
            aria-label={t('کاپی احتیاطی', 'بیک اپ', 'Backup')}
            title={t('کاپی احتیاطی و بازیابی', 'بیک اپ او بیا رغونه', 'Backup & restore')}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {t('کاپی احتیاطی دیتابیس', 'د ډاټابیس بیک اپ', 'Database backup')}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void backupNow()} disabled={creating}>
            <Download className="h-4 w-4" />
            {creating
              ? t('در حال تهیه نسخه…', 'په جوړولو…', 'Creating backup…')
              : t('کاپی احتیاطی فوری', 'سمدستي بیک اپ', 'Backup now')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            {t('آپلود کاپی احتیاطی و بازیابی', 'بیک اپ پورته او بیا رغونه', 'Upload backup & restore')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onGoSettings}>
            <Settings className="h-4 w-4" />
            {t('مدیریت و دانلود کاپی احتیاطی‌ها', 'د بیک اپونو مدیریت', 'Manage & download backups')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* تصدیق بازیابی — اجراؤات مخرب */}
      <AlertDialog open={!!pendingFile} onOpenChange={(o) => !o && !uploading && setPendingFile(null)}>
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-4 w-4 text-destructive" />
              {t('بازیابی کاپی احتیاطی', 'بیک اپ بیا رغونه', 'Restore backup')}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm">
              <span className="block">
                {t('فایل انتخاب‌شده', 'غوره شوی فایل', 'Selected file')}:{' '}
                <b dir="ltr">{pendingFile?.name}</b> ({pendingFile ? fmtSize(pendingFile.size) : ''})
              </span>
              <span className="block font-medium text-destructive">
                {t(
                  'تمام دیتای فعلی با محتوای این فایل جایگزین می‌شود!',
                  'ټول اوسني معلومات د دې فایل سره بدلېږي!',
                  'All current data will be replaced with this file!'
                )}
              </span>
              <span className="block text-muted-foreground">
                {t(
                  'قبل از بازیابی، به‌صورت خودکار از دیتای فعلی یک کاپی احتیاطی گرفته می‌شود.',
                  'له بیا رغونې دمخه له اوسني معلوماتو اتوماتیک خوندي بیک اپ اخیستل کېږي.',
                  'A safety backup of current data is created automatically first.'
                )}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={uploading}>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                uploadAndRestore()
              }}
              disabled={uploading}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {uploading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progress < 100
                    ? t(`در حال آپلود… ٪${progress}`, `پورته کول… ٪${progress}`, `Uploading… ${progress}%`)
                    : t('در حال بازیابی…', 'په بیا رغولو…', 'Restoring…')}
                </span>
              ) : (
                t('بازیابی و تعویض دیتا', 'بیا رغونه او بدلون', 'Restore & replace data')
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
