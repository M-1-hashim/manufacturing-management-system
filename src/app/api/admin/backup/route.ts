import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { db } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { requireAdminDb } from '@/lib/rbac'
import {
  listBackups,
  createBackup,
  deleteBackup,
  backupAbsPath,
  getBackupIntervalHours,
  getBackupKeep,
  saveBackupConfig,
  isValidBackupName,
  restoreFromBuffer,
  restoreFromBackupFile,
} from '@/lib/backup'
import { exportAllJson, currentDbType } from '@/lib/json-backup'

// همه مسیرهای /api/admin فقط برای ادمین (middleware) — اینجا هم دوباره بررسی می‌شود
// گارد مشترک: نقش/فعال بودن/نسخهٔ توکن از دیتابیس خوانده می‌شود، نه از توکن
async function requireAdmin(req: Request) {
  return requireAdminDb(
    req,
    'فقط مدیر سیستم به کاپی احتیاطی دسترسی دارد',
    (uid) => db.user.findUnique({ where: { id: uid } })
  )
}

// GET /api/admin/backup                 → فهرست + تنظیمات + نوع دیتابیس
// GET /api/admin/backup?download=x.db   → دانلود فایل کاپی احتیاطی
// GET /api/admin/backup?export=json     → خروجی JSON فوری (برای مهاجرت دیتا به هاست)
export async function GET(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })

    const url = new URL(req.url)

    // خروجی JSON فوری — بدون ذخیره روی دیسک
    if (url.searchParams.get('export') === 'json') {
      const snapshot = await exportAllJson()
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
      const body = JSON.stringify(snapshot)
      return new NextResponse(body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="backup-${stamp}.json"`,
          'Content-Length': String(Buffer.byteLength(body, 'utf8')),
        },
      })
    }

    const download = url.searchParams.get('download')
    if (download) {
      if (!isValidBackupName(download)) {
        return NextResponse.json({ error: 'نام فایل نامعتبر است' }, { status: 400 })
      }
      try {
        const buf = await readFile(backupAbsPath(download))
        const isJson = download.endsWith('.json')
        return new NextResponse(new Uint8Array(buf), {
          headers: {
            'Content-Type': isJson ? 'application/json; charset=utf-8' : 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${download}"`,
            'Content-Length': String(buf.length),
          },
        })
      } catch {
        return NextResponse.json({ error: 'فایل کاپی احتیاطی یافت نشد' }, { status: 404 })
      }
    }

    const [files, intervalHours, keep] = await Promise.all([
      listBackups(),
      getBackupIntervalHours(),
      getBackupKeep(),
    ])
    return NextResponse.json({ files, intervalHours, keep, dbType: currentDbType() })
  } catch (e) {
    console.error('backup GET', e)
    return NextResponse.json({ error: 'خطا در دریافت فهرست کاپی احتیاطی' }, { status: 500 })
  }
}

// POST /api/admin/backup
//  — JSON {}                        → ایجاد نسخه کاپی احتیاطی جدید (نوع خودکار بر اساس دیتابیس فعلی)
//  — JSON {format: "json"}          → اسنپ‌شات JSON (حتی روی SQLite — برای مهاجرت دیتا به هاست)
//  — JSON {restore: "backup-….db"}  → بازیابی از یکی از کاپی احتیاطی‌های موجود
//  — multipart/form-data (file)     → آپلود فایل کاپی احتیاطی (.db یا .json) و بازیابی آن
export async function POST(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const actor = { uid: guard.session.uid, username: guard.session.username }
    const contentType = req.headers.get('content-type') || ''

    // آپلود فایل کاپی احتیاطی و بازیابی
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'فایل کاپی احتیاطی ارسال نشده است' }, { status: 400 })
      }
      if (file.size > 512 * 1024 * 1024) {
        return NextResponse.json({ error: 'حجم فایل بیش از حد مجاز است (حداکثر 512 مگابایت)' }, { status: 400 })
      }
      const buf = Buffer.from(await file.arrayBuffer())
      try {
        const result = await restoreFromBuffer(buf, actor, file.name || 'upload')
        return NextResponse.json({ ok: true, restored: true, safetyBackup: result.safetyBackup })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'بازیابی ناموفق بود'
        const bad = msg.includes('معتبر نیست') || msg.includes('سازگار نبود')
        return NextResponse.json(
          { error: msg, rolledBack: bad },
          { status: bad ? 400 : 500 }
        )
      }
    }

    const body = (await req.json().catch(() => ({}))) as { restore?: string; format?: string }

    // بازیابی از فایل کاپی احتیاطی موجود
    if (body.restore) {
      if (!isValidBackupName(body.restore)) {
        return NextResponse.json({ error: 'نام فایل نامعتبر است' }, { status: 400 })
      }
      try {
        const result = await restoreFromBackupFile(body.restore, actor)
        return NextResponse.json({ ok: true, restored: true, safetyBackup: result.safetyBackup })
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'بازیابی ناموفق بود'
        const bad = msg.includes('سازگار نبود')
        return NextResponse.json({ error: msg, rolledBack: bad }, { status: bad ? 400 : 500 })
      }
    }

    // ایجاد نسخه کاپی احتیاطی جدید
    const created = await createBackup('manual', actor, body.format === 'json' ? 'json' : undefined)
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('backup POST', e)
    return NextResponse.json({ error: 'خطا در تهیه نسخه کاپی احتیاطی' }, { status: 500 })
  }
}

// PUT /api/admin/backup — ذخیره تنظیمات کاپی احتیاطی خودکار
export async function PUT(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const body = (await req.json().catch(() => ({}))) as { intervalHours?: number; keep?: number }
    await saveBackupConfig(Number(body.intervalHours ?? 24), Number(body.keep ?? 10))
    await logAudit(
      { uid: guard.session.uid, username: guard.session.username },
      'update',
      'settings',
      'backup',
      `هر ${Number(body.intervalHours ?? 24)} ساعت — نگهداری ${Number(body.keep ?? 10)} نسخه`
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('backup PUT', e)
    return NextResponse.json({ error: 'خطا در ذخیره تنظیمات کاپی احتیاطی' }, { status: 500 })
  }
}

// DELETE /api/admin/backup?file=x.db — حذف یک نسخه کاپی احتیاطی
export async function DELETE(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })
    const url = new URL(req.url)
    const file = url.searchParams.get('file') ?? ''
    if (!isValidBackupName(file)) {
      return NextResponse.json({ error: 'نام فایل نامعتبر است' }, { status: 400 })
    }
    await deleteBackup(file, { uid: guard.session.uid, username: guard.session.username })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'خطا در حذف فایل کاپی احتیاطی' }, { status: 500 })
  }
}
