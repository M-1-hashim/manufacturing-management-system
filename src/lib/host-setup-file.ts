/*
 * ساخت فایل «تنظیم خودکار هاست» (ManufacturingERP-HostSetup.bat)
 *
 * این فایل یک اسکریپت ویندوز (bat) است که مدیر سیستم برای کارکنان می‌فرستد.
 * کارمند فقط روی آن دابل‌کلیک می‌کند و — اگر برنامه روی همان کمپیوتر نصب باشد —
 * معلومات هاست به‌صورت خودکار در %APPDATA%\ManufacturingERP\db-connection.txt
 * نوشته می‌شود، برنامه بسته و دوباره باز می‌گردد؛ بدون هیچ تنظیم دستی.
 *
 * نکات فنی:
 * - محتوای db-connection.txt به Base64 انکود و داخل bat جاسازی می‌شود و با
 *   certutil دیکود می‌گردد → هر کاراکتری در پسورد (٪ ^ & ! و…) بدون مشکل ذخیره می‌شود.
 * - خودِ bat فقط ASCII است (بدون مشکل کدپیج)، محتوای دری داخل Base64 است.
 * - فرمت فایل دقیقاً همان چیزی است که electron/main.js → parseActiveOverride می‌خواند.
 */

export interface HostSetupConfig {
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

/** پاک‌سازی ورودی — همان منطق electron/main.js sanitizeHost */
function sanitizeHost(input: string): string {
  return String(input || '')
    .trim()
    .replace(/^mysql:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .split(/[/:?]/)[0]
    .trim()
}

/** اعتبارسنجی — همان قواعد دکمه «ذخیره» در نسخه دسکتاپ؛ پیام خطا یا null */
export function validateHostSetupConfig(c: HostSetupConfig): string | null {
  const host = sanitizeHost(c.host)
  const database = String(c.database || '').split(/[/?]/)[0].trim()
  const user = String(c.user || '').trim()
  const sshHost = sanitizeHost(c.sshHost)
  const sshUser = String(c.sshUser || '').trim()
  if (c.mode === 'ssh') {
    if (!sshHost || !sshUser || !database || !user) return 'MISSING_FIELDS'
    if (!String(c.sshPassword || '')) return 'MISSING_SSH_PASSWORD'
  } else if (!host || !database || !user) {
    return 'MISSING_FIELDS'
  }
  return null
}

/** ساخت محتوای db-connection.txt — همان فرمتی که electron/main.js می‌نویسد و می‌خواند */
export function buildDbConnectionTxt(c: HostSetupConfig): string {
  const mode = c.mode === 'ssh' ? 'ssh' : 'direct'
  const database = String(c.database || '').split(/[/?]/)[0].trim()
  const user = String(c.user || '').trim()
  const password = String(c.password ?? '')

  let urlHost: string
  let urlPort: string
  if (mode === 'ssh') {
    // در حالت تونل، MySQL همیشه از داخل سرور (127.0.0.1) و از طریق پورت محلی تونل
    urlHost = '127.0.0.1'
    urlPort = '5522'
  } else {
    urlHost = sanitizeHost(c.host)
    urlPort = String(c.port || '').trim() || '3306'
  }

  const url = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${urlHost}:${urlPort}/${database}`

  const lines = [
    '# فایل تنظیم اتصال دیتابیس — ManufacturingERP',
    '# این فایل به‌صورت خودکار ساخته شده است (فایل تنظیم خودکار هاست) — نیاز به ویرایش نیست',
    `# حالت اتصال: ${mode === 'ssh' ? 'تونل SSH (هاست اشتراکی)' : 'اتصال مستقیم (VPS/هاست اختصاصی)'}`,
    '#',
    '# برای برگشت به دیتابیس محلی (SQLite)، این خط mysql:// را با # کامنت کنید',
    '#',
    url,
    `ssh-mode=${mode}`,
  ]
  if (mode === 'ssh') {
    lines.push(
      `ssh-host=${sanitizeHost(c.sshHost)}`,
      `ssh-port=${String(c.sshPort || '').trim() || '21098'}`,
      `ssh-user=${String(c.sshUser || '').trim()}`,
      `ssh-password=${String(c.sshPassword ?? '')}`
    )
  }
  return lines.join('\r\n') + '\r\n'
}

/** UTF-8 → Base64 با شکستن به خط‌های 64 کاراکتری (سازگار با certutil) */
function toBase64Lines(text: string): string[] {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  const b64 = btoa(bin)
  const out: string[] = []
  for (let i = 0; i < b64.length; i += 64) out.push(b64.slice(i, i + 64))
  return out
}

/**
 * ساخت اسکریپت bat کامل.
 * رفتار پس از دابل‌کلیک روی ویندوز:
 *  1) نوشتن %APPDATA%\ManufacturingERP\db-connection.txt (از طریق certutil دیکود Base64)
 *  2) اگر پوشه دیتای نسخه‌های قدیمی موجود باشد، همان‌جا هم کپی می‌شود
 *  3) بستن برنامه در حال اجرا و بازکردن دوباره آن از مسیر نصب
 */
export function buildHostSetupBat(c: HostSetupConfig): string {
  const b64Lines = toBase64Lines(buildDbConnectionTxt(c))
  const L: string[] = [
    '@echo off',
    'setlocal EnableExtensions',
    'set "CFGDIR=%APPDATA%\\ManufacturingERP"',
    'if not exist "%CFGDIR%" mkdir "%CFGDIR%"',
    'set "B64F=%TEMP%\\mfg_host_setup_%RANDOM%.b64"',
    '> "%B64F%" echo -----BEGIN CERTIFICATE-----',
    ...b64Lines.map((l) => `>> "%B64F%" echo ${l}`),
    '>> "%B64F%" echo -----END CERTIFICATE-----',
    'certutil -f -decode "%B64F%" "%CFGDIR%\\db-connection.txt" >nul 2>&1',
    'if errorlevel 1 (',
    '  del "%B64F%" >nul 2>&1',
    '  echo [ERROR] Failed to write the configuration file.',
    '  pause',
    '  exit /b 1',
    ')',
    'del "%B64F%" >nul 2>&1',
    'if exist "%APPDATA%\\nextjs_tailwind_shadcn_ts" copy /y "%CFGDIR%\\db-connection.txt" "%APPDATA%\\nextjs_tailwind_shadcn_ts\\db-connection.txt" >nul 2>&1',
    'echo ManufacturingERP: host connection configured successfully.',
    'echo Restarting the app...',
    'taskkill /IM ManufacturingERP.exe /F >nul 2>&1',
    'ping -n 3 127.0.0.1 >nul',
    'set "EXE=%ProgramFiles%\\ManufacturingERP\\ManufacturingERP.exe"',
    'if not exist "%EXE%" set "EXE=%ProgramFiles(x86)%\\ManufacturingERP\\ManufacturingERP.exe"',
    'if not exist "%EXE%" set "EXE=%LocalAppData%\\Programs\\ManufacturingERP\\ManufacturingERP.exe"',
    'if exist "%EXE%" (',
    '  start "" "%EXE%"',
    '  echo Done! The app is starting with the new host settings.',
    ') else (',
    '  echo Done! Please open ManufacturingERP to use the new host settings.',
    ')',
    'ping -n 5 127.0.0.1 >nul',
    'endlocal',
  ]
  // bat ویندوزی باید CRLF و فقط ASCII باشد
  return L.join('\r\n') + '\r\n'
}

export const HOST_SETUP_FILENAME = 'ManufacturingERP-HostSetup.bat'

/** ساخت و دانلود فایل — در مرورگر و در نسخه دسکتاپ کار می‌کند */
export function downloadHostSetupFile(c: HostSetupConfig): boolean {
  if (validateHostSetupConfig(c)) return false
  const bat = buildHostSetupBat(c)
  const blob = new Blob([bat], { type: 'application/x-bat' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = HOST_SETUP_FILENAME
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return true
}
