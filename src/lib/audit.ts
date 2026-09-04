// ثبت رخدادهای سیستم (Audit Log) — فقط سمت سرور
import { db } from '@/lib/db'

export type AuditAction =
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'create'
  | 'update'
  | 'delete'
  | 'complete'
  | 'payment'
  | 'adjust'
  | 'change_password'
  | 'backup'
  | 'backup_auto'
  | 'backup_delete'

export interface AuditActor {
  uid?: string
  username?: string
}

/** ثبت یک رخداد در گزارش فعالیت‌ها — هرگز خطا پرتاب نمی‌کند */
export async function logAudit(
  actor: AuditActor | null,
  action: AuditAction,
  entity: string,
  entityId?: string,
  details?: string
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: actor?.uid ?? null,
        userName: actor?.username ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        details: details ?? null,
      },
    })
  } catch (e) {
    console.error('audit log failed', e)
  }
}
