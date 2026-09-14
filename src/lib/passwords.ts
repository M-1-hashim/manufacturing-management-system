// هش پسورد با scrypt (بدون وابستگی خارجی)
// سازگار با کاربران قدیمی (پسورد ساده در seed) — در ورود، پسورد به‌صورت شفاف به هش ارتقا می‌یابد
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    if (stored.startsWith('scrypt:')) {
      const [, salt, hash] = stored.split(':')
      const test = scryptSync(password, salt, 64)
      const expected = Buffer.from(hash, 'hex')
      return expected.length === test.length && timingSafeEqual(expected, test)
    }
    // سازگاری با داده‌های قدیمی (پسورد ساده)
    return password === stored
  } catch {
    return false
  }
}

export function isHashed(stored: string): boolean {
  return stored.startsWith('scrypt:')
}
