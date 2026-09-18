/*
 * تست انتها-به-انتهای «خطای داخلی هاست» (v1.0.26):
 *  Case A: دیتابیس محلیِ قدیمی (اسکیمای ≤۱.۰.۱۸ — بدون tokenVersion، پسورد ساده)
 *          → قبلاً: P2022 → 500 «خطای داخلی هاست» / حالا: ترمیم خودکار → 200
 *  Case B: فایل db کاملاً خالی (بدون هیچ جدولی — سناریوی demo-db گم‌شده)
 *          → قبلاً: P2021/P2022 → 500 / حالا: ساخت خودکار جدول‌ها + بوت‌استرپ ادمین → 200
 *  Case C: repairSchemaGap مستقیم روی db خراب + isSchemaGapError
 *  Case D: پسورد غلط → 401 (مسیر عادی دست‌نخورده)
 */
import { Database } from 'bun:sqlite'
import { rmSync, existsSync } from 'fs'

const CASE = process.env.CASE || 'A'
const DB = `/tmp/mfg-repair-test-${CASE}.db`
for (const suf of ['', '-wal', '-shm']) {
  try { rmSync(DB + suf) } catch {}
}

if (CASE === 'A') {
  // اسکیمای قدیمی: User بدون tokenVersion + کاربر ادمین با پسورد ساده
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
    VALUES ('u1','admin','admin123','مدیر سیستم','admin','general',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`)
  s.close()
} else if (CASE === 'C') {
  // اسکیمای واقعیِ قدیمی (بدون tokenVersion، بدون هیچ ردیف) — برای تست مستقیم repair
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
  s.close()
}
// Case B: هیچ فایلی ساخته نمی‌شود — کاملاً خالی

process.env.DATABASE_URL = 'file:' + DB
process.env.LOCAL_DATABASE_URL = 'file:' + DB

const { POST } = await import('../src/app/api/auth/login/route.ts')
const { repairSchemaGap, isSchemaGapError } = await import('../src/lib/db-repair.ts')
const { PrismaClient } = await import('@prisma/client')

function makeReq(username, password) {
  return new Request('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': 'test-ip' },
    body: JSON.stringify({ username, password }),
  })
}

if (CASE === 'A') {
  const res = await POST(makeReq('admin', 'admin123'))
  const j = await res.json()
  console.log(`[A] status=${res.status} role=${j.role} username=${j.username}`)
  if (res.status !== 200 || j.role !== 'admin') { console.error('[A] FAIL'); process.exit(1) }
  const cookie = res.headers.get('set-cookie') || ''
  if (!cookie.includes('mfg_session=')) { console.error('[A] FAIL: no session cookie'); process.exit(1) }
  // ستون tokenVersion حالا باید موجود باشد
  const s = new Database(DB, { readonly: true })
  const cols = s.prepare(`PRAGMA table_info("User")`).all().map((c) => c.name)
  s.close()
  if (!cols.includes('tokenVersion')) { console.error('[A] FAIL: tokenVersion not added'); process.exit(1) }
  console.log('[A] PASS — old db repaired transparently, tokenVersion added, login 200 + cookie')
} else if (CASE === 'B') {
  const res = await POST(makeReq('admin', 'admin123'))
  const j = await res.json()
  console.log(`[B] status=${res.status} role=${j.role}`)
  if (res.status !== 200 || j.role !== 'admin') { console.error('[B] FAIL'); process.exit(1) }
  if (!existsSync(DB)) { console.error('[B] FAIL: db file not created'); process.exit(1) }
  const s = new Database(DB, { readonly: true })
  const tables = s.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().length
  const u = s.prepare(`SELECT username, role FROM "User" LIMIT 1`).get()
  s.close()
  console.log(`[B] tables=${tables} bootstrapUser=${u?.username}/${u?.role}`)
  if (tables < 19 || u?.username !== 'admin') { console.error('[B] FAIL'); process.exit(1) }
  console.log('[B] PASS — empty db bootstrapped (19 tables + admin), login 200')
} else if (CASE === 'C') {
  const p = new PrismaClient({ datasources: { db: { url: 'file:' + DB } } })
  let threw = null
  try { await p.user.findUnique({ where: { id: 'x' } }) } catch (e) { threw = e }
  if (!threw || !isSchemaGapError(threw)) { console.error('[C] FAIL: P2022 not detected as schema gap'); process.exit(1) }
  console.log(`[C] gap detected: code=${threw.code}`)
  const rep = await repairSchemaGap()
  console.log(`[C] repair: attempted=${rep.attempted} repaired=${rep.repaired} detail=${rep.detail}`)
  if (!rep.repaired) { console.error('[C] FAIL: repair failed'); process.exit(1) }
  const u = await p.user.findUnique({ where: { id: 'x' } })
  console.log(`[C] findUnique after repair = ${u} (null یعنی جدول سالم است)`)
  if (u !== null) { console.error('[C] FAIL'); process.exit(1) }
  await p.$disconnect()
  console.log('[C] PASS — schema gap detected + repaired')
} else if (CASE === 'D') {
  const res = await POST(makeReq('admin', 'wrongpass'))
  const j = await res.json()
  console.log(`[D] status=${res.status} error=${j.error}`)
  if (res.status !== 401 || !/اشتباه/.test(j.error || '')) { console.error('[D] FAIL'); process.exit(1) }
  console.log('[D] PASS — wrong password still 401 with normal message')
}
console.log(`CASE ${CASE}: ALL PASS`)
