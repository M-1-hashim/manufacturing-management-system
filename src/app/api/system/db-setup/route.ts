import { NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { requireAdminDb } from '@/lib/rbac'
import { db, dbInternal } from '@/lib/db'
import type { ClientPair } from '@/lib/sync-engine'
import { ensureHostReady, createHostTables, getHostSetupStatus } from '@/lib/host-setup'
import { migrateLocalToServer } from '@/lib/sync-engine'

/*
 * راه‌اندازی هاست از داخل برنامه (تنظیمات → اتصال به هاست → «راه‌اندازی هاست»):
 *
 * GET              → وضعیت جدول‌ها/استفاده‌کنندگان روی هاست
 * POST create      → ساخت خودکار جدول‌های گمشده (19 جدول) + بوت‌استرپ استفاده‌کنندگان
 * POST migrate     → انتقال کامل دیتای این دستگاه به هاست (upsert همهٔ جدول‌ها)
 *
 * نکته: «create» وقتی هاست خالی است استفاده‌کنندگان/تنظیمات محلی را هم کپی می‌کند
 * تا بلافاصله بعد از اتصال، ورود به سیستم کار کند.
 *
 * فقط ادمین (نشست معتبر) — در ویزارد راه‌اندازی اولیه نیازی به این API نیست،
 * چون همان کار به‌صورت خودکار در شروع هاست انجام می‌شود.
 */

export const dynamic = 'force-dynamic'

// گارد مشترک: نقش/فعال بودن/نسخهٔ توکن از دیتابیس خوانده می‌شود، نه از توکن
async function requireAdmin(req: Request) {
  return requireAdminDb(
    req,
    'فقط مدیر سیستم به این بخش دسترسی دارد',
    (uid) => db.user.findUnique({ where: { id: uid } })
  )
}

function getPair(): ClientPair | null {
  const { sqlite, mysql } = dbInternal.getClients()
  if (!mysql || !sqlite) return null
  return { server: mysql, local: sqlite }
}

export async function GET(req: Request) {
  const guard = await requireAdmin(req)
  if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })
  try {
    const status = await getHostSetupStatus()
    return NextResponse.json({ ok: true, ...status })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 200 })
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin(req)
  if ('error' in guard) return NextResponse.json({ error: guard.error }, { status: guard.status })
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string }
    const action = String(body.action || '')
    const actor = guard.session

    const pair = getPair()
    if (!pair) {
      return NextResponse.json(
        { ok: false, error: 'NO_PAIR — دیتابیس محلی یا کلاینت MySQL در دسترس نیست' },
        { status: 200 }
      )
    }

    if (action === 'create') {
      const r = await ensureHostReady(pair)
      await logAudit(
        { uid: actor.uid, username: actor.username },
        'update',
        'settings',
        undefined,
        `host-setup: create tables — created=${r.createdTables.length} bootstrap=${r.bootstrapped}`
      )
      return NextResponse.json({ ...r })
    }

    if (action === 'migrate') {
      // اول مطمئن شو جدول‌ها هستند، بعد انتقال کامل
      const ddl = await createHostTables(pair.server)
      if (ddl.failed.length > 0) {
        return NextResponse.json({ ok: false, error: 'table creation failed', failed: ddl.failed }, { status: 200 })
      }
      const r = await migrateLocalToServer(pair)
      await logAudit(
        { uid: actor.uid, username: actor.username },
        'update',
        'settings',
        undefined,
        `host-setup: migrate local→host — copied=${r.copied} updated=${r.updated}`
      )
      return NextResponse.json({ ok: true, ...r })
    }

    return NextResponse.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 200 })
  }
}
