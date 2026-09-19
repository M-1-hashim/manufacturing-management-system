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
 *
 * اجرا:  bun scripts/test-admin-reset.mjs            (همهٔ caseها پشت‌سرهم)
 */
import { Database } from 'bun:sqlite'
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'fs'

const CASE = process.env.CASE || 'ALL'
const DIR = '/tmp/mfg-admin-reset'
try { rmSync(DIR, { recursive: true, force: true }) } catch {}
mkdirSync(DIR, { recursive: true })

const DB = `${DIR}/test-${CASE}.db`
const RESET_FILE = `${DIR}/reset-${CASE}.txt`

function writeOldSchemaDb(adminPasswordPlain) {
  // اسکیمای قدیمی ≤۱.۰.۱۸ (بدون tokenVersion) — مثل نصب واقعی قدیمی
  const s = new Database(DB)
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

if (CASE === 'D') {
  // تست واحد پارس — بدون دیتابیس
  const { parseAdminResetContent } = await import('../src/lib/admin-reset.ts')
  check(parseAdminResetContent('# comment\npassword=NewPass456\n') === 'NewPass456', 'پارس password=X')
  check(parseAdminResetContent('# راهنما\r\npassword=My Secret 99\r\n') === 'My Secret 99', 'پارس CRLF + فاصله داخل رمز')
  check(parseAdminResetContent('# فقط کامنت\n\n# باز کامنت\n') === 'admin123', 'فقط کامنت → پیش‌فرض admin123')
  check(parseAdminResetContent('') === 'admin123', 'فایل خالی → پیش‌فرض admin123')
  check(parseAdminResetContent('# header\nab\n') === 'admin123', 'رمز خیلی کوتاه → پیش‌فرض admin123')
  check(parseAdminResetContent('# header\nmy-plain-pass-2024\n') === 'my-plain-pass-2024', 'خط سادهٔ بدون = → رمز')
  check(parseAdminResetContent('username=admin\npassword=Xyz12345\n') === 'Xyz12345', 'username= نادیده، password= خوانده شد')
  check(parseAdminResetContent(' PASSWORD = spaced  ') === 'spaced', 'کلید بزرگ/فاصله — مقاوم')
  if (failures === 0) console.log('CASE D: ALL PASS')
  else process.exit(1)
  process.exit(0)
}

if (CASE !== 'ALL') {
  // اجرای تک‌case (برای دیباگ)
  process.env.CASE = CASE
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

if (CASE === 'A' || CASE === 'ALL') {
  console.log('— Case A: ریست با رمز دلخواه از مسیر env الکترون —')
  writeOldSchemaDb('oldSecret99')
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

if (CASE === 'B' || CASE === 'ALL') {
  console.log('— Case B: ریست حتی در تلاش ورود ناموفق (بدون ری‌استارت) —')
  writeOldSchemaDb('oldSecret99')
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

if (CASE === 'C' || CASE === 'ALL') {
  console.log('— Case C: بدون فایل ریست — مسیر عادی —')
  writeOldSchemaDb('admin123')
  delete process.env.ERP_ADMIN_RESET_FILES
  const res = await POST(makeReq('admin', 'admin123'))
  const j = await res.json()
  check(res.status === 200 && j.role === 'admin', `ورود عادی → 200 (got ${res.status})`)
  check(!existsSync(RESET_FILE + '.done.txt'), 'هیچ .done ساخته نشده')
  const oc = await consumeAdminPasswordReset()
  check(oc.attempted === false && oc.complete === false, 'بدون فایل → attempted=false')
  if (failures > 0) process.exit(1)
  if (CASE !== 'ALL') process.exit(0)
}

if (CASE === 'E' || CASE === 'ALL') {
  console.log('— Case E: idempotent — رمز از قبل admin123 است —')
  writeOldSchemaDb('admin123')
  const first = await POST(makeReq('admin', 'admin123'))
  check(first.status === 200, 'بوت‌استرپ/ورود اولیه → 200')
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

if (CASE === 'F' || CASE === 'ALL') {
  console.log('— Case F: فایل کنار دیتابیس SQLite (بدون env) —')
  writeOldSchemaDb('oldSecret99')
  const dirResetFile = `${DIR}/reset-admin-password.txt`
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

if (CASE === 'ALL') {
  console.log(failures === 0 ? '\nALL CASES: PASS (A-F)' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}
