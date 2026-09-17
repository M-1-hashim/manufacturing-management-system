'use client'

/**
 * موتور کاپی احتیاطی محلی — آینهٔ src/app/api/admin/backup/route.ts
 * ---------------------------------------------------------------
 * اسنپ‌شات‌ها در کولکشن «backups» ذخیره می‌شوند:
 *   { id, name, size, createdAt, data } — data = کل خروجی JSON
 * شکل خروجی دقیقاً مثل src/lib/json-backup.ts (هاست) است تا فایل‌های
 * JSON هاست و حالت محلی به‌هر دو جهت قابل بازیابی باشند.
 * نام‌گذاری مثل هاست: backup-YYYYMMDD-HHMMSS.json — کاپی احتیاطی
 * پیش از بازیابی با پیشوند safety- ساخته می‌شود.
 * تنظیمات نگهداری با کلیدهای هاست ذخیره می‌شوند: backupKeepCount (پیش‌فرض 10)
 * و backupIntervalHours — تا بعد از سینک، ردیف‌های بی‌کاربرد سمت هاست نسازیم؛
 * خواندن تعداد نگهداری با فال‌بک به کلید قدیمی backupKeep انجام می‌شود.
 */

import { ApiError, bodyAs, route, type Ctx, type RouteDef } from '../types'
import {
  actorFrom, getSetting, getSession, logAudit, newRow, nowISO, readCol, setSetting,
  uid, writeCol, type Row,
} from '../db'

export interface FullExport {
  app: string
  version: number
  dbType: string
  createdAt: string
  tables: Record<string, Record<string, unknown>[]>
}

interface BackupRow extends Row {
  name: string
  size: number
  createdAt: string
  data: FullExport
}

// ترتیب جداول مثل src/lib/json-backup.ts — والدین اول (حذف معکوس)
const TABLES: { name: string; local: string }[] = [
  { name: 'User', local: 'users' },
  { name: 'ProductCategory', local: 'productCategories' },
  { name: 'Product', local: 'products' },
  { name: 'Supplier', local: 'suppliers' },
  { name: 'RawMaterial', local: 'rawMaterials' },
  { name: 'Formula', local: 'formulas' },
  { name: 'FormulaItem', local: 'formulaItems' },
  { name: 'ProductionOrder', local: 'productionOrders' },
  { name: 'Customer', local: 'customers' },
  { name: 'Sale', local: 'sales' },
  { name: 'SaleItem', local: 'saleItems' },
  { name: 'Warehouse', local: 'warehouses' },
  { name: 'InventoryTransaction', local: 'inventoryTransactions' },
  { name: 'Expense', local: 'expenses' },
  { name: 'Employee', local: 'employees' },
  { name: 'Attendance', local: 'attendance' },
  { name: 'SalaryPayment', local: 'salaries' },
  { name: 'AuditLog', local: 'auditLogs' },
  { name: 'Setting', local: 'settings' },
]

// الگوی نام مثل هاست — به‌علاوهٔ پیشوند safety برای کاپی احتیاطی پیش از بازیابی
const NAME_RE = /^(backup|safety)-\d{8}-\d{6}\.json$/
const DEFAULT_KEEP = 10

// ---------------- محافظت دسترسی — مثل requireAdmin هاست ----------------

function requireAdmin(ctx: Ctx): { uid: string; username: string } {
  const session = ctx.session ?? getSession()
  if (!session) throw new ApiError(401, 'ابتدا وارد سیستم شوید')
  if (session.role !== 'admin') {
    throw new ApiError(403, 'فقط مدیر سیستم به کاپی احتیاطی دسترسی دارد')
  }
  return { uid: session.uid, username: session.username }
}

// ---------------- ساخت / اعتبارسنجی خروجی JSON ----------------

/** خروجی کامل همهٔ کولکشن‌ها — همان شکل exportAllJson هاست */
function buildExport(): FullExport {
  const tables: FullExport['tables'] = {}
  for (const t of TABLES) tables[t.name] = readCol(t.local)
  return {
    app: 'manufacturing-management-system',
    version: 1,
    dbType: 'sqlite',
    createdAt: nowISO(),
    tables,
  }
}

/** بررسی صحت ساختار — پیام‌ها مثل validateJsonBackup هاست */
function validateExport(data: unknown): FullExport {
  if (!data || typeof data !== 'object') {
    throw new ApiError(400, 'فایل کاپی احتیاطی JSON نامعتبر است')
  }
  const d = data as Partial<FullExport>
  if (d.app !== 'manufacturing-management-system' || d.version !== 1 || !d.tables) {
    throw new ApiError(400, 'این فایل یک کاپی احتیاطی معتبر سیستم مدیریتی نیست')
  }
  for (const t of TABLES) {
    if (!Array.isArray(d.tables[t.name])) {
      throw new ApiError(400, `فایل کاپی احتیاطی ناقص است — جدول ${t.name} یافت نشد`)
    }
  }
  return d as FullExport
}

/** آماده‌سازی رکورد واردشده — id تضمین شود (جدول Setting هاست id ندارد) */
function normalizeRow(r: Record<string, unknown>): Row {
  const out = { ...r }
  if (!out.id || typeof out.id !== 'string') out.id = uid()
  return out as Row
}

/**
 * تعویض کامل دیتا با خروجی کاپی احتیاطی — تعداد سطرهای بازیابی‌شده
 * (برای «کپی بروز از هاست» در تنظیمات هم صادر شده است)
 *
 * نکتهٔ پسوردها: هش‌های scrypt هاست عیناً حفظ می‌شوند — هندلر ورود محلی حالا
 * scrypt را (با scrypt-js) تأیید می‌کند؛ پسورد ریست نمی‌شود و ورود آفلاین با
 * پسورد واقعی همان کاربر هاست کار می‌کند.
 */
export function restoreAll(data: FullExport, actor: { uid: string; username: string }): number {
  let totalRows = 0
  // حذف همه — فرزندان اول (ترتیب معکوس)
  for (const t of [...TABLES].reverse()) writeCol(t.local, [])
  // درج — والدین اول
  for (const t of TABLES) {
    const rows = (data.tables[t.name] ?? []).map(normalizeRow)
    totalRows += rows.length
    writeCol(t.local, rows)
  }
  logAudit(actor, 'backup_restore', 'system', undefined, `بازیابی کامل کاپی احتیاطی — ${totalRows} رکورد`)
  return totalRows
}

// ---------------- اسنپ‌شات ----------------

/** نام یکتا مثل هاست — در برخورد، یک ثانیه جلو می‌رود */
function uniqueName(prefix: 'backup' | 'safety'): string {
  const names = new Set(readCol<BackupRow>('backups').map((r) => r.name))
  const base = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  for (let i = 0; i < 60; i++) {
    const t = new Date(base.getTime() + i * 1000)
    const name = `${prefix}-${t.getFullYear()}${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.json`
    if (!names.has(name)) return name
  }
  return `${prefix}-${base.getFullYear()}${p(base.getMonth() + 1)}${p(base.getDate())}-${p(base.getHours())}${p(base.getMinutes())}${p(base.getSeconds())}0.json`
}

/** حذف نسخه‌های قدیمی‌تر از حد نگهداری (جدیدترین‌ها می‌مانند) */
function pruneBackups(): void {
  const keep = readKeep()
  const rows = readCol<BackupRow>('backups')
  rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  const staleIds = new Set(rows.slice(keep).map((r) => r.id))
  if (staleIds.size === 0) return
  writeCol('backups', rows.filter((r) => !staleIds.has(r.id)))
}

/** تعداد نگهداری — کلید هاست backupKeepCount؛ فال‌بک به کلید قدیمی backupKeep */
function readKeep(): number {
  const raw = getSetting('backupKeepCount', '') || getSetting('backupKeep', '')
  const n = parseInt(raw || String(DEFAULT_KEEP), 10)
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 100) : DEFAULT_KEEP
}

/** فاصلهٔ کاپی احتیاطی خودکار به ساعت — کلید هاست؛ بدون مقدار ذخیره‌شده → 0 (غیرفعال) */
function readIntervalHours(): number {
  const raw = getSetting('backupIntervalHours', '')
  if (raw === '') return 0
  const n = parseFloat(raw)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 24 * 30) : 0
}

/** ایجاد اسنپ‌شات جدید — برگرداندن BackupFile مثل هاست (بدون audit — در فراخوان) */
function createSnapshot(prefix: 'backup' | 'safety'): { name: string; size: number; createdAt: string } {
  const data = buildExport()
  const json = JSON.stringify(data)
  const row = newRow({
    name: uniqueName(prefix),
    size: new TextEncoder().encode(json).length,
    createdAt: nowISO(),
    data,
  })
  const rows = readCol<BackupRow>('backups')
  rows.push(row)
  writeCol('backups', rows)
  pruneBackups()
  return { name: row.name, size: row.size, createdAt: row.createdAt }
}

function findSnapshot(name: string): BackupRow {
  const row = readCol<BackupRow>('backups').find((b) => b.name === name)
  if (!row) throw new ApiError(404, 'فایل کاپی احتیاطی یافت نشد')
  return row
}

export const routes: RouteDef[] = [
  // GET /api/admin/backup                 → فهرست + تنظیمات + نوع دیتابیس
  // GET /api/admin/backup?export=json     → خروجی JSON فوری (بدون ذخیره)
  // GET /api/admin/backup?download=x.json → محتوای فایل کاپی احتیاطی
  route('GET', '/api/admin/backup', (ctx) => {
    requireAdmin(ctx)

    if (ctx.url.searchParams.get('export') === 'json') {
      return buildExport() // بدنهٔ پاسخ = محتوای فایل
    }

    const download = ctx.url.searchParams.get('download')
    if (download) {
      if (!NAME_RE.test(download)) throw new ApiError(400, 'نام فایل نامعتبر است')
      return findSnapshot(download).data // بدنهٔ پاسخ = محتوای فایل
    }

    const files = readCol<BackupRow>('backups')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((b) => ({ name: b.name, size: b.size, createdAt: b.createdAt }))
    return { files, intervalHours: readIntervalHours(), keep: readKeep(), dbType: 'sqlite' }
  }),

  // POST /api/admin/backup
  //  — JSON {}                        → ایجاد نسخهٔ کاپی احتیاطی جدید
  //  — JSON {restore: "backup-….json"} → بازیابی از اسنپ‌شات موجود
  //  — JSON {import: <خروجی JSON>}     → بازیابی از فایل واردشده
  route('POST', '/api/admin/backup', (ctx) => {
    const actor = requireAdmin(ctx)
    const body = bodyAs<{ restore?: string; import?: unknown; format?: string }>(ctx.body)

    // آپلود multipart در حالت محلی به هندلر نمی‌رسد (بدنهٔ FormData پشتیبانی نمی‌شود)
    if (ctx.body == null) {
      throw new ApiError(400, 'در حالت محلی، بازیابی فقط با فایل JSON پشتیبانی می‌شود')
    }

    // بازیابی از اسنپ‌شات موجود
    if (body?.restore) {
      const name = String(body.restore)
      if (!NAME_RE.test(name)) throw new ApiError(400, 'نام فایل نامعتبر است')
      const row = findSnapshot(name)
      const data = validateExport(row.data)
      const safety = createSnapshot('safety') // کاپی احتیاطی از دیتای فعلی — قبل از هر تغییری
      const restored = restoreAll(data, actor)
      logAudit(
        actor,
        'backup_restore',
        'settings',
        undefined,
        `${name} — safety: ${safety.name} — ${restored} rows`
      )
      return { ok: true, restored: true, safetyBackup: safety.name }
    }

    // بازیابی از خروجی JSON واردشده (فایل .json آپلودشده)
    if (body && 'import' in body && body.import !== undefined) {
      const data = validateExport(body.import)
      const safety = createSnapshot('safety')
      const restored = restoreAll(data, actor)
      logAudit(
        actor,
        'backup_restore',
        'settings',
        undefined,
        `import (json) — safety: ${safety.name} — ${restored} rows`
      )
      return { ok: true, restored: true, safetyBackup: safety.name }
    }

    // ایجاد نسخهٔ کاپی احتیاطی جدید
    const created = createSnapshot('backup')
    logAudit(actor, 'backup', 'settings', undefined, created.name)
    return created
  }),

  // PUT /api/admin/backup — ذخیره تنظیمات کاپی احتیاطی
  route('PUT', '/api/admin/backup', (ctx) => {
    const actor = requireAdmin(ctx)
    const body = bodyAs<{ intervalHours?: number; keep?: number }>(ctx.body) ?? {}
    const ihRaw = Number(body.intervalHours ?? 24)
    // مثل saveBackupConfig هاست — کف 0 (غیرفعال) و سقف 720 ساعت
    const ih = Number.isFinite(ihRaw) && ihRaw >= 0 ? Math.min(ihRaw, 24 * 30) : 24
    const k = Number(body.keep ?? 10)
    const keep = Number.isFinite(k) && k >= 1 ? Math.min(Math.floor(k), 100) : DEFAULT_KEEP
    // کلیدهای هاست — بعد از سینک، هاست همان مقادیر را می‌خواند
    setSetting('backupIntervalHours', String(ih))
    setSetting('backupKeepCount', String(keep))
    logAudit(
      actor,
      'update',
      'settings',
      'backup',
      `هر ${ih} ساعت — نگهداری ${keep} نسخه`
    )
    return { ok: true }
  }),

  // DELETE /api/admin/backup?file=x.json — حذف یک نسخهٔ کاپی احتیاطی
  route('DELETE', '/api/admin/backup', (ctx) => {
    const actor = requireAdmin(ctx)
    const file = ctx.url.searchParams.get('file') ?? ''
    if (!NAME_RE.test(file)) throw new ApiError(400, 'نام فایل نامعتبر است')
    const rows = readCol<BackupRow>('backups')
    const idx = rows.findIndex((b) => b.name === file)
    if (idx === -1) throw new ApiError(404, 'فایل کاپی احتیاطی یافت نشد')
    rows.splice(idx, 1)
    writeCol('backups', rows)
    logAudit(actor, 'backup_delete', 'settings', undefined, file)
    return { ok: true }
  }),
]
