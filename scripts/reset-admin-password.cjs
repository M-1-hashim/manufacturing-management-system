#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/*
 * ریست نام‌کاربری/رمز مدیر — اسکریپت مستقل (بدون نیاز به build یا TypeScript)
 *
 * مصرف در cPanel (ترمینال):
 *   cd ~/app
 *   node scripts/reset-admin-password.cjs "رمز-جدید"
 *   node scripts/reset-admin-password.cjs "رمز-جدید" "mysql://USER:PASS@localhost:3306/DBNAME"
 *   node scripts/reset-admin-password.cjs "رمز-جدید" "mysql://..." --user="نام-کاربری-جدید"
 *
 * یا روی کامپیوتر خودتان (بعد از آپلود اسکریپت):
 *   bun scripts/reset-admin-password.cjs "رمز-جدید" --user="مدیر"
 *
 * منطق:
 *   ۱) رمز جدید از آرگومان اول گرفته می‌شود (حداقل ۴ کاراکتر).
 *   ۲) نام کاربری جدید (اختیاری) با --user=NAME یا --user NAME — اگر داده شود
 *      حساب مدیر (به هر نامی که باشد: admin یا نام قبلاً ریست‌شده) به این نام تغییر می‌کند.
 *   ۳) آدرس دیتابیس: آرگومان دوم یا env DATABASE_URL یا فایل .env کنار پروژه.
 *   ۴) mysql://  → با کلاینت Prisma موجود در node_modules (استقرار وب) اجرا می‌شود.
 *      file:     → SQLite با bun:sqlite (اگر با bun اجرا شود) یا node:sqlite (Node >= 22).
 *   ۵) هش با همان فرمت برنامه ساخته می‌شود: scrypt:salt(16بایت hex):hash(64بایت hex)
 *      با node:crypto — بدون هیچ وابستگی خارجی.
 *   ۶) tokenVersion +1 می‌شود → همهٔ نشست‌های فعال مدیر بی‌اعتبار می‌شوند.
 *   ۷) اگر حساب مدیر وجود نداشته باشد، ساخته می‌شود (role=admin، فعال).
 *
 * پس از ریست: با نام‌کاربری/رمز جدید وارد شوید و از منوی «کاربران» رمز را عوض کنید.
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

/* ---------- پارس آرگومان‌ها: رمز، DATABASE_URL، --user ---------- */
function parseArgs(argv) {
  const rest = []
  let newUser = ''
  for (let i = 0; i < argv.length; i++) {
    const a = String(argv[i] || '')
    if (a === '--user' && i + 1 < argv.length) { newUser = String(argv[++i] || '').trim(); continue }
    if (a.startsWith('--user=')) { newUser = a.slice('--user='.length).trim(); continue }
    rest.push(a)
  }
  return { password: rest[0] || '', dbUrl: rest[1] || '', newUser }
}

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

function resolveDatabaseUrl(restUrl) {
  if (restUrl) return restUrl
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  // .env کنار پروژه (پوشهٔ بالا از scripts) یا پوشهٔ اجرا
  for (const dir of [path.join(__dirname, '..'), process.cwd()]) {
    const envVars = readEnvFile(path.join(dir, '.env'))
    if (envVars.DATABASE_URL) return envVars.DATABASE_URL
  }
  return ''
}

/* ---------- MySQL از طریق Prisma (استقرار cPanel) ---------- */
async function resetMysql(url, hashed, newUser) {
  const target = newUser || ADMIN
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

    // حساب هدف: ۱) با نام جدید (اگر قبلاً ریست شده) ۲) با نام admin ۳) هر حساب با role=admin
    let rows = await prisma.$queryRawUnsafe(
      'SELECT `id`, `active` FROM `User` WHERE `username` = ? LIMIT 1', target
    )
    if (!rows || rows.length === 0) {
      rows = await prisma.$queryRawUnsafe(
        'SELECT `id`, `active` FROM `User` WHERE `username` = ? LIMIT 1', ADMIN
      )
    }
    if ((!rows || rows.length === 0)) {
      rows = await prisma.$queryRawUnsafe(
        'SELECT `id`, `active` FROM `User` WHERE `role` = \'admin\' ORDER BY `createdAt` LIMIT 1'
      )
    }
    if (rows && rows.length > 0) {
      await prisma.$executeRawUnsafe(
        'UPDATE `User` SET `username` = ?, `password` = ?, `active` = 1, `tokenVersion` = COALESCE(`tokenVersion`,0) + 1, `updatedAt` = NOW(3) WHERE `id` = ?',
        target, hashed, rows[0].id
      )
      ok('حساب مدیر در دیتابیس MySQL هاست ریست شد (نام کاربری: ' + target + ').')
    } else {
      await prisma.$executeRawUnsafe(
        'INSERT INTO `User` (`id`,`username`,`password`,`fullName`,`role`,`department`,`active`,`tokenVersion`,`createdAt`,`updatedAt`) VALUES (?, ?, ?, ?, ?, ?, 1, 0, NOW(3), NOW(3))',
        'admin-boot-' + Date.now(), target, hashed, 'مدیر سیستم', 'admin', 'general'
      )
      ok('حساب مدیر جدید در دیتابیس MySQL هاست ساخته شد (نام کاربری: ' + target + ').')
    }
    // ثبت در گزارش حسابرسی — بهترین تلاش؛ شکست بی‌اهمیت است
    try {
      await prisma.$executeRawUnsafe(
        'INSERT INTO `AuditLog` (`id`,`userName`,`action`,`entity`,`details`,`createdAt`,`updatedAt`) VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3))',
        'audit-reset-' + Date.now(), 'system', 'bootstrap', 'auth',
        'ریست نام‌کاربری/رمز مدیر با اسکریپت scripts/reset-admin-password.cjs'
      )
    } catch { /* جدول AuditLog ممکن است نباشد */ }
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

/* ---------- SQLite محلی ---------- */
function resetSqlite(dbUrl, hashed, newUser) {
  const target = newUser || ADMIN
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
      rows = db.prepare('SELECT id FROM "User" WHERE username = ?').all(target)
      if (rows.length === 0) rows = db.prepare('SELECT id FROM "User" WHERE username = ?').all(ADMIN)
      if (rows.length === 0) rows = db.prepare('SELECT id FROM "User" WHERE role = \'admin\' ORDER BY createdAt LIMIT 1').all()
      exists = rows.length > 0
      if (exists) {
        db.run('UPDATE "User" SET username = ?, password = ?, active = 1, tokenVersion = COALESCE(tokenVersion,0) + 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', target, hashed, rows[0].id)
      } else {
        db.run('INSERT INTO "User" (id,username,password,fullName,role,department,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
          'admin-boot-' + Date.now(), target, hashed, 'مدیر سیستم', 'admin', 'general')
      }
    } finally { db.close() }
  } else if (Number(process.versions.node.split('.')[0]) >= 22) {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbFile)
    try {
      try { db.exec('ALTER TABLE "User" ADD COLUMN tokenVersion INTEGER NOT NULL DEFAULT 0') } catch { /* از قبل هست */ }
      rows = db.prepare('SELECT id FROM "User" WHERE username = ?').all(target)
      if (rows.length === 0) rows = db.prepare('SELECT id FROM "User" WHERE username = ?').all(ADMIN)
      if (rows.length === 0) rows = db.prepare('SELECT id FROM "User" WHERE role = \'admin\' ORDER BY createdAt LIMIT 1').all()
      exists = rows.length > 0
      if (exists) {
        db.prepare('UPDATE "User" SET username = ?, password = ?, active = 1, tokenVersion = COALESCE(tokenVersion,0) + 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(target, hashed, rows[0].id)
      } else {
        db.prepare('INSERT INTO "User" (id,username,password,fullName,role,department,active,createdAt,updatedAt) VALUES (?,?,?,?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)').run(
          'admin-boot-' + Date.now(), target, hashed, 'مدیر سیستم', 'admin', 'general')
      }
    } finally { db.close() }
  } else {
    fail('برای SQLite محلی، اسکریپت را با «bun» اجرا کنید یا Node نسخه ۲۲+ داشته باشید.')
    log('راه ساده‌تر (بدون ترمینال): فایل reset-admin-password.txt کنار برنامه بسازید —')
    log('محتوای فایل:  password=رمز-جدید')
    log('و برنامه را باز کنید و یک بار تلاش ورود بزنید — رمز خودکار ریست می‌شود.')
    process.exit(1)
  }
  ok(exists
    ? 'حساب مدیر در دیتابیس محلی SQLite ریست شد (نام کاربری: ' + target + '): ' + dbFile
    : 'حساب مدیر جدید در دیتابیس محلی SQLite ساخته شد (نام کاربری: ' + target + '): ' + dbFile)
}

/* ---------- main ---------- */
async function main() {
  const { password: newPassword, dbUrl: restUrl, newUser } = parseArgs(process.argv.slice(2))
  console.log('\nریست نام‌کاربری/رمز مدیر — ManufacturingERP\n' + '─'.repeat(46))

  if (newUser && !/^[\w().\-\u0600-\u06FF ]{2,64}$/.test(newUser)) {
    fail('نام کاربری جدید نامعتبر است (۲ تا ۶۴ کاراکتر: حرف/عدد/._- و فاصله).')
    process.exit(1)
  }

  if (newPassword.length < MIN_PWD_LEN) {
    fail('رمز جدید را به‌صورت آرگومان بدهید (حداقل ' + MIN_PWD_LEN + ' کاراکتر):')
    log('node scripts/reset-admin-password.cjs "رمز-جدید" [--user="نام-کاربری-جدید"]')
    process.exit(1)
  }

  const url = resolveDatabaseUrl(restUrl)
  if (!url) {
    fail('آدرس دیتابیس (DATABASE_URL) پیدا نشد.')
    log('۱) در آرگومان دوم بدهید:  node scripts/reset-admin-password.cjs "رمز" "mysql://USER:PASS@localhost:3306/DB"')
    log('۲) یا در صفحهٔ Setup Node.js App بخش Environment variables مقدار DATABASE_URL را بگذارید و Restart بزنید، سپس دوباره اجرا کنید.')
    process.exit(1)
  }

  const hashed = hashPassword(newPassword)
  log('دیتابیس: ' + (url.startsWith('mysql:') ? 'MySQL (هاست)' : url.startsWith('file:') ? 'SQLite (محلی)' : 'نامشخص!'))
  if (newUser) log('نام کاربری جدید: ' + newUser)

  if (url.startsWith('mysql:')) {
    await resetMysql(url, hashed, newUser)
  } else if (url.startsWith('file:')) {
    resetSqlite(url, hashed, newUser)
  } else {
    fail('نوع دیتابیس شناخته نشد — آدرس باید با mysql: یا file: شروع شود.')
    process.exit(1)
  }

  console.log('')
  ok('تمام شد! حالا با این اطلاعات وارد شوید:')
  log('   نام کاربری:  ' + (newUser || ADMIN))
  log('   رمز:         ' + newPassword)
  log('بعد از ورود، از منوی «کاربران» رمز را به یک رمز امن شخصی تغییر دهید.')
  console.log('')
  process.exit(0)
}

main().catch((e) => {
  fail(e && e.message ? e.message : String(e))
  process.exit(1)
})
