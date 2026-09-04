import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionFromRequest } from '@/lib/session'

// GET /api/audit — گزارش فعالیت‌های سیستم (ادمین و مدیر)
export async function GET(req: Request) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return NextResponse.json({ error: 'ابتدا وارد سیستم شوید' }, { status: 401 })
    if (!['admin', 'manager'].includes(session.role)) {
      return NextResponse.json({ error: 'دسترسی به گزارش فعالیت‌ها مجاز نیست' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 150, 1), 500)
    const action = searchParams.get('action') || undefined
    const entity = searchParams.get('entity') || undefined

    const where: Record<string, string> = {}
    if (action) where.action = action
    if (entity) where.entity = entity

    const logs = await db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit })
    return NextResponse.json(logs)
  } catch (e) {
    console.error('audit GET', e)
    return NextResponse.json({ error: 'خطا در دریافت گزارش فعالیت‌ها' }, { status: 500 })
  }
}
