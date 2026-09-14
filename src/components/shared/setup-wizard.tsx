'use client'

/*
 * ویزارد راه‌اندازی اولیه — اولین باز شدن برنامه بعد از نصب:
 *
 *   گام ۱  خوش آمدید + انتخاب زبان + انتخاب تم رنگی
 *   گام ۲  محل ذخیرهٔ دیتا: فقط این دستگاه / هاست انترنتی
 *   گام ۳  اتصال به هاست (تونل SSH برای هاست اشتراکی، یا مستقیم برای VPS)
 *          + دکمهٔ تست اتصال + راهنمای کوتاه cPanel
 *   گام ۴  ذخیره شد → راه‌اندازی مجدد برنامه (تا اتصال جدید اعمال شود)
 *
 * بعد از ری‌استارت، هاست به‌صورت خودکار جدول‌های گمشده را روی هاست می‌سازد
 * و اگر هاست خالی باشد استفاده‌کنندگان/تنظیمات محلی را کپی می‌کند (host-setup).
 * در مرورگر (نسخهٔ وب) گام هاست غیرفعال است — اتصال هاست مخصوص نسخهٔ ویندوز.
 */

import { useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { useAppStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import {
  Factory, HardDrive, Cloud, Globe, Server, KeyRound, Database,
  ArrowLeft, ArrowRight, Check, RefreshCw, ShieldCheck, Info, MonitorSmartphone,
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

function applyTheme(id: string) {
  if (id === 'emerald') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', id)
  localStorage.setItem('mfg-color-theme', id)
}

export default function SetupWizard({ onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n()
  const setLang = useAppStore((s) => s.setLang)
  const isDesktop = typeof window !== 'undefined' && !!window.dbConnection
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

  function finish() {
    localStorage.setItem(SETUP_FLAG, '1')
    onDone()
  }

  function errMapping(code?: string): string {
    if (code === 'MISSING_FIELDS')
      return t('همهٔ فیلدهای الزامی را پر کنید', 'ټول لازم فیلډونه ډک کړئ', 'Please fill all required fields')
    if (code === 'MISSING_SSH_PASSWORD')
      return t('پاسورد SSH را وارد کنید', 'د SSH پټ نوم ولیکئ', 'SSH password is required')
    return code || ''
  }

  async function handleTest() {
    setFormError(null)
    if (!conn) return
    if (!sshHost.trim() || !sshUser.trim()) {
      setFormError(t('آدرس هاست و نام استفاده‌کننده SSH الزامی است', 'د هوسټ پته او د SSH کارن نوم لازم دي', 'SSH server and username are required'))
      return
    }
    setTesting(true)
    try {
      const r = await conn.test({ sshHost, sshPort, sshUser, sshPassword })
      if (r.ok) {
        toast.success(t('اتصال SSH برقرار است ✓', 'د SSH نښلون برقرار دی ✓', 'SSH connection OK ✓'))
      } else if (r.kind === 'AUTH') {
        toast.error(t('نام استفاده‌کننده یا پاسورد SSH اشتباه است', 'د SSH کارن نوم یا پټ نوم غلط دی', 'SSH username or password is wrong'))
      } else {
        toast.error(t('هاست SSH در دسترس نیست — آدرس/پورت یا انترنت را بررسی کنید', 'د SSH هاست نه لرېږي — پته/پورت یا انترنت وګورئ', 'SSH server unreachable — check address/port or internet'))
      }
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
    t('ذخیره‌سازی', 'ذخیره', 'Storage'),
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
            {t('به سامانه مدیریت تولید خوش آمدید', 'د تولید مدیریت سیسټم ته ښه راغلاست', 'Welcome to the Manufacturing ERP')}
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
          {/* ================= گام ۱: خوش آمدید ================= */}
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

          {/* ================= گام ۲: محل ذخیره‌سازی ================= */}
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
                  onClick={finish}
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

          {/* ================= گام ۳: اتصال به هاست ================= */}
          {step === 3 && (
            <div className="space-y-4">
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
                    {t('«Manage My Databases» → ساخت دیتابیس + استفاده‌کننده + اتصال استفاده‌کننده با ALL PRIVILEGES', '«Manage My Databases» → ډاټابیس + کارن جوړول + ټولې واکونو سره نښلول', 'Manage My Databases → create DB + user, link with ALL PRIVILEGES')}
                  </li>
                  <li>
                    {t('هاست اشتراکی: در «Manage Shell» دسترسی SSH را روشن کنید', 'شریک هوسټ: په «Manage Shell» کې SSH فعال کړئ', 'Shared hosting: enable SSH access under Manage Shell')}
                  </li>
                  <li>
                    {t('آدرس هاست (مثل server370.web-hosting.com) در ایمیل خوش‌آمدگویی هست', 'د هوسټ پته (لکه server370.web-hosting.com) په خوش راغلاست بریښنا لیک کې ده', 'Server address (like server370.web-hosting.com) is in your welcome email')}
                  </li>
                </ol>
                <p className="mt-1.5 text-muted-foreground">
                  {t('جدول‌ها به‌صورت خودکار ساخته می‌شوند — phpMyAdmin لازم نیست ✓', 'جدولونه په اتومات ډول جوړېږي — phpMyAdmin ته اړتیا نشته ✓', 'Tables are created automatically — no phpMyAdmin needed ✓')}
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
                      <Label htmlFor="w-ssh-user">{t('استفاده‌کننده SSH (cPanel)', 'د SSH کارن (cPanel)', 'SSH user (cPanel)')} *</Label>
                      <Input id="w-ssh-user" dir="ltr" autoComplete="off" value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-ssh-pass">{t('پاسورد SSH', 'د SSH پټ نوم', 'SSH password')} *</Label>
                      <Input id="w-ssh-pass" dir="ltr" type="password" autoComplete="new-password" value={sshPassword} onChange={(e) => setSshPassword(e.target.value)} />
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" className="w-full" disabled={testing} onClick={() => void handleTest()}>
                    {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    {testing ? t('در حال تست…', 'ازموینه روانه ده…', 'Testing…') : t('تست اتصال SSH', 'د SSH نښلون ازمویل', 'Test SSH connection')}
                  </Button>
                  <div className="rounded-lg border bg-muted/40 p-3 text-[12px] text-muted-foreground flex items-start gap-2">
                    <Database className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    <span>
                      {t(
                        'مشخصات MySQL (نه SSH): نام دیتابیس، استفاده‌کننده MySQL و پاسورد آن — آدرس MySQL همیشه از داخل هاست (127.0.0.1) خوانده می‌شود.',
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
                      <Label htmlFor="w-db-user">{t('استفاده‌کننده MySQL', 'د MySQL کارن', 'MySQL user')} *</Label>
                      <Input id="w-db-user" dir="ltr" autoComplete="off" value={dbUser} onChange={(e) => setDbUser(e.target.value)} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="w-db-pass">{t('پاسورد MySQL', 'د MySQL پټ نوم', 'MySQL password')}</Label>
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
                    <Label htmlFor="w-dbuser">{t('استفاده‌کننده MySQL', 'د MySQL کارن', 'MySQL user')} *</Label>
                    <Input id="w-dbuser" dir="ltr" autoComplete="off" value={dbUser} onChange={(e) => setDbUser(e.target.value)} />
                  </div>
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="w-dbpass">{t('پاسورد MySQL', 'د MySQL پټ نوم', 'MySQL password')}</Label>
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

          {/* ================= گام ۴: پایان ================= */}
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

        {/* رد کردن ویزارد */}
        <div className="text-center mt-4">
          <button onClick={finish} className="text-[12px] text-muted-foreground/80 underline underline-offset-4 hover:text-foreground transition-colors">
            {t('رد کردن راه‌اندازی و داخل شدن به برنامه', 'لغوه کول او پروګرام ته ننوتل', 'Skip setup and enter the app')}
          </button>
        </div>
      </div>
    </div>
  )
}
