import { NextResponse } from 'next/server'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { APP_VERSION } from '@/lib/app-version'

/**
 * دانلود عمومی نصب‌کنندهٔ ویندوز (سِتب) — مسیر عمومی (middleware PUBLIC_PATHS)
 *
 *   GET /api/download/setup                  → ManufacturingERP-Setup.exe   (نصب‌کننده NSIS)
 *   GET /api/download/setup?variant=portable → ManufacturingERP-Windows-Portable.zip
 *   GET /api/download/setup?info=1           → متادیتا (موجودیت/حجم/تاریخ ساخت) به‌صورت JSON
 *
 * - بدون نیاز به نشست: هر فردی که لینک را دارد می‌تواند دانلود کند.
 * - فایل‌ها در پوشهٔ download/ ریشهٔ پروژه ساخته می‌شوند (installer.nsi و build-desktop.sh).
 *   در بستهٔ دسکتاپ این پوشه ارسال نمی‌شود → پاسخ 404 و رابط کاربری دکمه را پنهان می‌کند.
 * - پشتیبانی از Range برای دانلود قابل ازسرگیری (شبکه‌های ضعیف) و نرم‌افزارهای دانلود.
 */

const DOWNLOAD_DIR = path.join(process.cwd(), 'download')

const FILES = {
  setup: { filename: 'ManufacturingERP-Setup.exe' },
  portable: { filename: 'ManufacturingERP-Windows-Portable.zip' },
} as const

type Variant = keyof typeof FILES

interface DlFileInfo {
  available: boolean
  filename: string
  size: number | null
  sizeHuman: string | null
  updatedAt: string | null
}

function resolveVariant(url: URL): Variant {
  return url.searchParams.get('variant') === 'portable' ? 'portable' : 'setup'
}

function humanSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

async function fileInfo(variant: Variant): Promise<DlFileInfo> {
  const f = FILES[variant]
  try {
    const st = await stat(path.join(DOWNLOAD_DIR, f.filename))
    if (!st.isFile()) throw new Error('not a file')
    return {
      available: true,
      filename: f.filename,
      size: st.size,
      sizeHuman: humanSize(st.size),
      updatedAt: st.mtime.toISOString(),
    }
  } catch {
    return { available: false, filename: f.filename, size: null, sizeHuman: null, updatedAt: null }
  }
}

function baseHeaders(filename: string): Record<string, string> {
  return {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const variant = resolveVariant(url)

  // متادیتا برای رابط کاربری (نمایش حجم/موجودیت)
  if (url.searchParams.get('info') === '1') {
    const [setup, portable] = await Promise.all([fileInfo('setup'), fileInfo('portable')])
    return NextResponse.json(
      { version: APP_VERSION, setup, portable },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  const f = FILES[variant]
  const filePath = path.join(DOWNLOAD_DIR, f.filename)

  let size: number
  try {
    const st = await stat(filePath)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    return NextResponse.json(
      { error: 'فایل نصب‌کننده هنوز ساخته نشده است — با مدیر سیستم تماس بگیرید' },
      { status: 404 }
    )
  }

  // درخواست Range — دانلود قابل ازسرگیری
  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
      if (Number.isNaN(start) || start > end || start >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        })
      }
      const stream = Readable.toWeb(
        createReadStream(filePath, { start, end })
      ) as unknown as ReadableStream<Uint8Array>
      return new NextResponse(stream, {
        status: 206,
        headers: {
          ...baseHeaders(f.filename),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1),
        },
      })
    }
  }

  // دانلود کامل — استریم (بدون بارگذاری کل فایل در حافظه)
  const stream = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>
  return new NextResponse(stream, {
    headers: { ...baseHeaders(f.filename), 'Content-Length': String(size) },
  })
}

// پروب نرم‌افزارهای دانلود — فقط هدرها
export async function HEAD(req: Request) {
  const url = new URL(req.url)
  const f = FILES[resolveVariant(url)]
  try {
    const st = await stat(path.join(DOWNLOAD_DIR, f.filename))
    return new NextResponse(null, {
      headers: { ...baseHeaders(f.filename), 'Content-Length': String(st.size) },
    })
  } catch {
    return new NextResponse(null, { status: 404 })
  }
}
