'use client'

/**
 * تأیید هش scrypt در مرورگر — برای ورود آفلاین با کاربرانی که از هاست کپی شده‌اند
 *
 * هشت میزبان (src/lib/passwords.ts) به شکل scrypt:<saltHex>:<hashHex> است و با
 * scryptSync(password, salt, 64) ساخته می‌شود — پارامترهای پیش‌فرض Node:
 * N=16384، r=8، p=1 و salt رشتهٔ hex به‌صورت UTF-8 به‌عنوان بایت استفاده می‌شود.
 * scrypt-js همان الگوریتم را به‌صورت خالص جاوااسکریپت پیاده می‌کند (WebCrypto
 * scrypt ندارد) — نتیجه باید بیت‌به‌بیت با نسخهٔ Node یکی باشد.
 */

import { scrypt } from 'scrypt-js'

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * تأیید پسورد در برابر هشت scrypt هاست — همان قالب scrypt:<salt>:<hash>
 * در خطا (هشت خراب / کتابخانه در دسترس نباشد) false برمی‌گرداند نه exception.
 */
export async function verifyScryptHash(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split(':')
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false
    const salt = parts[1]
    const expectedHex = parts[2]
    if (!salt || !expectedHex) return false
    const encoder = new TextEncoder()
    const derived = await scrypt(
      encoder.encode(password),
      encoder.encode(salt), // Node هم رشتهٔ salt را UTF-8 بایت می‌کند
      N,
      R,
      P,
      KEYLEN
    )
    // مقایسهٔ زمان-ثابت ساده
    const expected = hexToBytes(expectedHex)
    if (expected.length !== derived.length) return false
    let diff = 0
    for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i]
    return diff === 0
  } catch (e) {
    console.error('[scrypt-verify] failed', e)
    return false
  }
}

/** آیا رشته ذخیره‌شده یک هش scrypt است؟ (پسوردهای سادهٔ seed همیشه plaintext می‌مانند) */
export function isScryptHash(stored: unknown): boolean {
  return typeof stored === 'string' && stored.startsWith('scrypt:')
}

// برای دیباگ: تولید hex از مشتق — استفاده نشده ولی برای تست واحد مفید است
export function derivedToHex(bytes: Uint8Array): string {
  return bytesToHex(bytes)
}
