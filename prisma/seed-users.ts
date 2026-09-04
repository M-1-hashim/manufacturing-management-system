// افزودن حساب‌های کارکنان بخش‌ها + ارتقای رمزهای قدیمی به هش
// اجرا: bun prisma/seed-users.ts
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'

const db = new PrismaClient()

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

const users = [
  // ادمین و مدیر (از قبل موجود — در صورت نبود ساخته می‌شوند)
  { username: 'admin', password: 'admin123', fullName: 'مدیر سیستم', role: 'admin', department: 'general' },
  { username: 'manager', password: 'manager123', fullName: 'احمد کریمی', role: 'manager', department: 'general' },
  // کارکنان بخش‌ها
  { username: 'prodstaff', password: 'prod123', fullName: 'محمود نوری — مسئول تولید', role: 'operator', department: 'production' },
  { username: 'salesstaff', password: 'sales123', fullName: 'فرید احمدی — مسئول فروش', role: 'operator', department: 'sales' },
  { username: 'storestaff', password: 'store123', fullName: 'نجیب‌الله رحیمی — انباردار', role: 'operator', department: 'inventory' },
  { username: 'finstaff', password: 'fin123', fullName: 'زکیه سادات — حسابدار', role: 'operator', department: 'finance' },
  { username: 'hrstaff', password: 'hr123', fullName: 'سمیع‌الله جواد — منابع انسانی', role: 'operator', department: 'hr' },
  // ناظر (فقط خواندن)
  { username: 'viewer', password: 'viewer123', fullName: 'بازرس کیفیت', role: 'viewer', department: 'general' },
]

async function main() {
  for (const u of users) {
    await db.user.upsert({
      where: { username: u.username },
      update: { fullName: u.fullName, role: u.role, department: u.department },
      create: { ...u, password: hashPassword(u.password) },
    })
  }
  // ارتقای رمزهای قدیمی (بدون هش) موجود در دیتابیس
  const all = await db.user.findMany()
  for (const u of all) {
    if (!u.password.startsWith('scrypt:')) {
      await db.user.update({ where: { id: u.id }, data: { password: hashPassword(u.password) } })
    }
  }
  console.log(`✓ ${users.length} users ensured, legacy passwords hashed (${all.length} total)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
