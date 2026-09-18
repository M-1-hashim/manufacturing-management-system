'use client'

/*
 * ویزارد راه‌اندازی اولیه — اولین باز شدن برنامه بعد از نصب:
 *
 *   گام 1  خوش آمدید + انتخاب زبان + انتخاب تم رنگی
 *   گام 2  محل ذخیرهٔ دیتا: فقط این دستگاه / هاست انترنتی
 *   گام 3  اتصال به هاست (تونل SSH برای هاست اشتراکی، یا مستقیم برای VPS)
 *          + دکمهٔ تست اتصال + راهنمای کوتاه cPanel
 *   گام 4  ذخیره شد → راه‌اندازی مجدد برنامه (تا اتصال جدید اعمال شود)
 *
 * بعد از ری‌استارت، هاست به‌صورت خودکار جدول‌های گمشده را روی هاست می‌سازد
 * و اگر هاست خالی باشد کاربران سیستم/تنظیمات محلی را کپی می‌کند (host-setup).
 * در مرورگر (نسخهٔ وب) گام هاست غیرفعال است — اتصال هاست مخصوص نسخهٔ ویندوز.
 */

import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import { APP_VERSION } from '@/lib/app-version'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Factory, HardDrive, Cloud, Globe, Server, KeyRound, Database,
  ArrowLeft, ArrowRight, Check, CheckCircle2, RefreshCw, ShieldCheck, Info, MonitorSmartphone, AlertTriangle,
  FileText, FolderOpen, FileClock, FilePlus2,
} from 'lucide-react'

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

const SETUP_FLAG = 'mfg-setup-completed'
// اگر کاربر در ویزارد «فقط این دستگاه» را انتخاب کند، دیگر ویزارد تکرار نمی‌شود
const LOCAL_ONLY_FLAG = 'mfg-setup-local-mode'

function applyTheme(id: string) {
  if (id === 'emerald') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', id)
  localStorage.setItem('mfg-color-theme', id)
}

/** دلیل شکست پینگ واقعی MySQL — از گِیت شروع برنامه می‌آید (v۱.۰.۲۴) */
interface DbPingFailT {
  kind?: string | null
  error?: string | null
}

export default function SetupWizard({ onDone, dbPing }: { onDone: () => void; dbPing?: DbPingFailT | null }) {
  const { t, lang } = useI18n()
  const setLang = useAppStore((s) => s.setLang)
  // ?desktop=1 — برای نمایش/تست مرحلهٔ هاست در مرورگر (ذخیره فقط در نسخهٔ ویندوز کار می‌کند)
  const isDesktop =
    typeof window !== 'undefined' &&
    (!!window.dbConnection || new URLSearchParams(window.location.search).has('desktop'))
  const conn = typeof window !== 'undefined' ? window.dbConnection : undefined
  const [activeTheme, setActiveTheme] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mfg-color-theme') ?? 'emerald' : 'emerald'
  )

  const [step, setStep] = useState(1)
  const [mode, setMode] = useState<'ssh' | 'direct'>('ssh')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [saved, setSaved] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  /** نتیجهٔ آخرین تست ناموفق — برای پیام دقیق + چک‌لیست رفع مشکل */
  const [testFail, setTestFail] = useState<{ kind?: string; error?: string } | null>(null)
  /** اتصال ذخیره‌شده ولی وصل نمی‌شود — ویزارد با مقادیر فعلی دوباره باز شده */
  const [reopenedBroken, setReopenedBroken] = useState(false)
  /** مسیر فایل تنظیمات روی C:\ — از info() می‌آید */
  const [cfgPath, setCfgPath] = useState<string | null>(null)
  const [rereading, setRereading] = useState(false)
  /** آیا فایل db-connection.txt واقعاً روی دیسک هست؟ (null = نامعلوم/مرورگر) */
  const [fileExists, setFileExists] = useState<boolean | null>(null)
  const [creatingFile, setCreatingFile] = useState(false)

  function syncFileInfo(inf: { friendlyFileExists?: boolean; fileExists?: boolean; friendlyPath?: string; path?: string }) {
    if (typeof inf.friendlyFileExists === 'boolean') setFileExists(inf.friendlyFileExists)
    else if (typeof inf.fileExists === 'boolean') setFileExists(inf.fileExists)
    if (inf.friendlyPath || inf.path) setCfgPath(inf.friendlyPath || inf.path || null)
  }

  // فیلدهای هاست
  const [sshHost, setSshHost] = useState('')
  const [sshPort, setSshPort] = useState('21098')
  const [sshUser, setSshUser] = useState('')
  const [sshPassword, setSshPassword] = useState('')
  const [dbHost, setDbHost] = useState('')
  const [dbPort, setDbPort] = useState('3306')
  const [dbName, setDbName] = useState('')
  const [dbUser, setDbUser] = useState('')
  const [dbPassword, setDbPassword] = useState('')

  // پیش‌پرکردن از اتصال ذخیره‌شده — ویزارد هرگز فیلدهای خالیِ تکراری نشان نمی‌دهد
  // اگر اتصال ذخیره‌شده عملاً وصل نمی‌شود (reachable=false یا پینگ MySQL شکست
  // خورده از گِیت)، مستقیم گام هاست با مقادیر فعلی باز می‌شود تا کاربر فقط ایراد را اصلاح کند
  useEffect(() => {
    let alive = true
    async function prefill() {
      // شکست پینگ MySQL از گِیت — حتی بدون IPC هم گام هاست با بنر دلیل باز شود
      if (dbPing) {
        setReopenedBroken(true)
        setStep(3)
      }
      if (!conn) return
      try {
        const inf = await conn.info()
        if (!alive) return
        syncFileInfo(inf)
        if (!inf || !inf.active) return
        applyInfo(inf)
        if (inf.reachable === false || dbPing) {
          setReopenedBroken(true)
          setStep(3)
        }
      } catch { /* IPC در دسترس نیست — فرم خالی می‌ماند */ }
    }
    void prefill()
    return () => { alive = false }
  }, [])

  /** پر کردن فرم از پاسخ info() — هم برای پیش‌پرکردن و هم «بازخوانی از فایل» */
  function applyInfo(inf: {
    active?: boolean; sshMode?: boolean; sshHost?: string | null; sshPort?: string | number | null
    sshUser?: string | null; sshPassword?: string | null; host?: string | null; port?: string | number | null
    database?: string | null; user?: string | null; password?: string | null
  }) {
    setMode(inf.sshMode ? 'ssh' : 'direct')
    setSshHost(inf.sshHost || '')
    setSshPort(String(inf.sshPort || '21098'))
    setSshUser(inf.sshUser || '')
    setSshPassword(inf.sshPassword || '')
    setDbHost(inf.host || '')
    setDbPort(String(inf.port || '3306'))
    setDbName(inf.database || '')
    setDbUser(inf.user || '')
    setDbPassword(inf.password || '')
  }

  /** «بازخوانی از فایل» — کاربر فایل را در Notepad ویرایش کرده و اینجا دوباره خوانده می‌شود */
  async function handleReread() {
    if (!conn) return
    setRereading(true)
    setFormError(null)
    try {
      const inf = await conn.info()
      syncFileInfo(inf)
      if (inf.active) {
        applyInfo(inf)
        setTestFail(null)
        setReopenedBroken(false)
        toast.success(t('فایل تنظیمات خوانده شد — مقادیر به‌روز شد', 'د تنظیماتو فایل لوستل شو — ارزښتونه نوي شول', 'Config file reloaded — values updated'))
      } else {
        toast.info(t('هنوز خط اتصال فعالی در فایل نیست', 'تراوس د نښلون فعلی کرښه نشته', 'No active connection line in the file yet'))
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e))
    } finally {
      setRereading(false)
    }
  }

  /** «ساخت فایل تنظیمات» — اگر فایل به هر دلیلی روی C:\ نیست، با یک کلیک ساخته می‌شود */
  async function handleCreateFile() {
    if (!conn?.createFile) {
      toast.error(
        t(
          'این دکمه فقط در نسخهٔ ۱.۰.۲۵ یا بالاتر کار می‌کند — Setup جدید را از صفحهٔ دانلود نصب کنید',
          'دا تڼۍ یوازې په ۱.۰.۲۵ یا نوي نسخه کې کار کوي — نوی Setup نصب کړئ',
          'This button needs version 1.0.25+ — install the latest Setup from the download page'
        )
      )
      return
    }
    setCreatingFile(true)
    try {
      const r = await conn.createFile()
      if (r && r.ok) {
        toast.success(
          t('فایل تنظیمات ساخته شد ✓', 'د تنظیماتو فایل جوړ شو ✓', 'Config file created ✓')
        )
        try {
          const inf = await conn.info()
          syncFileInfo(inf)
        } catch { /* ignore */ }
      } else {
        toast.error(t('ساخت فایل ناموفق بود: ', 'فایل جوړول ناکام شو: ', 'File creation failed: ') + (r?.error || ''))
      }
    } catch (e) {
      toast.error(String((e as Error)?.message || e))
    } finally {
      setCreatingFile(false)
    }
  }

  function finish(localOnly = false) {
    localStorage.setItem(SETUP_FLAG, '1')
    if (localOnly) localStorage.setItem(LOCAL_ONLY_FLAG, '1')
    onDone()
  }

  function errMapping(code?: string): string {
    if (code === 'MISSING_FIELDS')
      return t('همهٔ فیلدهای الزامی را پر کنید', 'ټول لازم فیلډونه ډک کړئ', 'Please fill all required fields')
    if (code === 'MISSING_SSH_PASSWORD')
      return t('پسورد SSH را وارد کنید', 'د SSH پټ نوم ولیکئ', 'SSH password is required')
    return code || ''
  }

  /** پیام دقیق شکست تست SSH بر اساس نوع خطا + جزئیات خام */
  function sshFailText(kind: string | undefined, error: string | undefined): string {
    if (kind === 'AUTH')
      return t(
        'نام کاربری یا پسورد SSH اشتباه است — این‌ها همان نام کاربری/پسورد cPanel هستند (نه MySQL)',
        'د SSH کارن نوم یا پټ نوم غلط دی — دا همغه cPanel معلومات دي (نه MySQL)',
        'SSH username or password is wrong — these are your cPanel credentials (not MySQL)'
      )
    if (kind === 'TIMEOUT')
      return t(
        'سرور پاسخ نداد — معمولاً یعنی SSH روی هاست روشن نیست یا پورت اشتباه است (هاست‌های اشتراکی معمولاً 21098)',
        'سرور ځواب نه واکړ — معمولاً SSH پر هوسټ نه دی روشن یا پورټ غلط دی (شریک هوسټونه معمولاً ۲۱۰۹۸)',
        'Server did not respond — SSH is likely disabled on the host or the port is wrong (shared hosts usually use 21098)'
      )
    const e = String(error || '')
    if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(e))
      return t(
        'آدرس هاست پیدا نشد — املای آدرس را بررسی کنید (بدون https:// و بدون مسیر)',
        'د هوسټ پته پیدا نشوه — ليکدود وګورئ (بې له https://)',
        'Host address not found — check the spelling (without https:// or paths)'
      )
    if (/ECONNREFUSED/i.test(e))
      return t(
        'اتصال رد شد — پورت SSH بسته است یا اشتباه وارد شده',
        'نښلون رد شو — د SSH پورټ بند یا غلط دی',
        'Connection refused — the SSH port is closed or wrong'
      )
    if (/EHOSTUNREACH|ENETUNREACH|ETIMEDOUT/i.test(e))
      return t(
        'راه به سرور پیدا نشد — انترنت یا فایروال را بررسی کنید',
        'لار سرور ته پیدا نشوه — انټرنټ یا فایروال وګورئ',
        'No route to the server — check internet or firewall'
      )
    return t('اتصال SSH برقرار نشد', 'د SSH نښلون برقرار نشو', 'SSH connection failed') + (e ? ' — ' + e : '')
  }

  /** پیام دقیق شکست پینگ واقعی MySQL (SELECT 1) بر اساس نوع خطا */
  function dbFailText(kind: string | undefined, error: string | undefined): string {
    if (kind === 'AUTH')
      return t(
        'نام کاربری یا رمز MySQL اشتباه است — این‌ها در cPanel بخش «Manage My Databases» ساخته می‌شوند (نه همان رمز ورود cPanel)',
        'د MySQL کارن نوم یا پټ نوم غلط دی — دا په cPanel کې په «Manage My Databases» کې جوړېږي',
        'MySQL username or password is wrong — created under cPanel → Manage My Databases (not the cPanel login)'
      )
    if (kind === 'NO_DATABASE')
      return t(
        'دیتابیس با این نام پیدا نشد — در cPanel نام‌ها معمولاً با نام کاربری شروع می‌شوند (مثل myuser_mfg)',
        'ډاټابیس د دې نوم سره نه موندل کېږي — په cPanel کې نومونه معمولاً د کارن نوم سره پیلېږي',
        'Database not found with this name — cPanel names usually start with the username (e.g. myuser_mfg)'
      )
    if (kind === 'UNREACHABLE')
      return t(
        'MySQL در دسترس نیست — تونل SSH وصل نیست یا پورت/فایروال جلوی راه است',
        'MySQL نه ته رسېدلی — د SSH تونل نه دي نښلی یا پورټ/فایروال مخنیوی کوي',
        'MySQL is unreachable — the SSH tunnel is down or a port/firewall is blocking'
      )
    const e = String(error || '')
    return t(
      'اتصال به دیتابیس MySQL برقرار نشد — مقادیر زیر را با cPanel چک کنید',
      'نښلون له MySQL سره برقرار نشو — ارزښتونه له cPanel سره وګورئ',
      'Could not connect to MySQL — verify the values against cPanel'
    ) + (e && kind !== 'UNKNOWN' ? ' — ' + e : '')
  }

  async function handleTest() {
    setFormError(null)
    setTestFail(null)
    if (!conn) return
    if (!sshHost.trim() || !sshUser.trim()) {
      setFormError(t('آدرس هاست و نام کاربری SSH الزامی است', 'د هوسټ پته او د SSH کارن نوم لازم دي', 'SSH server and username are required'))
      return
    }
    setTesting(true)
    try {
      const r = await conn.test({ sshHost, sshPort, sshUser, sshPassword })
      if (r.ok) {
        toast.success(t('اتصال SSH وصل شد ✓', 'د SSH نښلون برقرار دی ✓', 'SSH connection OK ✓'))
      } else {
        setTestFail({ kind: r.kind, error: r.error })
        setFormError(sshFailText(r.kind, r.error))
        toast.error(t('تست اتصال ناموفق بود — پیام کامل در صفحه', 'ازمویښته ناکامه شوه — بشپړ پیام په پاڼه کې', 'Connection test failed — full message on screen'))
      }
    } catch (e) {
      setFormError(String((e as Error)?.message || e))
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (!conn) return
    setFormError(null)
    setSaving(true)
    try {
      const res = await conn.save({
        mode,
        host: mode === 'ssh' ? '127.0.0.1' : dbHost,
        port: dbPort,
        database: dbName,
        user: dbUser,
        password: dbPassword,
        sshHost,
        sshPort,
        sshUser,
        sshPassword,
      })
      if (res.ok) {
        localStorage.setItem(SETUP_FLAG, '1')
        setSaved(true)
        setStep(4)
      } else {
        setFormError(errMapping(res.error))
      }
    } catch (e) {
      setFormError(String((e as Error)?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const dir = lang === 'en' ? 'ltr' : 'rtl'
  const StepArrow = dir === 'rtl' ? ArrowLeft : ArrowRight
  const BackArrow = dir === 'rtl' ? ArrowRight : ArrowLeft

  const steps = [
    t('خوش آمدید', 'ښه راغلاست', 'Welcome'),
    t('ذخیره', 'ذخیره', 'Storage'),
    t('اتصال هاست', 'هوسټ نښلول', 'Host'),
    t('پایان', 'پای', 'Done'),
  ]

  return (
    <div className="min-h-screen auth-hero flex items-center justify-center p-4" dir={dir}>
      <div className="w-full max-w-2xl">
        {/* لوگو و عنوان */}
        <div className="text-center mb-6">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg mb-4">
            <Factory className="h-8 w-8" />
          </div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            {t('به سیستم مدیریتی تولید خوش آمدید', 'د تولید مدیریت سیسټم ته ښه راغلاست', 'Welcome to the Manufacturing ERP')}
          </h1>
          <p className="text-[13px] text-muted-foreground mt-1.5">
            {t('چند قدم کوتاه تا راه‌اندازی کامل — با هم تنظیمش می‌کنیم', 'څو لنډ ګامه تر بشپړې راه‌اندازې — یوځای یې تنظیموو', 'A few quick steps to get you fully set up')}
          </p>
        </div>

        {/* نشانگر گام‌ها */}
        <div className="flex items-center justify-center gap-2 mb-4" aria-hidden>
          {steps.map((label, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={cn(
                  'h-2 rounded-full transition-all duration-300',
                  step === i + 1 ? 'w-7 bg-primary' : step > i + 1 ? 'w-2 bg-primary/60' : 'w-2 bg-muted-foreground/25'
                )}
              />
            </div>
          ))}
        </div>

        <div className="auth-glass rounded-2xl border p-6 md:p-8">
          {/* ================= گام 1: خوش آمدید ================= */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-semibold text-base mb-1">{t('زبان برنامه را انتخاب کنید', 'د پروګرام ژبه وټاکه', 'Choose your language')}</h2>
                <p className="text-xs text-muted-foreground">{t('بعداً هم از منوی بالا قابل تغییر است', 'وروسته هم له پورته مینو بدلېدلی شي', 'You can change it later from the header')}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {(
                  [
                    { id: 'fa', label: 'دری', sub: 'Dari' },
                    { id: 'ps', label: 'پښتو', sub: 'Pashto' },
                    { id: 'en', label: 'English', sub: 'انگلیسی' },
                  ] as const
                ).map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLang(l.id)}
                    className={cn(
                      'rounded-xl border-2 p-4 text-center transition-all hover:-translate-y-0.5',
                      lang === l.id ? 'border-primary bg-primary/10 shadow-sm' : 'border-border hover:border-primary/40'
                    )}
                  >
                    <span className="block font-bold text-sm">{l.label}</span>
                    <span className="block text-[11px] text-muted-foreground mt-0.5">{l.sub}</span>
                    {lang === l.id && <Check className="h-4 w-4 text-primary mx-auto mt-1.5" />}
                  </button>
                ))}
              </div>

              <div className="pt-2 border-t">
                <h2 className="font-semibold text-sm mb-3 mt-4">{t('رنگ دلخواه خود را انتخاب کنید', 'خپل غوره رنګ وټاکه', 'Pick your favorite color')}</h2>
                <div className="flex flex-wrap gap-2.5">
                  {COLOR_THEMES.map((ct) => {
                    const selected = activeTheme === ct.id
                    return (
                      <button
                        key={ct.id}
                        onClick={() => { applyTheme(ct.id); setActiveTheme(ct.id) }}
                        title={t(ct.fa, ct.ps, ct.en)}
                        className={cn(
                          'h-9 w-9 rounded-full border-2 transition-transform hover:scale-110 flex items-center justify-center',
                          selected ? 'ring-2 ring-offset-2 ring-[var(--primary)] border-transparent scale-110' : 'border-black/10'
                        )}
                        style={{
                          backgroundColor: ct.dot,
                          boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.35)',
                        }}
                        aria-label={t(ct.fa, ct.ps, ct.en)}
                      >
                        {selected && <Check className="h-4 w-4 text-white drop-shadow" />}
                      </button>
                    )
                  })}
                </div>
              </div>

              <Button size="lg" className="w-full h-12 text-base" onClick={() => setStep(2)}>
                {t('ادامه', 'ادامه', 'Continue')}
                <StepArrow className="h-5 w-5" />
              </Button>
            </div>
          )}

          {/* ================= گام 2: محل ذخیره ================= */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-semibold text-base">{t('دیتای برنامه کجا ذخیره شود؟', 'د پروګرام ډاټا چېرې خوندي شي؟', 'Where should your data be stored?')}</h2>
                <p className="text-xs text-muted-foreground mt-1">{t('هر زمان می‌توانید از تنظیمات تغییرش دهید', 'هر وخت کولای شئ له امستنو بدل کړئ', 'You can change this anytime in Settings')}</p>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* هاست — پیشنهادی */}
                <button
                  onClick={() => { if (isDesktop) setStep(3) }}
                  disabled={!isDesktop}
                  className={cn(
                    'relative rounded-xl border-2 p-5 text-start transition-all',
                    isDesktop
                      ? 'border-primary/50 bg-primary/5 hover:border-primary hover:-translate-y-0.5 cursor-pointer'
                      : 'border-border opacity-55 cursor-not-allowed'
                  )}
                >
                  <span className="absolute top-3 end-3 inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5">
                    {t('پیشنهادی', 'سپارښتنه', 'Recommended')}
                  </span>
                  <div className="h-11 w-11 rounded-xl bg-primary/15 text-primary flex items-center justify-center mb-3">
                    <Cloud className="h-6 w-6" />
                  </div>
                  <p className="font-bold text-sm">{t('هاست انترنتی', 'انټرنټي هوسټ', 'Internet host')}</p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-5">
                    {t(
                      'دیتا روی هاست شما ذخیره می‌شود؛ همهٔ کامپیوترها به یک دیتای مشترک وصل‌اند و کاپی احتیاطی روی هاست انجام می‌شود.',
                      'ډاټا ستاسو په هوسټ کې خوندي کېږي؛ ټول کمپیوټره یوې شریکې ډاټا ته نښلي او بیکاپ په هوسټ کې کېږي.',
                      'Data lives on your host; all computers share one database and backups run on the host.'
                    )}
                  </p>
                  {!isDesktop && (
                    <p className="text-[11px] text-amber-600 mt-2 font-medium">
                      {t('فقط در نسخهٔ ویندوز (دسکتاپ) قابل تنظیم است', 'یوازې په ویندوز نسخه کې تنظیمېدلی شي', 'Only configurable in the Windows desktop app')}
                    </p>
                  )}
                </button>

                {/* محلی */}
                <button
                  onClick={() => finish(true)}
                  className="rounded-xl border-2 border-border p-5 text-start transition-all hover:border-foreground/30 hover:-translate-y-0.5 cursor-pointer"
                >
                  <div className="h-11 w-11 rounded-xl bg-muted text-foreground flex items-center justify-center mb-3">
                    <HardDrive className="h-6 w-6" />
                  </div>
                  <p className="font-bold text-sm">{t('فقط این دستگاه', 'یوازې همدا دستگاه', 'This device only')}</p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-5">
                    {t(
                      'دیتا فقط روی همین کامپیوتر می‌ماند — بدون نیاز به هاست و انترنت. بعداً قابل انتقال به هاست است.',
                      'ډاټا یوازې په همدې کمپیوټر پاتې کېږي — پرته له هوسټ او انټرنټ. وروسته هوسټ ته د انتقال وړ ده.',
                      'Data stays on this computer only — no host or internet needed. Migratable later.'
                    )}
                  </p>
                </button>
              </div>

              <Button variant="ghost" className="w-full" onClick={() => setStep(1)}>
                <BackArrow className="h-4 w-4" />
                {t('بازگشت', 'بېرته', 'Back')}
              </Button>
            </div>
          )}

          {/* ================= گام 3: اتصال به هاست ================= */}
          {step === 3 && (
            <div className="space-y-4">
              {reopenedBroken && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-[13px] leading-6">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-800 dark:text-amber-300">
                      {t(
                        'اتصال قبلی ذخیره شده بود ولی وصل نمی‌شود',
                        'نښلون پخوانی خوندي شوی و خو نه نښلي',
                        'A connection was saved before but it does not work'
                      )}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {dbPing?.kind
                        ? dbFailText(dbPing.kind, dbPing.error)
                        : t(
                            'مقادیر فعلی همان چیزی است که ذخیره شده — ایراد را پیدا و اصلاح کنید، بعد دوباره ذخیره کنید.',
                            'ارزښتونه همغه دي چې خوندي شوي — ستونزه پیدا او اصلاح کړئ، بیا یې خوندي کړئ.',
                            'The values below are what was saved — find and fix the problem, then save again.'
                          )}
                    </p>
                  </div>
                </div>
              )}
              <div>
                <h2 className="font-semibold text-base">{t('اتصال به هاست', 'هوسټ ته نښلول', 'Connect to your host')}</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('مشخصات را از cPanel هاست خود بردارید', 'مشخصات له خپل cPanel واخلئ', 'Grab the credentials from your cPanel')}
                </p>
              </div>

              {/* راهنمای cPanel */}
              <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 text-[12px] leading-6">
                <p className="font-semibold flex items-center gap-1.5 mb-1">
                  <Info className="h-3.5 w-3.5 text-primary" />
                  {t('سه کار در cPanel (فقط بار اول):', 'په cPanel کې درې کاره (یوازې لومړی ځل):', 'Three steps in cPanel (first time only):')}
                </p>
                <ol className="list-decimal ms-5 text-muted-foreground space-y-0.5">
                  <li>
                    {t('«Manage My Databases» → ساخت دیتابیس + کاربر + اتصال کاربر با ALL PRIVILEGES', '«Manage My Databases» → ډاټابیس + کارن جوړول + ټولې واکونو سره نښلول', 'Manage My Databases → create DB + user, link with ALL PRIVILEGES')}
                  </li>
                  <li>
                    {t('هاست اشتراکی: در «Manage Shell» دسترسی SSH را روشن کنید', 'شریک هوسټ: په «Manage Shell» کې SSH فعال کړئ', 'Shared hosting: enable SSH access under Manage Shell')}
                  </li>
                  <li>
                    {t('آدرس هاست (مثل server370.web-hosting.com) در ایمیل خوش‌آمد هاست هست', 'د هوسټ پته (لکه server370.web-hosting.com) په خوش راغلاست بریښنا لیک کې ده', 'Server address (like server370.web-hosting.com) is in your welcome email')}
                  </li>
                </ol>
                <p className="mt-1.5 text-muted-foreground">
                  {t('جدول‌ها به‌صورت خودکار ساخته می‌شوند — phpMyAdmin لازم نیست ✓', 'جدولونه په اتومات ډول جوړېږي — phpMyAdmin ته اړتیا نشته ✓', 'Tables are created automatically — no phpMyAdmin needed ✓')}
                </p>
              </div>

              {/* راه دوم: وارد کردن مشخصات مستقیم در فایل تنظیمات (بدون هیچ فرم) */}
              <div className="rounded-xl border bg-muted/40 p-3.5 text-[12px] leading-6 space-y-2">
                <p className="font-semibold flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  {t(
                    'راه دوم — وارد کردن مشخصات در فایل تنظیمات:',
                    'دویمه لار — په تنظیماتو فایل کې معلومات داخلول:',
                    'Alternative — enter the details in the config file:'
                  )}
                </p>
                <p className="text-muted-foreground">
                  {t(
                    'می‌توانید به‌جای این فرم، مشخصات هاست را مستقیم در فایل زیر بنویسید (با Notepad باز کنید، پر کنید، ذخیره کنید):',
                    'کولای شئ د دې فورم پر ځای، د هوسټ معلومات په لاندې فایل کې ولیکئ (له Notepad پرانیزئ، ډک کړئ، خوندي کړئ):',
                    'Instead of this form you can type the host details directly into this file (open in Notepad, fill it in, save):'
                  )}
                </p>
                {/* وضعیت واقعی فایل روی دیسک — جواب مستقیم به «فایل db-connection.txt نیست» */}
                {fileExists === true && (
                  <p className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {t(
                      'فایل تنظیمات روی کامپیوتر شما موجود است ✓ — کافی است آن را با Notepad باز کنید و پر کنید',
                      'د تنظیماتو فایل ستاسو په کمپیوټر کې شته ✓ — له Notepad پرانیزئ او ډک کړئ',
                      'The config file exists on your computer ✓ — open it in Notepad and fill it in'
                    )}
                  </p>
                )}
                {fileExists === false && (
                  <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-700/60 dark:bg-amber-950/30">
                    <p className="flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {t(
                        'فایل هنوز روی کامپیوتر شما ساخته نشده است — با دکمهٔ زیر همین حالا بسازید:',
                        'فایل تراوسه په کمپیوټر کې نه دی جوړ شوی — له لاندې تڼۍ يې جوړ کړئ:',
                        'The file has not been created on your computer yet — create it now with the button below:'
                      )}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 border-amber-400 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40"
                      disabled={creatingFile}
                      onClick={() => void handleCreateFile()}
                    >
                      {creatingFile ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="h-3.5 w-3.5" />}
                      {t('ساخت فایل تنظیمات', 'د تنظیماتو فایل جوړول', 'Create config file')}
                    </Button>
                  </div>
                )}
                <code
                  dir="ltr"
                  className="block break-all rounded-lg border bg-background px-2.5 py-1.5 text-[11px] font-mono select-all"
                >
                  {cfgPath || 'C:\\Users\\<USERNAME>\\ManufacturingERP\\db-connection.txt'}
                </code>
                {conn && (
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => { void conn.showFile?.() }}
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                      {t('باز کردن فایل در ویندوز', 'فایل په ویندوز کې پرانیستل', 'Show file in Explorer')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={rereading}
                      onClick={() => void handleReread()}
                    >
                      {rereading ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <FileClock className="h-3.5 w-3.5" />}
                      {t('بازخوانی از فایل', 'له فایل بیا لوستل', 'Re-read from file')}
                    </Button>
                  </div>
                )}
                <p className="text-muted-foreground">
                  {t(
                    'بعد از ویرایش فایل: «بازخوانی از فایل» را بزنید یا برنامه را ببندید و دوباره باز کنید. قالب کامل و نمونه‌ها داخل خود فایل نوشته شده است.',
                    'له فایل منځولو وروسته: «له فایل بیا لوستل» کېکاږئ یا پروګرام بنډول او بیا پرانیزئ. بشپړ فارمټ او بېلګې پخپله فایل کې ليکل شوي دي.',
                    'After editing the file: click “Re-read from file” or restart the app. The full format and examples are written inside the file itself.'
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground/80">
                  {t(
                    `اگر فایل ساخته نمی‌شود یا این صفحه اصلاً دیده نمی‌شود، نسخهٔ نصب‌شده روی کامپیوتر شما قدیمی است — Setup نسخهٔ ${'v' + APP_VERSION} یا بالاتر را از صفحهٔ دانلود نصب کنید.`,
                    `که فایل جوړېږي نه یا دا پاڼه نه ښکاري، ستاسو نسخه زړه ده — ${'v' + APP_VERSION} یا نوی Setup نصب کړئ.`,
                    `If the file is not created or this page never appears, the installed version is old — install Setup v${APP_VERSION}+ from the download page.`
                  )}
                </p>
              </div>

              {/* انتخاب حالت اتصال */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMode('ssh')}
                  className={cn(
                    'rounded-xl border-2 p-3.5 text-start transition-all',
                    mode === 'ssh' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className={cn('h-4.5 w-4.5', mode === 'ssh' ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="font-bold text-[13px]">{t('تونل SSH', 'د SSH تونل', 'SSH tunnel')}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-4">
                    {t('برای هاست اشتراکی (Namecheap/cPanel و…)', 'د شریک هوسټ لپاره (Namecheap/cPanel او…)', 'For shared hosting (Namecheap/cPanel etc.)')}
                  </p>
                </button>
                <button
                  onClick={() => setMode('direct')}
                  className={cn(
                    'rounded-xl border-2 p-3.5 text-start transition-all',
                    mode === 'direct' ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Server className={cn('h-4.5 w-4.5', mode === 'direct' ? 'text-primary' : 'text-muted-foreground')} />
                    <span className="font-bold text-[13px]">{t('اتصال مستقیم', 'مستقیمه نښلونه', 'Direct connection')}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-4">
                    {t('برای هاست اختصاصی/VPS با پورت 3306 باز', 'د ځانګړي هاست/VPS لپاره چې 3306 پرانیستی وي', 'For dedicated servers/VPS with port 3306 open')}
                  </p>
                </button>
              </div>

              {mode === 'ssh' ? (
                <div className="space-y-3">
                  <p className="text-[12px] text-muted-foreground flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 shrink-0" />
                    {t('برنامه خودش تونل امن SSH می‌سازد — PuTTY لازم نیست.', 'پروګرام پخپله د SSH خوندي تونل جوړوي — PuTTY ته اړتیا نشته.', 'The app builds the secure SSH tunnel itself — no PuTTY needed.')}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="w-ssh-host">{t('هاست SSH', 'د SSH هاست', 'SSH server')} *</Label>
                      <Input id="w-ssh-host" dir="ltr" placeholder="server370.web-hosting.com" value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-ssh-port">{t('پورت SSH', 'د SSH پورټ', 'SSH port')}</Label>
                      <Input id="w-ssh-port" dir="ltr" placeholder="21098" value={sshPort} onChange={(e) => setSshPort(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-ssh-user">{t('کاربر SSH (cPanel)', 'د SSH کارن (cPanel)', 'SSH user (cPanel)')} *</Label>
                      <Input id="w-ssh-user" dir="ltr" autoComplete="off" value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-ssh-pass">{t('پسورد SSH', 'د SSH پټ نوم', 'SSH password')} *</Label>
                      <Input id="w-ssh-pass" dir="ltr" type="password" autoComplete="new-password" value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} />
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="w-full" disabled={testing} onClick={() => void handleTest()}>
                    {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {testing ? t('در حال تست…', 'ازموینه روانه ده…', 'Testing…') : t('تست اتصال SSH', 'د SSH نښلون ازمویل', 'Test SSH connection')}
                  </Button>

                  {/* پیام دقیق شکست + چک‌لیست رفع مشکل */}
                  {testFail && (
                    <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-[12.5px] leading-6">
                      <p className="font-semibold flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                        <Info className="h-4 w-4 shrink-0" />
                        {t('تست ناموفق بود — چک‌لیست رفع مشکل:', 'ازمویښته ناکامه شوه — د حل لیست:', 'Test failed — troubleshooting checklist:')}
                      </p>
                      <ol className="list-decimal ms-5 mt-1.5 space-y-0.5 text-muted-foreground">
                        <li>
                          {t(
                            'در cPanel بخش «Manage Shell Access» دسترسی SSH را روشن کنید (روی برخی هاست‌ها پیش‌فرض خاموش است)',
                            'په cPanel کې «Manage Shell Access» فعال کړئ (په ځینو هوسټونو کې لومړي کې تړلی وی)',
                            'Enable SSH under cPanel \u2192 Manage Shell Access (off by default on some hosts)'
                          )}
                        </li>
                        <li>
                          {t(
                            'پورت را بررسی کنید: Namecheap معمولاً 21098 — بقیهٔ هاست‌ها معمولاً 22 (در ایمیل خوش‌آمد هاست هست)',
                            'پورټ وګورئ: Namecheap معمولاً ۲۱۰۹۸ — نور معمولاً ۲۲ (په خوش راغلاست بریښنا کې)',
                            'Check the port: Namecheap usually 21098 — others usually 22 (see the welcome email)'
                          )}
                        </li>
                        <li>
                          {t(
                            'نام کاربری/پسورد همان cPanel است — نه پسورد MySQL و نه پسورد ایمیل',
                            'کارن نوم/پټ نوم همغه cPanel دی — نه د MySQL پټ نوم',
                            'Username/password are the cPanel ones — not MySQL or email passwords'
                          )}
                        </li>
                        <li>
                          {t(
                            'آدرس را بدون https:// و بدون مسیر وارد کنید (مثل server370.web-hosting.com)',
                            'پته بې له https:// ولیکئ (لکه server370.web-hosting.com)',
                            'Enter the address without https:// or paths (e.g. server370.web-hosting.com)'
                          )}
                        </li>
                      </ol>
                      {testFail.error && (
                        <p className="mt-2 text-[11px] text-muted-foreground break-all" dir="ltr">
                          {t('جزئیات فنی', 'ټېکنیکي جزئیات', 'Technical details')}: {testFail.error}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="rounded-lg border bg-muted/40 p-3 text-[12px] text-muted-foreground flex items-start gap-2">
                    <Database className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>
                      {t(
                        'مشخصات MySQL (نه SSH): نام دیتابیس، کاربر MySQL و پسورد آن — آدرس MySQL همیشه از داخل هاست (127.0.0.1) خوانده می‌شود.',
                        'د MySQL مشخصات (نه SSH): د ډاټابیس نوم، د MySQL کارن او پټ نوم — د MySQL پته تل له دننه هاست (127.0.0.1) لوستل کېږي.',
                        'MySQL credentials (not SSH): database name, MySQL user and its password — MySQL host is always read from inside the server (127.0.0.1).'
                      )}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5 col-span-3 sm:col-span-1">
                      <Label htmlFor="w-db-name">{t('نام دیتابیس', 'د ډاټابیس نوم', 'Database name')} *</Label>
                      <Input id="w-db-name" dir="ltr" placeholder="myuser_mfg" value={dbName} onChange={(e) => setDbName(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-db-user">{t('کاربر MySQL', 'د MySQL کارن', 'MySQL user')} *</Label>
                      <Input id="w-db-user" dir="ltr" autoComplete="off" value={dbUser} onChange={(e) => setDbUser(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-db-pass">{t('پسورد MySQL', 'د MySQL پټ نوم', 'MySQL password')}</Label>
                      <Input id="w-db-pass" dir="ltr" type="password" autoComplete="new-password" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="w-host">{t('آدرس MySQL', 'د MySQL پته', 'MySQL host')} *</Label>
                    <Input id="w-host" dir="ltr" placeholder="1.2.3.4 یا server.example.com" value={dbHost} onChange={(e) => setDbHost(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-port">{t('پورت', 'پورټ', 'Port')}</Label>
                    <Input id="w-port" dir="ltr" placeholder="3306" value={dbPort} onChange={(e) => setDbPort(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-dbname">{t('نام دیتابیس', 'د ډاټابیس نوم', 'Database name')} *</Label>
                    <Input id="w-dbname" dir="ltr" value={dbName} onChange={(e) => setDbName(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="w-dbuser">{t('کاربر MySQL', 'د MySQL کارن', 'MySQL user')} *</Label>
                    <Input id="w-dbuser" dir="ltr" autoComplete="off" value={dbUser} onChange={(e) => setDbUser(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="w-dbpass">{t('پسورد MySQL', 'د MySQL پټ نوم', 'MySQL password')}</Label>
                    <Input id="w-dbpass" dir="ltr" type="password" autoComplete="new-password" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} />
                  </div>
                </div>
              )}

              {formError && <p className="text-sm text-destructive" role="alert">{formError}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                  <BackArrow className="h-4 w-4" />
                  {t('بازگشت', 'بېرته', 'Back')}
                </Button>
                <Button className="flex-[2] h-10" disabled={saving || !conn} onClick={() => void handleSave()}>
                  {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {saving ? t('در حال ذخیره…', 'ثبتول…', 'Saving…') : t('ذخیره و ادامه', 'ثبت او ادامه', 'Save & continue')}
                </Button>
              </div>
            </div>
          )}

          {/* ================= گام 4: پایان ================= */}
          {step === 4 && (
            <div className="text-center space-y-5 py-2">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Check className="h-8 w-8" />
              </div>
              <div>
                <h2 className="font-bold text-lg">{t('تنظیمات ذخیره شد ✓', 'امستنې وثابت شوې ✓', 'Settings saved ✓')}</h2>
                <p className="text-[13px] text-muted-foreground mt-2 leading-6">
                  {t(
                    'برنامه برای اعمال اتصال جدید یک‌بار راه‌اندازی مجدد می‌شود. بعد از باز شدن، جدول‌های دیتابیس خودکار روی هاست ساخته می‌شوند و می‌توانید داخل شوید.',
                    'پروګرام د نوي نښلون لپاره یو ځل بیا پرانیستل کېږي. له پرانیستلو وروسته د ډاټابیس جدولونه په اتومات ډول په هوسټ کې جوړېږي او ننوتل کولای شئ.',
                    'The app will restart once to apply the new connection. After reopening, database tables are created automatically on the host and you can sign in.'
                  )}
                </p>
              </div>
              {conn && (
                <Button size="lg" className="h-12 px-8 text-base" onClick={() => { void conn.relaunch() }}>
                  <RefreshCw className="h-5 w-5" />
                  {t('راه‌اندازی مجدد برنامه', 'پروګرام بیا پرانیستل', 'Restart the app now')}
                </Button>
              )}
              <div>
                <Button variant="ghost" size="sm" onClick={finish}>
                  <MonitorSmartphone className="h-4 w-4" />
                  {t('بعداً راه‌اندازی می‌کنم — ادامه به برنامه', 'وروسته بیا پرانیزم — پروګرام ته دوام', 'Restart later — continue to the app')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* نسخهٔ برنامه — کاربر بتواند تأیید کند نصبش به‌روز است */}
        <p className="text-center text-[11px] text-muted-foreground/70 mt-4" dir="ltr">
          ManufacturingERP v{APP_VERSION}
        </p>
      </div>
    </div>
  )
}
