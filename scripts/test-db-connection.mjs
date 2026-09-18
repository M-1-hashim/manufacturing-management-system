/*
 * تست رفت‌وبرگشت db-connection.txt — منطق واقعیِ electron/main.js
 *
 * تابع‌های لایهٔ داده (connectionConfigPath تا parseActiveOverride) از main.js
 * استخراج و با fs/app فیک تزریق می‌شوند؛ هیچ کد تکراری‌ای وجود ندارد.
 *
 * اجرا:  node scripts/test-db-connection.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')

const mainJs = readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8')

const START = mainJs.indexOf('function connectionConfigPath()')
const END = mainJs.indexOf('function migrateLegacyUserData()')
if (START < 0 || END < 0 || END <= START) {
  console.error('FATAL: region not found in electron/main.js')
  process.exit(1)
}
const region = mainJs.slice(START, END)

/* ------------------------------------------------ فیک‌ها */
function makeSandbox() {
  const files = new Map() // path -> string
  const mkdirs = new Set()
  const fs = {
    existsSync: (p) => files.has(String(p)),
    readFileSync: (p, enc) => {
      if (!files.has(String(p))) { const e = new Error('ENOENT: ' + p); e.code = 'ENOENT'; throw e }
      return files.get(String(p))
    },
    writeFileSync: (p, content) => {
      if (fs.__readOnly) { const e = new Error('EACCES: permission denied, open ' + p); e.code = 'EACCES'; throw e }
      files.set(String(p), String(content))
    },
    mkdirSync: (p) => { mkdirs.add(String(p)) },
    __readOnly: false,
  }
  const app = {
    __version: '1.0.25.0-test',
    getVersion: () => app.__version,
    getPath: (name) => {
      if (name === 'userData') return '/fake/appdata/ManufacturingERP'
      if (name === 'home') return '/fake/home'
      if (name === 'appData') return '/fake/appdata'
      throw new Error('unknown path: ' + name)
    },
  }
  const logs = []
  const logLine = (l) => logs.push(l)
  const factory = new Function('app', 'fs', 'path', 'logLine',
    region + '\n;return { connectionConfigPath, friendlyConfigPath, configCandidates, templateLines, writeConnectionContent, writeConnectionFile, ensureTemplateFile, parseFile, parseActiveOverride, getLastEnsure: () => lastEnsureResult };'
  )
  return { api: factory(app, fs, path, logLine), files, fs, app, logs }
}

/* ------------------------------------------------ runner */
let pass = 0, fail = 0
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name) }
  else { fail++; console.error('  FAIL  ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra) : '')) }
}
const FRIENDLY = '/fake/home/ManufacturingERP/db-connection.txt'
const APPDATA = '/fake/appdata/ManufacturingERP/db-connection.txt'

console.log('== ۱) ensureTemplateFile — فایل غایب → ساخت قالب با راهنمای فارسی ==')
{
  const s = makeSandbox()
  s.api.ensureTemplateFile()
  check('فایل در مسیر friendly ساخته شد', s.files.has(FRIENDLY))
  check('فایل در مسیر AppData هم ساخته شد', s.files.has(APPDATA))
  const content = s.files.get(FRIENDLY) || ''
  check('خط نسخهٔ برنامه در قالب هست', content.includes('1.0.25.0-test'))
  check('خط mysql:// نمونه (غیرفعال) هست', content.includes('# mysql://DBUSER:DBPASSWORD@DBHOST:3306/DBNAME'))
  check('راهنمای فارسی داخل فایل هست', content.includes('فایل تنظیم اتصال به هاست'))
  check('ssh-mode=direct پیش‌فرض هست', content.includes('# ssh-mode=direct'))
  const en = s.api.getLastEnsure()
  check('lastEnsureResult: created=true', en && en.created === true && en.error === null, en)
  const parsed = s.api.parseActiveOverride()
  check('پارس: قالب تازه فعال نیست', parsed.active === false && parsed.exists === true, parsed)
  check('parse: مسیر خوانده‌شده friendly است', parsed.path === FRIENDLY)
}

console.log('== ۲) ensureTemplateFile — فایل موجود → دست نمی‌زند ==')
{
  const s = makeSandbox()
  s.files.set(FRIENDLY, 'CUSTOM-USER-CONTENT')
  s.api.ensureTemplateFile()
  check('محتوای کاربر بازنویسی نشد', s.files.get(FRIENDLY) === 'CUSTOM-USER-CONTENT')
  const en = s.api.getLastEnsure()
  check('lastEnsureResult: created=false (skip)', en && en.created === false && en.attempted === false, en)
}

console.log('== ۳) round-trip حالت SSH (رمز URL-encoded در URL، خام در ssh-password) ==')
{
  const s = makeSandbox()
  const url = 'mysql://mfguser:my%40pass%231@server370.web-hosting.com:3306/mfg_db'
  s.files.set(FRIENDLY, s.api.templateLines(url) +
    'ssh-mode=ssh\r\nssh-host=server370.web-hosting.com\r\nssh-port=21098\r\nssh-user=cpuser\r\nssh-password=cp pass!2024\r\n')
  const p = s.api.parseActiveOverride()
  check('active=true', p.active === true)
  check('host', p.host === 'server370.web-hosting.com', p.host)
  check('port=3306', p.port === '3306', p.port)
  check('database=mfg_db', p.database === 'mfg_db', p.database)
  check('user=mfguser', p.user === 'mfguser', p.user)
  check('password decode: my@pass#1', p.password === 'my@pass#1', p.password)
  check('sshMode=true', p.sshMode === true)
  check('sshPort=21098', p.sshPort === '21098', p.sshPort)
  check('sshUser=cpuser', p.sshUser === 'cpuser', p.sshUser)
  check('sshPassword خام حفظ شد', p.sshPassword === 'cp pass!2024', p.sshPassword)
}

console.log('== ۴) round-trip حالت direct (پورت غیرپیش‌فرض) ==')
{
  const s = makeSandbox()
  const url = 'mysql://root:S3cret@192.168.1.50:3307/erp'
  s.files.set(FRIENDLY, s.api.templateLines(url) + 'ssh-mode=direct\r\n')
  const p = s.api.parseActiveOverride()
  check('active=true', p.active === true)
  check('host=192.168.1.50', p.host === '192.168.1.50', p.host)
  check('port=3307', p.port === '3307', p.port)
  check('database=erp', p.database === 'erp', p.database)
  check('sshMode=false', p.sshMode === false)
}

console.log('== ۵) اولویت: دو فایل فعال → friendly برنده است ==')
{
  const s = makeSandbox()
  s.files.set(FRIENDLY, s.api.templateLines('mysql://winuser:wp@winhost:3306/windb') + 'ssh-mode=direct\r\n')
  s.files.set(APPDATA, s.api.templateLines('mysql://appuser:ap@apphost:3306/appdb') + 'ssh-mode=direct\r\n')
  const p = s.api.parseActiveOverride()
  check('friendly برنده', p.host === 'winhost' && p.user === 'winuser', p.host)
}

console.log('== ۶) فقط AppData فعال → همان استفاده می‌شود ==')
{
  const s = makeSandbox()
  s.files.set(APPDATA, s.api.templateLines('mysql://appuser:ap@apphost:3306/appdb') + 'ssh-mode=direct\r\n')
  const p = s.api.parseActiveOverride()
  check('AppData فعال خوانده شد', p.active === true && p.host === 'apphost', p)
}

console.log('== ۷) writeConnectionFile → هر دو مسیر → parse دوباره ==')
{
  const s = makeSandbox()
  const url = 'mysql://u2:p2@h2.example.com:3307/db2'
  s.api.writeConnectionFile(url)
  check('friendly نوشته شد', s.files.has(FRIENDLY))
  check('AppData نوشته شد', s.files.has(APPDATA))
  const p = s.api.parseActiveOverride()
  check('round-trip: host', p.host === 'h2.example.com', p.host)
  check('round-trip: port', p.port === '3307', p.port)
  check('round-trip: db', p.database === 'db2', p.database)
  check('round-trip: قالب راهنما هم سرِ جایش است', (s.files.get(FRIENDLY) || '').includes('خط اتصال MySQL'))
}

console.log('== ۸) خطای نوشتن (فایل‌سیستم فقط‌خواندنی) → error ثبت می‌شود، crash نیست ==')
{
  const s = makeSandbox()
  s.fs.__readOnly = true
  let threw = false
  try { s.api.ensureTemplateFile() } catch { threw = true }
  check('ensureTemplateFile نمی‌ترکد', threw === false)
  const en = s.api.getLastEnsure()
  check('lastEnsureResult.error پر شد', en && en.error && String(en.error).includes('EACCES'), en)
}

console.log('== ۹) قالب بعد از build templateLines فعال — URL یک‌خطی سالم ==')
{
  const s = makeSandbox()
  const url = 'mysql://u:p%20w@host:3306/db'
  const content = s.api.templateLines(url)
  const lines = content.split('\r\n')
  const activeLines = lines.filter((l) => l.startsWith('mysql://'))
  check('دقیقاً یک خط mysql:// فعال', activeLines.length === 1, activeLines)
  check('خط فعال همان URL است', activeLines[0] === url)
  check('CRLF حفظ شده (Notepad-friendly)', content.includes('\r\n'))
}

console.log(`\nنتیجه: ${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
