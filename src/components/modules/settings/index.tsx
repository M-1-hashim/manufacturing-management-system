'use client'

// ماژول تنظیمات — معلومات شرکت، اسعار، مالیات پیش‌فرض + کاپی احتیاطی خودکار
import { useEffect, useRef, useState } from 'react'
import { Settings as SettingsIcon, Building2, Coins, Percent, Save, Calendar, Languages, DatabaseBackup, Download, Trash2, RefreshCw, HardDriveDownload, Upload, RotateCcw, Wifi, WifiOff, ArrowLeftRight, Smartphone, FileJson, Server, FileDown, BookOpen, FolderOpen, ExternalLink, Database, KeyRound, ShieldCheck, Palette, Sun, Moon, Check, Table2, FolderInput, MonitorDown, UserMinus, CalendarX } from 'lucide-react'
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
import { formatNumber, toGregorianStr } from '@/lib/format'
import { downloadHostSetupFile, downloadHostSetupJsonFile, validateHostSetupConfig, type HostSetupConfig } from '@/lib/host-setup-file'
import { useAppStore } from '@/lib/store'
import { useFetch } from '@/lib/hooks'
import { apiGet, apiPut, apiDelete, apiPost } from '@/lib/api'
import { clearOfflineCache } from '@/lib/offline-client'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { LOCAL_MODE } from '@/lib/local-api'
import { saveFileLocal } from '@/lib/local-api/bridge'
import { getHostConfig, saveHostConfig, clearHostConfig, normalizeHostUrl, probeHost, type HostConfig } from '@/lib/host-link'

// ---------- اتصال برنامه دسکتاپ به هاست (Electron IPC — نسخهٔ 1.0.3 به بعد) ----------
interface DbConnInfoT {
  ok: boolean
  path: string
  /** مسیر دوست‌داشتنی روی C:\Users\<کاربر>\ManufacturingERP\db-connection.txt (۱.۰.۲۴) */
  friendlyPath?: string
  /** وضعیت واقعی فایل روی دیسک (۱.۰.۲۵) — جواب مستقیم به «فایل db-connection.txt نیست» */
  friendlyFileExists?: boolean
  fileExists?: boolean
  ensureError?: string | null
  appVersion?: string
  logPath?: string
  active: boolean
  host: string | null
  port: string
  database: string | null
  user: string | null
  /** برای پیش‌پرکردن فرم — روی دیسک هم plaintext است و فقط به رندرر خود برنامه می‌آید */
  password?: string | null
  sshMode: boolean
  sshHost: string | null
  sshPort: string
  sshUser: string | null
  sshPassword?: string | null
  /** پروب TCP: true وصل شد / false قطعاً وصل نمی‌شود / null نامعلوم */
  reachable?: boolean | null
  tunnelStatus: string | null
  tunnelLocalPort: number | null
}

interface ConnSavePayloadT {
  mode: 'ssh' | 'direct'
  host: string
  port: string
  database: string
  user: string
  password: string
  sshHost: string
  sshPort: string
  sshUser: string
  sshPassword: string
}

interface DbConnApiT {
  info: () => Promise<DbConnInfoT>
  save: (payload: ConnSavePayloadT) => Promise<{ ok: boolean; path?: string; maskedUrl?: string; error?: string }>
  test: (payload: { sshHost: string; sshPort: string; sshUser: string; sshPassword: string }) => Promise<{ ok: boolean; kind?: string; error?: string }>
  reset: () => Promise<{ ok: boolean; path?: string; error?: string }>
  openFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
  showFile?: () => Promise<{ ok: boolean; path?: string; error?: string }>
  /** ساخت دستی فایل تنظیمات اگر به هر دلیلی روی C:\ نیست (۱.۰.۲۵) */
  createFile?: () => Promise<{ ok: boolean; path?: string; existed?: boolean; error?: string }>
  relaunch: () => Promise<{ ok: boolean }>
}

// پاسخ GET /api/system/db-info — وضعیت واقعی اتصال دیتابیس
interface DbInfoT {
  ok: boolean
  appVersion?: string
  mode: 'host-mysql' | 'local-sqlite' | 'host-offline'
  configuredForHost?: boolean
  host?: string
  port?: string
  database?: string
  version?: string
  tableCount?: number
  expectedCount?: number
  missingTables?: string[]
  schemaComplete?: boolean
  errorCode?: string
  errorKind?: 'UNREACHABLE' | 'AUTH' | 'NO_DATABASE' | 'NO_TABLES' | 'BAD_URL' | 'UNKNOWN'
  error?: string
  lastHostError?: string | null
  lastHostErrorKind?: string | null
  offlineSince?: string | null
  lastSnapshotAt?: string | null
  lastSyncAt?: string | null
  syncing?: boolean
}

// پاسخ GET /api/system/connection-status — وضعیت سوییچ خودکار آنلاین/آفلاین
interface ConnStatusT {
  ok: boolean
  configured: boolean
  mode: 'local' | 'host-mysql' | 'host-offline'
  host: string | null
  port: string | null
  database: string | null
  lastCheckAt: string | null
  lastOkAt: string | null
  lastError: string | null
  offlineSince: string | null
  syncing: boolean
  snapshotting: boolean
  lastSyncAt: string | null
  lastSnapshotAt: string | null
  lastSyncError: string | null
  pendingPush: number | null
  lastTick?: { ok: boolean; pushed: number; pulled: number; deleted: number; ms: number; at: string | null; error?: string } | null
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

// تم‌های رنگی — همان فهرست page.tsx (برای کارت «ظاهر برنامه»)
const COLOR_THEMES = [
  { id: 'emerald', fa: 'زمردی', ps: 'زمرد', en: 'Emerald', dot: '#0a7d63' },
  { id: 'teal', fa: 'فیروزه‌ای', ps: 'فیروزه‌ای', en: 'Teal', dot: '#0b8ea0' },
  { id: 'green', fa: 'سبز', ps: 'زرغون', en: 'Green', dot: '#2f9e44' },
  { id: 'azure', fa: 'آبی', ps: 'آبي', en: 'Azure', dot: '#3f6ae0' },
  { id: 'ocean', fa: 'اقیانوسی', ps: 'سمندري', en: 'Ocean', dot: '#2f7ec2' },
  { id: 'violet', fa: 'بنفش', ps: 'بنفش', en: 'Violet', dot: '#8f52d6' },
  { id: 'magenta', fa: 'سرخابی', ps: 'سرخابي', en: 'Magenta', dot: '#c04a97' },
  { id: 'rose', fa: 'یاقوتی', ps: 'یاقوتی', en: 'Rose', dot: '#d15062' },
  { id: 'gold', fa: 'طلایی', ps: 'طلایی', en: 'Gold', dot: '#a9841c' },
  { id: 'brown', fa: 'قهوه‌ای', ps: 'نسواری', en: 'Brown', dot: '#8f6b45' },
  { id: 'graphite', fa: 'گرافیتی', ps: 'ګرافیتي', en: 'Graphite', dot: '#5c6470' },
] as const

function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${n} B`
}

function fmtDate(iso: string): string {
  try {
    return toGregorianStr(iso, true)
  } catch {
    return iso
  }
}

export default function SettingsModule() {
  const { t } = useI18n()
  const lang = useAppStore((s) => s.lang)
  const setLang = useAppStore((s) => s.setLang)
  const user = useAppStore((s) => s.user)

  // ---------- ظاهر: تم رنگی + حالت تیره/روشن ----------
  const [isDark, setIsDark] = useState(() => typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
  const [activeTheme, setActiveTheme] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem('mfg-color-theme') ?? 'emerald' : 'emerald'))
  function applyColorTheme(id: string) {
    if (id === 'emerald') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem('mfg-color-theme', id)
    setActiveTheme(id)
  }
  function toggleDarkMode() {
    const next = !isDark
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('mfg-theme', next ? 'dark' : 'light')
    setIsDark(next)
  }
  const { data, loading, refetch } = useFetch<Record<string, string>>('/api/settings')

  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // ---------- کاپی احتیاطی خودکار (فقط ادمین) ----------
  const isAdmin = user?.role === 'admin'
  const backup = useFetch<{ files: BackupFileT[]; intervalHours: number; keep: number; dbType?: 'sqlite' | 'mysql' }>(isAdmin ? '/api/admin/backup' : null)
  const [bInterval, setBInterval] = useState('24')
  const [bKeep, setBKeep] = useState('10')
  const [bSaving, setBSaving] = useState(false)
  const [bCreating, setBCreating] = useState(false)
  const [bDeleting, setBDeleting] = useState<string | null>(null)
  const [deleteFileTarget, setDeleteFileTarget] = useState<string | null>(null) // فایل کاپی احتیاطی برای حذف با تأیید

  // ---------- اتصال به هاست از داخل برنامه (فقط نسخه ویندوز جدید) ----------
  const [connApi] = useState<DbConnApiT | null>(() => (typeof window !== 'undefined' ? window.dbConnection ?? null : null))
  const [connInfo, setConnInfo] = useState<DbConnInfoT | null>(null)
  const [connForm, setConnForm] = useState({
    mode: 'ssh' as 'ssh' | 'direct',
    host: '', port: '3306', database: '', user: '', password: '',
    sshHost: '', sshPort: '21098', sshUser: '', sshPassword: '',
  })
  const [connSaving, setConnSaving] = useState(false)
  const [connResetting, setConnResetting] = useState(false)
  const [connTesting, setConnTesting] = useState(false)
  /** آدرس نسخهٔ وب برای فایل تنظیمات آپلودی (اختیاری — فقط برای نسخهٔ اندروید) */
  const [setupWebUrl, setSetupWebUrl] = useState('')

  // ---------- وضعیت واقعی دیتابیس (کدام حالت؟ وصل است؟ جدول‌ها کامل؟) ----------
  const [dbInfo, setDbInfo] = useState<DbInfoT | null>(null)
  const [dbInfoLoading, setDbInfoLoading] = useState(false)

  // ---------- راه‌اندازی خودکار هاست (ساخت جدول‌ها / انتقال دیتا) ----------
  const [hostSetupBusy, setHostSetupBusy] = useState<'create' | 'migrate' | null>(null)
  const [hostSetupResult, setHostSetupResult] = useState<string | null>(null)
  const [migrateConfirm, setMigrateConfirm] = useState(false)

  // ---------- دانلود عمومی سِتب ویندوز + APK اندروید (فقط اگر فایل روی سرور موجود باشد) ----------
  const [setupDl, setSetupDl] = useState<{ sizeHuman: string | null } | null>(null)
  const [apkDl, setApkDl] = useState<{ sizeHuman: string | null } | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/download/setup?info=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { setup?: { available?: boolean; sizeHuman?: string | null }; apk?: { available?: boolean; sizeHuman?: string | null } } | null) => {
        if (alive && j?.setup?.available) setSetupDl({ sizeHuman: j.setup.sizeHuman ?? null })
        if (alive && j?.apk?.available) setApkDl({ sizeHuman: j.apk.sizeHuman ?? null })
      })
      .catch(() => { /* فایل موجود نیست — دکمه پنهان می‌ماند */ })
    return () => { alive = false }
  }, [])

  async function runHostSetup(action: 'create' | 'migrate') {
    setHostSetupBusy(action)
    setHostSetupResult(null)
    try {
      const r = await apiPost<{
        ok: boolean
        error?: string
        createdTables?: string[]
        bootstrapped?: boolean
        copiedUsers?: number
        copiedSettings?: number
        copied?: number
        updated?: number
      }>('/api/system/db-setup', { action })
      if (!r.ok) throw new Error(r.error || 'failed')
      if (action === 'create') {
        const parts: string[] = []
        parts.push(
          (r.createdTables?.length ?? 0) > 0
            ? t(`${r.createdTables!.length} جدول ساخته شد`, `${r.createdTables!.length} جدولونه جوړ شول`, `${r.createdTables!.length} tables created`)
            : t('همهٔ جدول‌ها از قبل موجود بود', 'ټول جدولونه له مخکې موجود وو', 'All tables already existed')
        )
        if (r.bootstrapped)
          parts.push(
            t(
              `${r.copiedUsers ?? 0} کاربر و ${r.copiedSettings ?? 0} تنظیم از دستگاه به هاست کپی شد`,
              `${r.copiedUsers ?? 0} کارن او ${r.copiedSettings ?? 0} امستنې هوسټ ته کاپي شوې`,
              `${r.copiedUsers ?? 0} users and ${r.copiedSettings ?? 0} settings copied to host`
            )
          )
        setHostSetupResult(parts.join(' — '))
        toast.success(t('راه‌اندازی هاست کامل شد', 'هوسټ راه‌اندازې بشپړه شوه', 'Host setup finished'))
      } else {
        setHostSetupResult(
          t(
            `${r.copied ?? 0} سطر کپی و ${r.updated ?? 0} سطر تازه شد — دیتای هاست حالا مثل همین دستگاه است`,
            `${r.copied ?? 0} کرښه کاپي او ${r.updated ?? 0} تازه شوه`,
            `${r.copied ?? 0} rows copied and ${r.updated ?? 0} updated — host data now matches this device`
          )
        )
        toast.success(t('انتقال دیتا به هاست کامل شد', 'ډاټا هوسټ ته ولېږدول شوه', 'Data migration to host finished'))
      }
      void refreshDbInfo()
    } catch (e) {
      setHostSetupResult(String((e as Error)?.message || e))
      toast.error(t('راه‌اندازی هاست ناموفق بود', 'هوسټ راه‌اندازې ناکامه شوه', 'Host setup failed'))
    } finally {
      setHostSetupBusy(null)
    }
  }

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

  // ---------- سوییچ خودکار آنلاین/آفلاین + همگام‌سازی ----------
  const [connStatus, setConnStatus] = useState<ConnStatusT | null>(null)
  const [syncAction, setSyncAction] = useState<string | null>(null)

  async function refreshConnStatus() {
    try {
      setConnStatus(await apiGet<ConnStatusT>('/api/system/connection-status'))
    } catch {
      /* بی‌صدا — فقط نمایش وضعیت است */
    }
  }

  useEffect(() => {
    void refreshConnStatus()
    const id = setInterval(() => { void refreshConnStatus() }, 15_000)
    return () => clearInterval(id)
  }, [])

  async function runSyncAction(action: 'check' | 'sync-now' | 'snapshot-now') {
    setSyncAction(action)
    try {
      const res = await apiPost<{ ok: boolean; result?: string; error?: string; rows?: number }>('/api/system/sync-actions', { action })
      if (res.ok) {
        if (action === 'check') {
          toast.success(t('بررسی اتصال انجام شد', 'ازمویلنه بشته شو', 'Connection check done'))
        } else if (action === 'sync-now') {
          toast.success(
            res.result === 'sync started'
              ? t('هاست وصل شد — همگام‌سازی آغاز گردید', 'هوسټ ونښل — همغه کول پیل شو', 'Host connected — sync started')
              : res.result
                ? t('کپی دیتای هاست گرفته شد', 'د هاست ډاټا کاپي شو', 'Server data copied')
                : t('درخواست انجام شد', 'غوښتنه ترسره شوه', 'Request done')
          )
        } else if (action === 'snapshot-now') {
          toast.success(`${t('کپی کامل دیتای هاست روی دستگاه گرفته شد', 'ډاټا کاپي شو', 'Server data copied to device')}${res.rows != null ? ` (${formatNumber(res.rows)} ${t('سطر', 'کرښه', 'rows')})` : ''}`)
        }
      } else {
        toast.error(res.error || t('اجراؤات ناموفق بود', 'عملیه ناکامه شوه', 'Operation failed'))
      }
      await refreshConnStatus()
      void refreshDbInfo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطای نامشخص', 'ناڅرګنده ستونزه', 'Unknown error'))
    } finally {
      setSyncAction(null)
    }
  }

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
            mode: info.sshMode ? 'ssh' : 'direct',
            host: info.host || '',
            port: info.port || '3306',
            database: info.database || '',
            user: info.user || '',
            sshHost: info.sshHost || '',
            sshPort: info.sshPort || '21098',
            sshUser: info.sshUser || '',
          }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [connApi])

  async function testSshConnection() {
    if (!connApi) return
    if (!connForm.sshHost.trim() || !connForm.sshUser.trim()) {
      toast.error(t('آدرس هاست و نام کاربری SSH الزامی است', 'د SSH پته او کاروونکی نوم اړین دي', 'SSH server address and username are required'))
      return
    }
    setConnTesting(true)
    try {
      const res = await connApi.test({
        sshHost: connForm.sshHost.trim(),
        sshPort: connForm.sshPort.trim() || '21098',
        sshUser: connForm.sshUser.trim(),
        sshPassword: connForm.sshPassword,
      })
      if (res.ok) {
        toast.success(t('✅ اتصال SSH موفق بود — مقادیر درست است، حالا ذخیره کنید', '✅ د SSH نښلول بریالی شو — اوس خوندي کړئ', '✅ SSH connection OK — now save'))
      } else if (res.kind === 'AUTH') {
        toast.error(t('🔑 پسورد یا نام کاربری SSH (همان cPanel) غلط است', '🔑 د SSH (cPanel) پسورد یا کاروونکی غلط دی', 'Wrong SSH (cPanel) username or password'))
      } else if (res.kind === 'TIMEOUT') {
        toast.error(t('⏳ از هاست پاسخی نیامد — انترنت یا فایروال را چک کنید', '⏳ له هاست ځواب نه شو — انترنت یا فایروال وګورئ', 'No response from server — check internet/firewall'))
      } else {
        toast.error(t('🌐 هاست SSH پیدا نشد — آدرس/پورت را چک کنید و در cPanel → Manage Shell دسترسی SSH را فعال کنید', '🌐 د SSH هاست نه موندل شو — پته/بورډ وګورئ او په cPanel → Manage Shell کې SSH فعاله کړئ', 'SSH server not reachable — check address/port and enable SSH in cPanel → Manage Shell'))
      }
    } catch {
      toast.error(t('خطا در تست اتصال', 'د ازمویلې ستونزه', 'Test failed'))
    } finally {
      setConnTesting(false)
    }
  }

  async function saveHostConnection() {
    if (!connApi) return
    const ssh = connForm.mode === 'ssh'
    if (ssh) {
      if (!connForm.sshHost.trim() || !connForm.sshUser.trim() || !connForm.database.trim() || !connForm.user.trim()) {
        toast.error(t('آدرس SSH، نام کاربری SSH، نام دیتابیس و نام کاربری دیتابیس الزامی است', 'د SSH پته، د SSH کاروونکی، د ډاټابیس نوم او کاروونکی اړین دي', 'SSH address, SSH user, database name and username are required'))
        return
      }
      if (!connForm.sshPassword) {
        toast.error(t('پسورد SSH (همان پسورد cPanel) الزامی است', 'د SSH پسورد (همان د cPanel) اړین دی', 'SSH password (same as cPanel) is required'))
        return
      }
    } else if (!connForm.host.trim() || !connForm.database.trim() || !connForm.user.trim()) {
      toast.error(t('آدرس هاست، نام دیتابیس و نام کاربری الزامی است', 'د هوسټ پته، د ډاټابیس نوم او د کاروونکي نوم اړین دي', 'Host, database and username are required'))
      return
    }
    setConnSaving(true)
    try {
      const res = await connApi.save({
        mode: connForm.mode,
        host: connForm.host.trim(),
        port: connForm.port.trim() || '3306',
        database: connForm.database.trim(),
        user: connForm.user.trim(),
        password: connForm.password,
        sshHost: connForm.sshHost.trim(),
        sshPort: connForm.sshPort.trim() || '21098',
        sshUser: connForm.sshUser.trim(),
        sshPassword: connForm.sshPassword,
      })
      if (!res.ok) {
        throw new Error(res.error === 'MISSING_FIELDS' || res.error === 'MISSING_SSH_PASSWORD'
          ? t('اړینې برخې بشپړې کړئ', 'اړینې برخې بشپړې کړئ', 'Missing required fields')
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
      toast.success(t(
        'اتصال هاست حذف شد — برنامه در صفحهٔ راه‌اندازی هاست باز می‌شود (حالت محلی دیگر ورود ندارد)…',
        'نښلون له هوسټ لیرې شو — پروګرام په امستنې پاڼه کې پرانیستل کېږي…',
        'Host connection removed — the app will open on the host setup page (local-only mode no longer signs in)…'
      ))
      setTimeout(() => {
        void connApi.relaunch()
      }, 1500)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در تغییر حالت', 'د بدلون ستونزه', 'Switch failed'))
    } finally {
      setConnResetting(false)
    }
  }

  /* فایل تنظیم خودکار هاست — دانلود و پخش بین کمپیوترهای کارکنان */
  function handleDownloadHostSetup() {
    const cfg: HostSetupConfig = {
      mode: connForm.mode,
      host: connForm.host.trim(),
      port: connForm.port.trim() || '3306',
      database: connForm.database.trim(),
      user: connForm.user.trim(),
      password: connForm.password,
      sshHost: connForm.sshHost.trim(),
      sshPort: connForm.sshPort.trim() || '21098',
      sshUser: connForm.sshUser.trim(),
      sshPassword: connForm.sshPassword,
    }
    const err = validateHostSetupConfig(cfg)
    if (err) {
      toast.error(
        err === 'MISSING_SSH_PASSWORD'
          ? t('پسورد SSH (همان پسورد cPanel) الزامی است', 'د SSH پسورد (همان د cPanel) اړین دی', 'SSH password (same as cPanel) is required')
          : t('اول معلومات هاست را در همین فرم کامل کنید (حالت، آدرس، دیتابیس، کاربر و پسورد)', 'لومړی د هوسټ معلومات په دې فورم کې بشپړ کړئ', 'Fill the host details in this form first (mode, address, database, user and password)')
      )
      return
    }
    if (downloadHostSetupFile(cfg)) {
      toast.success(
        t('فایل ManufacturingERP-HostSetup.bat دانلود شد — آن را برای کارکنان بفرستید', 'فایل دانلود شو — د کارکوونکو ته یې ولېږئ', 'ManufacturingERP-HostSetup.bat downloaded — send it to staff')
      )
    } else {
      toast.error(t('خطا در ساخت فایل', 'د فایل جوړولو ستونزه', 'Could not build the file'))
    }
  }

  /* فایل تنظیمات آپلودی (JSON) — در اولین باز شدن برنامه (ویزارد) آپلود می‌شود — ویندوز + اندروید */
  function handleDownloadHostSetupJson() {
    const cfg: HostSetupConfig = {
      mode: connForm.mode,
      host: connForm.host.trim(),
      port: connForm.port.trim() || '3306',
      database: connForm.database.trim(),
      user: connForm.user.trim(),
      password: connForm.password,
      sshHost: connForm.sshHost.trim(),
      sshPort: connForm.sshPort.trim() || '21098',
      sshUser: connForm.sshUser.trim(),
      sshPassword: connForm.sshPassword,
    }
    const err = validateHostSetupConfig(cfg)
    if (err) {
      toast.error(
        err === 'MISSING_SSH_PASSWORD'
          ? t('پسورد SSH (همان پسورد cPanel) الزامی است', 'د SSH پسورد اړین دی', 'SSH password is required')
          : t('اول معلومات هاست را در همین فرم کامل کنید (حالت، آدرس، دیتابیس، کاربر و پسورد)', 'لومړی د هوسټ معلومات په دې فورم کې بشپړ کړئ', 'Fill the host details in this form first')
      )
      return
    }
    // آدرس وب اگر از قبل شناخته است (حالت اندروید) — وگرنه از ورودی فرم
    const webUrl = setupWebUrl.trim() || (LOCAL_MODE ? getHostConfig()?.url ?? '' : '')
    if (downloadHostSetupJsonFile(webUrl, cfg)) {
      toast.success(
        t(
          'فایل ManufacturingERP-HostSetup.json دانلود شد — آن را برای کارکنان بفرستید؛ در اولین باز شدن برنامه از ویزارد همان‌جا آپلود و تنظیم می‌شود',
          'فایل دانلود شو — د کارکوونکو ته یې ولېږئ؛ په لومړي پرانیستلو کې اپلودېږي',
          'ManufacturingERP-HostSetup.json downloaded — send it to staff; they upload it in the first-run wizard'
        )
      )
    } else {
      toast.error(t('خطا در ساخت فایل', 'د فایل جوړولو ستونزه', 'Could not build the file'))
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
      toast.success(t('تنظیمات کاپی احتیاطی ذخیره شد', 'د بیک اپ امستنې خوندي شوې', 'Backup settings saved'))
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
      toast.success(t(`کاپی احتیاطی ${created.name} ایجاد شد`, `بیک اپ ${created.name} جوړ شو`, `Backup ${created.name} created`))
      backup.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در تهیه کاپی احتیاطی', 'د بیک اپ ستونزه', 'Backup failed'))
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
      // حالت محلی (اندروید): JSON مستقیم در Downloads دستگاه ذخیره می‌شود — blob در WebView کار نمی‌کند
      if (LOCAL_MODE) {
        const json: unknown = await res.json()
        const text = JSON.stringify(json)
        if (saveFileLocal(name, text)) {
          toast.success(t('فایل کاپی احتیاطی در پوشهٔ Downloads ذخیره شد', 'د بیک اپ فایل په Downloads کې خوندي شو', 'Backup file saved to Downloads'))
          return
        }
        // پل اندروید در دسترس نیست (مرورگر) → دانلود blob مثل قبل
        const blob = new Blob([text], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        URL.revokeObjectURL(a.href)
        return
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
      // حالت محلی (اندروید): خروجی JSON مستقیم در Downloads دستگاه ذخیره می‌شود
      if (LOCAL_MODE) {
        const json: unknown = await res.json()
        const text = JSON.stringify(json)
        const name = `backup-${new Date().toISOString().slice(0, 10)}.json`
        if (saveFileLocal(name, text)) {
          toast.success(
            t('خروجی JSON آماده شد — برای انتقال دیتا به هاست استفاده کنید', 'د JSON خپلوونکی چمتو شو', 'JSON export ready')
          )
          return
        }
        // پل اندروید در دسترس نیست (مرورگر) → دانلود blob مثل قبل
        const blob = new Blob([text], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = name
        a.click()
        URL.revokeObjectURL(a.href)
        toast.success(
          t('خروجی JSON آماده شد — برای انتقال دیتا به هاست استفاده کنید', 'د JSON خپلوونکی چمتو شو', 'JSON export ready')
        )
        return
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
      toast.success(t('فایل کاپی احتیاطی حذف شد', 'د بیک اپ فایل له منځه ولاړ', 'Backup file deleted'))
      backup.refetch()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('خطا در حذف', 'د حذف ستونزه', 'Delete failed'))
    } finally {
      setBDeleting(null)
      setDeleteFileTarget(null)
    }
  }

  // ---------- بازیابی (از فایل موجود یا آپلود) ----------
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null) // نام فایل کاپی احتیاطی موجود
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
      if (payload.file && LOCAL_MODE) {
        // حالت محلی: FormData در موتور محلی پشتیبانی نمی‌شود — فایل JSON خوانده و با { import: … } فرستاده می‌شود
        const text = await payload.file.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          throw new Error(t('فایل انتخاب‌شده معتبر نیست — فایل خروجی JSON (.json) را انتخاب کنید', 'فایل غلط دی — د JSON فایل انتخاب کړئ', 'Invalid file — pick a JSON export file (.json)'))
        }
        res = await fetch('/api/admin/backup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ import: parsed }),
        })
      } else if (payload.file) {
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
          `بازیابی انجام شد — کاپی احتیاطی ${body.safetyBackup} گرفته شد`,
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

  // ---------- اسعار لحظه‌ای از API واقعی ----------
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
            'انترنت در دسترس نیست — آخرین نرخ ذخیره‌شده نمایش داده می‌شود',
            'انټرنټ نه لري — وروستنی ذخیره شوې نرخ ښودل کیږي',
            'No internet — showing last stored rates'
          )
        )
      } else {
        toast.success(
          t(
            `نرخ لحظه‌ای دریافت شد: 1 دالر = ${r.usd} AFG`,
            `لحظه يي نرخ ترلاسه شو: 1 ډالر = ${r.usd} AFG`,
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
          ? t('تجدید خودکار نرخ فعال شد', 'اتوماتیک بروز رسانی فعال شو', 'Auto rate sync enabled')
          : t('تجدید خودکار نرخ غیرفعال شد — نرخ‌ها دستی مدیریت می‌شوند', 'اتوماتیک بروز رسانی بند شو — نرخونه لاسي اداره کیږي', 'Auto rate sync disabled — rates are managed manually')
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
        absentDeductionPerDay: form.absentDeductionPerDay ?? '',
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
        subtitle={t('معلومات شرکت، اسعار و مالیات', 'د شرکت معلومات، د اسعارو نرخ او مالیه', 'Company info, exchange rates & tax')}
        icon={SettingsIcon}
        actions={
          <Button onClick={save} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? t('در حال ذخیره...', 'خوندي کول...', 'Saving...') : t('ذخیره تغییرات', 'بدلونونه خوندي کړئ', 'Save changes')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* معلومات شرکت */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-4 w-4 text-primary" />
              {t('معلومات شرکت', 'د شرکت معلومات', 'Company Information')}
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
              <Label htmlFor="companyPhone">{t('تیلیفون', 'ټیلیفون', 'Phone')}</Label>
              <Input id="companyPhone" dir="ltr" className="text-end" value={form.companyPhone ?? ''} onChange={(e) => set('companyPhone', e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('این معلومات در سرلوحه بل‌های فروش نمایش داده می‌شود.', 'دا معلومات د پلورنې بلونو سربرګ کې ښکاري.', 'Shown on sales invoice headers.')}
            </p>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* اسعار */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Coins className="h-4 w-4 text-primary" />
                {t('اسعار (نسبت به AFG)', 'د اسعارو نرخ (په AFG)', 'Exchange rates (vs AFG)')}
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
                    {t('نرخ لحظه‌ای از انترنت', 'لحظه يي نرخ له انټرنټ', 'Live rates from the internet')}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {form.ratesUpdatedAt
                      ? t(
                          `آخرین تجدید: ${fmtDate(form.ratesUpdatedAt)} — منبع: ${form.ratesSource || liveInfo?.source || '—'}`,
                          `وروستنی بروز رسانی: ${fmtDate(form.ratesUpdatedAt)} — سرچینه: ${form.ratesSource || liveInfo?.source || '—'}`,
                          `Last update: ${fmtDate(form.ratesUpdatedAt)} — source: ${form.ratesSource || liveInfo?.source || '—'}`
                        )
                      : t('هنوز نرخ از انترنت دریافت نشده — دکمه را بزنید', 'تر اوسه نرخ له انټرنټ نه دی اخیستل شوی', 'No rate fetched yet — click refresh')}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={fetchLiveRates} disabled={rateFetching} className="gap-1.5 shrink-0">
                  <RefreshCw className={`h-3.5 w-3.5 ${rateFetching ? 'animate-spin' : ''}`} />
                  {rateFetching ? t('در حال دریافت...', 'اخیستل...', 'Fetching...') : t('تجدید لحظه‌ای', 'لحظه يي بروز رسانی', 'Refresh live rates')}
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

              {/* تجدید خودکار */}
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <Label htmlFor="ratesAutoSync" className="cursor-pointer">{t('تجدید خودکار نرخ‌ها', 'اتوماتیک بروز رسانی نرخونه', 'Auto-update rates')}</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('نرخ‌ها هر ساعت از سرای افغانی (sarafi.af) گرفته و ذخیره می‌شوند؛ در قطعی انترنت آخرین نرخ استفاده می‌شود.', 'نرخونه هر ساعت له سرای افغاني (sarafi.af) اخیستل او ذخیره کیږي؛ د انټرنټ پرېکېدو کې وروستنی نرخ کارول کیږي.', 'Rates are fetched hourly from sarafi.af and stored; last known rates are used when offline.')}
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
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">{t('2٪ مالیات خدمات', '2٪ د خدماتو مالیه', '2% services')}</Badge>
                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200">{t('10٪ مالیات تماس', '10٪ تماس مالیه', '10% telecom')}</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* کسر خودکار غیبت از معاش */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UserMinus className="h-4 w-4 text-primary" />
            {t('کسر خودکار غیبت از معاش', 'اتوماتيک د غېبت کسر له معاشه', 'Automatic absence deduction')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="absentDeductionPerDay">
                {t('کسر به‌ازای هر روز غیبت (AFG)', 'د هر ورځې غېبت کسر (AFG)', 'Deduction per absent day (AFG)')}
              </Label>
              <Input
                id="absentDeductionPerDay"
                dir="ltr"
                type="number"
                min="0"
                step="0.01"
                className="text-end"
                placeholder={t('خالی = ۱/۳۰ معاش', 'تش = ۱/۳۰ معاش', 'Empty = 1/30 of salary')}
                value={form.absentDeductionPerDay ?? ''}
                onChange={(e) => set('absentDeductionPerDay', e.target.value)}
              />
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground rounded-lg border border-dashed p-2.5">
              <CalendarX className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>
                {t(
                  'در ثبت پرداخت معاش، روزهای غایبِ همان ماه شمسی از حاضری شمرده می‌شوند و به این مقدار از معاش کم می‌شود. اگر خالی بماند، یک‌سی‌ام معاش ماهانهٔ همان کارمند به‌ازای هر روز غیبت کسر می‌شود.',
                  'د معاش ورکولو په ثبت کې، د همدې میاشتې غېبت ورځې له حاضرو څخه شمېرل کیږي او دا اند له معاشه کم کیږي. که تش پرېښودل شي، د هر کوونکي د میاشتني معاش ۱/۳ برخه د هرې ورځې غېبت لپاره کم کیږي.',
                  'When recording a salary payment, absent days of that Shamsi month are counted from attendance and deducted at this rate. If empty, 1/30 of the monthly salary is deducted per absent day.'
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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
            {t('تقویم سیستم شمسی (هجری شمسی) است و در همه گزارش‌ها و بل‌ها استفاده می‌شود؛ تاریخ میلادی نیز در دسترس است.', 'د سیسټم تقویم هجري شمسي دی او په ټولو راپورونو کې کارول کیږي؛ میلادي نېټه هم شتون لري.', 'System uses the Shamsi (Jalali) calendar everywhere; Gregorian is also available.')}
          </div>
        </CardContent>
      </Card>

      {/* ظاهر برنامه — تم‌های رنگی و حالت روشن/تیره */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4 text-primary" />
            {t('ظاهر برنامه', 'د پروګرام بڼه', 'Appearance')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {COLOR_THEMES.map((ct) => {
              const selected = activeTheme === ct.id
              return (
                <button
                  key={ct.id}
                  onClick={() => applyColorTheme(ct.id)}
                  className={`rounded-xl border-2 overflow-hidden transition-all hover:-translate-y-0.5 ${
                    selected ? 'border-primary shadow-sm' : 'border-transparent'
                  }`}
                  aria-label={t(ct.fa, ct.ps, ct.en)}
                >
                  <span className="block h-10 w-full" style={{ background: `linear-gradient(135deg, ${ct.dot}, ${ct.dot}99 60%, ${ct.dot}55)` }} />
                  <span className="flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium">
                    {t(ct.fa, ct.ps, ct.en)}
                    {selected && <Check className="h-3 w-3 text-primary" />}
                  </span>
                </button>
              )
            })}
          </div>
          <Separator />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="gap-2" onClick={toggleDarkMode}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              {isDark
                ? t('حالت روشن', 'روښانه حالت', 'Light mode')
                : t('حالت تیره', 'تیاره حالت', 'Dark mode')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t('تم فوراً اعمال و برای دفعات بعد ذخیره می‌شود.', 'ټینګ سمدلاسه پلي او د راتلونکو لپاره خوندي کېږي.', 'Themes apply instantly and are remembered.')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* پیوند هاست (سرور مرکزی) — فقط نسخهٔ اندروید مستقل */}
      {LOCAL_MODE && <ApkHostLinkCard />}

      {/* نسخه اندروید — فقط روی سرور (در حالت محلی APK مستقل، دانلود APK بی‌معناست) */}
      {!LOCAL_MODE && (
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
      )}

      {/* کاپی احتیاطی — فقط ادمین */}
      {isAdmin && (
        <Card className="border-emerald-200 dark:border-emerald-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DatabaseBackup className="h-4 w-4 text-primary" />
              {t('کاپی احتیاطی خودکار و دستی', 'اتوماتیک او لاسي بیک اپ', 'Automatic & manual backup')}
              <Badge variant="outline" className="ms-2">{t('مخصوص ادمین', 'ځانګړی ادمین', 'Admin only')}</Badge>
              {backup.data?.dbType === 'mysql' ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">
                  {t('ذخیره: هاست MySQL', 'ساتنه: MySQL هوسټ', 'Storage: MySQL host')}
                </Badge>
              ) : (
                <Badge variant="secondary">
                  {t('ذخیره: SQLite محلی', 'ساتنه: ځایی SQLite', 'Storage: local SQLite')}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* فایل‌های هاست اشتراکی — ذخیره دیتا در MySQL هاست (در حالت محلی پنهان) */}
            {!LOCAL_MODE && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <Server className="h-4 w-4 shrink-0 text-amber-600" />
                <p className="flex-1 text-xs leading-5 text-amber-900 dark:text-amber-200">
                  {t(
                    'برای ذخیره دیتا در هاست اشتراکی: فایل SQL را در phpMyAdmin هاست ایمپورت کنید، سپس طبق راهنما برنامه را به دیتابیس هاست وصل کرده و کاپی احتیاطی JSON را بازیابی کنید.',
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
            )}

            {/* تنظیمات خودکار */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div className="space-y-1.5">
                <Label htmlFor="bInterval">{t('فاصله کاپی احتیاطی خودکار', 'د اتوماتیک بیک اپ فاصله', 'Auto-backup interval')}</Label>
                <select
                  id="bInterval"
                  value={bInterval}
                  onChange={(e) => setBInterval(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="0">{t('غیرفعال', 'ناروښان', 'Disabled')}</option>
                  <option value="1">{t('هر 1 ساعت', 'هر 1 ساعت', 'Every hour')}</option>
                  <option value="6">{t('هر 6 ساعت', 'هر 6 ساعته', 'Every 6 hours')}</option>
                  <option value="12">{t('هر 12 ساعت', 'هر 12 ساعته', 'Every 12 hours')}</option>
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
                'سیستم به‌صورت خودکار در فواصل انتخابی از کل دیتابیس کاپی احتیاطی می‌گیرد و نسخه‌های قدیمی‌تر را خودکار حذف می‌کند. فایل‌ها کنار دیتابیس در پوشه backups نگهداری می‌شوند.',
                'سیسټم په ټاکل شوو فاصلو کې له ټولې ډاټابیس څخه اتوماتیک بیک اپ اخلي او زړې نسخې اتوماتیک حذفوي.',
                'The system automatically backs up the whole database at the chosen interval and prunes old versions. Files are stored in the backups folder next to the database.'
              )}
            </p>

            <Separator />

            {/* فهرست نسخه‌های کاپی احتیاطی */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="text-sm text-muted-foreground flex-1">
                {t(
                  `${(backup.data?.files.length ?? 0)} کاپی احتیاطی ذخیره شده است. برای انتقال به کامپیوتر دیگر، فایل را دانلود کنید.`,
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
                  {bCreating ? t('در حال تهیه...', 'چمتو کول...', 'Creating...') : t('کاپی احتیاطی بگیر', 'بیک اپ واخله', 'Backup now')}
                </Button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto rounded-lg border">
              {backup.loading && !backup.data ? (
                <p className="p-4 text-sm text-muted-foreground text-center">{t('در حال بارگیری...', 'بارول...', 'Loading...')}</p>
              ) : (backup.data?.files.length ?? 0) === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">
                  {t('هنوز کاپی احتیاطی وجود ندارد', 'تر اوسه بیک اپ نشته', 'No backups yet')}
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
                            <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setDeleteFileTarget(f.name)} disabled={bDeleting === f.name} aria-label={t('حذف', 'حذف', 'Delete')}>
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
              {t('توصیه: فایل کاپی احتیاطی را به‌صورت دوره‌ای دانلود و در فلش یا محل امن نگه‌داری کنید.', 'مشوره: د بیک اپ فایل په دوره يي ډول ښکته کړئ او په خوندي ځای کې یې وساتئ.', 'Tip: periodically download a backup file and keep it on a USB drive or safe location.')}
            </p>

            {/* اینپوت مخفی آپلود کاپی احتیاطی */}
            <input ref={uploadInputRef} type="file" accept={LOCAL_MODE ? '.json,.db,.sqlite,.sqlite3' : '.db,.sqlite,.sqlite3'} className="hidden" onChange={pickRestoreFile} />

            {/* تصدیق بازیابی — از فایل موجود یا آپلودی */}
            <AlertDialog open={!!restoreTarget || !!restoreFile} onOpenChange={(o) => { if (!o && !restoring) { setRestoreTarget(null); setRestoreFile(null) } }}>
              <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-destructive" />
                    {t('بازیابی کاپی احتیاطی', 'بیک اپ بیا رغونه', 'Restore backup')}
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
                      {t('قبل از بازیابی، به‌صورت خودکار از دیتای فعلی یک کاپی احتیاطی گرفته می‌شود.', 'له بیا رغونې دمخه له اوسني معلوماتو اتوماتیک خوندي بیک اپ اخیستل کېږي.', 'A safety backup of current data is created automatically first.')}
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

            {/* تصدیق حذف فایل کاپی احتیاطی — مثل بازیابی، با دیالوگ تأیید */}
            <AlertDialog open={!!deleteFileTarget} onOpenChange={(o) => { if (!o && !bDeleting) setDeleteFileTarget(null) }}>
              <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-destructive" />
                    {t('حذف فایل کاپی احتیاطی', 'د بیک اپ فایل له منځه وړل', 'Delete backup file')}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2 text-sm">
                    <span className="block">
                      {t('فایل', 'فایل', 'File')}:{' '}
                      <b dir="ltr">{deleteFileTarget}</b>
                    </span>
                    <span className="block font-medium text-destructive">
                      {t('این فایل برای همیشه حذف می‌شود و قابل بازگشت نیست!', 'دا فایل د تل لپاره له منځه ځي او بیرته نه راګرځي!', 'This file will be permanently deleted and cannot be recovered!')}
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={!!bDeleting}>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault()
                      if (deleteFileTarget) void removeBackupFile(deleteFileTarget)
                    }}
                    disabled={!!bDeleting}
                    className="bg-destructive text-white hover:bg-destructive/90"
                  >
                    {bDeleting ? t('در حال حذف…', 'په له منځه وړل کې…', 'Deleting…') : t('حذف', 'حذف', 'Delete')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}

      {/* اتصال برنامه به هاست اشتراکی — بدون جستجوی دستی فایل db-connection.txt (در حالت محلی پنهان) */}
      {isAdmin && !LOCAL_MODE && (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="h-4 w-4 text-primary" />
              {t('اتصال برنامه به هاست (ذخیره دیتا در MySQL)', 'پروګرام له هوسټ سره نښلول (د ډاټا ساتل په MySQL کې)', 'Connect app to host (store data in MySQL)')}
              <Badge variant="outline" className="font-mono" dir="ltr">
                v{dbInfo?.appVersion || '?'}
              </Badge>
              {connInfo?.active ? (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">{t('به هاست وصل است', 'له هوسټ سره نښلول شوی', 'Connected to host')}</Badge>
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
                        : dbInfo?.ok && dbInfo.mode === 'host-offline'
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
                            `به هاست وصل است ولی جدول‌ها کامل نیست (${dbInfo.tableCount ?? 0} از ${dbInfo.expectedCount ?? 19}) — تا زمانی که همهٔ جدول‌ها ساخته نشوند، ذخیرهٔ داده کار نمی‌کند.`,
                            `له هوسټ سره نښلون برقرار دی خو جدولونه بشپړ نه دي (${dbInfo.tableCount ?? 0} له ${dbInfo.expectedCount ?? 19}) — تر هغه چې ټول جدولونه جوړ نشي، خوندي کول کار نه کوي.`,
                            `Host reachable but tables are incomplete (${dbInfo.tableCount ?? 0} of ${dbInfo.expectedCount ?? 19}) — saving will not work until all tables exist.`
                          )}
                        </p>
                        <p className="mt-1">
                          {t('جدول‌های گمشده:', 'ورک جدولونه:', 'Missing tables:')} <span dir="ltr" className="font-mono">{(dbInfo.missingTables || []).join(', ')}</span>
                        </p>
                        <p className="mt-1">
                          {t('راه‌حل: فایل SQL هاست (دکمه «دانلود فایل SQL هاست» در بخش کاپی احتیاطی) را در phpMyAdmin هاست ایمپورت کنید.', 'حل: د SQL هوسټ فایل په phpMyAdmin کې وارد کړئ.', 'Fix: import the host SQL file (backup section) in your hosting phpMyAdmin.')}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p>
                          ❌ {t('به هاست وصل نمی‌شود:', 'له هوسټ سره نښلون نه کېږي:', 'Cannot reach the host:')}
                          {' '}<span dir="ltr" className="font-mono">{dbInfo.error || 'unknown error'}</span>
                        </p>
                        <p className="mt-1 font-mono" dir="ltr">
                          app v{dbInfo.appVersion || '?'} · error code: {dbInfo.errorCode || '?'} · target: {dbInfo.host}{dbInfo.port ? `:${dbInfo.port}` : ''} · db: {dbInfo.database || '?'}
                        </p>
                        <p className="mt-1">
                          {dbInfo.errorKind === 'AUTH'
                            ? t('🔑 پسورد یا نام کاربری دیتابیس غلط است — در cPanel → MySQL Databases دوباره چک کنید.', '🔑 پسورد یا د کاروونکی نوم غلط دی — په cPanel کې بیا وګورئ.', 'Wrong database password or username — recheck in cPanel → MySQL Databases.')
                            : dbInfo.errorKind === 'NO_DATABASE'
                              ? t('🗄 دیتابیس با این نام پیدا نشد — نام را دقیقاً مثل cPanel بنویسید (مثل username_dbname).', '🗄 ډاټابیس د دې نوم سره نه موندل کېږي — نوم دقیقاً لکه cPanel ولیکئ.', 'Database not found — write the name exactly as in cPanel.')
                              : dbInfo.errorKind === 'NO_TABLES'
                                ? t('📋 وصل شد ولی جدول‌ها ساخته نشده‌اند — فایل SQL هاست را در phpMyAdmin ایمپورت کنید.', '📋 ونښلول خو جدولونه نه دي جوړ شوي — د SQL هوسټ فایل په phpMyAdmin وارد کړئ.', 'Connected but tables are missing — import the host SQL file in phpMyAdmin.')
                                : dbInfo.host === '127.0.0.1'
                                  ? t(
                                      '🔗 تونل SSH وصل نمی‌شود. چک کنید: (1) انترنت دستگاه روشن است؛ (2) در cPanel هاست → Manage Shell دسترسی SSH فعال (Enable) باشد؛ (3) آدرس هاست SSH، پورت (معمولاً 21098) و نام کاربری/پسورد cPanel درست باشند — دکمه «تست اتصال SSH» جواب دقیق می‌دهد. تا وقتی تونل وصل نشود، برنامه روی دیتابیس محلی کار می‌کند.',
                                      '🔗 د SSH تونل نه نښلېږي. وګورئ: (1) انترنت روشن وي؛ (2) په cPanel → Manage Shell کې SSH فعال وي؛ (3) د SSH هاست پته، بورډ (معمولاً 21098) او cPanel کاروونکی/پسورد سم وي — تڼۍ «تست اتصال SSH» دقیق ځواب درکوي. تر نښلېدو پروګرام په ځایی ډاټابیس کار کوي.',
                                      '🔗 SSH tunnel cannot connect. Check: (1) internet is on; (2) SSH access enabled in cPanel → Manage Shell; (3) SSH server address, port (usually 21098) and cPanel credentials are correct — the "Test SSH connection" button gives an exact answer. Until the tunnel connects, the app works on the local database.'
                                    )
                                  : t(
                                      '🌐 هاست MySQL پیدا نشد. اگر هاست شما اشتراکی است (Namecheap و اکثر cPanelها)، اتصال مستقیم پورت 3306 همیشه بسته است — در فورم پایین حالت «تونل SSH» را انتخاب و ذخیره کنید. برای VPS/هاست اختصاصی: (1) IP دستگاه در Remote MySQL ثبت و تازه باشد؛ (2) پورت 3306 در فایروال باز باشد؛ (3) آدرس هاست درست باشد.',
                                      '🌐 د MySQL هاست نه موندل کېږي. که هوسټ مو شریک دی (Namecheap او ډېری cPanel)، مستقیم نښلول 3306 تل تړلی وي — په فورم کې «د SSH تونل» حالت غوره او خوندي کړئ. د VPS لپاره: (1) IP په Remote MySQL کې اوسمن وي؛ (2) بورډ 3306 پرانیستی وي؛ (3) پته سمه وي.',
                                      '🌐 MySQL server not reachable. If you are on shared hosting (Namecheap and most cPanels), direct port 3306 is always blocked — switch to SSH tunnel mode in the form below and save. For VPS/dedicated: (1) your IP registered/updated in Remote MySQL; (2) port 3306 open in firewall; (3) correct host address.'
                                    )}
                        </p>
                      </div>
                    )
                  ) : dbInfo.mode === 'host-offline' ? (
                    <div>
                      <p>
                        ⚠️ {t(
                          'هاست در دسترس نیست — برنامه خودکار به دیتابیس محلی برگشته و روی آخرین کپی دیتای هاست کار می‌کند. همهٔ تغییرات محفوظ است و بعد از وصل شدن انترنت، خودکار با هاست همگام می‌شود.',
                          'هوسټ نه لرېږي — پروګرام اتوماتیک ځایی ډاټابیس ته ګرځېدلی او په وروستۍ کاپي کار کوي. ټول بدلونونه خوندي دي او له نښلېدو وروسته اتوماتیک همغه کېږي.',
                          'Host unreachable — the app automatically switched to the local database (last copy of server data). All changes are safe and will sync automatically once internet returns.'
                        )}
                      </p>
                      {dbInfo.lastHostError && (
                        <p className="mt-1 font-mono" dir="ltr">{dbInfo.lastHostError.slice(0, 160)}</p>
                      )}
                    </div>
                  ) : (
                    <p>
                      {t('حالت محلی (SQLite) — دیتا فقط در همین دستگاه ذخیره می‌شود. برای ذخیره در هاست، معلومات بالا را پر و ذخیره کنید.', 'ځایی حالت (SQLite) — ډاټا یوازې په همدې ماشین کې خوندي کېږي.', 'Local mode (SQLite) — data is stored only on this device. Fill the form below to store data on your host.')}
                      {dbInfo.ok && dbInfo.tableCount != null ? ` (${t(`${dbInfo.tableCount} جدول`, `${dbInfo.tableCount} جدولونه`, `${dbInfo.tableCount} tables`)})` : ''}
                    </p>
                  )}
                </div>
              ) : (
                <p>{t('وضعیت نامشخص — دکمه «بررسی مجدد» را بزنید.', 'حالت نامعلوم — «بیا ازمویل» کلیک کړئ.', 'Status unknown — press Re-check.')}</p>
              )}
            </div>

            {/* راه‌اندازی خودکار هاست — فقط ادمین، فقط نسخهٔ دسکتاپ */}
            {isAdmin && connApi && (
              <div className="rounded-lg border border-dashed p-3 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold">
                    <Table2 className="h-3.5 w-3.5 text-primary" />
                    {t('راه‌اندازی خودکار هاست', 'اتوماتیک هوسټ راه‌اندازې', 'Automatic host setup')}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 px-2.5"
                      disabled={hostSetupBusy !== null}
                      onClick={() => void runHostSetup('create')}
                    >
                      {hostSetupBusy === 'create' ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Table2 className="h-3 w-3" />}
                      {t('ساخت جدول‌های گمشده', 'ورک جدولونه جوړول', 'Create missing tables')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 px-2.5"
                      disabled={hostSetupBusy !== null}
                      onClick={() => setMigrateConfirm(true)}
                    >
                      <FolderInput className="h-3 w-3" />
                      {t('انتقال دیتای این دستگاه به هاست', 'د دې دستگاه ډاټا هوسټ ته', 'Migrate this device data to host')}
                    </Button>
                  </div>
                </div>
                {hostSetupResult && <p className="text-[11px] text-muted-foreground leading-5">{hostSetupResult}</p>}
                <p className="text-[11px] text-muted-foreground leading-5">
                  {t(
                    '«ساخت جدول‌ها» هاست تازه/خالی را آماده می‌کند (19 جدول + کپی کاربران سیستم محلی). «انتقال» همهٔ دیتای این دستگاه را روی هاست می‌ریزد — برای وقتی که قبلاً بدون هاست کار کرده‌اید و حالا می‌خواهید به هاست بروید.',
                    '«جوړول» نوی/تش هوسټ چمتو کوي (19 جدول + کاپي کارنانو). «انتقال» ټول د دې دستگاه ډاټا هوسټ ته اچي — کله چې مخکې بې هوسټه کارېدئ او اوس هوسټ ته ځئ.',
                    '"Create tables" prepares a fresh/empty host (19 tables + copies local users). "Migrate" pushes all data from this device to the host — for when you worked locally before and now want to move to the host.'
                  )}
                </p>
              </div>
            )}

            {/* تصدیق انتقال دیتا به هاست */}
            <AlertDialog open={migrateConfirm} onOpenChange={setMigrateConfirm}>
              <AlertDialogContent className="sm:max-w-md">
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <FolderInput className="h-4 w-4 text-primary" />
                    {t('انتقال دیتای این دستگاه به هاست', 'د دې دستگاه ډاټا هوسټ ته لېږدول', 'Migrate this device data to host')}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2 text-sm">
                    <span className="block">
                      {t(
                        'همهٔ دیتای این دستگاه (محصولات، مشتریان، بل‌ها، تولید و…) به هاست کپی و سطرهای موجود تجدید می‌شوند. دیتای هاست حذف نمی‌شود.',
                        'ټول د دې دستگاه ډاټا (محصولات، پیرودونکي، بلونه، تولید او…) هوسټ ته کاپي او موجودې کرښې تازه کېږي. د هوسټ ډاټا نه حذفېږي.',
                        'All data from this device (products, customers, invoices, production…) is copied to the host and existing rows are updated. Nothing on the host is deleted.'
                      )}
                    </span>
                    <span className="block text-muted-foreground">
                      {t(
                        'این اجراؤات ممکن است بسته به حجم دیتا چند دقیقه طول بکشد؛ در طول انتقال برنامه را نبندید.',
                        'دا عملیې کېدای شي د ډاټا حجم پورې څو دقیقې وکړي؛ د لېږد په جریان کې پروګرام مه بنده کړئ.',
                        'This can take a few minutes depending on data size; keep the app open until it finishes.'
                      )}
                    </span>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={hostSetupBusy === 'migrate'}>{t('لغو', 'لغوه', 'Cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => {
                      e.preventDefault()
                      setMigrateConfirm(false)
                      void runHostSetup('migrate')
                    }}
                    disabled={hostSetupBusy === 'migrate'}
                  >
                    {t('شروع انتقال', 'لېږد پیل کړئ', 'Start migration')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            {/* سوییچ خودکار آنلاین/آفلاین + همگام‌سازی دوسویه */}
            <div
              className={
                'rounded-lg border p-3 text-xs leading-6 ' +
                (connStatus?.mode === 'host-mysql'
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : connStatus?.mode === 'host-offline'
                    ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200'
                    : 'border-border bg-muted/40 text-muted-foreground')
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-semibold">
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  {t('قطع/وصل خودکار انترنت (همگام‌سازی)', 'اتوماتیک قطع/وصل (همغه کول)', 'Auto online/offline (sync)')}
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2" onClick={() => void runSyncAction('check')} disabled={syncAction !== null}>
                    <RefreshCw className={'h-3 w-3' + (syncAction === 'check' ? ' animate-spin' : '')} />
                    {t('بررسی اتصال', 'د نښلولو ازمویل', 'Check connection')}
                  </Button>
                  {connStatus?.mode === 'host-mysql' && (
                    <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2" onClick={() => void runSyncAction('snapshot-now')} disabled={syncAction !== null || connStatus.snapshotting}>
                      <HardDriveDownload className="h-3 w-3" />
                      {t('کپی دیتای هاست به دستگاه', 'د هاست ډاټا کاپي', 'Copy server data to device')}
                    </Button>
                  )}
                  <Button size="sm" className="h-7 gap-1.5 px-2" onClick={() => void runSyncAction('sync-now')} disabled={syncAction !== null || connStatus?.syncing}>
                    <ArrowLeftRight className="h-3 w-3" />
                    {connStatus?.mode === 'host-offline'
                      ? t('کوشش برای اتصال و همگام‌سازی', 'هڅه د نښلولو او همغه کولو', 'Try connect & sync')
                      : t('همگام‌سازی اکنون', 'اوس همغه کول', 'Sync now')}
                  </Button>
                </div>
              </div>
              <div className="mt-1.5 space-y-0.5">
                {connStatus?.mode === 'host-mysql' && (
                  <>
                    <p>
                      ⚡ {t(
                        'همگام‌سازی لحظه‌ای فعال است — برنامه با سرعت کامل روی دیتابیس همین دستگاه کار می‌کند و هر تغییر (ثبت، تصحیح، حذف) در چند ثانیه دوطرفه با هاست جابه‌جا می‌شود. دیتای هاست هم خودکار به دستگاه اضافه می‌شود.',
                        'لحظه‌يي همغه کول فعال دي — پروګرام په بشپړه سرعت سره په ځایی ډاټابیس کار کوي او هر بدلون په څو ثانیو کې دوه اړخیزه له هاست سره تبادله کېږي.',
                        'Live sync active — the app runs at full speed on this device\u2019s database and every change (create, edit, delete) reaches the server within seconds, while server changes flow back automatically.'
                      )}
                    </p>
                    <p className="text-[11px] opacity-80">
                      {t('آخرین همگام‌سازی خودکار:', 'وروستنی اتوماتیک همغه کول:', 'Last automatic sync:')}{' '}
                      <span dir="ltr">
                        {connStatus.lastTick?.at ? fmtDate(connStatus.lastTick.at) : '—'}
                        {connStatus.lastTick && !connStatus.lastTick.ok && connStatus.lastTick.error ? ` (${connStatus.lastTick.error.slice(0, 80)})` : ''}
                      </span>
                      {connStatus.lastTick && connStatus.lastTick.ok && (connStatus.lastTick.pushed > 0 || connStatus.lastTick.pulled > 0 || connStatus.lastTick.deleted > 0)
                        ? ` — ↑${connStatus.lastTick.pushed} ↓${connStatus.lastTick.pulled} ✕${connStatus.lastTick.deleted}`
                        : ''}
                    </p>
                    {connStatus.pendingPush != null && connStatus.pendingPush > 0 && (
                      <p className="font-semibold">
                        {formatNumber(connStatus.pendingPush)} {t('تغییر در صف ارسال به هاست', 'بدلون په د لیږلو لیبل کې', 'changes queued for upload')}
                      </p>
                    )}
                    {connStatus.lastSnapshotAt && (
                      <p className="text-[11px] opacity-80">
                        {t('آخرین کپی کامل هاست:', 'وروستنۍ بشپړه کاپي:', 'Last full server copy:')} <span dir="ltr">{fmtDate(connStatus.lastSnapshotAt)}</span>
                      </p>
                    )}
                  </>
                )}
                {connStatus?.mode === 'host-offline' && (
                  <>
                    <p>
                      ⚠️ {t('هاست قطع است — برنامه روی دیتابیس محلی کار می‌کند. زمان قطع:', 'هوسټ پرې دی — پروګرام په ځایی ډاټابیس کار کوي. د پرې کېدو وخت:', 'Host is down — app is working on the local database. Since:')} <span dir="ltr">{connStatus.offlineSince ? fmtDate(connStatus.offlineSince) : '—'}</span>
                      {connStatus.pendingPush != null ? ` — ${formatNumber(connStatus.pendingPush)} ${t('تغییر در انتظار همگام‌سازی', 'بدلون په انتظار همغه کولو', 'changes pending sync')}` : ''}
                    </p>
                    <p>
                      {t(
                        'هر وقت انترنت وصل شود (حداکثر 15 ثانیه بعد) همهٔ تغییرات خودکار به هاست منتقل و جدیدترین دیتا دریافت می‌شود — نیازی به هیچ کاری نیست.',
                        'له انترنت له نښلېدو سره (تر 15 ثانیو) ټول بدلونونه اتوماتیک هاست ته ځي او نوی ډاټا راځي — هیڅ کار ته اړتیا نشته.',
                        'When internet returns (within ~15 seconds) all changes are pushed to the server and fresh data is pulled automatically — no action needed.'
                      )}
                    </p>
                  </>
                )}
                {connStatus?.syncing && <p className="font-semibold">⟳ {t('در حال همگام‌سازی تغییرات با هاست…', 'د هاست سره همغه کول…', 'Syncing changes with server…')}</p>}
                {connStatus?.mode === 'local' && (
                  <p>
                    {t(
                      'هاست تنظیم نشده — دیتا فقط روی همین دستگاه ذخیره می‌شود. برای فعال‌کردن همگام‌سازی خودکار، معلومات هاست را در فورم زیر ذخیره کنید.',
                      'هوسټ نه دی تنظیم شوی — ډاټا یوازې په همدې دستگاه کې. د فعالولو لپاره د هوسټ معلومات خوندي کړئ.',
                      'No host configured — data stays on this device. Save host details below to enable auto sync.'
                    )}
                  </p>
                )}
                {!connStatus && <p>{t('در حال دریافت وضعیت…', 'د حالت ترلاسه کول…', 'Loading status…')}</p>}
                {connStatus?.lastSyncError && (
                  <p className="text-destructive">
                    {t('خطای آخرین همگام‌سازی:', 'د وروستي همغه کولو ستونزه:', 'Last sync error:')} <span dir="ltr" className="font-mono">{connStatus.lastSyncError.slice(0, 140)}</span>
                  </p>
                )}
              </div>
            </div>
            <>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'معلومات هاست خود را همین‌جا وارد کنید. در نسخه ویندوز دکمه «ذخیره» فایل db-connection.txt را خودکار می‌نویسد و برنامه دوباره باز می‌شود؛ و دکمه «دانلود فایل تنظیم خودکار» فایلی می‌سازد که با یک دابل‌کلیک، هاست را روی هر کمپیوتر نصب‌شده تنظیم می‌کند.',
                    'د هوسټ معلومات دلته داخل کړئ. په وینډوز نسخه کې د «خوندي کولو» تڼۍ فایل اتوماتیک لیکي او پروګرام بیا پرانیستل کېږي؛ او د «فایل ښکته کولو» تڼۍ داسې فایل جوړوي چې په یوه کلیک، هوسټ په هر نصب شوي کمپیوټر کې تنظېږي.',
                    'Enter your host details here. In the Windows app, Save writes db-connection.txt automatically and restarts the app; the "Download auto-setup file" button creates a file that configures the host on any installed computer with one double-click.'
                  )}
                </p>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                  {t(
                    'مهم: برای اولین انتقال دیتای فعلی به هاست، اول دکمه «خروجی JSON (انتقال به هاست)» را بزنید، بعد اینجا وصل شوید و در بخش کاپی احتیاطی همان فایل را بازیابی کنید. بعد از آن، همه‌چیز خودکار است: در قطعی انترنت برنامه روی دیتابیس محلی کار می‌کند و بعد از وصل شدن، تغییرات خودکار همگام می‌شود.',
                    'مهم: د لومړي ځل لېږدولو لپاره «د JSON صادرول» وکاروئ، بیا دلته وصل شئ او هماغه فایل بیا رغوئ. وروسته هرڅه اتوماتیک دي.',
                    'Important: for the first migration export the JSON backup, connect here, then restore that file. After that everything is automatic: on internet loss the app works locally and syncs automatically when back online.'
                  )}
                </div>
                {/* انتخاب روش اتصال — تونل SSH (هاست اشتراکی) یا اتصال مستقیم */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setConnForm({ ...connForm, mode: 'ssh' })}
                    className={
                      'rounded-lg border p-3 text-start transition-colors ' +
                      (connForm.mode === 'ssh'
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-background hover:bg-muted/50')
                    }
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <KeyRound className="h-4 w-4 text-primary" />
                      {t('تونل SSH — هاست اشتراکی', 'د SSH تونل — شریک هوسټ', 'SSH tunnel — shared hosting')}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground leading-5">
                      {t(
                        'برای Namecheap و هر cPanel که اتصال مستقیم MySQL (3306) بسته است — برنامه خودش تونل امن می‌سازد.',
                        'د Namecheap او هر cPanel چې مستقیم نښلول (3306) تړلی وي — پروګرام پخپله تونل جوړوي.',
                        'For Namecheap and any cPanel with remote MySQL (3306) blocked — the app builds a secure tunnel itself.'
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnForm({ ...connForm, mode: 'direct' })}
                    className={
                      'rounded-lg border p-3 text-start transition-colors ' +
                      (connForm.mode === 'direct'
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border bg-background hover:bg-muted/50')
                    }
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Server className="h-4 w-4 text-primary" />
                      {t('اتصال مستقیم — VPS / هاست اختصاصی', 'مستقیم نښلول — VPS / ځانګړی هاست', 'Direct connection — VPS / dedicated')}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground leading-5">
                      {t(
                        'وقتی MySQL روی شبکه داخلی یا هاستی در دسترس است که پورت 3306 آن باز است.',
                        'کله چې MySQL په داخلي شبکه یا هغه هاست وي چې بورډ 3306 یې پرانیستی وي.',
                        'When MySQL is on a LAN or a server with port 3306 open.'
                      )}
                    </span>
                  </button>
                </div>

                {connForm.mode === 'ssh' ? (
                  <>
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-6 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                      <p className="font-semibold">
                        {t('تنظیم در cPanel (یک‌بار):', 'په cPanel کې امستنه (یو ځل):', 'Setup in cPanel (once):')}
                      </p>
                      <p>
                        1) {t('«Manage My Databases» → دیتابیس و کاربر بسازید (مثل cpuser_factory).', '«Manage My Databases» → ډاټابیس او کاروونکی جوړ کړئ.', '«Manage My Databases» → create database & user.')}
                        {'  '}2) {t('«Manage Shell» → دسترسی SSH را Enable کنید.', '«Manage Shell» → د SSH لاسرسی فعاله کړئ.', '«Manage Shell» → enable SSH access.')}
                      </p>
                      <p>
                        {t(
                          'آدرس هاست SSH در ایمیل خوش‌آمد هاست است (مثل server370.web-hosting.com)، پورت آن معمولاً 21098، و نام کاربری/پسورد SSH همان است که با آن به cPanel داخل می‌شوید.',
                          'د SSH هاست پته په د هوسټ د هرکلي بریښنالیک کې ده (لکه server370.web-hosting.com)، بورډ یې معمولاً 21098 دی، او د SSH کاروونکی/پسورد هماغه د cPanel ننوتل دی.',
                          'The SSH server address is in your hosting welcome email (e.g. server370.web-hosting.com), port is usually 21098, and SSH user/password are your cPanel login.'
                        )}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="sHost">{t('آدرس هاست SSH', 'د SSH هاست پته', 'SSH server address')}</Label>
                        <Input id="sHost" dir="ltr" placeholder="server370.web-hosting.com" autoComplete="off" value={connForm.sshHost} onChange={(e) => setConnForm({ ...connForm, sshHost: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sPort">{t('پورت SSH (معمولاً 21098)', 'د SSH بورډ (معمولاً 21098)', 'SSH port (usually 21098)')}</Label>
                        <Input id="sPort" dir="ltr" inputMode="numeric" placeholder="21098" value={connForm.sshPort} onChange={(e) => setConnForm({ ...connForm, sshPort: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sUser">{t('نام کاربری SSH (همان cPanel)', 'د SSH کاروونکی (همان cPanel)', 'SSH username (same as cPanel)')}</Label>
                        <Input id="sUser" dir="ltr" placeholder="cpuser" autoComplete="off" value={connForm.sshUser} onChange={(e) => setConnForm({ ...connForm, sshUser: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="sPass">{t('پسورد SSH (همان پسورد cPanel)', 'د SSH پسورد (همان د cPanel)', 'SSH password (same as cPanel)')}</Label>
                        <Input id="sPass" dir="ltr" type="password" autoComplete="new-password" value={connForm.sshPassword} onChange={(e) => setConnForm({ ...connForm, sshPassword: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="hDb">{t('نام دیتابیس', 'د ډاټابیس نوم', 'Database name')}</Label>
                        <Input id="hDb" dir="ltr" placeholder="cpuser_factory" autoComplete="off" value={connForm.database} onChange={(e) => setConnForm({ ...connForm, database: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="hUser">{t('نام کاربری دیتابیس', 'د ډاټابیس کاروونکی', 'Database username')}</Label>
                        <Input id="hUser" dir="ltr" placeholder="cpuser_factory" autoComplete="off" value={connForm.user} onChange={(e) => setConnForm({ ...connForm, user: e.target.value })} />
                      </div>
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="hPass">{t('پسورد دیتابیس', 'د ډاټابیس پسورد', 'Database password')}</Label>
                        <Input id="hPass" dir="ltr" type="password" autoComplete="new-password" value={connForm.password} onChange={(e) => setConnForm({ ...connForm, password: e.target.value })} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="hHost">{t('آدرس هاست', 'د هوسټ پته', 'Host address')}</Label>
                      <Input id="hHost" dir="ltr" placeholder="your-server.com" autoComplete="off" value={connForm.host} onChange={(e) => setConnForm({ ...connForm, host: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="hPort">{t('پورت (معمولاً 3306)', 'بورډ (معمولاً 3306)', 'Port (usually 3306)')}</Label>
                      <Input id="hPort" dir="ltr" inputMode="numeric" placeholder="3306" value={connForm.port} onChange={(e) => setConnForm({ ...connForm, port: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="hDb">{t('نام دیتابیس', 'د ډاټابیس نوم', 'Database name')}</Label>
                      <Input id="hDb" dir="ltr" placeholder="erp_db" autoComplete="off" value={connForm.database} onChange={(e) => setConnForm({ ...connForm, database: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="hUser">{t('نام کاربری دیتابیس', 'د ډاټابیس کاروونکی', 'Database username')}</Label>
                      <Input id="hUser" dir="ltr" placeholder="erp_user" autoComplete="off" value={connForm.user} onChange={(e) => setConnForm({ ...connForm, user: e.target.value })} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="hPass">{t('پسورد دیتابیس', 'د ډاټابیس پسورد', 'Database password')}</Label>
                      <Input id="hPass" dir="ltr" type="password" autoComplete="new-password" value={connForm.password} onChange={(e) => setConnForm({ ...connForm, password: e.target.value })} />
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {connApi && (
                    <Button onClick={saveHostConnection} disabled={connSaving} className="gap-2">
                      <Save className="h-4 w-4" />
                      {connSaving ? t('در حال ذخیره…', 'خوندي کول…', 'Saving…') : t('ذخیره و اتصال به هاست', 'خوندي او نښلول', 'Save & connect to host')}
                    </Button>
                  )}
                  <Button variant="outline" onClick={handleDownloadHostSetup} className="gap-2 border-primary/40">
                    <Download className="h-4 w-4" />
                    {t('دانلود فایل تنظیم خودکار هاست', 'د اتوماتیک هوسټ فایل ښکته کول', 'Download auto host-setup file')}
                  </Button>
                  {setupDl && (
                    <Button asChild variant="outline" className="gap-2">
                      <a
                        href="/api/download/setup"
                        download
                        title={setupDl.sizeHuman ? `ManufacturingERP-Setup.exe (${setupDl.sizeHuman})` : 'ManufacturingERP-Setup.exe'}
                      >
                        <MonitorDown className="h-4 w-4" />
                        {t('دانلود سِتب ویندوز', 'د ویندوز سېټ ښکته کول', 'Download Windows setup')}
                      </a>
                    </Button>
                  )}
                  {apkDl && (
                    <Button asChild variant="outline" className="gap-2">
                      <a
                        href="/api/download/setup?variant=apk"
                        download
                        title={apkDl.sizeHuman ? `app.apk (${apkDl.sizeHuman})` : 'app.apk'}
                      >
                        <Smartphone className="h-4 w-4" />
                        {t('دانلود سِتب اندروید', 'د اندروید سېټ ښکته کول', 'Download Android app')}
                      </a>
                    </Button>
                  )}
                  {connApi && connForm.mode === 'ssh' && (
                    <Button variant="outline" onClick={testSshConnection} disabled={connTesting} className="gap-2">
                      <ShieldCheck className={'h-4 w-4' + (connTesting ? ' animate-pulse' : '')} />
                      {connTesting ? t('در حال تست SSH…', 'د SSH ازمویل…', 'Testing SSH…') : t('تست اتصال SSH', 'د SSH نښلول ازمویل', 'Test SSH connection')}
                    </Button>
                  )}
                  {connApi && (
                    <Button variant="outline" className="gap-2" onClick={() => { void connApi.openFolder() }}>
                      <FolderOpen className="h-4 w-4" />
                      {t('باز کردن پوشه تنظیمات', 'د امستنې فولډر پرانیستل', 'Open settings folder')}
                    </Button>
                  )}
                  {connApi && connInfo?.active && (
                    <Button variant="ghost" className="gap-2 text-destructive hover:text-destructive" onClick={resetToLocalDb} disabled={connResetting}>
                      <RotateCcw className="h-4 w-4" />
                      {connResetting ? t('در حال تغییر…', 'په بدلون…', 'Switching…') : t('حذف اتصال هاست (بازگشت به صفحهٔ راه‌اندازی)', 'له هوسټ نښلون لیرې کول (امستنې پاڼې ته)', 'Remove host connection (back to setup page)')}
                    </Button>
                  )}
                </div>
                {/* فایل تنظیم خودکار هاست — یک دابل‌کلیک روی کمپیوتر کارمند + فایل آپلودی ویزارد */}
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-6 text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
                  <p className="font-semibold">
                    {t('فایل تنظیم خودکار هاست (برای کمپیوترهای کارکنان):', 'د اتوماتیک هوسټ فایل (د کارکوونکو کمپیوټرونه):', 'Auto host-setup file (for staff computers):')}
                  </p>
                  <p>
                    {t(
                      'دکمه «دانلود فایل تنظیم خودکار هاست» را بزنید — فایل ManufacturingERP-HostSetup.bat دانلود می‌شود. آن را برای کارکنان بفرستید (فلش، ایمیل، واتساپ). کارمند روی کمپیوتر خود دابل‌کلیک می‌کند: معلومات هاست خودکار ذخیره، برنامه بسته و دوباره باز می‌شود — بدون هیچ تنظیم دستی.',
                      'د «دانلود فایل تنظیم خودکار هاست» تڼۍ کېکاږئ — فایل دانلودېږي. دا د کارکوونکو ته ولېږئ (فلاشي، برېښنالیک، واټساپ). کارکوونکی په خپل کمپیوټر کې دوه ځلې کلیک کوي: د هوسټ معلومات اتوماتیک خوندي، پروګرام بند او بیا پرانیستل کېږي — پرته له هېڅ لاسي تنظیم.',
                      'Press "Download auto host-setup file" — ManufacturingERP-HostSetup.bat is downloaded. Send it to staff (USB, email, WhatsApp). They double-click it on their computer: host details are saved automatically, the app closes and reopens — no manual setup at all.'
                    )}
                  </p>
                  <p className="font-semibold mt-2.5">
                    {t('فایل تنظیمات برای آپلود در ویزارد (ویندوز و اندروید):', 'د تنظیماتو فایل د ویزارد لپاره (ویندوز او اندروید):', 'Setup file for the first-run wizard (Windows & Android):')}
                  </p>
                  <p>
                    {t(
                      'اگر نسخهٔ وب هم دارید، آدرسش را وارد کنید (برای گوشی‌ها لازم می‌شود) و دکمهٔ زیر را بزنید — فایل JSON دانلود می‌شود. کارمند فایل را در اولین باز شدن برنامه در ویزارد «آپلود فایل تنظیمات» انتخاب می‌کند و همه‌چیز خودکار تنظیم می‌شود.',
                      'که ویب نسخه لرئ، پته یې ولیکئ او تڼۍ کېکاږئ — فایل JSON دانلودېږي چې کارکوونکی په ویزارد کې اپلودوي.',
                      'If you also have the web version, enter its address and press the button — a JSON file downloads; staff upload it in the first-run wizard and everything configures automatically.'
                    )}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 mt-1.5">
                    <Input
                      dir="ltr"
                      value={setupWebUrl}
                      onChange={(e) => setSetupWebUrl(e.target.value)}
                      placeholder="https://erp.example.com (اختیاری — برای اندروید)"
                      inputMode="url"
                      className="h-8 flex-1 bg-white/70 text-[12px] dark:bg-black/25"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 gap-1.5 border-sky-300 dark:border-sky-700"
                      onClick={handleDownloadHostSetupJson}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t('دانلود فایل تنظیمات (JSON)', 'د تنظیماتو فایل (JSON) ښکته کول', 'Download setup file (JSON)')}
                    </Button>
                  </div>
                  <p className="mt-1 opacity-80">
                    {t(
                      'نکته: این فایل شامل پسورد هاست است — فقط به افراد مورد اعتماد بدهید. اگر پسورد هاست را تغییر دادید، یک فایل جدید بسازید و بفرستید.',
                      'یادونه: دا فایل د هوسټ پسورد لري — یوازې باوري کسانو ته یې ورکړئ. که د هوسټ پسورد بدل شو، نوی فایل جوړ او ولېږئ.',
                      'Note: this file contains your host password — give it only to trusted people. If the host password changes, generate and send a new file.'
                    )}
                  </p>
                </div>
                {connInfo?.sshMode && connInfo.tunnelStatus && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5" dir="ltr">
                    <span className={'inline-block h-2 w-2 rounded-full ' + (connInfo.tunnelStatus === 'online' ? 'bg-emerald-500' : connInfo.tunnelStatus === 'stopped' ? 'bg-zinc-400' : 'bg-amber-500 animate-pulse')} />
                    SSH tunnel: {connInfo.tunnelStatus}{connInfo.tunnelLocalPort ? ` @127.0.0.1:${connInfo.tunnelLocalPort}` : ''}
                  </p>
                )}
                {connInfo?.path && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground break-all" dir="ltr">
                      {t('فایل تنظیمات:', 'د امستنې فایل:', 'Config file:')} <span className="font-mono">{connInfo.friendlyPath || connInfo.path}</span>
                    </p>
                    {typeof connInfo.friendlyFileExists === 'boolean' && (
                      <p className={'flex items-center gap-1.5 text-xs font-medium ' + (connInfo.friendlyFileExists ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                        {connInfo.friendlyFileExists ? '✓' : '!'}
                        {connInfo.friendlyFileExists
                          ? t('فایل روی کامپیوتر موجود است ✓', 'فایل په کمپیوټر کې شته ✓', 'File exists on this computer ✓')
                          : t('فایل موجود نیست — دکمهٔ «ساخت فایل تنظیمات» را بزنید', 'فایل نشته — «د تنظیماتو فایل جوړول» کېکاږئ', 'File missing — click “Create config file”')}
                      </p>
                    )}
                    {connInfo.friendlyFileExists === false && connApi?.createFile && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
                        onClick={async () => {
                          try {
                            const r = await connApi.createFile!()
                            if (r.ok) {
                              toast.success(t('فایل تنظیمات ساخته شد ✓', 'د تنظیماتو فایل جوړ شو ✓', 'Config file created ✓'))
                              const inf = await connApi.info()
                              setConnInfo(inf)
                            } else {
                              toast.error(t('ساخت فایل ناموفق بود: ', 'ناکام شو: ', 'Failed: ') + (r.error || ''))
                            }
                          } catch (e) {
                            toast.error(String((e as Error)?.message || e))
                          }
                        }}
                      >
                        {t('ساخت فایل تنظیمات', 'د تنظیماتو فایل جوړول', 'Create config file')}
                      </Button>
                    )}
                  </div>
                )}
                {connForm.mode === 'ssh' ? (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'توجه: در حالت تونل نیازی به Remote MySQL نیست — فقط در cPanel → Manage Shell دسترسی SSH فعال باشد. برنامه در هر بار اجرا تونل را خودکار وصل می‌کند؛ اگر تونل قطع شود برنامه روی دیتابیس محلی ادامه می‌دهد و بعداً خودکار همگام می‌شود.',
                      'پاملرنه: په تونل حالت کې Remote MySQL ته اړتیا نشته — یوازې په cPanel → Manage Shell کې SSH فعال وي. پروګرام په هر پرانیستل کې تونل اتوماتیک نښلوي؛ که تونل پرې شي، پروګرام په ځایی ډاټابیس کار کوي او وروسته اتوماتیک همغه کېږي.',
                      'Note: tunnel mode does not need Remote MySQL — only enable SSH in cPanel → Manage Shell. The app reconnects the tunnel automatically on every launch; if the tunnel drops, the app keeps working on the local database and syncs automatically later.'
                    )}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      'توجه: در هاست‌های اشتراکی (Namecheap و اکثر cPanelها) اتصال مستقیم MySQL بسته است و فقط حالت «تونل SSH» کار می‌کند. اتصال مستقیم برای VPS/هاست اختصاصی است.',
                      'پاملرنه: په شریکو هوسټونو کې مستقیم نښلول تړلی وي — یوازې «د SSH تونل» کار کوي. مستقیم نښلول د VPS لپاره دي.',
                      'Note: on shared hosts (Namecheap and most cPanels) direct MySQL is blocked — only SSH tunnel works. Direct mode is for VPS/dedicated servers.'
                    )}
                  </p>
                )}
            </>
            {!connApi && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'دکمه «ذخیره و اتصال به هاست» فقط در نسخه ویندوز (اپلیکیشن دسکتاپ) کار می‌کند — در مرورگر از دکمه «دانلود فایل تنظیم خودکار هاست» استفاده کنید تا فایل را برای کارکنان بسازید. روش دستی پیدا کردن فایل db-connection.txt:',
                    'د «خوندي او نښلول» تڼۍ یوازې په وینډوز نسخه کې کار کوي — په براوزر کې د «فایل ښکته کولو» تڼۍ وکاروئ. لاسي لار:',
                    'The "Save & connect" button only works in the Windows desktop app — in the browser use the "Download auto host-setup file" button to create the file for staff. Manual way to find db-connection.txt:'
                  )}
                </p>
                <ol className="list-decimal ms-5 space-y-1.5 text-sm">
                  <li>
                    {t('کلیدهای', 'تڼۍ', 'Press')} <b dir="ltr">Win + R</b> {t('را فشار دهید و تایپ کنید:', 'وګړئ او ولیکئ:', 'and type:')}&nbsp;
                    <span dir="ltr" className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">%APPDATA%\ManufacturingERP</span>
                  </li>
                  <li>{t('فایل db-connection.txt را با Notepad باز کنید و طبق راهنمای داخل آن، خط mysql:// را تصحیح کنید.', 'د db-connection.txt فایل په Notepad کې پرانیزئ او د mysql:// کرښه سم کړئ.', 'Open db-connection.txt in Notepad and edit the mysql:// line as guided inside.')}</li>
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

// ---------------- پیوند هاست (سرور مرکزی) — فقط نسخهٔ اندروید مستقل ----------------
/*
 * در APK، «هاست» = آدرس نسخهٔ وب نصب‌شده (همان سروری که دیتابیس MySQL را سرو می‌کند).
 * ورود اول باید با کاربرانِ دیتابیس همان سرور انجام شود؛ بعد از هر ورود موفق،
 * کپی آفلاین دستگاه با دیتای سرور بروز می‌شود تا در حالت آفلاین هم کار کند.
 */
function ApkHostLinkCard() {
  const { t } = useI18n()
  const [cfg, setCfg] = useState<HostConfig | null>(() => getHostConfig())
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<'test' | 'pull' | 'save' | null>(null)
  const [probeOk, setProbeOk] = useState<boolean | null>(null)

  async function runTest() {
    setBusy('test')
    try {
      const r = await apiPost<{ ok?: boolean; version?: string | null; error?: string }>('/api/system/host-sync', { action: 'test' })
      setProbeOk(!!r?.ok)
      if (r?.ok) {
        toast.success(t(`اتصال برقرار است${r.version ? ` — نسخهٔ ${r.version}` : ''}`, `نښلون برقرار دی${r.version ? ` — نسخه ${r.version}` : ''}`, `Connection OK${r.version ? ` (v${r.version})` : ''}`))
      } else {
        toast.error(r?.error || t('سرور در دسترس نیست', 'سرور نه لرېږي', 'Server unreachable'))
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }

  async function runPull() {
    setBusy('pull')
    try {
      const r = await apiPost<{ ok?: boolean; rows?: number | null; error?: string }>('/api/system/host-sync', { action: 'pull' })
      if (r?.ok) {
        setCfg(getHostConfig())
        setProbeOk(true)
        toast.success(t(`کپی آفلاین بروز شد — ${r.rows ?? 0} رکورد`, `افلاین کاپی تازه شوه — ${r.rows ?? 0} ریکارډ`, `Offline copy updated — ${r.rows ?? 0} rows`))
      } else {
        toast.error(r?.error || t('کپی گرفتن ناموفق بود', 'کاپی اخیستنه ناکامه شوه', 'Copy failed'))
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e))
    } finally {
      setBusy(null)
    }
  }

  async function saveEdit() {
    const url = normalizeHostUrl(draft)
    if (!url) {
      toast.error(t('آدرس سرور را وارد کنید', 'پتهٔ سرور ولیکئ', 'Enter the server address'))
      return
    }
    setBusy('save')
    try {
      // ورودی خام داده می‌شود تا اگر پروتکل ننوشته بود، https و http هر دو امتحان شوند
      const p = await probeHost(draft)
      // مهم: آدرسی ذخیره می‌شود که واقعاً جواب داده (ممکن است http باشد)
      const savedUrl = p.ok && p.triedUrl ? p.triedUrl : url
      const next: HostConfig = { ...(cfg ?? { url: '' }), url: savedUrl }
      if (p.ok) {
        next.verifiedAt = new Date().toISOString()
        next.serverVersion = p.version
        next.lastPullError = null
      }
      saveHostConfig(next)
      setCfg(getHostConfig())
      setEditing(false)
      setProbeOk(p.ok ? true : false)
      toast.success(
        p.ok
          ? t('آدرس سرور ذخیره و تأیید شد ✓', 'پته خوندي او تایید شوه ✓', 'Server address saved & verified ✓')
          : t('ذخیره شد — اما تست اتصال ناموفق بود', 'خوندي شو — خو ازمویښته ناکامه شوه', 'Saved — but the test failed')
      )
    } finally {
      setBusy(null)
    }
  }

  function removeHost() {
    clearHostConfig()
    toast.success(t('اتصال سرور حذف شد — برای تنظیم مجدد، راه‌اندازی اولیه باز می‌شود', 'د سرور نښلون ړنګ شو — د بیا تنظیم لپاره لومړنۍ راه‌اندازې پرانیستل کیږي', 'Server connection removed — first-run setup will reopen'))
    setTimeout(() => { window.location.href = '/' }, 900)
  }

  /** فایل تنظیمات برای نصب‌های جدید — آدرس همین سرور داخل آن است؛ در ویزارد اولین باز شدن آپلود می‌شود */
  function downloadSetupFileJson() {
    if (!cfg?.url) {
      toast.error(t('اول آدرس سرور را ذخیره کنید', 'لومړی د سرور پته خوندي کړئ', 'Save the server address first'))
      return
    }
    if (downloadHostSetupJsonFile(cfg.url, null)) {
      toast.success(
        t(
          'فایل تنظیمات دانلود شد — برای نصب‌های جدید بفرستید؛ در اولین باز شدن برنامه، فایل را در ویزارد «آپلود فایل تنظیمات» انتخاب می‌کنند و آدرس سرور خودکار تنظیم می‌شود',
          'د تنظیماتو فایل دانلود شو — د نویو نصبونو لپاره یې ولېږئ؛ په ویزارد کې اپلودېږي',
          'Setup file downloaded — send it to new installs; they pick it in the first-run wizard and the server address configures automatically'
        )
      )
    } else {
      toast.error(t('خطا در ساخت فایل', 'د فایل جوړولو ستونزه', 'Could not build the file'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4 text-primary" />
          {t('اتصال به سرور مرکزی (هاست)', 'مرکزي سرور (هوسټ) ته نښلول', 'Central server (host) connection')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!editing ? (
          <>
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1 rounded-lg border bg-muted/40 px-3 py-2">
                {probeOk === false ? <WifiOff className="h-4 w-4 shrink-0 text-amber-600" /> : <Wifi className="h-4 w-4 shrink-0 text-emerald-600" />}
                <span dir="ltr" className="text-sm truncate">{cfg?.url}</span>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={runTest} disabled={busy !== null}>
                  <RefreshCw className={busy === 'test' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                  {t('تست', 'ازمویښته', 'Test')}
                </Button>
                <Button size="sm" className="h-9 gap-1.5" onClick={runPull} disabled={busy !== null}>
                  <RefreshCw className={busy === 'pull' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
                  {t('بروزرسانی کپی آفلاین', 'افلاین کاپی تازه کول', 'Update offline copy')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={downloadSetupFileJson}
                  title={t('فایل تنظیمات برای نصب‌های جدید — در اولین باز شدن برنامه آپلود می‌شود', 'د تنظیماتو فایل د نویو نصبونو لپاره', 'Setup file for new installs — uploaded in the first-run wizard')}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('فایل تنظیمات', 'د تنظیماتو فایل', 'Setup file')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={() => { setDraft(cfg?.url ?? ''); setEditing(true) }}
                >
                  {t('تغییر آدرس', 'پته بدلول', 'Change address')}
                </Button>
                <Button variant="ghost" size="sm" className="h-9 text-destructive hover:text-destructive" onClick={removeHost}>
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('حذف', 'ړنګول', 'Remove')}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground leading-5">
              {t(
                'ورود با کاربرانِ دیتابیس همین سرور انجام می‌شود؛ بعد از هر ورود موفق، کپی آفلاین دستگاه خودکار بروز می‌شود تا بدون انترنت هم برنامه کار کند.',
                'ننوتل د همدې سرور ډېټابیس کارنانو سره کیږي؛ د هر بریالي ننوتلو وروسته افلاین کاپی اتومات تازه کیږي چې له انټرنېټ پرته هم پروګرام کار وکړي.',
                'Sign-in uses the users of this server\u2019s database; after each successful sign-in the offline copy refreshes so the app works without internet too.'
              )}
            </p>
            {(cfg?.lastPullAt || cfg?.lastPullError) && (
              <div className="text-xs space-y-1">
                {cfg?.lastPullAt && (
                  <p className="text-muted-foreground">
                    {t('آخرین کپی موفق:', 'وروستنی بریالی کاپی:', 'Last successful copy:')}{' '}
                    <span dir="ltr">{new Date(cfg.lastPullAt).toLocaleString()}</span>
                  </p>
                )}
                {cfg?.lastPullError && (
                  <p className="text-destructive">
                    {t('آخرین خطای کپی:', 'وروستنیه کاپي ستونزه:', 'Last copy error:')}{' '}
                    <span dir="ltr">{cfg.lastPullError}</span>
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="space-y-3">
            <Label htmlFor="host-url-edit">{t('آدرس جدید سرور', 'د سرور نوی پته', 'New server address')}</Label>
            <div className="flex gap-2">
              <Input
                id="host-url-edit"
                dir="ltr"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="https://erp.example.com"
                inputMode="url"
              />
              <Button className="h-10 shrink-0" onClick={saveEdit} disabled={busy !== null}>
                {busy === 'save' ? '...' : t('ذخیره', 'خوندي', 'Save')}
              </Button>
              <Button variant="ghost" className="h-10 shrink-0" onClick={() => setEditing(false)} disabled={busy !== null}>
                {t('انصراف', 'لغوه', 'Cancel')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t('آدرس تست و سپس ذخیره می‌شود؛ اگر سرور در دسترس نباشد باز هم ذخیره می‌شود ولی با هشدار.', 'پته ازمویښتې او بیا خوندي کیږي؛ که سرور نه لرېږي هم خوندي کیږي خو د خبرداري سره.', 'The address is tested then saved; if unreachable it is still saved with a warning.')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
