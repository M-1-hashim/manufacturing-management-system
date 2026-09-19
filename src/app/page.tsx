'use client'

/**
 * سیستم مدیریتی جامع تولید — نسخه SPA تک‌صفحه‌ای
 * صنایع تولیدی افغانستان | دری / پشتو / انگلیسی | RTL
 * ادمین: دسترسی کامل | کارکنان بخش‌ها: دسترسی به ماژول‌های بخش خود
 */
import { useEffect, useState } from 'react'
import { useAppStore, type SessionUser } from '@/lib/store'
import { I18nProvider, useI18n } from '@/lib/i18n'
import { DirectionProvider } from '@radix-ui/react-direction'
import { apiGet, apiPost } from '@/lib/api'
import { installAuthInterceptor } from '@/lib/auth-client'
import { installOfflineInterceptor, trySync, refreshPendingCount, clearOfflineCache } from '@/lib/offline-client'
import { LOCAL_MODE, installLocalApi } from '@/lib/local-api'
import { decideFirstRun } from '@/lib/first-run'
import { canAccess, roleLabel, departmentLabel } from '@/lib/rbac'
import { getHostConfig, getSavedCreds, saveCreds, probeHost } from '@/lib/host-link'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  LayoutDashboard, Package, FlaskConical, Boxes, Factory, ShoppingCart,
  Warehouse, Wallet, Users, BarChart3, Settings, LogOut, Menu, X,
  Wifi, WifiOff, Languages, Sun, Moon, Lock, UserCog, History, KeyRound, RefreshCw, Palette, Check,
  Cloud, CloudOff, Database, Download, MonitorDown, Smartphone,
} from 'lucide-react'

import DashboardModule from '@/components/modules/dashboard'
import BackupMenu from '@/components/shared/backup-menu'
import SetupWizard from '@/components/shared/setup-wizard'
import ApkHostWizard from '@/components/shared/apk-host-wizard'
import ProductsModule from '@/components/modules/products'
import MaterialsModule from '@/components/modules/materials'
import FormulasModule from '@/components/modules/formulas'
import ProductionModule from '@/components/modules/production'
import SalesModule from '@/components/modules/sales'
import InventoryModule from '@/components/modules/inventory'
import FinanceModule from '@/components/modules/finance'
import HrModule from '@/components/modules/hr'
import ReportsModule from '@/components/modules/reports'
import SettingsModule from '@/components/modules/settings'
import UsersModule from '@/components/modules/users'
import AuditModule from '@/components/modules/audit'

// حالت محلی (نسخهٔ اندروید مستقل) — موتور API محلی قبل از هر رندری نصب می‌شود
// تا تمام درخواست‌های /api/* بدون هاست، در داخل خود برنامه پاسخ بگیرند
if (LOCAL_MODE) installLocalApi()

// رهگیری سراسری 401 + لایهٔ آفلاین/همگام‌سازی — در module-scope نصب می‌شوند تا fetchهای
// همزمانِ mount-effect فرزندان (که قبل از اجرای effect والد رخ می‌دهند) هم پوشش داده شوند.
// هر دو نصب‌کننده idempotent و گارد window دارند (در SSR بی‌اثرند).
installAuthInterceptor()
if (!LOCAL_MODE) installOfflineInterceptor()

const NAV = [
  { id: 'dashboard', fa: 'داشبورد', ps: 'معلوماتي پاڼه', en: 'Dashboard', icon: LayoutDashboard },
  { id: 'products', fa: 'محصولات', ps: 'محصولات', en: 'Products', icon: Package },
  { id: 'materials', fa: 'مواد خام', ps: 'خام مواد', en: 'Raw Materials', icon: Boxes },
  { id: 'formulas', fa: 'فرمولاسیون', ps: 'فورمولونه', en: 'Formulas (BOM)', icon: FlaskConical },
  { id: 'production', fa: 'تولید', ps: 'تولید', en: 'Production', icon: Factory },
  { id: 'sales', fa: 'فروش', ps: 'پلورنه', en: 'Sales', icon: ShoppingCart },
  { id: 'inventory', fa: 'انبار', ps: 'ګدام', en: 'Inventory', icon: Warehouse },
  { id: 'finance', fa: 'مدیریت مالی', ps: 'مالي', en: 'Finance', icon: Wallet },
  { id: 'hr', fa: 'کارکنان', ps: 'کارکوونکي', en: 'HR', icon: Users },
  { id: 'reports', fa: 'گزارشات', ps: 'راپورونه', en: 'Reports', icon: BarChart3 },
  { id: 'users', fa: 'کاربران سیستم', ps: 'کاروونکي', en: 'Users', icon: UserCog },
  { id: 'audit', fa: 'فعالیت‌ها', ps: 'فعالیتونه', en: 'Activity Log', icon: History },
  { id: 'settings', fa: 'تنظیمات', ps: 'امستنې', en: 'Settings', icon: Settings },
] as const

// گروه‌بندی منوی کنار — برای خوانایی بهتر
const NAV_GROUPS: { key: string; labelFa: string; labelPs: string; labelEn: string; items: readonly string[] }[] = [
  { key: 'ops', labelFa: 'اجراؤات روزانه', labelPs: 'ورځني کارونه', labelEn: 'Daily operations', items: ['dashboard', 'products', 'materials', 'formulas', 'production', 'sales'] },
  { key: 'mgmt', labelFa: 'مدیریت', labelPs: 'مدیریت', labelEn: 'Management', items: ['inventory', 'finance', 'hr', 'reports'] },
  { key: 'sys', labelFa: 'سیستم', labelPs: 'سیسټم', labelEn: 'System', items: ['users', 'audit', 'settings'] },
]

// تم‌های رنگی برنامه — swatch برای نمایش در منو و ویزارد
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

// ---------------- تغییر پسورد (پروفایل) ----------------
function ProfileDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n()
  const user = useAppStore((s) => s.user)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function reset() {
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (next.length < 6) {
      setError(t('پسورد جدید باید حداقل 6 کاراکتر باشد', 'نوی پټ نوم باید لږ تر لږه 6 توري وي', 'New password must be at least 6 characters'))
      return
    }
    if (next !== confirm) {
      setError(t('تکرار پسورد جدید مطابقت ندارد', 'د نوي پټ نوم تکرار سم نه دی', 'Password confirmation does not match'))
      return
    }
    setLoading(true)
    try {
      await apiPost('/api/auth/change-password', { currentPassword: current, newPassword: next })
      toast.success(t('پسورد با کامیابی تغییر کرد', 'پټ نوم په بریالیتوب بدل شو', 'Password changed successfully'))
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('خطا در تغییر پسورد', 'د پټ نوم بدلون کې ستونزه', 'Failed to change password'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { reset(); onClose() } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            {t('تغییر پسورد', 'پټ نوم بدلول', 'Change password')}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{user?.username ? `${t('کاربر', 'کارن', 'User')}: ${user.username}` : ''}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pw">{t('پسورد فعلی', 'اوسنی پټ نوم', 'Current password')}</Label>
            <Input id="cur-pw" dir="ltr" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">{t('پسورد جدید', 'نوی پټ نوم', 'New password')}</Label>
            <Input id="new-pw" dir="ltr" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf-pw">{t('تکرار پسورد جدید', 'د نوي پټ نوم تکرار', 'Confirm new password')}</Label>
            <Input id="conf-pw" dir="ltr" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose() }}>
              {t('انصراف', 'لغوه', 'Cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('در حال ذخیره...', 'ثبتول...', 'Saving...') : t('تغییر پسورد', 'پټ نوم بدلول', 'Change')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// برای toast — import در سطح بالا (sonner)
import { toast } from 'sonner'

// ---------------- ریست رمز ادمین (فراموشی رمز) ----------------
interface AdminResetApiT {
  prepare: () => Promise<{ ok: boolean; path?: string; existed?: boolean; error?: string }>
  status: () => Promise<{ ok: boolean; exists: boolean; path?: string; paths?: string[] }>
}

function getAdminResetApi(): AdminResetApiT | null {
  try {
    return (window as unknown as { adminReset?: AdminResetApiT }).adminReset ?? null
  } catch {
    return null
  }
}

/**
 * راهنمای «رمز ادمین را فراموش کرده‌ام» — مکانیزم فایل reset-admin-password.txt.
 * دسکتاپ: فایل با یک کلیک از همین دیالوگ ساخته می‌شود (بدون ری‌استارت).
 * وب: ساخت فایل در پوشهٔ برنامه روی سرور (cPanel File Manager).
 * اندروید: رمز روی سرور است — ریست از نسخهٔ وب/ویندوز.
 */
function ForgotPasswordDialog({
  open,
  onClose,
  onPrefill,
  isApp,
}: {
  open: boolean
  onClose: () => void
  onPrefill: (username: string, password: string) => void
  isApp: boolean
}) {
  const { t } = useI18n()
  const [resetApi] = useState(() => getAdminResetApi())
  const [status, setStatus] = useState<'idle' | 'working' | 'ready' | 'error'>('idle')
  const [filePath, setFilePath] = useState<string | null>(null)
  const [existed, setExisted] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // وضعیت فایل هنگام باز شدن دیالوگ — اگر از قبل ساخته شده، فوراً «آماده» نشان داده می‌شود
  useEffect(() => {
    if (!open || !resetApi) return
    let alive = true
    resetApi
      .status()
      .then((s) => {
        if (!alive) return
        if (s.exists && s.paths && s.paths[0]) {
          setFilePath(s.paths[0])
          setExisted(true)
          setStatus('ready')
        }
      })
      .catch(() => {}) /* بی‌اهمیت — دکمه ساخت همچنان کار می‌کند */
    return () => {
      alive = false
    }
  }, [open, resetApi])

  function handleCreateFile() {
    if (!resetApi) return
    setStatus('working')
    setErr(null)
    resetApi
      .prepare()
      .then((r) => {
        if (r.ok && r.path) {
          setFilePath(r.path)
          setExisted(!!r.existed)
          setStatus('ready')
          toast.success(t('فایل ریست ساخته شد', 'د ریست فایل جوړ شو', 'Reset file created'))
        } else {
          setErr(r.error || t('ساخت فایل ناموفق بود', 'جوړول ناکام شو', 'Failed to create file'))
          setStatus('error')
        }
      })
      .catch((e: unknown) => {
        setErr(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
  }

  function handleFillAndClose() {
    onPrefill('admin', 'admin123')
    onClose()
    toast.info(
      t('فرم پر شد — فقط دکمهٔ داخل شدن را بزنید', 'فورم ډک شو — یوازې د ننوتلو تڼۍ کېکاږئ', 'Form filled — just press Sign in')
    )
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            {t('بازیابی رمز ادمین', 'د اډمین پټ نوم بېرته راوړل', 'Admin password recovery')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground leading-6">
            {t(
              'اگر رمز کاربر admin را فراموش کرده‌اید، با فایل ریست، رمز برمی‌گردد — بدون دستکاری دیتابیس؛ همهٔ دیتای کارخانه دست‌نخورده می‌ماند.',
              'که د اډمین پټ نوم مو هېر کړی وي، د ریست فایل سره پټ نوم بېرته راځي — ډېټا نه بدلیږي؛ ټولې فابریکې ډېټا خوندي پاتې کېږي.',
              'If you forgot the admin password, the reset file restores it — no database edits; all factory data stays untouched.'
            )}
          </p>

          {/* دسکتاپ — ساخت فایل با یک کلیک */}
          {resetApi && (
            <div className="space-y-3">
              <ol className="space-y-2 list-none">
                {[
                  t('دکمهٔ زیر را بزنید تا فایل ریست ساخته شود (یا با Notepad خودتان بسازید).', 'لاندې تڼۍ کېکاږئ چې د ریست فایل جوړ شي (یا په Notepad په خپله جوړ کړئ).', 'Press the button below to create the reset file (or create it yourself in Notepad).'),
                  t('رمز ادمین به admin123 برمی‌گردد (در فایل قابل تغییر است).', 'د اډمین پټ نوم admin123 ته ګرځي (په فایل کې بدلېدلی شي).', 'Admin password becomes admin123 (editable in the file).'),
                  t('در صفحهٔ ورود، admin / admin123 را وارد و «داخل شدن» را بزنید — ری‌استارت لازم نیست.', 'په ننوتلو پاڼه کې admin / admin123 ليککل او «ننوتل» کېکاږئ — بیا چارتوب نه غواړي.', 'Enter admin / admin123 on the sign-in screen and press Sign in — no restart needed.'),
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-6">{step}</span>
                  </li>
                ))}
              </ol>

              {status !== 'ready' && (
                <Button type="button" onClick={handleCreateFile} disabled={status === 'working'} className="w-full h-10">
                  {status === 'working' ? t('در حال ساخت...', 'جوړول...', 'Creating...') : t('ساخت فایل ریست رمز', 'د پټ نوم ریست فایل جوړول', 'Create password reset file')}
                </Button>
              )}

              {status === 'ready' && filePath && (
                <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2.5">
                  <p className="text-emerald-700 dark:text-emerald-400 font-medium text-[13px]">
                    {existed
                      ? t('فایل ریست از قبل موجود است ✓', 'د ریست فایل له دمخه موجود دی ✓', 'Reset file already exists ✓')
                      : t('فایل ریست ساخته شد ✓', 'د ریست فایل جوړ شو ✓', 'Reset file created ✓')}
                  </p>
                  <p className="text-[12px] text-muted-foreground leading-5">
                    {t('مسیر فایل:', 'د فایل مسیر:', 'File path:')}
                    <code dir="ltr" className="block mt-1 rounded bg-muted px-2 py-1.5 text-[11px] break-all text-start">
                      {filePath}
                    </code>
                  </p>
                  <Button type="button" onClick={handleFillAndClose} className="w-full h-10">
                    {t('پر کردن فرم ورود با admin / admin123', 'د ننوتلو فورم ډکول admin / admin123', 'Fill sign-in form with admin / admin123')}
                  </Button>
                </div>
              )}

              {status === 'error' && err && (
                <p className="text-sm text-destructive" role="alert">{err}</p>
              )}

              <p className="text-[12px] text-muted-foreground leading-5">
                {t(
                  'بعد از ورود، از «تنظیمات → پروفایل» رمز جدید بگذارید. فایل ریست خودکار بی‌اثر می‌شود (به done. تغییر نام می‌یابد).',
                  'وروسته له ننوتله، له «امستنې → پروفایل» نوی پټ نوم کېږدئ. د ریست فایل په اتوماتیک ډول بې‌اثره کېږي.',
                  'After signing in, set a new password from Settings → Profile. The reset file is auto-consumed (renamed to .done).'
                )}
              </p>
            </div>
          )}

          {/* وب/سرور — ساخت دستی فایل روی هاست */}
          {!resetApi && !isApp && (
            <div className="space-y-3">
              <ol className="space-y-2 list-none">
                {[
                  t('در cPanel → File Manager به پوشهٔ اصلی برنامه بروید (همان‌جا که فایل‌های server.js و .next هستند).', 'په cPanel → File Manager کې اصلي پروګرام فولډر ته لاړ شئ (هلته چې server.js او .next دي).', 'In cPanel → File Manager, go to the app root folder (where server.js and .next live).'),
                  t('فایلی به نام reset-admin-password.txt بسازید با این یک خط:', 'د reset-admin-password.txt په نوم فایل جوړ کړئ د دې یوې کرښې سره:', 'Create a file named reset-admin-password.txt containing this line:'),
                ].map((step, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="leading-6">{step}</span>
                  </li>
                ))}
              </ol>
              <code dir="ltr" className="block rounded bg-muted px-2 py-1.5 text-[12px] text-start">
                password=admin123
              </code>
              <p className="leading-6">
                {t(
                  'سپس در صفحهٔ ورود با admin / admin123 وارد شوید. برای رمز دلخواه، همان خط را در فایل عوض کنید.',
                  'بیا په ننوتلو پاڼه کې admin / admin123 سره ننوځئ. د خوښې پټ نوم لپاره همدغه کرښه په فایل کې بدله کړئ.',
                  'Then sign in with admin / admin123. For a custom password, change that line in the file.'
                )}
              </p>
            </div>
          )}

          {/* اندروید — رمز روی سرور است */}
          {isApp && (
            <p className="rounded-xl border bg-muted/40 p-3 text-[13px] leading-6">
              {t(
                'در نسخهٔ اندروید، رمز ادمین روی سرور ذخیره است. از نسخهٔ وب یا ویندوز همین راهنما را اجرا کنید؛ بعد از ریست، با همان رمز جدید در اندروید هم وارد می‌شوید.',
                'په اندروید نسخه کې د اډمین پټ نوم په سرور کې دی. له ویب یا ویندوز نسخې همدغه لارښود پر مخ یوسئ؛ له ریست وروسته په اندروید کې هم په نوي پټ نوم ننوځئ.',
                'On Android the admin password lives on the server. Follow this guide from the web or Windows version; after the reset, sign in on Android with the same new password.'
              )}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// معلومات دانلود سِتب ویندوز (پاسخ GET /api/download/setup?info=1 — عمومی)
interface SetupDlInfoT {
  version: string
  setup: { available: boolean; sizeHuman: string | null }
  portable: { available: boolean; sizeHuman: string | null }
  apk?: { available: boolean; sizeHuman: string | null }
}

// وضعیت اتصال دیتابیس (پاسخ GET /api/system/connection-status)
interface DbStatusT {
  ok: boolean
  configured: boolean
  mode: 'local' | 'host-mysql' | 'host-offline'
  host: string | null
  port: string | null
  syncing: boolean
  offlineSince: string | null
  pendingPush: number | null
  lastError: string | null
}

// ---------------- Login ----------------
function LoginView() {
  const { t, lang } = useI18n()
  const setUser = useAppStore((s) => s.setUser)
  const setLang = useAppStore((s) => s.setLang)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hostCfg] = useState(() => (LOCAL_MODE ? getHostConfig() : null))
  const [hostProbe, setHostProbe] = useState<{ ok: boolean; error?: string } | null>(null)
  const [probing, setProbing] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)

  // پیش‌پرکردن فرم با حساب ذخیره‌شدهٔ موفق قبلی — ورود سریع و امکان ورود آفلاین
  useEffect(() => {
    const saved = getSavedCreds()
    if (saved) {
      setUsername(saved.username)
      setPassword(saved.password)
    }
  }, [])

  // نشان وضعیت سرور (فقط حالت محلی/APK که «هاست» آدرس نسخهٔ وب است)
  const reprobeHost = () => {
    if (!hostCfg) return
    setProbing(true)
    probeHost(hostCfg.url)
      .then((p) => setHostProbe({ ok: p.ok, error: p.error }))
      .catch(() => setHostProbe({ ok: false, error: 'unknown' }))
      .finally(() => setProbing(false))
  }
  useEffect(() => {
    if (!hostCfg) return
    setProbing(true)
    let alive = true
    probeHost(hostCfg.url)
      .then((p) => { if (alive) setHostProbe({ ok: p.ok, error: p.error }) })
      .catch(() => { if (alive) setHostProbe({ ok: false, error: 'unknown' }) })
      .finally(() => { if (alive) setProbing(false) })
    return () => { alive = false }
  }, [hostCfg])

  // دانلود عمومی سِتب — حتی بدون داخل شدن (هر فردی که لینک صفحه را باز کند)
  const [dlInfo, setDlInfo] = useState<SetupDlInfoT | null>(null)
  const [isApp, setIsApp] = useState(false) // داخل اپ اندروید (UA: SetabAndroid) — کارت‌های ویندوز پنهان می‌شوند
  useEffect(() => {
    let alive = true
    try { setIsApp(/SetabAndroid/.test(navigator.userAgent)) } catch { /* noop */ }
    fetch('/api/download/setup?info=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SetupDlInfoT | null) => { if (alive && (j?.setup?.available || j?.apk?.available)) setDlInfo(j) })
      .catch(() => { /* فایل موجود نیست — کارت نمایش داده نمی‌شود */ })
    return () => { alive = false }
  }, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const user = await apiPost<SessionUser>('/api/auth/login', { username, password })
      setUser(user)
      // ذخیرهٔ حساب موفق روی دستگاه — پیش‌پرکردن و ورود آفلاین بعدی
      // (نسخهٔ اندروید همین کار را در موتور هم می‌کند — دوباره‌نویسی بی‌ضرر است)
      saveCreds(username.trim(), password)
      toast.success(`${t('خوش آمدید', 'ښه راغلاست', 'Welcome')}, ${user.fullName}`)
      // اگر اجراؤات آفلاین در صف باشد، بلافاصله همگام‌سازی می‌شود
      void trySync()
      // نسخهٔ اندروید: بعد از ورود موفق، کپی آفلاین دستگاه با دیتای هاست بروز می‌شود
      if (LOCAL_MODE && getHostConfig()) {
        void (async () => {
          try {
            const r = await apiPost<{ ok?: boolean; rows?: number | null; error?: string }>('/api/system/host-sync', { action: 'pull' })
            if (r?.ok) {
              toast.success(t('کپی آفلاین با دیتای سرور بروز شد', 'افلاین کاپی د سرور له ډېټا سره تازه شوه', 'Offline copy updated from server'))
            } else if (r?.error) {
              toast.error(r.error)
            }
          } catch { /* در قطعی هاست بی‌اهمیت — ورود محلی سالم ماند */ }
        })()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('خطا در داخل شدن', 'د ننوتلو ستونزه', 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  const langLabel = lang === 'fa' ? 'دری' : lang === 'ps' ? 'پښتو' : 'EN'

  return (
    <div className="min-h-screen auth-hero flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid lg:grid-cols-[1.1fr_1fr] gap-0 rounded-2xl overflow-hidden border bg-card/60 backdrop-blur-xl shadow-2xl">
        {/* پنل برند — فقط دسکتاپ */}
        <div className="hidden lg:flex flex-col justify-between p-10 relative">
          <div>
            <div className="h-14 w-14 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg">
              <Factory className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight mt-6 leading-snug">
              {t('سیستم مدیریتی جامع تولید', 'د تولید جامع مدیریت سیسټم', 'Comprehensive Manufacturing ERP')}
            </h1>
            <p className="text-[13.5px] text-muted-foreground mt-3 leading-7 max-w-sm">
              {t(
                'مدیریت چرخهٔ کامل تولید — از مواد خام و فرمولاسیون تا تولید، فروش، انبار و مالی؛ همه در یک جا.',
                'د تولید بشپړ چورلیزه اداره — له خامو موادو او فورمولونو تر تولید، پلورنې، ګدام او مالي؛ ټول په یو ځای کې.',
                'Manage the full production cycle — raw materials and formulas to production, sales, inventory and finance; all in one place.'
              )}
            </p>
          </div>
          <ul className="space-y-3 text-[13px]">
            {(
              [
                [t('13 ماژول تخصصی', '13 مسلکي ماډلونه', '13 specialized modules')],
                [t('سه‌زبانه (دری/پشتو/انگلیسی) + راست‌به‌چپ', 'دوه‌ژبیز (دری/پښتو/انګلیسي) + RTL', 'Trilingual (Dari/Pashto/English) + RTL')],
                [t('کارکرد آفلاین + همگام‌سازی خودکار', 'افلاین کار کول + اتوماتیک همغه کول', 'Offline-ready with automatic sync')],
                [t('تقویم شمسی و افغانی', 'شمسي او افغاني تقویم', 'Shamsi & Afghan calendar')],
              ] as const
            ).map(([text]) => (
              <li key={text} className="flex items-center gap-2.5">
                <span className="h-5 w-5 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <Check className="h-3 w-3" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        {/* فورم ورود */}
        <div className="p-7 md:p-10 flex flex-col justify-center bg-card">
          <div className="lg:hidden text-center mb-6">
            <div className="mx-auto h-12 w-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-md mb-3">
              <Factory className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">{t('سیستم مدیریتی تولید', 'د تولید مدیریت سیسټم', 'Manufacturing ERP')}</h1>
          </div>

          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">{t('داخل شدن به سیستم', 'سیسټم ته ننوتل', 'Sign in')}</h2>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => setLang(lang === 'fa' ? 'ps' : lang === 'ps' ? 'en' : 'fa')} title={t('تغییر زبان', 'ژبه بدلول', 'Change language')}>
              <Languages className="h-4 w-4" />
              <span className="text-sm">{langLabel}</span>
            </Button>
          </div>

          {/* وضعیت سرور مرکزی — فقط نسخهٔ اندروید (هاست = آدرس نسخهٔ وب) */}
          {LOCAL_MODE && hostCfg && (
            <div className="mb-4 flex items-center justify-between gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-[12.5px]">
              <span className="flex items-center gap-1.5 min-w-0 text-muted-foreground">
                <Database className="h-3.5 w-3.5 shrink-0" />
                <span dir="ltr" className="truncate">{hostCfg.url}</span>
              </span>
              <button
                type="button"
                onClick={reprobeHost}
                disabled={probing}
                className={cn(
                  'flex items-center gap-1 shrink-0 font-medium',
                  hostProbe?.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                )}
                title={hostProbe?.ok ? t('سرور در دسترس است', 'سرور لرې دی', 'Server reachable') : hostProbe?.error || ''}
              >
                {probing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : hostProbe?.ok ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                {hostProbe?.ok
                  ? t('در دسترس', 'لرې', 'Online')
                  : t('قطع — ورود آفلاین', 'قطع — افلاین ننوتل', 'Offline sign-in')}
              </button>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('نام کاربری', 'کارن نوم', 'Username')}</Label>
              <Input id="username" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)}
                placeholder="admin" autoComplete="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('پسورد', 'پټ نوم', 'Password')}</Label>
              <Input id="password" dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password" required />
            </div>
            {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
            <Button type="submit" className="w-full h-11" disabled={loading}>
              {loading ? t('در حال داخل شدن...', 'ننوتل...', 'Signing in...') : <><Lock className="h-4 w-4 me-2" />{t('داخل شدن به سیستم', 'سیسټم ته ننوتل', 'Sign in')}</>}
            </Button>
            <button
              type="button"
              onClick={() => setForgotOpen(true)}
              className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors min-h-[44px] sm:min-h-0"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {t('رمز ادمین را فراموش کرده‌اید؟', 'د اډمین پټ نوم مو هېر دی؟', 'Forgot the admin password?')}
            </button>
          </form>

          <ForgotPasswordDialog
            open={forgotOpen}
            onClose={() => setForgotOpen(false)}
            onPrefill={(u, p) => {
              setUsername(u)
              setPassword(p)
            }}
            isApp={isApp}
          />

          {/* دانلود عمومی نصب‌کنندهٔ ویندوز — برای همه (بدون نیاز به حساب) — در اپ اندروید پنهان */}
          {!isApp && dlInfo?.setup.available && (
            <div className="mt-6 pt-5 border-t">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <MonitorDown className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm">{t('نسخهٔ ویندوز (سِتب)', 'د ویندوز نسخه (سېټ)', 'Windows version (Setup)')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-5">
                    {t(
                      `برای نصب روی کمپیوتر — ویندوز 10/11 (64 بیت) · ${dlInfo.setup.sizeHuman ?? ''}`,
                      `د کمپیوټر لپاره نصب — ویندوز 10/11 (64 بټ) · ${dlInfo.setup.sizeHuman ?? ''}`,
                      `For computer installation — Windows 10/11 (64-bit) · ${dlInfo.setup.sizeHuman ?? ''}`
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button asChild size="sm" className="h-9">
                      <a href="/api/download/setup" download>
                        <Download className="h-4 w-4 me-2" />
                        {t('دانلود سِتب', 'سېټ ښکته کول', 'Download setup')}
                      </a>
                    </Button>
                    {dlInfo.portable.available && (
                      <Button asChild size="sm" variant="outline" className="h-9">
                        <a href="/api/download/setup?variant=portable" download>
                          {t('نسخهٔ پرتابل (بدون نصب)', 'پرتابل نسخه (پرته له نصب)', 'Portable (no install)')}
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* دانلود نسخهٔ اندروید (APK) — مستقل از ویندوز، وصل به سرور */}
          {!isApp && dlInfo?.apk?.available && (
            <div className="mt-4 pt-5 border-t">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <Smartphone className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm">{t('نسخهٔ اندروید (سِتب)', 'د اندروید نسخه (سېټ)', 'Android version (Setup)')}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-5">
                    {t(
                      `برای موبایل و تبلت — بدون نیاز به کمپیوتر (اندروید ۷ به بالا) · ${dlInfo.apk.sizeHuman ?? ''}`,
                      `د موبایل او ټابلیټ لپاره — له کمپیوټر پرته (اندروید ۷ او وروسته) · ${dlInfo.apk.sizeHuman ?? ''}`,
                      `For phones & tablets — no computer needed (Android 7+) · ${dlInfo.apk.sizeHuman ?? ''}`
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button asChild size="sm" variant="outline" className="h-9">
                      <a href="/api/download/setup?variant=apk" download>
                        <Smartphone className="h-4 w-4 me-2" />
                        {t('دانلود APK', 'APK ښکته کول', 'Download APK')}
                      </a>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------- Shell ----------------
function Shell() {
  const { t, lang, dir } = useI18n()
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const pendingOps = useAppStore((s) => s.pendingOps)
  const [dark, setDark] = useState(false)
  const [colorTheme, setColorTheme] = useState('emerald')
  const [online, setOnline] = useState(true)
  const [dbStatus, setDbStatus] = useState<DbStatusT | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)

  // تم تیره/روشن + تم رنگی
  function applyColorTheme(id: string) {
    if (id === 'emerald') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem('mfg-color-theme', id)
    setColorTheme(id)
  }
  useEffect(() => {
    const isDark = localStorage.getItem('mfg-theme') === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
    const savedTheme = localStorage.getItem('mfg-color-theme') ?? 'emerald'
    if (savedTheme === 'emerald') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', savedTheme)
    const raf = requestAnimationFrame(() => { setDark(isDark); setColorTheme(savedTheme) })
    return () => cancelAnimationFrame(raf)
  }, [])
  function toggleTheme() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('mfg-theme', next ? 'dark' : 'light')
  }

  // تشخیص اتصال (آفلاین/آنلاین)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // وضعیت اتصال دیتابیس (هاست به کدام دیتابیس وصل است؟) — هر 20 ثانیه
  useEffect(() => {
    if (!user || !online) return
    let alive = true
    async function poll() {
      try {
        const s = await apiGet<DbStatusT>('/api/system/connection-status')
        if (alive) setDbStatus(s)
      } catch {
        if (alive) setDbStatus(null)
      }
    }
    void poll()
    const id = setInterval(poll, 20_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [user, online])

  // اعتبارسنجی نشست با هاست — اگر کوکی ختم شده/نامعتبر باشد خروج خودکار
  // (interceptor های auth/آفلاین در module-scope نصب شده‌اند — بالای فایل)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const raf = requestAnimationFrame(() => {
      apiGet<SessionUser>('/api/auth/me')
        .then((fresh) => { if (!cancelled) setUser(fresh) })
        .catch(() => { if (!cancelled) setUser(null) })
    })
    return () => { cancelled = true; cancelAnimationFrame(raf) }
  }, [])

  // اگر تب فعال برای این نقش مجاز نیست → داشبورد
  useEffect(() => {
    if (user && !canAccess(user, activeTab)) {
      const raf = requestAnimationFrame(() => setActiveTab('dashboard'))
      return () => cancelAnimationFrame(raf)
    }
  }, [user, activeTab, setActiveTab])

  async function handleLogout() {
    try {
      await apiPost('/api/auth/logout', {})
    } catch { /* کوکی در هر صورت پاک می‌شود */ }
    setProfileOpen(false)
    setUser(null)
    setActiveTab('dashboard')
    // کش داده‌های کاربر قبلی حذف می‌شود تا در صفحه ورود آفلاین قابل مشاهده نباشد
    void clearOfflineCache().then(() => refreshPendingCount())
  }

  if (!user)
    return (
      <DirectionProvider dir={dir}>
        <LoginView />
      </DirectionProvider>
    )

  const nav = NAV.filter((n) => canAccess(user, n.id))

  const moduleEl = (() => {
    switch (activeTab) {
      case 'dashboard': return <DashboardModule />
      case 'products': return <ProductsModule />
      case 'materials': return <MaterialsModule />
      case 'formulas': return <FormulasModule />
      case 'production': return <ProductionModule />
      case 'sales': return <SalesModule />
      case 'inventory': return <InventoryModule />
      case 'finance': return <FinanceModule />
      case 'hr': return <HrModule />
      case 'reports': return <ReportsModule />
      case 'users': return <UsersModule />
      case 'audit': return <AuditModule />
      case 'settings': return canAccess(user, 'settings') ? <SettingsModule /> : <DashboardModule />
      default: return <DashboardModule />
    }
  })()

  const langLabel = lang === 'fa' ? 'دری' : lang === 'ps' ? 'پښتو' : 'EN'
  const nextLang = lang === 'fa' ? 'ps' : lang === 'ps' ? 'en' : 'fa'

  // بج وضعیت اتصال دیتابیس — بر اساس وضعیت واقعی هاست (نه فقط navigator.onLine)
  const dbBadge = (() => {
    if (!online)
      return {
        cls: 'text-red-600 border-red-300',
        icon: <WifiOff className="h-3.5 w-3.5" />,
        label: t('آفلاین', 'آفلاین', 'Offline'),
        title: t('اتصال انترنت دستگاه قطع است', 'انترنت دستگاه قطع دی', 'Device internet is offline'),
      }
    if (dbStatus?.mode === 'host-offline')
      return {
        cls: 'border-amber-400 text-amber-600',
        icon: <CloudOff className="h-3.5 w-3.5" />,
        label: t('آفلاین — دیتابیس محلی', 'افلاین — ځایی ډاټابیس', 'Offline — Local DB'),
        title:
          t(
            'هاست در دسترس نیست — برنامه روی دیتابیس محلی کار می‌کند و بعد از وصل شدن، همهٔ تغییرات خودکار با هاست همگام می‌شود',
            'هوسټ نه لرېږي — پروګرام په ځایی ډاټابیس کار کوي او له نښلېدو وروسته ټول بدلونونه اتوماتیک همغه کېږي',
            'Host unreachable — the app works on the local database copy; all changes sync automatically once the host is back'
          ) +
          (dbStatus.pendingPush ? ` — ${dbStatus.pendingPush} ` + t('تغییر در انتظار', 'بدلون په انتظار', 'pending changes') : ''),
      }
    if (dbStatus?.syncing)
      return {
        cls: 'border-amber-400 text-amber-600',
        icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" />,
        label: t('همگام‌سازی…', 'همغه کول…', 'Syncing…'),
        title: t('در حال همگام‌سازی تغییرات آفلاین با هاست', 'د افلاین بدلونونو همغه کول', 'Syncing offline changes with the server'),
      }
    if (dbStatus?.mode === 'host-mysql')
      return {
        cls: 'text-emerald-600 border-emerald-300',
        icon: <Cloud className="h-3.5 w-3.5" />,
        label:
          dbStatus.pendingPush && dbStatus.pendingPush > 0
            ? t('همگام لحظه‌ای', 'لحظه‌يي همغه کول', 'Live sync')
            : t('به هاست وصل است', 'هاست نښلی', 'Server'),
        title:
          t(
            'همگام‌سازی لحظه‌ای فعال است — هر تغییر در چند ثانیه با هاست جابه‌جا می‌شود',
            'همغه کولو لحظه‌يي سیستم فعال دی — هر بدلون په څو ثانیو کې سره تبادله کېږي',
            'Live sync active — every change reaches the server within seconds'
          ) +
          (dbStatus.host ? `: ${dbStatus.host}` : '') +
          (dbStatus.pendingPush && dbStatus.pendingPush > 0
            ? ` — ${dbStatus.pendingPush} ` + t('در صف ارسال', 'په لیبل کې', 'queued')
            : ''),
      }
    if (dbStatus?.mode === 'local')
      return {
        cls: 'text-muted-foreground border-border',
        icon: <Database className="h-3.5 w-3.5" />,
        label: t('دیتابیس محلی', 'ځایی ډاټابیس', 'Local DB'),
        title: t('بدون هاست — دیتا فقط روی همین دستگاه ذخیره می‌شود', 'بې هوسټه — ډاټا یوازې په همدې دستگاه کې', 'No host configured — data stays on this device'),
      }
    return {
      cls: 'text-emerald-600 border-emerald-300',
      icon: <Wifi className="h-3.5 w-3.5" />,
      label: t('آنلاین', 'آنلاین', 'Online'),
      title: '',
    }
  })()

  return (
    <DirectionProvider dir={dir}>
    <div className="app-shell min-h-screen flex flex-col print:hidden" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex flex-1 overflow-x-clip">
        {/* overflow-x-clip: سایدبارِ بسته در موبایل با translate بیرون صفحه می‌رود؛
            بدون این، اسکرول افقی خیالی در موبایل ظاهر می‌شد (clip برخلاف hidden
            کانتینر اسکرول نمی‌سازد و sticky هدر نمی‌شکند) */}
        {/* پوشش موبایل */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden no-print" onClick={() => setSidebarOpen(false)} />
        )}

        {/* سایدبار */}
        <aside
          className={cn(
            'sidebar-tint fixed lg:sticky top-0 z-50 lg:z-auto h-screen w-64 shrink-0 border-e bg-sidebar text-sidebar-foreground flex flex-col no-print transition-transform duration-300',
            sidebarOpen ? 'translate-x-0' : 'max-lg:rtl:translate-x-full max-lg:ltr:-translate-x-full'
          )}
        >
          <div className="flex items-center gap-2.5 px-4 h-14 border-b shrink-0">
            <div className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Factory className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-[15.5px] tracking-tight truncate">{t('سیستم مدیریتی تولید', 'د تولید سیسټم', 'Mfg. ERP')}</p>
              <p className="text-[12.5px] text-muted-foreground truncate">{t('نسخه حرفه‌ای', 'مسلکي نسخه', 'Professional')}</p>
            </div>
            <button className="ms-auto lg:hidden p-1" onClick={() => setSidebarOpen(false)} aria-label="بستن منو">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-2.5" aria-label={t('منوی اصلی', 'اصلي مینو', 'Main menu')}>
            {NAV_GROUPS.map((group) => {
              const items = group.items
                .map((id) => nav.find((n) => n.id === id))
                .filter((n): n is (typeof NAV)[number] => !!n)
              if (items.length === 0) return null
              return (
                <div key={group.key}>
                  <p className="nav-label">{t(group.labelFa, group.labelPs, group.labelEn)}</p>
                  <div className="space-y-0.5 mb-1">
                    {items.map((item) => {
                      const active = activeTab === item.id
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setActiveTab(item.id as never); setSidebarOpen(false) }}
                          className={cn(
                            'relative w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-[15.5px] font-semibold transition-colors',
                            active
                              ? 'bg-primary/10 text-primary font-semibold'
                              : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          )}
                          aria-current={active ? 'page' : undefined}
                        >
                          {active && <span className="nav-active-bar" aria-hidden />}
                          <item.icon className="h-[18px] w-[18px] shrink-0" />
                          <span className="truncate">{t(item.fa, item.ps, item.en)}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </nav>

          <div className="p-2.5 border-t shrink-0">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[14px] font-bold shrink-0">
                {(user.fullName || user.username || '?').charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-semibold truncate">{user.fullName || user.username}</p>
                <p className="text-[12.5px] text-muted-foreground truncate">
                  {roleLabel(user.role, lang)}
                  {user.department && user.department !== 'general' ? ` · ${departmentLabel(user.department, lang)}` : ''}
                </p>
              </div>
              <button
                onClick={() => setProfileOpen(true)}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                aria-label={t('تغییر پسورد', 'پټ نوم بدلول', 'Change password')}
                title={t('تغییر پسورد', 'پټ نوم بدلول', 'Change password')}
              >
                <KeyRound className="h-4 w-4" />
              </button>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
                aria-label={t('خارج شدن', 'وتل', 'Logout')}
                title={t('خارج شدن', 'وتل', 'Logout')}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* محتوای اصلی */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 h-14 border-b bg-background/80 backdrop-blur flex items-center gap-2 px-2.5 md:px-6 no-print">
            <button className="lg:hidden p-2 -ms-2 rounded-md hover:bg-accent transition-colors" onClick={() => setSidebarOpen(true)} aria-label={t('باز کردن منو', 'مینو پرانول', 'Open menu')}>
              <Menu className="h-5 w-5" />
            </button>
            <h2 className="font-semibold text-[15px] md:text-base tracking-tight truncate">
              {t(nav.find((n) => n.id === activeTab)?.fa ?? '', nav.find((n) => n.id === activeTab)?.ps ?? '', nav.find((n) => n.id === activeTab)?.en ?? '')}
            </h2>

            <div className="ms-auto flex items-center gap-1.5">
              {pendingOps > 0 && (
                <button
                  onClick={() => void trySync()}
                  title={t('اجراؤات در انتظار همگام‌سازی — برای کوشش دستی کلیک کنید', 'د همغه کولو انتظار عملیې — لاسي هڅه', 'Operations pending sync — click to retry now')}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-amber-300 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="text-xs font-bold" dir="ltr">{pendingOps}</span>
                </button>
              )}
              <Badge variant="outline" className={cn('gap-1.5 h-8 px-2.5', dbBadge.cls)} title={dbBadge.title}>
                {dbBadge.icon}
                <span className="hidden sm:inline">{dbBadge.label}</span>
              </Badge>

              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => useAppStore.getState().setLang(nextLang as never)} title={t('تغییر زبان', 'ژبه بدلول', 'Change language')}>
                <Languages className="h-4 w-4" />
                <span className="text-sm">{langLabel}</span>
              </Button>

              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggleTheme} aria-label={t('تغییر تم', 'ټینګ بدلول', 'Toggle theme')}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              {/* انتخاب‌گر تم رنگی — گرادیان زندهٔ 11 تم */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={t('تم رنگی', 'رنګینه ټینګ', 'Color theme')} title={t('تم رنگی', 'رنګینه ټینګ', 'Color theme')}>
                    <Palette className="h-4 w-4" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-60 p-3">
                  <p className="text-xs font-semibold mb-2.5">{t('تم رنگی', 'د رنګ ټینګ', 'Color theme')}</p>
                  <div className="grid grid-cols-4 gap-2">
                    {COLOR_THEMES.map((ct) => (
                      <button
                        key={ct.id}
                        onClick={() => applyColorTheme(ct.id)}
                        title={t(ct.fa, ct.ps, ct.en)}
                        className={cn(
                          'h-9 rounded-lg flex items-center justify-center transition-transform hover:scale-105',
                          colorTheme === ct.id ? 'ring-2 ring-offset-1 ring-[var(--primary)]' : ''
                        )}
                        style={{ backgroundColor: ct.dot }}
                        aria-label={t(ct.fa, ct.ps, ct.en)}
                      >
                        {colorTheme === ct.id && <Check className="h-4 w-4 text-white drop-shadow" />}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-2.5 leading-4">
                    {t('رنگ کلیدها، چارتها و هایلایت‌ها را عوض می‌کند', 'د تڼیو، چارټونو او هایلایت رنګ بدلوي', 'Changes the color of buttons, charts and highlights')}
                  </p>
                </PopoverContent>
              </Popover>

              <BackupMenu onGoSettings={() => setActiveTab('settings')} />
            </div>
          </header>

          <main className="flex-1 p-2.5 md:p-6 w-full max-w-[1400px] mx-auto" key={activeTab}>
            {moduleEl}
          </main>

          {/* فوتر ثابت — پایین صفحه */}
          <footer className="mt-auto border-t py-3 px-2.5 text-center text-[11px] text-muted-foreground bg-background no-print">
            <p>
              {t(
                'سیستم مدیریتی جامع تولید — ساخته‌شده برای صنایع افغانستان',
                'د تولید جامع مدیریت سیسټم — د افغانستان صنعتونو لپاره',
                'Comprehensive Manufacturing ERP — Built for Afghan Industry'
              )}
              {' · '}
              <span dir="ltr">© {new Date().getFullYear()}</span>
            </p>
          </footer>
        </div>
      </div>

      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
    </DirectionProvider>
  )
}

// ---------------- دروازهٔ راه‌اندازی اولیه ----------------
/*
 * اولین باز شدن برنامه بعد از نصب → ویزارد تنظیمات (زبان/تم + هاست).
 * منطق تصمیم در src/lib/first-run.ts است (محض و قابل تست) — خلاصه:
 *   - نسخهٔ دسکتاپ (ویندوز): صفحهٔ اطلاعات هاست تا وقتی اتصال هاست **واقعاً**
 *     وصل نشده در هر اجرا نشان داده می‌شود — حتی اگر فایل db-connection.txt
 *     از قبل خط اتصال داشته باشد ولی عملاً وصل نمی‌شود (پروب TCP خرابی را
 *     می‌فهمد) ویزارد با مقادیر فعلی پیش‌پر و باز می‌شود. اگر کاربر «فقط این
 *     دستگاه» را انتخاب کند (فلگ mfg-setup-local-mode) دیگر تکرار نمی‌شود.
 *   - نسخهٔ اندروید (LOCAL_MODE): بدون ذخیرهٔ «اطلاعات هاست» (آدرس سرور مرکزی)
 *     — یا آدرسِ ذخیره‌شدهٔ بدون تست موفق — ویزارد ادامه می‌کند، حتی اگر
 *     کاربرِ قدیمی ذخیره شده باشد. بعد از نخستین ورود موفق، حساب روی دستگاه
 *     ذخیره می‌شود و آفلاین هم ورود ممکن است.
 *   - نسخهٔ وب (مرورگر): ویزارد نمایش داده نمی‌شود — اتصال هاست از env هاست می‌آید.
 * درگاه اضطراری ?setup=1 ویزارد را همیشه و در همه‌جا باز می‌کند.
 */
const SETUP_FLAG = 'mfg-setup-completed'
const LOCAL_ONLY_FLAG = 'mfg-setup-local-mode'

/** نتیجهٔ پینگ ناموفق هاست — برای بنر دلیل داخل ویزارد */
export interface DbPingFail {
  kind?: string | null
  error?: string | null
}

function FirstRunGate() {
  const { t } = useI18n()
  const [state, setState] = useState<'loading' | 'wizard' | 'app'>('loading')
  const [pingFail, setPingFail] = useState<DbPingFail | null>(null)

  useEffect(() => {
    let alive = true
    async function decide() {
      // درگاه اضطراری: باز کردن آدرس با ?setup=1 ویزارد را دوباره نشان می‌دهد
      const forceSetup = new URLSearchParams(window.location.search).get('setup') === '1'
      const localOnly = localStorage.getItem(LOCAL_ONLY_FLAG) === '1'
      const setupFlag = localStorage.getItem(SETUP_FLAG) === '1'
      const hasSavedUser = !!useAppStore.getState().user
      const hostCfg = getHostConfig()
      const base = {
        forceSetup,
        localOnly,
        setupFlag,
        hasSavedUser,
        localMode: LOCAL_MODE,
        hasHostConfig: !!hostCfg,
        hostConfigUnverified: !!hostCfg && !hostCfg.verifiedAt,
      }

      // ---- نسخهٔ دسکتاپ (ویندوز): وضعیت واقعی اتصال هاست بررسی می‌شود ----
      if (window.dbConnection) {
        let infoActive = false
        let infoReachable: boolean | null = null
        let infoDbOk: boolean | null = null
        try {
          const info = await window.dbConnection.info()
          infoActive = !!info.active
          infoReachable = typeof info.reachable === 'boolean' ? info.reachable : null
          // پروب TCP فقط «پورت باز» را می‌گوید — پینگ واقعی MySQL هم لازم است:
          // با فایل فعال و پورت باز، نام دیتابیس/رمز غلط فقط اینجا پیدا می‌شود
          if (infoActive && infoReachable !== false && !localOnly) {
            try {
              const r = await fetch('/api/system/host-ping', { cache: 'no-store' })
              if (r.ok) {
                const j = await r.json()
                infoDbOk = typeof j.ok === 'boolean' ? j.ok : null
                if (infoDbOk === false && alive) {
                  setPingFail({ kind: j.kind ?? null, error: j.error ?? null })
                }
              }
              // اگر endpoint نبود (نسخه‌های قدیمی سرور) → null — بدون حلقهٔ ویزارد
            } catch { infoDbOk = null }
          }
        } catch { /* IPC در دسترس نیست — ویزارد نشان بده */ }
        const d = decideFirstRun({ ...base, desktop: true, infoActive, infoReachable, infoDbOk })
        if (!alive) return
        if (d === 'app') {
          localStorage.setItem(SETUP_FLAG, '1')
          setState('app')
        } else {
          setState('wizard')
        }
        return
      }

      const d = decideFirstRun({ ...base, desktop: false, infoActive: false, infoReachable: null, infoDbOk: null })
      if (!alive) return
      if (d === 'wizard') {
        setState('wizard')
        return
      }
      // نصب قبلی (فلگ یا نشست ذخیره‌شده) — فلگ ثبت می‌شود و برنامه باز می‌شود
      localStorage.setItem(SETUP_FLAG, '1')
      setState('app')
    }
    void decide()
    return () => { alive = false }
  }, [])

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3" aria-busy="true">
        <div className="h-9 w-9 rounded-full border-[3px] border-primary border-t-transparent animate-spin" aria-hidden />
        <p className="text-[13px] text-muted-foreground">
          {t('در حال بررسی اتصال به هاست…', 'د هوسټ سره د نښلون په کتله کې…', 'Checking host connection…')}
        </p>
      </div>
    )
  }
  if (state === 'wizard') {
    return LOCAL_MODE
      ? <ApkHostWizard onDone={() => setState('app')} />
      : <SetupWizard onDone={() => setState('app')} dbPing={pingFail} />
  }
  return <Shell />
}

export default function Home() {
  return (
    <I18nProvider>
      <FirstRunGate />
    </I18nProvider>
  )
}

// v1.0.27 — ریست رمز ادمین (HMR touch)

// HMR touch 2
