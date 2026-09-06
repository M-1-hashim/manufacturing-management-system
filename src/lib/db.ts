import { createRequire } from 'module'
import path from 'path'
import { PrismaClient } from '@prisma/client'

/*
 * پشتیبانی دوگانه از دیتابیس — نقطهٔ کلیدی نسخهٔ دسکتاپ:
 *
 * کلاینت Prisma در زمان build به یک provider قفل می‌شود (sqlite یا mysql).
 * نسخهٔ ≤۱.۰.۴ فقط کلاینت SQLite را داخل setup.exe می‌فرستاد؛ بعد از وصل شدن
 * به هاست، DATABASE_URL=mysql://... به کلاینت SQLite داده می‌شد و همهٔ
 * کوئری‌ها خطا می‌دادند («دیتا اضافه نمی‌شود»).
 *
 * راه‌حل: اسکریپت دسکتاپ (electron/build-desktop.sh) یک کلاینت دوم با
 * provider=mysql در node_modules/prisma-mysql-client می‌سازد و داخل بسته
 * می‌گذارد. اینجا بر اساس DATABASE_URL در زمان اجرا بین دو کلاینت سوییچ می‌کنیم:
 *   - mysql://...  → کلاینت MySQL (هاست اشتراکی)
 *   - file:...     → کلاینت SQLite (حالت محلی/آفلاین)
 * اگر کلاینت MySQL موجود نباشد (مثلاً در dev)، به کلاینت پیش‌فرض برمی‌گردیم.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

type AnyPrismaCtor = new (options?: Record<string, unknown>) => PrismaClient

function loadMysqlClientCtor(): AnyPrismaCtor | null {
  try {
    // cwd در نسخهٔ بسته‌شده = resources/server (node_modules همان‌جاست)
    const req = createRequire(path.join(process.cwd(), 'package.json'))
    const mod = req('prisma-mysql-client') as { PrismaClient?: AnyPrismaCtor }
    return mod?.PrismaClient ?? null
  } catch {
    return null
  }
}

function instantiatePrisma(): PrismaClient {
  const url = process.env.DATABASE_URL || ''
  if (url.startsWith('mysql:')) {
    const MysqlCtor = loadMysqlClientCtor()
    if (MysqlCtor) {
      return new MysqlCtor()
    }
    // احتمال: استقرار وب روی هاست که طبق راهنما کلاینت پیش‌فرض را با اسکیمای
    // mysql ساخته است — همان پیش‌فرض جواب می‌دهد.
    console.error('[db] DATABASE_URL is mysql:// but prisma-mysql-client not found — using default client')
  }
  return new PrismaClient()
}

export const db = globalForPrisma.prisma ?? instantiatePrisma()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
