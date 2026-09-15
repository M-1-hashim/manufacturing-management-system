'use client'

/**
 * هندلر گزارش فعالیت‌ها — آینهٔ src/app/api/audit/route.ts
 * فیلترهای query: limit (1..500، پیش‌فرض 150)، action، entity
 * مرتب‌سازی نزولی بر اساس createdAt — مثل orderBy هاست
 */

import { ApiError, route, type Ctx, type RouteDef } from '../types'
import { getSession, readCol, type LocalSession, type Row } from '../db'

interface LocalAuditLog extends Row {
  userId: string | null
  userName: string | null
  action: string
  entity: string
  entityId: string | null
  details: string | null
}

/** ادمین و مدیر اجازهٔ دیدن گزارش را دارند — پیام‌ها مثل هاست */
function requireAuditAccess(ctx: Ctx): LocalSession {
  const s = ctx.session ?? getSession()
  if (!s) throw new ApiError(401, 'ابتدا وارد سیستم شوید')
  if (!['admin', 'manager'].includes(s.role)) {
    throw new ApiError(403, 'دسترسی به گزارش فعالیت‌ها مجاز نیست')
  }
  return s
}

export const routes: RouteDef[] = [
  // GET /api/audit?limit=&action=&entity=
  route('GET', '/api/audit', (ctx) => {
    requireAuditAccess(ctx)
    const limit = Math.min(Math.max(Number(ctx.url.searchParams.get('limit')) || 150, 1), 500)
    const action = ctx.url.searchParams.get('action') || undefined
    const entity = ctx.url.searchParams.get('entity') || undefined
    return readCol<LocalAuditLog>('auditLogs')
      .filter((l) => (action ? l.action === action : true) && (entity ? l.entity === entity : true))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, limit)
  }),
]
