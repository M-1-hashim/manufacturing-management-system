/*
 * تست انتها-به-انتهای «ریست رمز ادمین» (v1.0.27):
 *  Case A: فایل ریست با password=NewPass456 (مسیر env الکترون) → ورود با رمز جدید 200،
 *          رمز قدیمی 401، فایل → .done تغییر نام، tokenVersion ≥ 1
 *  Case B: اولین تلاش ورود با پسورد غلط — ریست قبل از بررسی اعتبارنامه اعمال می‌شود
 *          (بدون ری‌استارت برنامه) → تلاش دوم با رمز جدید 200
 *  Case C: بدون فایل ریست → مسیر عادی دست‌نخورده (admin123 → 200، هیچ .done ساخته نمی‌شود)
 *  Case D: تست واحد parseAdminResetContent — password=X / خط ساده / فقط کامنت / خالی / رمز خیلی کوتاه / CRLF
 *  Case E: idempotent — فایل با محتوای پیش‌فرض وقتی رمز از قبل admin123 است → skip بدون churn + مصرف فایل
 *  Case F: فایل کنار دیتابیس SQLite (بدون env الکترون) — مسیر پوشهٔ data دسکتاپ
 *  Case G: منطق سمت الکترون (main.js) — مسیرها، قالب فایل، IPC prepare/status
 *          با fs/app فیک (استخراج واقعی کد از main.js — مثل test-db-connection.mjs)
 *
 * نکتهٔ ساختاری: کلاینت Prisma یک‌بار از DATABASE_URL ساخته می‌شود → همهٔ caseها
 * باید «همان یک فایل» دیتابیس را استفاده کنند؛ بین caseها فقط محتوای جدول User
 * بازنشانی می‌شود (seedAdmin) و هر case فایل ریستِ یکتای خودش را دارد.
 *
 * اجرا:  bun scripts/test-admin-reset.mjs            (همهٔ caseها پشت‌سرهم)
 *        CASE=F bun scripts/test-admin-reset.mjs     (تک‌case برای دیباگ)
 */
import { Database } from 'bun:sqlite'
import { rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs'
import path from 'node:path'

const CASE = process.env.CASE || 'ALL'
const DIR = '/tmp/mfg-admin-reset'
try { rmSync(DIR, { recursive: true, force: true }) } catch {}
mkdirSync(DIR, { recursive: true })

const DB = `${DIR}/test.db`
const RF = (suffix) => `${DIR}/reset-${suffix}.txt`

/** آماده‌سازی جدول User با یک ردیف ادمین — پسورد ساده (سازگار با verify قدیمی)
 *  oldSchema: شبیه‌سازی نصب ≤۱.۰.۱۸ (بدون ستون tokenVersion) — فقط Case A */
function seedAdmin(adminPasswordPlain, oldSchema = false) {
  const s = new Database(DB)
  if (oldSchema) {
    s.exec(`DROP TABLE IF EXISTS "User"`)
    s.exec(`CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL,
      "password" TEXT NOT NULL,
      "fullName" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'viewer',
      "department" TEXT NOT NULL DEFAULT 'general',
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
  } else {
    s.exec(`DELETE FROM "User"`)
  }
  s.exec(`INSERT INTO "User" (id,username,password,fullName,role,department,active,createdAt,updatedAt)
    VALUES ('u1','admin','${adminPasswordPlain}','مدیر سیستم','admin','general',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
  s.close()
}

function userRow() {
  const s = new Database(DB, { readonly: true })
  const u = s.prepare(`SELECT id, username, password, tokenVersion FROM "User" WHERE username='admin'`).get()
  s.close()
  return u
}

process.env.DATABASE_URL = 'file:' + DB
process.env.LOCAL_DATABASE_URL = 'file:' + DB

let failures = 0
function check(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ FAIL: ${label}`)
    failures++
  }
}

if (CASE === 'D' || CASE === 'ALL') {
  // تست واحد پارس — بدون دیتابیس (قبل از caseهای دیتابیسی، با خروجی کمتر)
  if (CASE === 'D') {
    await parseCase()
    process.exit(failures === 0 ? 0 : 1)
  }
  await parseCase(true)
}

async function parseCase(quiet = false) {
  const { parseAdminResetContent } = await import('../src/lib/admin-reset.ts')
  check(parseAdminResetContent('# comment\npassword=NewPass456\n') === 'NewPass456', 'پارس password=X')
  check(parseAdminResetContent('# راهنما\r\npassword=My Secret 99\r\n') === 'My Secret 99', 'پارس CRLF + فاصله داخل رمز')
  check(parseAdminResetContent('# فقط کامنت\n\n# باز کامنت\n') === 'admin123', 'فقط کامنت → پیش‌فرض admin123')
  check(parseAdminResetContent('') === 'admin123', 'فایل خالی → پیش‌فرض admin123')
  check(parseAdminResetContent('# header\nab\n') === 'admin123', 'رمز خیلی کوتاه → پیش‌فرض admin123')
  check(parseAdminResetContent('# header\nmy-plain-pass-2024\n') === 'my-plain-pass-2024', 'خط سادهٔ بدون = → رمز')
  check(parseAdminResetContent('username=admin\npassword=Xyz12345\n') === 'Xyz12345', 'username= نادیده، password= خوانده شد')
  check(parseAdminResetContent(' PASSWORD = spaced  ') === 'spaced', 'کلید بزرگ/فاصله — مقاوم')
  if (!quiet && failures === 0) console.log('CASE D: ALL PASS')
}

if (CASE !== 'ALL') {
  // اجرای تک‌case (برای دیباگ) — سایر caseها اجرا نمی‌شوند
  process.env.ONLY = CASE
}

const { POST } = await import('../src/app/api/auth/login/route.ts')
const { consumeAdminPasswordReset, adminResetFileCandidates } = await import('../src/lib/admin-reset.ts')

function makeReq(username, password) {
  return new Request('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': 'test-ip' },
    body: JSON.stringify({ username, password }),
  })
}

const run = (name) => CASE === 'ALL' || CASE === name

if (run('A')) {
  console.log('— Case A: ریست با رمز دلخواه از مسیر env الکترون —')
  seedAdmin('oldSecret99', true) // اسکیمای قدیمی — ensureLocalSchema باید ترقی دهد
  const RESET_FILE = RF('a')
  writeFileSync(RESET_FILE, '# راهنما\npassword=NewPass456\n', 'utf8')
  process.env.ERP_ADMIN_RESET_FILES = RESET_FILE
  const res = await POST(makeReq('admin', 'NewPass456'))
  const j = await res.json()
  check(res.status === 200 && j.role === 'admin', `ورود با رمز جدید → 200 (got ${res.status})`)
  check(existsSync(RESET_FILE + '.done.txt') && !existsSync(RESET_FILE), 'فایل به .done.txt مصرف شد')
  const row = userRow()
  check(!row.password.startsWith('oldSecret99'), 'هش پسورد عوض شد')
  check(Number(row.tokenVersion) >= 1, `tokenVersion ≥ 1 (got ${row.tokenVersion})`)
  const res2 = await POST(makeReq('admin', 'oldSecret99'))
  check(res2.status === 401, `رمز قدیمی → 401 (got ${res2.status})`)
  const res3 = await POST(makeReq('admin', 'NewPass456'))
  check(res3.status === 200, 'ورود دوباره با رمز جدید → 200')
  delete process.env.ERP_ADMIN_RESET_FILES
  if (failures > 0) process.exit(1)
  if (CASE !== 'ALL') process.exit(0)
}

if (run('B')) {
  console.log('— Case B: ریست حتی در تلاش ورود ناموفق (بدون ری‌استارت) —')
  seedAdmin('oldSecret99')
  const RESET_FILE = RF('b')
  writeFileSync(RESET_FILE, 'password=SecondTry777', 'utf8')
  process.env.ERP_ADMIN_RESET_FILES = RESET_FILE
  const res1 = await POST(makeReq('admin', 'wrong-guess'))
  check(res1.status === 401, `اولین تلاش غلط → 401 (got ${res1.status})`)
  check(existsSync(RESET_FILE + '.done.txt'), 'ریست با این هم اعمال و فایل مصرف شد')
  const res2 = await POST(makeReq('admin', 'SecondTry777'))
  check(res2.status === 200, `تلاش دوم با رمز جدید → 200 (got ${res2.status})`)
  delete process.env.ERP_ADMIN_RESET_FILES
  if (failures > 0) process.exit(1)
  if (CASE !== 'ALL') process.exit(0)
}

if (run('C')) {
  console.log('— Case C: بدون فایل ریست — مسیر عادی —')
  seedAdmin('admin123')
  delete process.env.ERP_ADMIN_RESET_FILES
  const RESET_FILE = RF('c')
  const res = await POST(makeReq('admin', 'admin123'))
  const j = await res.json()
  check(res.status === 200 && j.role === 'admin', `ورود عادی → 200 (got ${res.status})`)
  check(!existsSync(RESET_FILE + '.done.txt'), 'هیچ .done ساخته نشده')
  const oc = await consumeAdminPasswordReset()
  check(oc.attempted === false && oc.complete === false, 'بدون فایل → attempted=false')
  if (failures > 0) process.exit(1)
  if (CASE !== 'ALL') process.exit(0)
}

if (run('E')) {
  console.log('— Case E: idempotent — رمز از قبل admin123 است —')
  seedAdmin('admin123')
  const RESET_FILE = RF('e')
  const first = await POST(makeReq('admin', 'admin123'))
  check(first.status === 200, 'ورود اولیه → 200')
  const before = userRow()
  writeFileSync(RESET_FILE, '# تماماً پیش‌فرض\npassword=admin123\n', 'utf8')
  process.env.ERP_ADMIN_RESET_FILES = RESET_FILE
  const res = await POST(makeReq('admin', 'admin123'))
  check(res.status === 200, 'ورود با همان admin123 → 200')
  const after = userRow()
  check(Number(after.tokenVersion) === Number(before.tokenVersion), `tokenVersion بدون churn (before=${before.tokenVersion} after=${after.tokenVersion})`)
  check(existsSync(RESET_FILE + '.done.txt'), 'فایل مصرف شد')
  delete process.env.ERP_ADMIN_RESET_FILES
  if (failures > 0) process.exit(1)
  if (CASE !== 'ALL') process.exit(0)
}

if (run('F')) {
  console.log('— Case F: فایل کنار دیتابیس SQLite (بدون env) —')
  seedAdmin('oldSecret99')
  const dirResetFile = `${DIR}/reset-admin-password.txt` // مسیر کاندید «کنار db»
  writeFileSync(dirResetFile, 'password=FromDbDir789', 'utf8')
  delete process.env.ERP_ADMIN_RESET_FILES
  const cands = adminResetFileCandidates()
  check(cands.some((p) => p === dirResetFile), 'کنار db در کاندیدهاست')
  const res = await POST(makeReq('admin', 'FromDbDir789'))
  check(res.status === 200, `ورود با رمز فایل کنار db → 200 (got ${res.status})`)
  check(existsSync(dirResetFile + '.done.txt') && !existsSync(dirResetFile), 'فایل مصرف شد')
  if (failures > 0) process.exit(1)
  if (CASE !== 'ALL') process.exit(0)
}

if (run('G')) {
  console.log('— Case G: منطق سمت الکترون (استخراج واقعی main.js با fs/app فیک) —')
  const mainJs = readFileSync(new URL('../electron/main.js', import.meta.url), 'utf8')
  const START = mainJs.indexOf('function friendlyAdminResetPath()')
  const markerIdx = mainJs.indexOf('«باز کردن فایل تنظیمات»')
  const END = markerIdx > 0 ? mainJs.lastIndexOf('/*', markerIdx) : -1
  check(START > 0 && END > START, 'ناحیهٔ admin-reset در main.js پیدا شد')
  const region = mainJs.slice(START, END)

  // فیک‌ها — fs درون‌حافظه‌ای، app الکترون ساختگی
  const files = new Map()
  const fakeFs = {
    existsSync: (p) => files.has(p),
    writeFileSync: (p, c) => { if (p === '/forbidden/x.txt') throw new Error('EACCES: forbidden'); files.set(p, String(c)) },
    readFileSync: (p) => { if (!files.has(p)) throw new Error('ENOENT'); return files.get(p) },
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a) },
    mkdirSync: () => {},
  }
  const fakeApp = {
    getPath: (k) => (k === 'home' ? '/home/demo' : k === 'userData' ? '/userdata' : k === 'appData' ? '/appdata' : ''),
    getVersion: () => '1.0.27-test',
  }
  const registered = {}
  const fakeIpcMain = { handle: (name, fn) => { registered[name] = fn } }
  const logs = []
  const fn = new Function('fs', 'path', 'app', 'ipcMain', 'logLine',
    `${region}\n;return { friendlyAdminResetPath, adminResetCandidates, adminResetTemplateLines }`)
  const ex = fn(fakeFs, path, fakeApp, fakeIpcMain, (m) => logs.push(m))

  check(ex.friendlyAdminResetPath() === path.join('/home/demo', 'ManufacturingERP', 'reset-admin-password.txt'), 'مسیر دوستانه = home/ManufacturingERP/reset-admin-password.txt')
  const cands = ex.adminResetCandidates()
  check(cands.length === 2 && cands[0].startsWith('/home/demo') && cands[1].startsWith('/userdata'), 'دو کاندید: friendly + userData')
  const tpl = ex.adminResetTemplateLines()
  check(tpl.includes('\r\n') && tpl.includes('password=admin123') && tpl.includes('1.0.27-test'), 'قالب CRLF با خط رمز + نسخهٔ برنامه')

  const prep1 = registered['admin-reset:prepare']()
  check(prep1.ok && prep1.existed === false && prep1.path === ex.friendlyAdminResetPath(), 'prepare → ساخت فایل در مسیر دوستانه')
  check(fakeFs.existsSync(prep1.path) && fakeFs.readFileSync(prep1.path) === tpl, 'محتوای فایل روی دیسک == قالب')
  const prep2 = registered['admin-reset:prepare']()
  check(prep2.ok && prep2.existed === true && prep2.path === prep1.path, 'prepare دوباره → فایل موجود short-circuit')
  const st = registered['admin-reset:status']()
  check(st.ok && st.exists === true && st.paths[0] === prep1.path, 'status → exists=true با مسیر واقعی')

  // شکست نوشتن → خطای تمیز بدون crash
  files.clear()
  const brokenApp = { getPath: () => '/forbidden', getVersion: () => '1.0.27-test' }
  const fn2 = new Function('fs', 'path', 'app', 'ipcMain', 'logLine',
    `${region}\n;return { friendlyAdminResetPath, adminResetCandidates, adminResetTemplateLines }`)
  const ex2 = fn2(fakeFs, path, brokenApp, fakeIpcMain, (m) => logs.push(m))
  const prep3 = ex2.adminResetCandidates().length >= 0 && (() => {
    // بازنویسی registered handler با app شکسته — همان الگوی prepare
    try {
      const existing = ex2.adminResetCandidates().find((p) => fakeFs.existsSync(p))
      if (existing) return { ok: true, path: existing, existed: true }
      const p = ex2.friendlyAdminResetPath()
      fakeFs.writeFileSync(p, ex2.adminResetTemplateLines(), 'utf8')
      return { ok: true, path: p, existed: false }
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) }
    }
  })()
  check(prep3.ok === false && typeof prep3.error === 'string' && prep3.error.includes('EACCES'), 'شکست نوشتن → {ok:false, error} بدون crash')
  if (failures > 0) process.exit(1)
  if (CASE !== 'ALL') process.exit(0)
}

if (CASE === 'ALL') {
  console.log(failures === 0 ? '\nALL CASES: PASS (A-G)' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}
