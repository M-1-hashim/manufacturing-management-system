'use client'

/**
 * ویزارد راه‌اندازی اولیهٔ نسخهٔ اندروید — اولین باز شدن برنامه بعد از نصب:
 *
 *   گام 1  خوش آمدید + انتخاب زبان + انتخاب تم رنگی
 *   گام 2  اطلاعات هاست (سرور): آدرس نسخهٔ وب نصب‌شده + تست اتصال + ذخیره
 *   گام 3  پایان → صفحهٔ ورود
 *
 * ورود اول باید با نام کاربری/رمزی انجام شود که در دیتابیس هاست ذخیره است
 * (اینترنت لازم است)؛ بعد از نخستین ورود موفق، حساب روی دستگاه ذخیره می‌شود
 * تا در حالت آفلاین هم بتوان وارد شد.
 *
 * حذف اتصال / تغییر آدرس: ?setup=1 روی همان نشست، یا ماژول تنظیمات.
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
  normalizeHostUrl,
  probeHost,
  saveHostConfig,
  type HostProbe,
} from '@/lib/host-link'
import {
  Factory, Globe, Check, RefreshCw, ArrowLeft, ArrowRight, AlertTriangle, Server, Wifi, WifiOff,
} from 'lucide-react'

const SETUP_FLAG = 'mfg-setup-completed'

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

function applyTheme(id: string) {
  if (id === 'emerald') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', id)
  localStorage.setItem('mfg-color-theme', id)
}

export default function ApkHostWizard({ onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n()
  const setLang = useAppStore((s) => s.setLang)
  const [activeTheme, setActiveTheme] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('mfg-color-theme') ?? 'emerald' : 'emerald'
  )
  const [step, setStep] = useState(1)
  const [hostUrl, setHostUrl] = useState('')
  const [probe, setProbe] = useState<HostProbe | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function finish() {
    localStorage.setItem(SETUP_FLAG, '1')
    onDone()
  }

  async function handleTest(): Promise<HostProbe | null> {
    setFormError(null)
    const url = normalizeHostUrl(hostUrl)
    if (!url) {
      setFormError(t('آدرس سرور را وارد کنید', 'پتهٔ سرور ولیکئ', 'Enter the server address'))
      return null
    }
    setTesting(true)
    setProbe(null)
    try {
      const result = await probeHost(url)
      setProbe(result)
      if (result.ok) {
        toast.success(
          t('اتصال برقرار شد ✓', 'نښلون برقرار دی ✓', 'Connection OK ✓') +
            (result.version ? ` (v${result.version})` : '')
        )
      } else {
        setFormError(result.error ?? t('سرور در دسترس نیست', 'سرور نه لرېږي', 'Server unreachable'))
      }
      return result
    } finally {
      setTesting(false)
    }
  }

  async function handleSave(force = false) {
    setFormError(null)
    const url = normalizeHostUrl(hostUrl)
    if (!url) {
      setFormError(t('آدرس سرور را وارد کنید', 'پتهٔ سرور ولیکئ', 'Enter the server address'))
      return
    }
    setSaving(true)
    try {
      let result = probe
      // اگر تست نشده یا آدرس عوض شده، قبل از ذخیره تست می‌کنیم
      if (!force) {
        result = await handleTest()
        if (!result?.ok) {
          setSaving(false)
          return
        }
      }
      saveHostConfig({
        url,
        ...(result?.ok
          ? { verifiedAt: new Date().toISOString(), serverVersion: result.version }
          : {}),
      })
      localStorage.setItem(SETUP_FLAG, '1')
      setStep(3)
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
    t('اتصال سرور', 'سرور نښلول', 'Server'),
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
            {t('چند قدم کوتاه تا راه‌اندازی کامل', 'څو لنډ ګامه تر بشپړې راه‌اندازې', 'A few quick steps to get you set up')}
          </p>
        </div>

        {/* نشانگر گام‌ها */}
        <div className="flex items-center justify-center gap-2 mb-4" aria-hidden>
          {steps.map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-2 rounded-full transition-all duration-300',
                step === i + 1 ? 'w-7 bg-primary' : step > i + 1 ? 'w-2 bg-primary/60' : 'w-2 bg-muted-foreground/25'
              )}
            />
          ))}
        </div>

        <div className="auth-glass rounded-2xl border p-6 md:p-8">
          {/* ================= گام 1: زبان و تم ================= */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="font-semibold text-lg mb-1">{t('زبان برنامه', 'د پروګرام ژبه', 'App language')}</h2>
                <p className="text-[13px] text-muted-foreground mb-3">
                  {t('زبان دلخواه خود را انتخاب کنید', 'خپله غوښتې ژبه وټاکئ', 'Choose your preferred language')}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['fa', 'دری', 'دری'],
                      ['ps', 'پشتو', 'پښتو'],
                      ['en', 'انگلیسی', 'English'],
                    ] as const
                  ).map(([id, fa, ps]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setLang(id)}
                      className={cn(
                        'h-11 rounded-xl border text-sm font-medium transition-all',
                        lang === id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
                      )}
                    >
                      {lang === 'ps' ? ps : fa}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <h2 className="font-semibold text-lg mb-3">{t('رنگ اصلی', 'اصلي رنگ', 'Accent color')}</h2>
                <div className="flex flex-wrap gap-2.5">
                  {COLOR_THEMES.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      title={lang === 'en' ? c.en : lang === 'ps' ? c.ps : c.fa}
                      onClick={() => {
                        applyTheme(c.id)
                        setActiveTheme(c.id)
                      }}
                      className={cn(
                        'h-9 w-9 rounded-full border-2 transition-all flex items-center justify-center',
                        activeTheme === c.id ? 'border-foreground scale-110' : 'border-transparent'
                      )}
                      style={{ backgroundColor: c.dot }}
                      aria-label={lang === 'en' ? c.en : lang === 'ps' ? c.ps : c.fa}
                    >
                      {activeTheme === c.id && <Check className="h-4 w-4 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end">
                <Button className="h-11 px-6" onClick={() => setStep(2)}>
                  {t('ادامه', 'ادامه', 'Continue')}
                  <StepArrow className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* ================= گام 2: اطلاعات هاست ================= */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="font-semibold text-lg flex items-center gap-2">
                  <Globe className="h-5 w-5 text-primary" />
                  {t('اتصال به سرور (هاست)', 'سرور (هوسټ) نښلول', 'Connect to server (host)')}
                </h2>
                <p className="text-[13px] text-muted-foreground mt-1.5 leading-6">
                  {t(
                    'آدرس همان سیستمی را وارد کنید که نسخهٔ وب روی آن نصب است. بعد از این‌مرحله، با نام کاربری و رمزی که در دیتابیس همان سرور ذخیره است داخل می‌شوید.',
                    'همغه پته ولیکئ چې ویب نسخه پرې نصب دی. وروسته به د هغه سرور ډېټابیس کې ثبت کارن نوم او پټ نوم ته ننوځئ.',
                    'Enter the address where the web version is installed. You will then sign in with the username and password stored in that server\u2019s database.'
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="host-url">{t('آدرس سرور', 'د سرور پته', 'Server address')}</Label>
                <div className="flex gap-2">
                  <Input
                    id="host-url"
                    dir="ltr"
                    value={hostUrl}
                    onChange={(e) => {
                      setHostUrl(e.target.value)
                      setProbe(null)
                      setFormError(null)
                    }}
                    placeholder="https://erp.example.com"
                    inputMode="url"
                    autoComplete="url"
                  />
                  <Button type="button" variant="outline" className="h-10 shrink-0 gap-1.5" onClick={() => void handleTest()} disabled={testing}>
                    {testing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    {t('تست', 'ازمویښنه', 'Test')}
                  </Button>
                </div>
                {probe?.ok && (
                  <p className="text-[13px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                    <Check className="h-4 w-4" />
                    {t(
                      `سرور در دسترس است${probe.version ? ` — نسخهٔ ${probe.version}` : ''}`,
                      `سرور لرې دی${probe.version ? ` — نسخه ${probe.version}` : ''}`,
                      `Server reachable${probe.version ? ` — version ${probe.version}` : ''}`
                    )}
                  </p>
                )}
              </div>

              {formError && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-[13px] leading-6">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p>{formError}</p>
                    {probe && !probe.ok && (
                      <button
                        type="button"
                        className="underline underline-offset-2 text-amber-700 dark:text-amber-400 mt-1"
                        onClick={() => void handleSave(true)}
                        disabled={saving}
                      >
                        {t(
                          'ذخیرهٔ همین آدرس بدون تست (بعداً می‌توانید از تنظیمات اصلاح کنید)',
                          'همدا پته پرته له ازمویښتې خوندي کړئ',
                          'Save this address without testing (you can fix it later in Settings)'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <Button variant="ghost" onClick={() => setStep(1)} className="gap-1.5">
                  <BackArrow className="h-4 w-4" />
                  {t('قبلی', 'پخوانی', 'Back')}
                </Button>
                <Button className="h-11 px-6 gap-1.5" onClick={() => void handleSave()} disabled={saving || testing}>
                  {saving ? t('در حال ذخیره...', 'خوندي کول...', 'Saving...') : <><Server className="h-4 w-4" />{t('ذخیره و ادامه', 'خوندي او ادامه', 'Save & continue')}</>}
                </Button>
              </div>
            </div>
          )}

          {/* ================= گام 3: پایان ================= */}
          {step === 3 && (
            <div className="space-y-6 text-center">
              <div className="mx-auto h-16 w-16 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Check className="h-8 w-8" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">{t('اتصال ذخیره شد', 'نښلون خوندي شو', 'Connection saved')}</h2>
                <p className="text-[13px] text-muted-foreground mt-2 leading-6 max-w-md mx-auto">
                  {t(
                    'حالا با نام کاربری و رمزی که در دیتابیس سرور ذخیره است وارد شوید. بعد از نخستین ورود موفق، حساب شما روی همین دستگاه ذخیره می‌شود تا در حالت بدون انترنت هم بتوانید وارد شوید.',
                    'اوس د سرور ډېټابیس کارن نوم او پټ نوم ته ننوځئ. لومړنی بریالی ننوتل وروسته، حساب مو پدې وسیله خوندي کیږي چې له انټرنېټ پرته هم وننوځئ.',
                    'Now sign in with the username and password stored in the server\u2019s database. After your first successful login the account is saved on this device so you can sign in offline too.'
                  )}
                </p>
              </div>
              <Button className="h-11 px-8" onClick={finish}>
                {t('رفتن به صفحهٔ ورود', 'د ننوتلو پاڼې ته', 'Go to sign in')}
                <StepArrow className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        <p className="text-center text-[12px] text-muted-foreground mt-4 flex items-center justify-center gap-1.5">
          <WifiOff className="h-3.5 w-3.5" />
          {t(
            'ورود آفلاین فقط بعد از نخستین ورود موفق ممکن است',
            'افلاین ننوتل یوازې د لومړني بریالي ننوتلو وروسته کیږي',
            'Offline sign-in works after the first successful sign-in'
          )}
        </p>
      </div>
    </div>
  )
}
