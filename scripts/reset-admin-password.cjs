#!/usr/bin/env node
/*
 * ریست رمز ادمین — اسکریپت مستقل (بدون نیاز به build یا TypeScript)
 *
 * مصرف در cPanel (ترمینال):
 *   cd ~/app
 *   node scripts/reset-admin-password.cjs "رمز-جدید"
 *   node scripts/reset-admin-password.cjs "رمز-جدید" "mysql://USER:PASS@localhost:3306/DBNAME"
 *
 * یا روی کامپیوتر خودتان (بعد از آپلود اسکریپت):
 *   bun scripts/reset-admin-password.cjs "رمز-جدید"
 *
 * منطق:
 *   ۱) رمز جدید از آرگومان اول گرفته می‌شود (حداقل ۴ کاراکتر).
 *   ۲) آدرس دیتابیس: آرگومان دوم یا env DATABASE_URL یا فایل .env کنار پروژه.
 *   ۳) mysql://  → با کلاینت Prisma موجود در node_modules (استقرار وب) اجرا می‌شود.
 *      file:     → SQLite با bun:sqlite (اگر با bun اجرا شود) یا node:sqlite (Node ≥ ۲۲).
 *   ۴) هش با همان فرمت برنامه ساخته می‌شود: scrypt:salt(16بایت hex):hash(64بایت hex)
 *      با node:crypto — بدون هیچ وابستگی خارجی.
 *   ۵) tokenVersion +1 می‌شود → همهٔ نشست‌های فعال ادمین بی‌اعتبار می‌شوند.
 *   ۶) اگر کاربر admin وجود نداشته باشد، ساخته می‌شود (role=admin، فعال).
 *
 * پس از ریست: با admin / رمز-جدید وارد شوید و از منوی «کاربران» رمز را دوباره عوض کنید.
 */
'use strict'

const { randomBytes, scryptSync } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const MIN_PWD_LEN = 4
const ADMIN = 'admin'

function log(msg) { console.log('  ' + msg) }
function ok(msg) { console.log('  \u2713 ' + msg) }
function fail(msg) { console.error('  \u2717 خطا: ' + msg) }

/* ---------- هش — دقیقاً همان فرمت src/lib/passwords.ts ---------- */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return 'scrypt:' + salt + ':' + hash
}

/* ---------- خواندن .env (بدون وابستگی) ---------- */
function readEnvFile(file) {
  try {
    const txt = fs.readFileSync(file, 'utf8')
    const out = {}
    for (const raw of txt.split(/\r?\n/)) {
      const l = raw.trim()
      if (!l || l.startsWith('#')) continue
      const eq = l.indexOf('=')
      if (eq <= 0) continue
      const k = l.slice(0, eq).trim()
      let v = l.slice(eq + 1).trim()
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      if (k && !(k in out)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function resolveDatabaseUrl() {
  const argUrl = process.argv[3] || ''
  if (argUrl) return argUrl
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  // .env کنار پروژه (پوشهٔ بالا از scripts) یا پوشهٔ اجرا
  for (const dir of [path.join(__dirname, '..'), process.cwd()]) {
    const envVars = readEnvFile(path.join(dir, '.env'))
    if (envVars.DATABASE_URL) return envVars.DATABASE_URL
  }
  return ''
}

/* ---------- MySQL از طریق Prisma (استقرار cPanel) ---------- */
async function resetMysql(url, hashed) {
  let PrismaClient
  try {
    PrismaClient = require('@prisma/client').PrismaClient
  } catch {
    fail('کلاینت Prisma پیدا نشد — ابتدا در پوشهٔ پروژه دستور زیر را اجرا کنید:')
    log('npx prisma generate --schema prisma/schema.mysql.prisma')
    process.exit(1)
  }
  process.env.DATABASE_URL = url
  const prisma = new PrismaClient()
  try {
    // tokenVersion ممکن است در اسکیمای خیلی قدیمی نباشد — خطا بی‌اهمیت است
    try {
      await prisma.$executeRawUnsafe('ALTER TABLE `User` ADD COLUMN `tokenVersion` INT NOT NULL DEFAULT 0')
    } catch { /* Duplicate column → از قبل هست */ }

    const rows = await prisma.$queryRawUnsafe(
      'SELECT `id`, `active` FROM `User` WHERE `username` = ? LIMIT 1', ADMIN
    )
    if (rows && rows.length > 0) {
      await prisma.$executeRawUnsafe(
        'UPDATE `User` SET `password` = ?, `active` = 1, `tokenVersion` = COALESCE(`tokenVersion`,0) + 1, `updatedAt` = NOW(3) WHERE `username` = ?',
        hashed, ADMIN
      )
      ok('رمز کاربر admin در دیتابیس MySQL هاست عوض شد.')
    } else {
      await prisma.$executeRawUnsafe(
        'INSERT INTO `User` (`id`,`username`,`password`,`fullName`,`role`,`department`,`active`,`tokenVersion`,`createdAt`,`updatedAt`) VALUES (?, ?, ?, ?, ?, ?, 1, 0, NOW(3), NOW(3))',
        'admin-boot-' + Date.now(), ADMIN, hashed, 'مدیر سیستم', 'admin', 'general'
      )
      ok('کاربر admin در دیتابیس MySQL هاست ساخته شد.')
    }
    // ثبت در گزارش حسابرسی — بهترین تلاش؛ شکست بی‌اهمیت است
    try {
      await prisma.$executeRawUnsafe(
        'INSERT INTO `AuditLog` (`id`,`userName`,`action`,`entity`,`details`,`createdAt`,`updatedAt`) VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3))',
        'audit-reset-' + Date.now(), 'system', 'bootstrap', 'auth',
        'ریست رمز ادمین با اسکریپت scripts/reset-admin-password.cjs'
      )
    } catch { /* جدول AuditLog ممکن است نباشد */ }
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

/* ---------- SQLite محلی ---------- */
function resetSqlite(dbUrl, hashed) {
  const dbFile = dbUrl.replace(/^file:/, '')
  if (!fs.existsSync(dbFile)) {
    fail('فایل دیتابیس پیدا نشد: ' + dbFile)
    process.exit(1)
  }
  let rows = []
  let exists = false
  if (process.versions.bun) {
    const { Database } = require('bun:sqlite')
    const db = new Database(dbFile)
    try {
      try { db.exec('ALTER TABLE "User" ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0') } catch { /* از قبل هست */ }
      exists = !!db.prepare('SELECT id FROM "User" WHERE username = ?').get(ADMIN)
      if (exists) {
        db.run('UPDATE "User" SET password = ?, active = 1, tokenVersion = COALESCE(tokenVersion,0) + 1, updatedAt = CURRENT_TIMESTAMP WHERE username = ?', hashed, ADMIN)
      } else {
        db.run('INSERT INTO "User" (id,username,password,fullName,role,department,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
          'admin-boot-' + Date.now(), ADMIN, hashed, 'مدیر سیستم', 'admin', 'general')
      }
    } finally { db.close() }
  } else if (Number(process.versions.node.split('.')[0]) >= 22) {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbFile)
    try {
      try { db.exec('ALTER TABLE "User" ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0') } catch { /* از قبل هست */ }
      exists = !!db.prepare('SELECT id FROM "User" WHERE username = ?').get(ADMIN)
      if (exists) {
        db.prepare('UPDATE "User" SET password = ?, active = 1, tokenVersion = COALESCE(tokenVersion,0) + 1, updatedAt = CURRENT_TIMESTAMP WHERE username = ?').run(hashed, ADMIN)
      } else {
        db.prepare('INSERT INTO "User" (id,username,password,fullName,role,department,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').run(
          'admin-boot-' + Date.now(), ADMIN, hashed, 'مدیر سیستم', 'admin', 'general')
      }
    } finally { db.close() }
  } else {
    fail('برای SQLite محلی، اسکریپت را با «bun» اجرا کنید یا Node نسخه ۲۲+ داشته باشید.')
    log('راه ساده‌تر (بدون ترمینال): فایل reset-admin-password.txt کنار برنامه بسازید —')
    log('محتوای فایل:  password=' + (process.argv[2] || 'رمز-جدید'))
    log('و برنامه را باز کنید و یک بار تلاش ورود بزنید — رمز خودکار ریست می‌شود.')
    process.exit(1)
  }
  ok(exists
    ? 'رمز کاربر admin در دیتابیس محلی SQLite عوض شد: ' + dbFile
    : 'کاربر admin در دیتابیس محلی SQLite ساخته شد: ' + dbFile)
}

/* ---------- main ---------- */
async function main() {
  const newPassword = String(process.argv[2] || '')
  console.log('\nریست رمز ادمین — ManufacturingERP\n' + '─'.repeat(46))

  if (newPassword.length < MIN_PWD_LEN) {
    fail('رمز جدید را به‌صورت آرگومان بدهید (حداقل ' + MIN_PWD_LEN + ' کاراکتر):')
    log('node scripts/reset-admin-password.cjs "رمز-جدید"')
    process.exit(1)
  }

  const url = resolveDatabaseUrl()
  if (!url) {
    fail('آدرس دیتابیس (DATABASE_URL) پیدا نشد.')
    log('۱) در آرگومان دوم بدهید:  node scripts/reset-admin-password.cjs "رمز" "mysql://USER:PASS@localhost:3306/DB"')
    log('۲) یا در صفحهٔ Setup Node.js App بخش Environment variables مقدار DATABASE_URL را بگذارید و Restart بزنید، سپس دوباره اجرا کنید.')
    process.exit(1)
  }

  const hashed = hashPassword(newPassword)
  log('دیتابیس: ' + (url.startsWith('mysql:') ? 'MySQL (هاست)' : url.startsWith('file:') ? 'SQLite (محلی)' : 'نامشخص!'))

  if (url.startsWith('mysql:')) {
    await resetMysql(url, hashed)
  } else if (url.startsWith('file:')) {
    resetSqlite(url, hashed)
  } else {
    fail('نوع دیتابیس شناخته نشد — آدرس باید با mysql: یا file: شروع شود.')
    process.exit(1)
  }

  console.log('')
  ok('تمام شد! حالا با این اطلاعات وارد شوید:')
  log('   نام کاربری:  admin')
  log('   رمز:         ' + newPassword)
  log('بعد از ورود، از منوی «کاربران» رمز را به یک رمز امن شخصی تغییر دهید.')
  console.log('')
  process.exit(0)
}

main().catch((e) => {
  fail(e && e.message ? e.message : String(e))
  process.exit(1)
})
