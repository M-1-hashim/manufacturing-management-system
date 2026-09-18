import { NextRequest, NextResponse } from 'next/server'
import { dbInternal } from '@/lib/db'

/*
 * پینگ واقعی هاست — «اتصال ذخیره‌شده واقعاً به MySQL وصل می‌شود؟»
 *
 * گِیت شروع برنامه (دسکتاپ) این را صدا می‌زند تا بعد از پروبِ TCP، سطح واقعی
 * هم آزموده شود: پروب TCP فقط می‌گوید «پورت باز است» ولی این endpoint با
 * SELECT 1 روی کلاینت Prismaِ MySQL کل زنجیره (تونل SSH → MySQL →
 * احراز هویت → انتخاب دیتابیس) را می‌سنجد و نوع خطا را برمی‌گرداند.
 *
 * امنیت: فقط برای برنامهٔ دسکتاپ است که رندررش روی 127.0.0.1 بالاست —
 * در استقرار وب عمومی (Host برابر دامنهٔ عمومی) پاسخ 403 می‌دهد تا
 * کسی نتواند جزئیات اتصال هاست را بیرون بکشد.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PING_TIMEOUT_MS = 8000

/** دسته‌بندی خطا — هم‌خانوادهٔ classifyError در connection-manager */
function classify(msg: string): string {
  if (/Access denied/i.test(msg)) return 'AUTH'
  if (/Unknown database/i.test(msg)) return 'NO_DATABASE'
  if (
    /Can't reach|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|getaddrinfo|EHOSTUNREACH|ENETUNREACH|PING_TIMEOUT|not allowed to connect|ER_HOST_NOT_PRIVILEGED|Connection refused|socket hang up|ECONNRESET/i.test(
      msg
    )
  )
    return 'UNREACHABLE'
  return 'UNKNOWN'
}

function isLoopbackHost(req: NextRequest): boolean {
  const h = (req.headers.get('host') || '').toLowerCase()
  // «127.0.0.1:3000» یا «localhost:3000» یا «[::1]:3000» → فقط بخش میزبان
  const name = h.replace(/^\[([^\]]+)\]/, '$1').split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '::1'
}

export async function GET(req: NextRequest) {
  if (!isLoopbackHost(req)) {
    return NextResponse.json(
      { ok: false, kind: 'FORBIDDEN', error: 'host-ping is only available to the desktop app' },
      { status: 403 }
    )
  }

  const mysql = dbInternal.getClients().mysql
  if (!mysql || !dbInternal.mysqlConfigured()) {
    return NextResponse.json({ ok: false, kind: 'NOT_CONFIGURED', error: 'NO_HOST' })
  }

  try {
    const q = mysql.$queryRawUnsafe('SELECT 1')
    q.catch(() => {}) // جلوگیری از unhandledRejection بعد از تایم‌اوت مسابقه
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('PING_TIMEOUT — هاست در ۸ ثانیه پاسخ نداد')),
        PING_TIMEOUT_MS
      )
      q.then(
        () => {
          clearTimeout(timer)
          resolve()
        },
        (e) => {
          clearTimeout(timer)
          reject(e)
        }
      )
    })
    return NextResponse.json({ ok: true, kind: null, error: null })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    return NextResponse.json({ ok: false, kind: classify(msg), error: msg.slice(0, 300) })
  }
}
