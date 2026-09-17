@echo off
rem ============================================================
rem  ManufacturingERP - host.bat  (Host Connection Setup)
rem
rem  Double-click this file, answer the questions (host address,
rem  username, passwords) and the app will connect to your
rem  hosting MySQL database. Fully offline - no internet needed
rem  to run this setup itself.
rem
rem  The PowerShell code is embedded at the bottom of this same
rem  file (after the marker line) - nothing else is required.
rem ============================================================
setlocal EnableExtensions
set "MFG_BAT_PATH=%~f0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex(([IO.File]::ReadAllText($env:MFG_BAT_PATH,[Text.Encoding]::UTF8))-replace('(?s)^.*?#'+'PSBEGIN#',''))"
set "EC=%errorlevel%"
if not "%EC%"=="0" (
  echo.
  echo [ERROR] Something went wrong - exit code %EC%.
  echo Try: right-click this file, then "Run with PowerShell".
  pause
)
endlocal & exit /b %EC%
#PSBEGIN#
# =====================================================================
#  ManufacturingERP - Host Connection Setup (host.bat)
#  دابل‌کلیک کنید، مشخصات هاست را وارد کنید — برنامه به هاست وصل می‌شود
#  این اسکریپت فایل db-connection.txt را در پوشهٔ دیتای برنامه می‌نویسد
#  و برنامه را دوباره باز می‌کند. کاملاً آفلاین و بدون نیاز به اینترنت.
# =====================================================================

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { chcp 65001 | Out-Null } catch {}
try { $Host.UI.RawUI.WindowTitle = 'ManufacturingERP - Host Setup' } catch {}

function Read-Req([string]$Prompt, [string]$Default) {
  while ($true) {
    $v = ''
    if ($Default) { $v = Read-Host ("  {0} [{1}]" -f $Prompt, $Default) }
    else { $v = Read-Host ("  " + $Prompt) }
    if ($null -eq $v) { $v = '' }
    $v = ('' + $v).Trim()
    if ($v) { return $v }
    if ($Default) { return $Default }
    Write-Host '    * This field is required (این فیلد الزامی است)' -ForegroundColor Yellow
  }
}

function Read-Pass([string]$Prompt, [switch]$AllowEmpty) {
  while ($true) {
    $sec = Read-Host -Prompt ('  ' + $Prompt) -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $v = ''
    try { $v = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    if ($v) { return $v }
    if ($AllowEmpty) { return '' }
    Write-Host '    * This field is required (این فیلد الزامی است)' -ForegroundColor Yellow
  }
}

function Sanitize-Host([string]$s) {
  $t = ('' + $s).Trim()
  $t = $t -replace '^mysql://', ''
  $t = $t -replace '^https?://', ''
  $i = $t.IndexOfAny([char[]]@('/', ':', '?'))
  if ($i -ge 0) { $t = $t.Substring(0, $i) }
  return $t.Trim()
}

function Normalize-Port([string]$p, [string]$def) {
  $t = (('' + $p).Trim() -replace '[^0-9]', '')
  if (-not $t) { $t = $def }
  return $t
}

function Test-Tcp([string]$h, [string]$p) {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $ar = $c.BeginConnect($h, [int]$p, $null, $null)
    $ok = ($ar.AsyncWaitHandle.WaitOne(6000) -and $c.Connected)
    try { $c.Close() } catch {}
    return $ok
  } catch { return $false }
}

function Enc([string]$s) { return [System.Uri]::EscapeDataString($s) }

function Main {
  Write-Host ''
  Write-Host '  ====================================================' -ForegroundColor Cyan
  Write-Host '    ManufacturingERP - Host Connection Setup' -ForegroundColor Cyan
  Write-Host '    اتصال برنامه به هاست' -ForegroundColor Cyan
  Write-Host '  ====================================================' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  Connection type (نوع اتصال را انتخاب کنید):'
  Write-Host '    [1] SSH tunnel - shared hosting / cPanel (تونل SSH - هاست اشتراکی)'
  Write-Host '    [2] Direct MySQL - VPS / dedicated host (اتصال مستقیم - سرور اختصاصی)'
  Write-Host ''
  $m = Read-Host '  Choose (انتخاب) [1]'
  $mode = 'ssh'
  if ($m -eq '2') { $mode = 'direct' }

  $sshHost = ''
  $sshPort = '21098'
  $sshUser = ''
  $sshPass = ''
  $myHost = ''
  $myPort = '3306'

  if ($mode -eq 'ssh') {
    Write-Host ''
    Write-Host '  --- SSH tunnel settings (تنظیمات تونل SSH) ---' -ForegroundColor Cyan
    Write-Host '      (same username/password you use for cPanel or SSH login)' -ForegroundColor DarkGray
    $sshHost = Sanitize-Host (Read-Req 'SSH host - e.g. serverXXX.web-hosting.com (آدرس هاست SSH)' '')
    $sshPort = Normalize-Port (Read-Req 'SSH port (پورت SSH)' '21098') '21098'
    $sshUser = Read-Req 'SSH username (نام کاربری SSH)' ''
    $sshPass = Read-Pass 'SSH password (رمز SSH)'
  } else {
    Write-Host ''
    Write-Host '  --- Direct MySQL settings (تنظیمات اتصال مستقیم) ---' -ForegroundColor Cyan
    $myHost = Sanitize-Host (Read-Req 'MySQL host (آدرس هاست)' '')
    $myPort = Normalize-Port (Read-Req 'MySQL port (پورت MySQL)' '3306') '3306'
  }

  Write-Host ''
  Write-Host '  --- MySQL database (دیتابیس MySQL) ---' -ForegroundColor Cyan
  $db = Read-Req 'Database name (نام دیتابیس)' ''
  $db = ((('' + $db) -split '[/?#]')[0]).Trim()
  $dbUser = Read-Req 'MySQL username (نام کاربری MySQL)' ''
  $dbPass = Read-Pass 'MySQL password (رمز MySQL - اگر خالی است فقط Enter)' -AllowEmpty

  # ---------- quick reachability check (بررسی سریع دسترسی) ----------
  Write-Host ''
  if ($mode -eq 'ssh') {
    Write-Host ('  Checking ' + $sshHost + ':' + $sshPort + ' ... (بررسی دسترسی) ') -NoNewline
    if (Test-Tcp $sshHost $sshPort) {
      Write-Host 'OK' -ForegroundColor Green
    } else {
      Write-Host 'FAILED' -ForegroundColor Yellow
      Write-Host '    (port closed or blocked - saving anyway; the app will keep retrying)' -ForegroundColor DarkYellow
    }
  } else {
    Write-Host ('  Checking ' + $myHost + ':' + $myPort + ' ... (بررسی دسترسی) ') -NoNewline
    if (Test-Tcp $myHost $myPort) {
      Write-Host 'OK' -ForegroundColor Green
    } else {
      Write-Host 'FAILED' -ForegroundColor Yellow
      Write-Host '    (port closed or blocked - saving anyway; check Remote MySQL access)' -ForegroundColor DarkYellow
    }
  }

  # ---------- build db-connection.txt (exact app format) ----------
  $eu = Enc $dbUser
  $ep = Enc $dbPass
  if ($mode -eq 'ssh') {
    $url = 'mysql://' + $eu + ':' + $ep + '@127.0.0.1:5522/' + $db
    $modeFa = 'تونل SSH (هاست اشتراکی)'
  } else {
    $url = 'mysql://' + $eu + ':' + $ep + '@' + $myHost + ':' + $myPort + '/' + $db
    $modeFa = 'اتصال مستقیم (سرور اختصاصی/VPS)'
  }

  $lines = @(
    '# فایل تنظیم اتصال دیتابیس — ManufacturingERP',
    '# ساخته‌شده با host.bat — نیاز به ویرایش نیست',
    ('# حالت اتصال: ' + $modeFa),
    '#',
    '# برای برگشت به دیتابیس محلی (SQLite)، خط mysql:// را با # کامنت کنید',
    '#',
    $url
  )
  if ($mode -eq 'ssh') {
    $lines += @(
      'ssh-mode=ssh',
      ('ssh-host=' + $sshHost),
      ('ssh-port=' + $sshPort),
      ('ssh-user=' + $sshUser),
      ('ssh-password=' + $sshPass)
    )
  } else {
    $lines += @('ssh-mode=direct')
  }

  $nl = [string][char]13 + [string][char]10
  $text = [string]::Join($nl, $lines) + $nl

  $appData = [Environment]::GetFolderPath('ApplicationData')
  $cfgDir = [IO.Path]::Combine($appData, 'ManufacturingERP')
  $cfgPath = [IO.Path]::Combine($cfgDir, 'db-connection.txt')
  New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($cfgPath, $text, $utf8)

  Write-Host ''
  Write-Host '  [OK] Configuration saved (تنظیمات ذخیره شد):' -ForegroundColor Green
  Write-Host ('       ' + $cfgPath)

  $legacyDir = [IO.Path]::Combine($appData, 'nextjs_tailwind_shadcn_ts')
  if (Test-Path -LiteralPath $legacyDir) {
    try {
      [IO.File]::WriteAllText([IO.Path]::Combine($legacyDir, 'db-connection.txt'), $text, $utf8)
    } catch {}
  }

  # ---------- summary (خلاصه) ----------
  $passShow = '***'
  if (-not $dbPass) { $passShow = '(empty)' }
  Write-Host ''
  Write-Host '  --- Summary (خلاصهٔ تنظیمات) ---' -ForegroundColor Cyan
  if ($mode -eq 'ssh') {
    Write-Host ('   Mode       : SSH tunnel (تونل SSH)')
    Write-Host ('   SSH        : ' + $sshUser + '@' + $sshHost + ':' + $sshPort)
    Write-Host ('   Database   : ' + $db + '  (via secure tunnel on this PC)')
    Write-Host ('   MySQL user : ' + $dbUser + '   password: ' + $passShow)
  } else {
    Write-Host ('   Mode       : Direct MySQL (اتصال مستقیم)')
    Write-Host ('   Host       : ' + $myHost + ':' + $myPort)
    Write-Host ('   Database   : ' + $db)
    Write-Host ('   MySQL user : ' + $dbUser + '   password: ' + $passShow)
  }

  # ---------- (re)start the app ----------
  Write-Host ''
  $ans = Read-Host '  Open the app now? (برنامه الان باز شود؟) [Y/n]'
  if ($ans -notmatch '^[nN]') {
    try {
      Get-Process -Name 'ManufacturingERP' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    } catch {}
    $cands = @()
    if ($env:ProgramFiles) { $cands += [IO.Path]::Combine($env:ProgramFiles, 'ManufacturingERP\ManufacturingERP.exe') }
    $pf86 = ${env:ProgramFiles(x86)}
    if ($pf86) { $cands += [IO.Path]::Combine($pf86, 'ManufacturingERP\ManufacturingERP.exe') }
    if ($env:LocalAppData) { $cands += [IO.Path]::Combine($env:LocalAppData, 'Programs\ManufacturingERP\ManufacturingERP.exe') }
    $exe = $null
    foreach ($c in $cands) { if (Test-Path -LiteralPath $c) { $exe = $c; break } }
    if ($exe) {
      Start-Process -FilePath $exe
      Write-Host '  [OK] The app is starting with the new host settings (برنامه با تنظیمات جدید باز شد)' -ForegroundColor Green
      Write-Host '       First sync may take a minute (همگام‌سازی اول ممکن است کمی طول بکشد)'
    } else {
      Write-Host '  [!] ManufacturingERP.exe not found (برنامه پیدا نشد)' -ForegroundColor Yellow
      Write-Host '      Install/open the app manually (برنامه را دستی باز کنید).'
    }
  } else {
    Write-Host '  Done (تمام) — next time the app opens, it will connect to the host.'
  }

  Write-Host ''
  Read-Host '  Press Enter to close (برای بستن Enter بزنید)'
}

try { Main } catch {
  Write-Host ''
  Write-Host ('  [ERROR] ' + $_.Exception.Message) -ForegroundColor Red
  Read-Host '  Press Enter to close (برای بستن Enter بزنید)'
  exit 1
}
exit 0
