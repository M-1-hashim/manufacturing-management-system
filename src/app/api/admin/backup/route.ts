import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { getSessionFromRequest } from '@/lib/session'
import { logAudit } from '@/lib/audit'
import {
  listBackups,
  createBackup,
  deleteBackup,
  backupAbsPath,
  getBackupIntervalHours,
  getBackupKeep,
  saveBackupConfig,
  isValidBackupName,
} from '@/lib/backup'

// همه مسیرهای /api/admin فقط برای ادمین (middleware) — اینجا هم دوباره بررسی می‌شود

async function requireAdmin(req: Request) {
  const session = await getSessionFromRequest(req)
  if (!session) {
    return { error: NextResponse.json({ error: 'ابتدا وارد سیستم شوید' }, { status: 401 }) }
  }
  if (session.role !== 'admin') {
    return { error: NextResponse.json({ error: 'فقط مدیر سیستم به پشتیبان‌گیری دسترسی دارد' }, { status: 403 }) }
  }
  return { session }
}

// GET /api/admin/backup                 → فهرست + تنظیمات
// GET /api/admin/backup?download=x.db   → دانلود فایل پشتیبان
export async function GET(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if (guard.error) return guard.error

    const url = new URL(req.url)
    const download = url.searchParams.get('download')
    if (download) {
      if (!isValidBackupName(download)) {
        return NextResponse.json({ error: 'نام فایل نامعتبر است' }, { status: 400 })
      }
      try {
        const buf = await readFile(backupAbsPath(download))
        return new NextResponse(new Uint8Array(buf), {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${download}"`,
            'Content-Length': String(buf.length),
          },
        })
      } catch {
        return NextResponse.json({ error: 'فایل پشتیبان یافت نشد' }, { status: 404 })
      }
    }

    const [files, intervalHours, keep] = await Promise.all([
      listBackups(),
      getBackupIntervalHours(),
      getBackupKeep(),
    ])
    return NextResponse.json({ files, intervalHours, keep })
  } catch (e) {
    console.error('backup GET', e)
    return NextResponse.json({ error: 'خطا در دریافت فهرست پشتیبان' }, { status: 500 })
  }
}

// POST /api/admin/backup — ایجاد نسخه پشتیبان جدید (دستی)
export async function POST(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if (guard.error) return guard.error
    const created = await createBackup('manual', { uid: guard.session!.uid, username: guard.session!.username })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('backup POST', e)
    return NextResponse.json({ error: 'خطا در تهیه نسخه پشتیبان' }, { status: 500 })
  }
}

// PUT /api/admin/backup — ذخیره تنظیمات پشتیبان‌گیری خودکار
export async function PUT(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if (guard.error) return guard.error
    const body = (await req.json().catch(() => ({}))) as { intervalHours?: number; keep?: number }
    await saveBackupConfig(Number(body.intervalHours ?? 24), Number(body.keep ?? 10))
    await logAudit(
      { uid: guard.session!.uid, username: guard.session!.username },
      'update',
      'settings',
      'backup',
      `هر ${Number(body.intervalHours ?? 24)} ساعت — نگهداری ${Number(body.keep ?? 10)} نسخه`
    )
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('backup PUT', e)
    return NextResponse.json({ error: 'خطا در ذخیره تنظیمات پشتیبان' }, { status: 500 })
  }
}

// DELETE /api/admin/backup?file=x.db — حذف یک نسخه پشتیبان
export async function DELETE(req: Request) {
  try {
    const guard = await requireAdmin(req)
    if (guard.error) return guard.error
    const url = new URL(req.url)
    const file = url.searchParams.get('file') ?? ''
    if (!isValidBackupName(file)) {
      return NextResponse.json({ error: 'نام فایل نامعتبر است' }, { status: 400 })
    }
    await deleteBackup(file, { uid: guard.session!.uid, username: guard.session!.username })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'خطا در حذف فایل پشتیبان' }, { status: 500 })
  }
}
