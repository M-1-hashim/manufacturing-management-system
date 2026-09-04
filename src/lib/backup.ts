// پشتیبان‌گیری خودکار و دستی دیتابیس SQLite — فقط سمت سرور
// فایل‌های پشتیبان کنار دیتابیس در پوشه backups/ ذخیره می‌شوند
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { db } from '@/lib/db'
import { logAudit, type AuditActor } from '@/lib/audit'

export interface BackupFile {
  name: string
  size: number
  createdAt: string // ISO
}

// الگوی نام فایل پشتیبان: backup-YYYYMMDD-HHMMSS.db
const NAME_RE = /^backup-\d{8}-\d{6}\.db$/
const DEFAULT_KEEP = 10

// ---------------- مسیرها ----------------
export function dbFilePath(): string {
  const url = process.env.DATABASE_URL || ''
  if (url.startsWith('file:')) {
    const p = url.slice('file:'.length)
    return path.isAbsolute(p) ? p : path.join(process.cwd(), p)
  }
  return path.join(process.cwd(), 'db', 'custom.db')
}

export function backupsDir(): string {
  return path.join(path.dirname(dbFilePath()), 'backups')
}

export function isValidBackupName(name: string): boolean {
  return NAME_RE.test(name)
}

// ---------------- تنظیمات پشتیبان‌گیری (جدول Setting) ----------------
async function getSettingRaw(key: string, fallback: string): Promise<string> {
  try {
    const row = await db.setting.findUnique({ where: { key } })
    return row?.value ?? fallback
  } catch {
    return fallback
  }
}

async function putSetting(key: string, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/** فاصله زمانی پشتیبان‌گیری خودکار به ساعت — 0 یعنی غیرفعال */
export async function getBackupIntervalHours(): Promise<number> {
  const v = parseFloat(await getSettingRaw('backupIntervalHours', '24'))
  if (!Number.isFinite(v) || v < 0) return 24
  return Math.min(v, 24 * 30)
}

/** تعداد نسخه‌های پشتیبان نگهداری‌شده */
export async function getBackupKeep(): Promise<number> {
  const v = parseInt(await getSettingRaw('backupKeepCount', String(DEFAULT_KEEP)), 10)
  if (!Number.isFinite(v) || v < 1) return DEFAULT_KEEP
  return Math.min(v, 100)
}

export async function saveBackupConfig(intervalHours: number, keep: number): Promise<void> {
  const ih = Number.isFinite(intervalHours) && intervalHours >= 0 ? Math.min(intervalHours, 24 * 30) : 24
  const k = Number.isFinite(keep) && keep >= 1 ? Math.min(Math.floor(keep), 100) : DEFAULT_KEEP
  await putSetting('backupIntervalHours', String(ih))
  await putSetting('backupKeepCount', String(k))
}

// ---------------- عملیات پشتیبان‌گیری ----------------
export async function listBackups(): Promise<BackupFile[]> {
  const dir = backupsDir()
  if (!fs.existsSync(dir)) return []
  const entries = await fsp.readdir(dir)
  const names = entries.filter((f) => NAME_RE.test(f))
  const out: BackupFile[] = []
  for (const name of names) {
    try {
      const st = await fsp.stat(path.join(dir, name))
      out.push({ name, size: st.size, createdAt: st.mtime.toISOString() })
    } catch {
      /* فایل حذف‌شده همزمان */
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name))
}

/** حذف نسخه‌های قدیمی‌تر از حد نگهداری */
async function pruneBackups(): Promise<void> {
  const keep = await getBackupKeep()
  const files = await listBackups() // جدیدترین اول
  const stale = files.slice(keep)
  for (const f of stale) {
    await fsp.unlink(path.join(backupsDir(), f.name)).catch(() => {})
  }
}

/** ایجاد یک نسخه پشتیبان سازگار (VACUUM INTO — در برابر نوشتن همزمان امن است) */
export async function createBackup(
  reason: 'auto' | 'manual',
  actor?: AuditActor | null
): Promise<BackupFile> {
  const dir = backupsDir()
  await fsp.mkdir(dir, { recursive: true })
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const name = `backup-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.db`
  const target = path.join(dir, name)

  try {
    await db.$executeRawUnsafe(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } catch {
    // روش جایگزین: چک‌پوینت WAL و سپس کپی مستقیم فایل
    await db.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)').catch(() => {})
    await fsp.copyFile(dbFilePath(), target)
  }

  const st = await fsp.stat(target)
  await pruneBackups()
  await logAudit(actor ?? null, reason === 'auto' ? 'backup_auto' : 'backup', 'system', undefined, name)
  return { name, size: st.size, createdAt: st.mtime.toISOString() }
}

export async function deleteBackup(name: string, actor?: AuditActor | null): Promise<void> {
  if (!isValidBackupName(name)) throw new Error('invalid backup name')
  await fsp.unlink(path.join(backupsDir(), name))
  await logAudit(actor ?? null, 'backup_delete', 'system', undefined, name)
}

export function backupAbsPath(name: string): string {
  if (!isValidBackupName(name)) throw new Error('invalid backup name')
  return path.join(backupsDir(), name)
}

// ---------------- زمان‌بند خودکار (یک‌نمونه در هر پروسه) ----------------
type BackupGlobal = typeof globalThis & {
  __mfgBackupTimer?: ReturnType<typeof setInterval>
  __mfgBackupBootTimer?: ReturnType<typeof setTimeout>
}
const g = globalThis as BackupGlobal

async function autoBackupTick(): Promise<void> {
  try {
    const hours = await getBackupIntervalHours()
    if (!hours) return // غیرفعال
    const files = await listBackups()
    const lastMs = files[0] ? new Date(files[0].createdAt).getTime() : 0
    if (Date.now() - lastMs >= hours * 3_600_000) {
      await createBackup('auto')
      console.log('[backup] auto backup created')
    }
  } catch (e) {
    console.error('[backup] auto tick failed', e)
  }
}

/** در instrumentation.ts سرور فراخوانی می‌شود — هر ۱۰ دقیقه بررسی می‌کند */
export function initBackupScheduler(): void {
  if (g.__mfgBackupTimer) return
  g.__mfgBackupTimer = setInterval(() => {
    void autoBackupTick()
  }, 10 * 60 * 1000)
  g.__mfgBackupBootTimer = setTimeout(() => {
    void autoBackupTick()
  }, 15_000)
  // تایمرها نباید پروسه را زنده نگه دارند
  g.__mfgBackupTimer.unref?.()
  g.__mfgBackupBootTimer.unref?.()
}
