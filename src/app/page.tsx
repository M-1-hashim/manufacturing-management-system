'use client'

/**
 * سامانه جامع مدیریت تولید — نسخه SPA تک‌صفحه‌ای
 * صنایع تولیدی افغانستان | دری / پشتو / انگلیسی | RTL
 * ادمین: دسترسی کامل | کارکنان بخش‌ها: دسترسی به ماژول‌های بخش خود
 */
import { useEffect, useState } from 'react'
import { useAppStore, type SessionUser } from '@/lib/store'
import { I18nProvider, useI18n } from '@/lib/i18n'
import { apiGet, apiPost } from '@/lib/api'
import { installAuthInterceptor } from '@/lib/auth-client'
import { installOfflineInterceptor, trySync, refreshPendingCount, clearOfflineCache } from '@/lib/offline-client'
import { canAccess, roleLabel, departmentLabel } from '@/lib/rbac'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import {
  LayoutDashboard, Package, FlaskConical, Boxes, Factory, ShoppingCart,
  Warehouse, Wallet, Users, BarChart3, Settings, LogOut, Menu, X,
  Wifi, WifiOff, Languages, Sun, Moon, Lock, UserCog, History, KeyRound, RefreshCw,
} from 'lucide-react'

import DashboardModule from '@/components/modules/dashboard'
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

const NAV = [
  { id: 'dashboard', fa: 'داشبورد', ps: 'معلوماتي پاڼه', en: 'Dashboard', icon: LayoutDashboard },
  { id: 'products', fa: 'محصولات', ps: 'محصولات', en: 'Products', icon: Package },
  { id: 'materials', fa: 'مواد خام', ps: 'خام مواد', en: 'Raw Materials', icon: Boxes },
  { id: 'formulas', fa: 'فرمولاسیون', ps: 'فورمولونه', en: 'Formulas (BOM)', icon: FlaskConical },
  { id: 'production', fa: 'تولید', ps: 'تولید', en: 'Production', icon: Factory },
  { id: 'sales', fa: 'فروش', ps: 'پلورنه', en: 'Sales', icon: ShoppingCart },
  { id: 'inventory', fa: 'انبار', ps: 'ګدام', en: 'Inventory', icon: Warehouse },
  { id: 'finance', fa: 'مالی', ps: 'مالي', en: 'Finance', icon: Wallet },
  { id: 'hr', fa: 'کارکنان', ps: 'کارکوونکي', en: 'HR', icon: Users },
  { id: 'reports', fa: 'گزارشات', ps: 'راپورونه', en: 'Reports', icon: BarChart3 },
  { id: 'users', fa: 'کاربران', ps: 'کاروونکي', en: 'Users', icon: UserCog },
  { id: 'audit', fa: 'فعالیت‌ها', ps: 'فعالیتونه', en: 'Activity Log', icon: History },
  { id: 'settings', fa: 'تنظیمات', ps: 'امستنې', en: 'Settings', icon: Settings },
] as const

// ---------------- تغییر رمز عبور (پروفایل) ----------------
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
      setError(t('رمز جدید باید حداقل ۶ کاراکتر باشد', 'نوی پټ نوم باید لږ تر لږه ۶ توري وي', 'New password must be at least 6 characters'))
      return
    }
    if (next !== confirm) {
      setError(t('تکرار رمز جدید مطابقت ندارد', 'د نوي پټ نوم تکرار سم نه دی', 'Password confirmation does not match'))
      return
    }
    setLoading(true)
    try {
      await apiPost('/api/auth/change-password', { currentPassword: current, newPassword: next })
      toast.success(t('رمز عبور با موفقیت تغییر کرد', 'پټ نوم په بریالیتوب بدل شو', 'Password changed successfully'))
      reset()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('خطا در تغییر رمز', 'د پټ نوم بدلون کې ستونزه', 'Failed to change password'))
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
            {t('تغییر رمز عبور', 'پټ نوم بدلول', 'Change password')}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{user?.username ? `${t('کاربر', 'کارن', 'User')}: ${user.username}` : ''}</p>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cur-pw">{t('رمز عبور فعلی', 'اوسنی پټ نوم', 'Current password')}</Label>
            <Input id="cur-pw" dir="ltr" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">{t('رمز عبور جدید', 'نوی پټ نوم', 'New password')}</Label>
            <Input id="new-pw" dir="ltr" type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conf-pw">{t('تکرار رمز جدید', 'د نوي پټ نوم تکرار', 'Confirm new password')}</Label>
            <Input id="conf-pw" dir="ltr" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => { reset(); onClose() }}>
              {t('انصراف', 'لغوه', 'Cancel')}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? t('در حال ذخیره...', 'ثبتول...', 'Saving...') : t('تغییر رمز', 'پټ نوم بدلول', 'Change')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// برای toast — import در سطح بالا (sonner)
import { toast } from 'sonner'

// ---------------- Login ----------------
function LoginView() {
  const { t } = useI18n()
  const setUser = useAppStore((s) => s.setUser)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const user = await apiPost<SessionUser>('/api/auth/login', { username, password })
      setUser(user)
      toast.success(`${t('خوش آمدید', 'ښه راغلاست', 'Welcome')}, ${user.fullName}`)
      // اگر عملیات آفلاین در صف باشد، بلافاصله همگام‌سازی می‌شود
      void trySync()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('خطا در ورود', 'د ننوتلو ستونزه', 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-50 via-white to-sky-50 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg mb-4">
            <Factory className="h-8 w-8" />
          </div>
          <h1 className="text-2xl font-bold">{t('سامانه مدیریت تولید', 'د تولید مدیریت سیسټم', 'Manufacturing ERP')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('مدیریت چرخه تولید از مواد خام تا فروش', 'له خامو موادو تر پلورنې د تولید چاپېریال', 'Production cycle: raw materials to sales')}
          </p>
        </div>

        <form onSubmit={handleLogin} className="rounded-2xl border bg-card p-6 shadow-xl space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">{t('نام کاربری', 'کارن نوم', 'Username')}</Label>
            <Input id="username" dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)}
              placeholder="admin" autoComplete="username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t('رمز عبور', 'پټ نوم', 'Password')}</Label>
            <Input id="password" dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••" autoComplete="current-password" required />
          </div>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="w-full h-11" disabled={loading}>
            {loading ? t('در حال ورود...', 'ننوتل...', 'Signing in...') : <><Lock className="h-4 w-4 me-2" />{t('ورود به سیستم', 'سیسټم ته ننوتل', 'Sign in')}</>}
          </Button>
          <div className="text-xs text-muted-foreground text-center space-y-1 pt-2 border-t">
            <p>{t('حساب ادمین:', 'د ادمین حساب:', 'Admin account:')} <span dir="ltr" className="font-mono">admin / admin123</span></p>
            <p>{t('کارکنان بخش‌ها با حساب اختصاصی خود وارد می‌شوند (ایجاد شده توسط ادمین)', 'د برخو کارکوونکي په خپلو ځانګړو حسابونو ننوځي', 'Department staff sign in with their own accounts (created by admin)')}</p>
          </div>
        </form>
      </div>
    </div>
  )
}

// ---------------- Shell ----------------
function Shell() {
  const { t, lang } = useI18n()
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const activeTab = useAppStore((s) => s.activeTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const sidebarOpen = useAppStore((s) => s.sidebarOpen)
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen)
  const pendingOps = useAppStore((s) => s.pendingOps)
  const [dark, setDark] = useState(false)
  const [online, setOnline] = useState(true)
  const [profileOpen, setProfileOpen] = useState(false)

  // تم تیره/روشن
  useEffect(() => {
    const isDark = localStorage.getItem('mfg-theme') === 'dark'
    document.documentElement.classList.toggle('dark', isDark)
    const raf = requestAnimationFrame(() => setDark(isDark))
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

  // اعتبارسنجی نشست با سرور — اگر کوکی منقضی/نامعتبر باشد خروج خودکار
  useEffect(() => {
    // رهگیری سراسری 401 + لایه آفلاین/همگام‌سازی — همه fetch های مستقیم ماژول‌ها را هم پوشش می‌دهد
    installAuthInterceptor()
    installOfflineInterceptor()
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

  if (!user) return <LoginView />

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

  return (
    <div className="min-h-screen flex flex-col" dir={lang === 'en' ? 'ltr' : 'rtl'}>
      <div className="flex flex-1">
        {/* پوشش موبایل */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden no-print" onClick={() => setSidebarOpen(false)} />
        )}

        {/* سایدبار */}
        <aside
          className={cn(
            'fixed lg:sticky top-0 z-50 lg:z-auto h-screen w-64 shrink-0 border-e bg-sidebar text-sidebar-foreground flex flex-col no-print transition-transform duration-300',
            sidebarOpen ? 'translate-x-0' : 'max-lg:rtl:translate-x-full max-lg:ltr:-translate-x-full'
          )}
        >
          <div className="flex items-center gap-2.5 px-4 h-16 border-b shrink-0">
            <div className="h-9 w-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
              <Factory className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-sm truncate">{t('سامانه تولید', 'د تولید سیسټم', 'Mfg. ERP')}</p>
              <p className="text-xs text-muted-foreground truncate">{t('نسخه حرفه‌ای', 'مسلکي نسخه', 'Professional')}</p>
            </div>
            <button className="ms-auto lg:hidden p-1" onClick={() => setSidebarOpen(false)} aria-label="بستن منو">
              <X className="h-5 w-5" />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto p-2 space-y-0.5" aria-label={t('منوی اصلی', 'اصلي مینو', 'Main menu')}>
            {nav.map((item) => {
              const active = activeTab === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => { setActiveTab(item.id as never); setSidebarOpen(false) }}
                  className={cn(
                    'w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground/80'
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <item.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{t(item.fa, item.ps, item.en)}</span>
                </button>
              )
            })}
          </nav>

          <div className="p-3 border-t shrink-0">
            <div className="flex items-center gap-2.5 px-2 py-1.5">
              <div className="h-8 w-8 rounded-full bg-secondary text-secondary-foreground flex items-center justify-center text-sm font-bold shrink-0">
                {user.fullName.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{user.fullName}</p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {roleLabel(user.role, lang)}
                  {user.department && user.department !== 'general' ? ` · ${departmentLabel(user.department, lang)}` : ''}
                </p>
              </div>
              <button
                onClick={() => setProfileOpen(true)}
                className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground"
                aria-label={t('تغییر رمز عبور', 'پټ نوم بدلول', 'Change password')}
                title={t('تغییر رمز عبور', 'پټ نوم بدلول', 'Change password')}
              >
                <KeyRound className="h-4 w-4" />
              </button>
              <button
                onClick={handleLogout}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-destructive"
                aria-label={t('خروج', 'وتل', 'Logout')}
                title={t('خروج', 'وتل', 'Logout')}
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        {/* محتوای اصلی */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-30 h-16 border-b bg-background/80 backdrop-blur flex items-center gap-2 px-4 no-print">
            <button className="lg:hidden p-2 -ms-2 rounded-md hover:bg-accent" onClick={() => setSidebarOpen(true)} aria-label={t('باز کردن منو', 'مینو پرانول', 'Open menu')}>
              <Menu className="h-5 w-5" />
            </button>
            <h2 className="font-bold text-base md:text-lg truncate">
              {t(nav.find((n) => n.id === activeTab)?.fa ?? '', nav.find((n) => n.id === activeTab)?.ps ?? '', nav.find((n) => n.id === activeTab)?.en ?? '')}
            </h2>

            <div className="ms-auto flex items-center gap-1.5">
              {pendingOps > 0 && (
                <button
                  onClick={() => void trySync()}
                  title={t('عملیات در انتظار همگام‌سازی — برای تلاش دستی کلیک کنید', 'د همغه کولو انتظار عملیات — لاسي هڅه', 'Operations pending sync — click to retry now')}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-amber-300 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="text-xs font-bold" dir="ltr">{pendingOps}</span>
                </button>
              )}
              <Badge variant="outline" className={cn('gap-1.5 h-8 px-2.5', online ? 'text-emerald-600 border-emerald-300' : 'text-red-600 border-red-300')}>
                {online ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{online ? t('آنلاین', 'آنلاین', 'Online') : t('آفلاین', 'آفلاین', 'Offline')}</span>
              </Badge>

              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={() => useAppStore.getState().setLang(nextLang as never)} title={t('تغییر زبان', 'ژبه بدلول', 'Change language')}>
                <Languages className="h-4 w-4" />
                <span className="text-sm">{langLabel}</span>
              </Button>

              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={toggleTheme} aria-label={t('تغییر تم', 'ټینګ بدلول', 'Toggle theme')}>
                {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>
          </header>

          <main className="flex-1 p-4 md:p-6 w-full max-w-[1400px] mx-auto" key={activeTab}>
            {moduleEl}
          </main>

          {/* فوتر ثابت — پایین صفحه */}
          <footer className="mt-auto border-t py-3 px-4 text-center text-xs text-muted-foreground bg-background no-print">
            <p>
              {t(
                'سامانه جامع مدیریت تولید — ساخته‌شده برای صنایع افغانستان',
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
  )
}

export default function Home() {
  return (
    <I18nProvider>
      <Shell />
    </I18nProvider>
  )
}
