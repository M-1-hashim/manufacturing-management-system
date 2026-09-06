import type { PrismaClient } from '@prisma/client'
import { dbInternal } from '@/lib/db'

/*
 * موتور همگام‌سازی دوسویه بین هاست (MySQL) و دیتابیس محلی (SQLite):
 *
 * ۱) snapshotServerToLocal  — کپی کامل سرور → محلی (در یک تراکنش اتمیک)
 *    وقتی آنلاین هستیم دوره‌ای اجرا می‌شود تا همیشه آخرین کپیِ دیتای سرور
 *    روی دستگاه باشد؛ به همین دلیل وقتی اینترنت قطع می‌شود کاربر همان دیتای
 *    سرور را در حالت آفلاین می‌بیند.
 *
 * ۲) pushLocalChanges — سطرهای تغییرکرده در دورهٔ آفلاین → سرور
 *    تشخیص با updatedAt/createdAt؛ برخورد دو نسخه: آخرین نوشته برنده (LWW)
 *
 * ۳) replayJournal — حذف‌های انجام‌شده در آفلاین (ژورنال _SyncJournal روی
 *    SQLite محلی) روی سرور تکرار می‌شوند
 *
 * ۴) runReconnectSync — بعد از وصل شدن خودکار به هاست: push → journal → snapshot
 *
 * کلاینت‌ها به‌صورت پارامتر تزریق می‌شوند تا قابل تست باشد.
 */

type Row = Record<string, unknown>

interface Delegate {
  findMany: (args?: Row) => Promise<Row[]>
  findUnique?: (args: Row) => Promise<Row | null>
  createMany: (args: { data: Row[] }) => Promise<{ count: number }>
  deleteMany: (args?: Row) => Promise<{ count: number }>
  update: (args: Row) => Promise<Row>
}

export interface ClientPair {
  server: PrismaClient
  local: PrismaClient
}

/** ترتیب جداول: اولین‌ها والد هستند — درج به ترتیب، حذف به ترتیب معکوس */
const TABLES: {
  name: string
  track: 'updatedAt' | 'createdAt' | 'none'
  childOf?: { parent: string; fk: string }
}[] = [
  { name: 'User', track: 'updatedAt' },
  { name: 'ProductCategory', track: 'createdAt' },
  { name: 'Product', track: 'updatedAt' },
  { name: 'Supplier', track: 'createdAt' },
  { name: 'RawMaterial', track: 'updatedAt' },
  { name: 'Formula', track: 'updatedAt' },
  { name: 'FormulaItem', track: 'none', childOf: { parent: 'Formula', fk: 'formulaId' } },
  { name: 'ProductionOrder', track: 'updatedAt' },
  { name: 'Customer', track: 'updatedAt' },
  { name: 'Sale', track: 'updatedAt' },
  { name: 'SaleItem', track: 'none', childOf: { parent: 'Sale', fk: 'saleId' } },
  { name: 'Warehouse', track: 'createdAt' },
  { name: 'InventoryTransaction', track: 'createdAt' },
  { name: 'Expense', track: 'createdAt' },
  { name: 'Employee', track: 'updatedAt' },
  { name: 'Attendance', track: 'createdAt' },
  { name: 'SalaryPayment', track: 'createdAt' },
  { name: 'AuditLog', track: 'createdAt' },
  { name: 'Setting', track: 'none' },
]

const CHUNK = 200
const TAKE_LIMIT = 20000
const META_PREFIX = 'sync.'
const JOURNAL_TABLE = '_SyncJournal'
const JOURNAL_MAX = 4000

function del(client: PrismaClient, name: string): Delegate {
  return (client as unknown as Record<string, Delegate>)[name]
}

/* ------------------------------ متا (Setting محلی) ------------------------------ */

export async function getMeta(pair: ClientPair, key: string): Promise<string | null> {
  const row = await del(pair.local, 'setting').findUnique?.({ where: { key } })
  return row && typeof row.value === 'string' ? row.value : null
}

export async function setMeta(pair: ClientPair, key: string, value: string): Promise<void> {
  await del(pair.local, 'setting').upsert?.({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

/* ------------------------------ ژورنال حذف آفلاین ------------------------------ */

let journalReady = false
let journalInserts = 0

export async function ensureJournalTable(pair: ClientPair): Promise<void> {
  if (journalReady) return
  await pair.local.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "${JOURNAL_TABLE}" (` +
      `"id" INTEGER PRIMARY KEY AUTOINCREMENT, ` +
      `"ts" TEXT NOT NULL, "tbl" TEXT NOT NULL, "where_json" TEXT NOT NULL, "done" INTEGER NOT NULL DEFAULT 0)`
  )
  journalReady = true
}

/** قلاب را روی db.ts نصب می‌کند — حذف‌های حالت آفلاین ژورنال می‌شوند */
export function installOfflineJournaling(): void {
  const { sqlite } = dbInternal.getClients()
  if (!sqlite) return
  const pair: ClientPair = { server: sqlite, local: sqlite } // ژورنال فقط روی local نوشته می‌شود
  dbInternal.registerDeleteJournal((table, where) => {
    void (async () => {
      try {
        await ensureJournalTable(pair)
        await sqlite.$executeRawUnsafe(
          `INSERT INTO "${JOURNAL_TABLE}" (ts, tbl, where_json) VALUES (?, ?, ?)`,
          new Date().toISOString(),
          table,
          JSON.stringify(where ?? {})
        )
        journalInserts++
        if (journalInserts % 50 === 0) {
          await sqlite.$executeRawUnsafe(
            `DELETE FROM "${JOURNAL_TABLE}" WHERE id NOT IN ` +
              `(SELECT id FROM "${JOURNAL_TABLE}" ORDER BY id DESC LIMIT ${JOURNAL_MAX})`
          )
        }
      } catch (e) {
        console.error('[sync] journal insert failed:', e)
      }
    })()
  })
}

export async function replayJournal(pair: ClientPair): Promise<number> {
  await ensureJournalTable(pair)
  const rows = await pair.local.$queryRawUnsafe<Array<{ id: number; tbl: string; w: string }>>(
    `SELECT id, tbl, where_json AS w FROM "${JOURNAL_TABLE}" WHERE done = 0 ORDER BY id ASC LIMIT ${JOURNAL_MAX}`
  )
  let done = 0
  for (const r of rows) {
    // ژورنال با نام delegate ذخیره می‌شود (supplier) — مقایسهٔ بی‌حساس به بزرگی حروف
    const entry = TABLES.find((t) => t.name.toLowerCase() === String(r.tbl).toLowerCase())
    if (!entry) {
      await pair.local.$executeRawUnsafe(`UPDATE "${JOURNAL_TABLE}" SET done = 1 WHERE id = ?`, r.id)
      continue
    }
    try {
      const where = JSON.parse(r.w) as Row
      await del(pair.server, r.tbl).deleteMany({ where })
      await pair.local.$executeRawUnsafe(`UPDATE "${JOURNAL_TABLE}" SET done = 1 WHERE id = ?`, r.id)
      done++
    } catch (e) {
      console.error(`[sync] journal replay failed for ${r.tbl}#${r.id}:`, e)
      throw e
    }
  }
  // پاک‌سازی ورودی‌های قدیمی انجام‌شده (بیش از ۷ روز)
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
  await pair.local.$executeRawUnsafe(
    `DELETE FROM "${JOURNAL_TABLE}" WHERE done = 1 AND ts < ?`,
    weekAgo
  )
  return done
}

async function countPendingJournal(pair: ClientPair): Promise<number> {
  try {
    await ensureJournalTable(pair)
    const rows = await pair.local.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*) AS n FROM "${JOURNAL_TABLE}" WHERE done = 0`
    )
    return Number(rows[0]?.n ?? 0)
  } catch {
    return 0
  }
}

/* ------------------------------ سرور → محلی (اسنپ‌شات) ------------------------------ */

let snapshotBusy = false

/**
 * کپی کامل دیتای سرور روی دیتابیس محلی — اتمیک.
 * کلیدهای sync.* در جدول Setting محلی حفظ می‌شوند.
 */
export async function snapshotServerToLocal(pair: ClientPair): Promise<{ rows: number }> {
  if (snapshotBusy) throw new Error('اسنپ‌شات قبلی هنوز در حال اجراست')
  snapshotBusy = true
  try {
    // ۱) خواندن کامل از سرور
    const data = new Map<string, Row[]>()
    for (const t of TABLES) {
      data.set(t.name, await del(pair.server, t.name).findMany({ take: TAKE_LIMIT }))
    }

    // ۲) کلیدهای sync.* محلی که باید حفظ شوند
    const allLocalSettings = await del(pair.local, 'setting').findMany()
    const preserved = allLocalSettings.filter(
      (r) => typeof r.key === 'string' && String(r.key).startsWith(META_PREFIX)
    )

    // ۳) نوشتن در محلی — یک تراکنش اتمیک
    await pair.local.$transaction(async (tx) => {
      const txd = (name: string) => (tx as unknown as Record<string, Delegate>)[name]

      // حذف — فرزندان اول
      for (const t of [...TABLES].reverse()) {
        if (t.name === 'Setting') {
          await txd('setting').deleteMany()
        } else {
          await txd(t.name).deleteMany()
        }
      }

      // درج — والدین اول
      for (const t of TABLES) {
        const rows = data.get(t.name) ?? []
        const finalRows =
          t.name === 'Setting'
            ? [...rows.filter((r) => !String(r.key ?? '').startsWith(META_PREFIX)), ...preserved]
            : rows
        for (let i = 0; i < finalRows.length; i += CHUNK) {
          await txd(t.name).createMany({ data: finalRows.slice(i, i + CHUNK) })
        }
      }

      // ۴) راستی‌آزمایی تعداد سطرها
      for (const t of TABLES) {
        const rows = data.get(t.name) ?? []
        const expected =
          t.name === 'Setting'
            ? rows.filter((r) => !String(r.key ?? '').startsWith(META_PREFIX)).length + preserved.length
            : rows.length
        const found = await txd(t.name).findMany()
        if (found.length !== expected) {
          throw new Error(`جدول ${t.name}: ${found.length} سطر به‌جای ${expected} کپی شد`)
        }
      }
    })

    await setMeta(pair, 'sync.lastSnapshotAt', new Date().toISOString())
    const total = [...data.values()].reduce((s, rows) => s + rows.length, 0)
    console.log(`[sync] snapshot server→local OK: ${total} rows`)
    return { rows: total }
  } finally {
    snapshotBusy = false
  }
}

/* ------------------------------ محلی → سرور (push) ------------------------------ */

export interface PushResult {
  pushed: number
  skipped: number
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

let pushBusy = false

/**
 * سطرهای تغییرکرده محلی از تاریخ since به بعد را به سرور می‌فرستد.
 * برخورد (همان سطر هم محلی هم سروری عوض شده): نسخهٔ جدیدتر برنده است.
 * جدول Setting پوش داده نمی‌شود (بدون timestamp — برای جلوگیری از خراب‌کردن
 * تنظیمات جدیدتر سرور؛ تغییرات تنظیمات آفلاین بعد از اتصال با اسنپ‌شات برمی‌گردد).
 */
export async function pushLocalChanges(pair: ClientPair, since: Date): Promise<PushResult> {
  if (pushBusy) throw new Error('همگام‌سازی قبلی هنوز در حال اجراست')
  pushBusy = true
  let pushed = 0
  let skipped = 0
  try {
    for (const t of TABLES) {
      if (t.track === 'none' || t.name === 'Setting') continue
      const localDel = del(pair.local, t.name)
      const rows = await localDel.findMany({
        where: { [t.track]: { gt: since } },
        take: TAKE_LIMIT,
      })
      if (rows.length === 0) continue

      const serverDel = del(pair.server, t.name)

      // نقشهٔ نسخهٔ سرور برای تصمیم LWW — یک بار خوانده می‌شود
      const serverRows = await serverDel.findMany({
        select: t.track === 'updatedAt' ? { id: true, updatedAt: true } : { id: true },
        take: TAKE_LIMIT,
      })
      const serverMap = new Map<string, unknown>()
      for (const r of serverRows) serverMap.set(String(r.id), (r as Row).updatedAt)

      const toCreate: Row[] = []
      const toUpdate: Row[] = []
      for (const row of rows) {
        const id = row.id != null ? String(row.id) : null
        if (!id) continue
        if (!serverMap.has(id)) {
          toCreate.push(row)
        } else if (t.track === 'updatedAt') {
          const localAt = asDate(row.updatedAt)
          const serverAt = asDate(serverMap.get(id))
          if (serverAt && localAt && serverAt > localAt) {
            skipped++ // سرور جدیدتر — محلی نادیده گرفته می‌شود
          } else {
            toUpdate.push(row)
          }
        }
        // createdAt-track و از قبل موجود در سرور → رد (سرور حقیقت است)
      }

      // درج سطرهای جدید — دسته‌ای
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        await serverDel.createMany({ data: toCreate.slice(i, i + CHUNK) })
      }
      pushed += toCreate.length

      // به‌روزرسانی سطرهای ویرایش‌شده — تراکنش دسته‌ای
      for (let i = 0; i < toUpdate.length; i += CHUNK) {
        const chunk = toUpdate.slice(i, i + CHUNK)
        await pair.server.$transaction(async (tx) => {
          const txd = (tx as unknown as Record<string, Delegate>)[t.name]
          for (const row of chunk) {
            const { id, ...data } = row
            void id
            await txd.update({ where: { id: String(row.id) }, data })
            pushed++
          }
        })
      }

      // سطرهای فرزند (بدون timestamp) — همراه والد بازنویسی می‌شوند
      if ((t.name === 'Formula' || t.name === 'Sale') && (toCreate.length || toUpdate.length)) {
        const child = TABLES.find((c) => c.childOf?.parent === t.name)!
        const ids = [...toCreate, ...toUpdate].map((r) => String(r.id))
        for (const pid of ids) {
          const childRows = await del(pair.local, child.name).findMany({
            where: { [child.childOf!.fk]: pid },
          })
          await del(pair.server, child.name).deleteMany({
            where: { [child.childOf!.fk]: pid },
          })
          for (let i = 0; i < childRows.length; i += CHUNK) {
            await del(pair.server, child.name).createMany({
              data: childRows.slice(i, i + CHUNK),
            })
          }
          pushed += childRows.length
        }
      }

      if (rows.length) console.log(`[sync] push ${t.name}: +${toCreate.length} ~${toUpdate.length} (skip ${skipped})`)
    }
    return { pushed, skipped }
  } finally {
    pushBusy = false
  }
}

/* ------------------------------ همگام‌سازی کامل بعد از اتصال ------------------------------ */

export interface SyncSummary {
  pushed: number
  skipped: number
  journalReplayed: number
  snapshotRows: number
  startedAt: string
  finishedAt: string
}

let reconnectBusy = false

/**
 * بعد از وصل شدن به هاست: push تغییرات آفلاین → تکرار حذف‌ها → اسنپ‌شات سرور.
 * اگر offlineSince داده نشود فقط اسنپ‌شات می‌گیرد (push نیاز به مرز زمانی دارد).
 */
export async function runReconnectSync(pair: ClientPair, offlineSince?: string | null): Promise<SyncSummary> {
  if (reconnectBusy) throw new Error('همگام‌سازی از قبل در حال اجراست')
  reconnectBusy = true
  const startedAt = new Date().toISOString()
  try {
    let pushed = 0
    let skipped = 0
    let journalReplayed = 0

    const sinceStr = offlineSince ?? (await getMeta(pair, 'sync.offlineSince'))
    if (sinceStr) {
      const since = asDate(sinceStr)
      if (since) {
        const r = await pushLocalChanges(pair, since)
        pushed = r.pushed
        skipped = r.skipped
        journalReplayed = await replayJournal(pair)
      }
    }

    const snap = await snapshotServerToLocal(pair)

    await setMeta(pair, 'sync.lastSyncAt', new Date().toISOString())
    await setMeta(pair, 'sync.offlineSince', '')
    const summary: SyncSummary = {
      pushed,
      skipped,
      journalReplayed,
      snapshotRows: snap.rows,
      startedAt,
      finishedAt: new Date().toISOString(),
    }
    console.log('[sync] reconnect sync done:', JSON.stringify(summary))
    return summary
  } finally {
    reconnectBusy = false
  }
}

/* ------------------------------ شمارش تغییرات در انتظار ------------------------------ */

export async function pendingPushCount(pair: ClientPair, since: Date): Promise<number> {
  let total = 0
  for (const t of TABLES) {
    if (t.track === 'none' || t.name === 'Setting') continue
    try {
      const n = await del(pair.local, t.name).findMany({
        where: { [t.track]: { gt: since } },
        select: { id: true },
        take: TAKE_LIMIT,
      })
      total += n.length
    } catch {
      /* جدولی خطا داد — ادامه */
    }
  }
  total += await countPendingJournal(pair)
  return total
}
