import { randomUUID } from 'crypto'
import type { PrismaClient } from '@prisma/client'
import { dbInternal } from '@/lib/db'

/*
 * موتور همگام‌سازی لحظه‌ای دوسویه بین هاست (MySQL) و دیتابیس محلی (SQLite)
 * — معماری «محلی‌محور» نسخهٔ ۱.۰.۱۰:
 *
 * برنامه همیشه روی دیتابیس محلی کار می‌کند (پاسخ فوری حتی وقتی انترنت
 * کند است). این موتور هر چند ثانیه یک «تیک» می‌زند و فقط «تفاوت‌ها» را
 * جابه‌جا می‌کند:
 *
 *   ۱) push  — سطرهای محلی که updatedAt شان از آخرین ارسال (نشانِ آبی
 *      جلوتر) تازه‌تر است → روی هاست درج/تجدید می‌شوند (LWW: نسخهٔ
 *      جدیدتر برنده است)
 *   ۲) pull  — سطرهای هاست که updatedAt شان از آخرین دریافت تازه‌تر است
 *      → روی محلی درج/تجدید می‌شوند؛ فرزندان (FormulaItem/SaleItem)
 *      با «مطابق‌سازی دامنهٔ والد» همگام می‌شوند تا حذف‌وایجاد دوباره
 *      در هاست هم روی دستگاه‌های دیگر اعمال شود
 *   ۳) ژورنال حذف — حذف‌های این دستگاه (_SyncJournal) روی هاست تکرار و
 *      به‌صورت «سنگ‌قبر» (_SyncTombstones) ثبت می‌شوند
 *   ۴) سنگ‌قبرها — حذف‌های سایر دستگاه‌ها از هاست خوانده و روی محلی
 *      اعمال می‌شوند (با احترام به LWW)
 *
 * تشخیص تغییر با یک کوئری UNION ALL سبک (MAX(updatedAt) هر ۱۹ جدول)
 * انجام می‌شود — تیک بی‌کار فقط ۲ رفت‌وبرگشت شبکه دارد.
 *
 * همهٔ اجراؤات idempotent هستند: اگر تیک وسط کار قطع شود، تیک بعدی
 * همان تغییرها را دوباره می‌فرستد و LWW تکرار را بی‌ضرر می‌کند.
 */

type Row = Record<string, unknown>

interface Delegate {
  findMany: (args?: Row) => Promise<Row[]>
  findUnique?: (args: Row) => Promise<Row | null>
  createMany: (args: { data: Row[]; skipDuplicates?: boolean }) => Promise<{ count: number }>
  deleteMany: (args?: Row) => Promise<{ count: number }>
  update: (args: Row) => Promise<Row>
  upsert?: (args: Row) => Promise<Row>
  count?: (args?: Row) => Promise<number>
}

export interface ClientPair {
  server: PrismaClient
  local: PrismaClient
}

/** ترتیب جداول: اولین‌ها والد هستند — درج به ترتیب، حذف به ترتیب معکوس */
const TABLES: {
  name: string
  childOf?: { parent: string; fk: string }
}[] = [
  { name: 'User' },
  { name: 'ProductCategory' },
  { name: 'Product' },
  { name: 'Supplier' },
  { name: 'RawMaterial' },
  { name: 'Formula', childOf: { parent: 'Product', fk: 'productId' } },
  { name: 'FormulaItem', childOf: { parent: 'Formula', fk: 'formulaId' } },
  { name: 'ProductionOrder' },
  { name: 'Customer' },
  { name: 'Sale' },
  { name: 'SaleItem', childOf: { parent: 'Sale', fk: 'saleId' } },
  { name: 'Warehouse' },
  { name: 'InventoryTransaction' },
  { name: 'Expense' },
  { name: 'Employee' },
  { name: 'Attendance', childOf: { parent: 'Employee', fk: 'employeeId' } },
  { name: 'SalaryPayment', childOf: { parent: 'Employee', fk: 'employeeId' } },
  { name: 'AuditLog' },
  { name: 'Setting' },
]

/** جداول فرزندی که با «مطابق‌سازی دامنهٔ والد» همگام می‌شوند */
const CHILD_TABLES = new Set(['FormulaItem', 'SaleItem'])

const CHUNK = 100
const TAKE_LIMIT = 20000
const META_PREFIX = 'sync.'
const JOURNAL_TABLE = '_SyncJournal'
const TOMBSTONE_TABLE = '_SyncTombstones'
const JOURNAL_MAX = 4000
/** هم‌پوشانی پنجرهٔ تغییرات برای جبران دقت میلی‌ثانیه و ساعت دستگاه‌ها */
const OVERLAP_MS = 1500
/** سنگ‌قبرهای قدیمی‌تر از ۳۰ روز پاک می‌شوند */
const TOMBSTONE_TTL_MS = 30 * 24 * 3600 * 1000
const TOMBSTONE_PULL_LIMIT = 2000

function del(client: PrismaClient, name: string): Delegate {
  return (client as unknown as Record<string, Delegate>)[name]
}

function idKeyOf(table: string): string {
  return table === 'Setting' ? 'key' : 'id'
}

/**
 * createMany امن — کلاینت SQLite از skipDuplicates پشتیبانی نمی‌کند
 * (فقط MySQL/Postgres). اول با skipDuplicates کوشش می‌شود؛ اگر پذیرفته
 * نشد بدون آن، و اگر تداخل یونیک پیش آمد سطر‌به‌سطر با گذشتن از تکراری‌ها.
 */
async function createManySafe(d: Delegate, data: Row[]): Promise<void> {
  if (data.length === 0) return
  try {
    await d.createMany({ data, skipDuplicates: true })
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (!/skipDuplicates/i.test(msg)) throw e
    try {
      await d.createMany({ data })
    } catch (e2) {
      const m2 = String((e2 as Error)?.message || e2)
      if (!/unique constraint/i.test(m2)) throw e2
      for (const row of data) {
        try {
          await d.createMany({ data: [row] })
        } catch (e3) {
          const m3 = String((e3 as Error)?.message || e3)
          if (!/unique constraint/i.test(m3)) throw e3
        }
      }
    }
  }
}

function isSyncMetaKey(key: unknown): boolean {
  return typeof key === 'string' && key.startsWith(META_PREFIX)
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v
  // MAX() روی SQLite مقدار epoch-ms می‌دهد — گاهی bigint، گاهی رشتهٔ عددی
  if (typeof v === 'bigint') {
    const d = new Date(Number(v))
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof v === 'string') {
    const s = v.trim()
    if (/^\d{10,}$/.test(s)) {
      const d = new Date(Number(s))
      return Number.isNaN(d.getTime()) ? null : d
    }
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
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

/* --------------------------- نشان‌های آبی (watermark) --------------------------- */

interface Watermarks {
  /** آخرین ارسال موفق هر جدول به هاست (ISO — ساعت دستگاه محلی) */
  push: Map<string, string>
  /** آخرین دریافت موفق از هاست (ISO — ساعتِ مقادیر هاست) */
  pull: Map<string, string>
  /** آخرین سنگ‌قبر دریافت‌شده */
  tomb: string | null
}

function emptyWatermarks(): Watermarks {
  return { push: new Map(), pull: new Map(), tomb: null }
}

function parseWatermarkJson(raw: string | null): Map<string, string> {
  const m = new Map<string, string>()
  if (!raw) return m
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.length > 4) m.set(k, v)
    }
  } catch {
    /* خراب — از صفر شروع می‌شود */
  }
  return m
}

async function readWatermarks(pair: ClientPair): Promise<Watermarks> {
  const [push, pull, tomb] = await Promise.all([
    getMeta(pair, 'sync.pushWm'),
    getMeta(pair, 'sync.pullWm'),
    getMeta(pair, 'sync.tombWm'),
  ])
  return { push: parseWatermarkJson(push), pull: parseWatermarkJson(pull), tomb: tomb && tomb.length > 4 ? tomb : null }
}

async function writeWatermarks(pair: ClientPair, wm: Watermarks): Promise<void> {
  const toJson = (m: Map<string, string>) => JSON.stringify(Object.fromEntries(m))
  await setMeta(pair, 'sync.pushWm', toJson(wm.push))
  await setMeta(pair, 'sync.pullWm', toJson(wm.pull))
  if (wm.tomb) await setMeta(pair, 'sync.tombWm', wm.tomb)
}

export async function resetWatermarks(pair: ClientPair): Promise<void> {
  await writeWatermarks(pair, emptyWatermarks())
}

/* ----------------------- تشخیص سبک تغییر (MAX updatedAt) ----------------------- */

function buildMaxQuery(kind: 'sqlite' | 'mysql'): string {
  const q = kind === 'sqlite' ? '"' : '`'
  return TABLES.map((t) => {
    const whereSetting =
      t.name === 'Setting' ? ` WHERE ${q}key${q} NOT LIKE 'sync.%'` : ''
    return `SELECT '${t.name}' AS t, MAX(${q}updatedAt${q}) AS m FROM ${q}${t.name}${q}${whereSetting}`
  }).join(' UNION ALL ')
}

async function maxUpdatedAtMap(
  client: PrismaClient,
  kind: 'sqlite' | 'mysql'
): Promise<Map<string, Date>> {
  const rows = await client.$queryRawUnsafe<Array<{ t: string; m: unknown }>>(buildMaxQuery(kind))
  const map = new Map<string, Date>()
  for (const r of rows) {
    const d = asDate(r.m)
    if (d) map.set(String(r.t), d)
  }
  return map
}

/* ------------------------------ جدول سنگ‌قبر هاست ------------------------------ */

let tombstoneReady = false

/** ساخت جدول _SyncTombstones روی هاست (اگر نبود) — یک‌بار در هر پروسه */
export async function ensureServerTombstones(pair: ClientPair): Promise<void> {
  if (tombstoneReady) return
  try {
    // MySQL (هاست واقعی)
    await pair.server.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS \`${TOMBSTONE_TABLE}\` (\n` +
        `  \`id\` VARCHAR(191) NOT NULL,\n` +
        `  \`tbl\` VARCHAR(191) NOT NULL,\n` +
        `  \`recordId\` VARCHAR(191) NOT NULL,\n` +
        `  \`deletedAt\` DATETIME(3) NOT NULL,\n` +
        `  INDEX \`${TOMBSTONE_TABLE}_deletedAt_idx\`(\`deletedAt\`),\n` +
        `  INDEX \`${TOMBSTONE_TABLE}_tbl_recordId_idx\`(\`tbl\`, \`recordId\`),\n` +
        `  PRIMARY KEY (\`id\`)\n` +
        `) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
    tombstoneReady = true
  } catch {
    // SQLite (تست/هاست شبیه‌سازی‌شده) — بدون پسوند MySQL
    try {
      await pair.server.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "${TOMBSTONE_TABLE}" (\n` +
          `  "id" TEXT PRIMARY KEY NOT NULL,\n` +
          `  "tbl" TEXT NOT NULL,\n` +
          `  "recordId" TEXT NOT NULL,\n` +
          `  "deletedAt" DATETIME NOT NULL\n` +
          `)`
      )
      await pair.server.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "${TOMBSTONE_TABLE}_deletedAt_idx" ON "${TOMBSTONE_TABLE}"("deletedAt")`
      )
      tombstoneReady = true
    } catch (e2) {
      const msg = String((e2 as Error)?.message || e2)
      if (/already exists/i.test(msg)) {
        tombstoneReady = true
        return
      }
      throw e2
    }
  }
}

async function insertServerTombstone(
  pair: ClientPair,
  table: string,
  recordId: string,
  deletedAt: Date
): Promise<void> {
  try {
    await ensureServerTombstones(pair)
    await pair.server.$executeRawUnsafe(
      `INSERT INTO \`${TOMBSTONE_TABLE}\` (id, tbl, recordId, deletedAt) VALUES (?, ?, ?, ?)`,
      randomUUID(),
      table,
      recordId,
      deletedAt
    )
  } catch (e) {
    // تکراری بودن id سنگ‌قبر مهم نیست — بقیهٔ خطاها لاگ می‌شود
    const msg = String((e as Error)?.message || e)
    if (!/duplicate|unique/i.test(msg)) throw e
  }
}

/* ------------------------------ ژورنال حذف محلی ------------------------------ */

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

/** قلاب را روی db.ts نصب می‌کند — همهٔ حذف‌های کاربر ژورنال می‌شوند (آنلاین و آفلاین) */
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
  const rows = await pair.local.$queryRawUnsafe<Array<{ id: number; ts: string; tbl: string; w: string }>>(
    `SELECT id, ts, tbl, where_json AS w FROM "${JOURNAL_TABLE}" WHERE done = 0 ORDER BY id ASC LIMIT ${JOURNAL_MAX}`
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
      await del(pair.server, entry.name).deleteMany({ where })
      // سنگ‌قبر برای حذف‌های id-دار — تا دستگاه‌های دیگر هم حذف را ببینند
      if (where && typeof where.id === 'string') {
        const ts = asDate(r.ts) ?? new Date()
        await insertServerTombstone(pair, entry.name, where.id, ts)
      }
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

/* ------------------------------ push: محلی → هاست ------------------------------ */

function stripMetaSetting(row: Row): boolean {
  // جدول Setting — کلیدهای sync.* هرگز سینک نمی‌شوند
  return isSyncMetaKey(row.key)
}

/**
 * ارسال دلتای یک جدول به هاست. since=null یعنی همهٔ سطرها.
 * برخورد: نسخهٔ جدیدتر برنده (LWW بر اساس updatedAt).
 */
async function pushTableDelta(pair: ClientPair, table: string, since: Date | null): Promise<number> {
  const localDel = del(pair.local, table)
  const where: Row = since ? { updatedAt: { gt: since } } : {}
  let rows = await localDel.findMany({ where, take: TAKE_LIMIT })
  if (table === 'Setting') rows = rows.filter((r) => !stripMetaSetting(r))
  if (rows.length === 0) return 0

  const serverDel = del(pair.server, table)
  const ik = idKeyOf(table)
  const ids = rows.map((r) => String(r[ik])).filter((x) => x && x !== 'undefined' && x !== 'null')
  if (ids.length === 0) return 0

  // نسخهٔ هاست فقط برای همین idها خوانده می‌شود (نه کل جدول)
  const serverRows = await serverDel.findMany({
    where: { [ik]: { in: ids } },
    select: { [ik]: true, updatedAt: true },
  })
  const serverMap = new Map<string, unknown>()
  for (const r of serverRows) serverMap.set(String(r[ik]), r.updatedAt)

  const toCreate: Row[] = []
  const toUpdate: Row[] = []
  for (const row of rows) {
    const id = row[ik] != null ? String(row[ik]) : null
    if (!id) continue
    if (!serverMap.has(id)) {
      toCreate.push(row)
    } else {
      const localAt = asDate(row.updatedAt)
      const serverAt = asDate(serverMap.get(id))
      if (!serverAt || (localAt && localAt > serverAt)) toUpdate.push(row)
    }
  }

  for (let i = 0; i < toCreate.length; i += CHUNK) {
    await createManySafe(serverDel, toCreate.slice(i, i + CHUNK))
  }

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK)
    await pair.server.$transaction(async (tx) => {
      const txd = (tx as unknown as Record<string, Delegate>)[table]
      for (const row of chunk) {
        const { [ik]: _id, ...data } = row
        void _id
        await txd.update({ where: { [ik]: String(row[ik]) }, data })
      }
    })
  }

  return toCreate.length + toUpdate.length
}

/* ------------------------------ pull: هاست → محلی ------------------------------ */

async function pullTableDelta(pair: ClientPair, table: string, since: Date | null): Promise<number> {
  const serverDel = del(pair.server, table)
  const where: Row = since ? { updatedAt: { gt: since } } : {}
  let rows = await serverDel.findMany({ where, take: TAKE_LIMIT })
  if (table === 'Setting') rows = rows.filter((r) => !stripMetaSetting(r))
  if (rows.length === 0) return 0

  const localDel = del(pair.local, table)
  const ik = idKeyOf(table)
  const ids = rows.map((r) => String(r[ik])).filter((x) => x && x !== 'undefined' && x !== 'null')
  if (ids.length === 0) return 0

  const localRows = await localDel.findMany({
    where: { [ik]: { in: ids } },
    select: { [ik]: true, updatedAt: true },
  })
  const localMap = new Map<string, unknown>()
  for (const r of localRows) localMap.set(String(r[ik]), r.updatedAt)

  const toCreate: Row[] = []
  const toUpdate: Row[] = []
  for (const row of rows) {
    const id = row[ik] != null ? String(row[ik]) : null
    if (!id) continue
    if (!localMap.has(id)) {
      toCreate.push(row)
    } else {
      const serverAt = asDate(row.updatedAt)
      const localAt = asDate(localMap.get(id))
      if (!localAt || (serverAt && serverAt > localAt)) toUpdate.push(row)
    }
  }

  for (let i = 0; i < toCreate.length; i += CHUNK) {
    await createManySafe(localDel, toCreate.slice(i, i + CHUNK))
  }

  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    const chunk = toUpdate.slice(i, i + CHUNK)
    await pair.local.$transaction(async (tx) => {
      const txd = (tx as unknown as Record<string, Delegate>)[table]
      for (const row of chunk) {
        const { [ik]: _id, ...data } = row
        void _id
        await txd.update({ where: { [ik]: String(row[ik]) }, data })
      }
    })
  }

  // فرزندان والدِ تغییرکرده — مطابق‌سازی دامنهٔ والد:
  // حذف‌وایجاد دوبارهٔ آیتم‌ها در هاست (مثلاً تصحیح فورمولا) روی محلی هم
  // اعمال می‌شود؛ آیتم‌های یتیم محلی که دیگر در هاست نیستند حذف می‌شوند.
  const meta = TABLES.find((t) => t.name === table)
  if (meta?.childOf && CHILD_TABLES.has(table)) {
    const fk = meta.childOf.fk
    const parentIds = rows.map((r) => String(r[fk])).filter((x) => x && x !== 'undefined' && x !== 'null')
    const uniqueParents = [...new Set(parentIds)]
    for (const pid of uniqueParents) {
      const serverChildren = await serverDel.findMany({
        where: { [fk]: pid },
        select: { id: true },
        take: TAKE_LIMIT,
      })
      const serverIds = new Set(serverChildren.map((c) => String(c.id)))
      const localChildren = await localDel.findMany({ where: { [fk]: pid }, select: { id: true } })
      const orphans = localChildren.filter((c) => !serverIds.has(String(c.id)))
      if (orphans.length > 0) {
        await localDel.deleteMany({ where: { id: { in: orphans.map((o) => String(o.id)) } } })
      }
    }
  }

  return toCreate.length + toUpdate.length
}

/* --------------------------- سنگ‌قبرهای هاست → محلی --------------------------- */

async function pullTombstones(pair: ClientPair, wm: Watermarks): Promise<number> {
  await ensureServerTombstones(pair)
  const since = wm.tomb ? new Date(Date.parse(wm.tomb) - OVERLAP_MS) : null
  const sql = since
    ? `SELECT tbl, recordId, deletedAt FROM \`${TOMBSTONE_TABLE}\` WHERE deletedAt > ? ORDER BY deletedAt ASC LIMIT ${TOMBSTONE_PULL_LIMIT}`
    : `SELECT tbl, recordId, deletedAt FROM \`${TOMBSTONE_TABLE}\` ORDER BY deletedAt ASC LIMIT ${TOMBSTONE_PULL_LIMIT}`
  const rows = since
    ? await pair.server.$queryRawUnsafe<Array<{ tbl: string; recordId: string; deletedAt: Date }>>(sql, since)
    : await pair.server.$queryRawUnsafe<Array<{ tbl: string; recordId: string; deletedAt: Date }>>(sql)
  if (rows.length === 0) return 0

  let removed = 0
  let maxAt: Date | null = null
  for (const r of rows) {
    const d = asDate(r.deletedAt)
    if (d && (!maxAt || d > maxAt)) maxAt = d
    const entry = TABLES.find((t) => t.name.toLowerCase() === String(r.tbl).toLowerCase())
    if (!entry) continue
    const rid = String(r.recordId)
    if (!rid || rid === 'undefined') continue
    try {
      const local = await del(pair.local, entry.name).findUnique?.({ where: { id: rid } })
      if (!local) {
        removed++
        continue // از قبل حذف شده
      }
      // LWW: اگر محلی بعد از سنگ‌قبر تصحیح شده → نگه داشته می‌شود (بازگشت)
      const localAt = asDate((local as Row).updatedAt)
      if (localAt && d && localAt > d) continue
      await del(pair.local, entry.name).deleteMany({ where: { id: rid } })
      removed++
    } catch (e) {
      console.error(`[sync] tombstone apply failed for ${r.tbl}#${rid}:`, e)
    }
  }
  if (maxAt) wm.tomb = maxAt.toISOString()
  return removed
}

/* --------------------------------- تیک سینک --------------------------------- */

let tickBusy = false

export interface TickResult {
  ok: boolean
  pushed: number
  pulled: number
  deleted: number
  ms: number
  error?: string
}

let lastTickResult: TickResult | null = null

export function getLastTickResult(): TickResult | null {
  return lastTickResult
}

/**
 * یک دور کامل همگام‌سازی لحظه‌ای: ژورنال حذف → push → pull → سنگ‌قبرها.
 * در حالت آنلاین هر چند ثانیه اجرا می‌شود؛ تیکِ بی‌کار فقط ۲ رفت‌وبرگشت دارد.
 */
export async function syncTick(pair: ClientPair): Promise<TickResult> {
  if (tickBusy) return lastTickResult ?? { ok: false, pushed: 0, pulled: 0, deleted: 0, ms: 0, error: 'busy' }
  tickBusy = true
  const t0 = Date.now()
  let pushed = 0
  let pulled = 0
  let deleted = 0
  const failedTables: string[] = []
  try {
    await ensureServerTombstones(pair)
    const wm = await readWatermarks(pair)

    // ۱) حذف‌های محلی → هاست + سنگ‌قبر
    deleted += await replayJournal(pair)

    // ۲) push — فقط جداولی که MAX(updatedAt) محلی از نشان جلوتر است
    const localMax = await maxUpdatedAtMap(pair.local, 'sqlite')
    const pushCutoffs = new Map<string, string>()
    for (const t of TABLES) {
      const cur = localMax.get(t.name)
      const base = wm.push.get(t.name)
      if (!cur) continue // جدول محلی خالی است
      if (!base || cur.getTime() > Date.parse(base)) {
        try {
          const since = base ? new Date(Date.parse(base) - OVERLAP_MS) : null
          pushed += await pushTableDelta(pair, t.name, since)
          pushCutoffs.set(t.name, new Date().toISOString())
        } catch (e) {
          failedTables.push(t.name)
          console.error(`[sync] push ${t.name} failed:`, (e as Error)?.message || e)
        }
      }
    }

    // ۳) pull — فقط جداولی که MAX(updatedAt) هاست از نشان جلوتر است
    const serverMax = await maxUpdatedAtMap(pair.server, 'mysql')
    for (const t of TABLES) {
      const cur = serverMax.get(t.name)
      const base = wm.pull.get(t.name)
      if (!cur) continue
      if (!base || cur.getTime() > Date.parse(base)) {
        try {
          const since = base ? new Date(Date.parse(base) - OVERLAP_MS) : null
          pulled += await pullTableDelta(pair, t.name, since)
          const prev = wm.pull.get(t.name)
          if (!prev || cur.getTime() > Date.parse(prev)) wm.pull.set(t.name, cur.toISOString())
        } catch (e) {
          failedTables.push(t.name)
          console.error(`[sync] pull ${t.name} failed:`, (e as Error)?.message || e)
        }
      }
    }

    // ۴) سنگ‌قبرهای سایر دستگاه‌ها
    try {
      deleted += await pullTombstones(pair, wm)
    } catch (e) {
      console.error('[sync] tombstone pull failed:', (e as Error)?.message || e)
    }

    // ۵) ثبت نشان‌های ارسال
    for (const [tbl, iso] of pushCutoffs) wm.push.set(tbl, iso)
    await writeWatermarks(pair, wm)

    const result: TickResult = {
      ok: failedTables.length === 0,
      pushed,
      pulled,
      deleted,
      ms: Date.now() - t0,
      error: failedTables.length ? `tables: ${failedTables.join(',')}` : undefined,
    }
    lastTickResult = result
    return result
  } catch (e) {
    const result: TickResult = {
      ok: false,
      pushed,
      pulled,
      deleted,
      ms: Date.now() - t0,
      error: String((e as Error)?.message || e).slice(0, 300),
    }
    lastTickResult = result
    return result
  } finally {
    tickBusy = false
  }
}

/* --------------------------- اسنپ‌شات کامل هاست → محلی --------------------------- */

let snapshotBusy = false

/**
 * کپی کامل دیتای هاست روی دیتابیس محلی — اتمیک.
 * بعد از موفقیت، نشان‌های push/pull بر اساس سطرهای کپی‌شده تنظیم می‌شوند
 * تا دلتای تکراری ارسال نشود (جلوگیری از چرخش بی‌پایان echo).
 * کلیدهای sync.* در جدول Setting محلی حفظ می‌شوند.
 */
export async function snapshotServerToLocal(pair: ClientPair): Promise<{ rows: number }> {
  if (snapshotBusy) throw new Error('اسنپ‌شات قبلی هنوز در حال اجراست')
  snapshotBusy = true
  try {
    // ۱) خواندن کامل از هاست
    const data = new Map<string, Row[]>()
    for (const t of TABLES) {
      data.set(t.name, await del(pair.server, t.name).findMany({ take: TAKE_LIMIT }))
    }

    // ۲) کلیدهای sync.* محلی که باید حفظ شوند
    const allLocalSettings = await del(pair.local, 'setting').findMany()
    const preserved = allLocalSettings.filter((r) => isSyncMetaKey(r.key))

    // ۳) نوشتن در محلی — یک تراکنش اتمیک
    await pair.local.$transaction(async (tx) => {
      const txd = (name: string) => (tx as unknown as Record<string, Delegate>)[name]

      // حذف — فرزندان اول
      for (const t of [...TABLES].reverse()) {
        await txd(t.name).deleteMany()
      }

      // درج — والدین اول
      for (const t of TABLES) {
        const rows = data.get(t.name) ?? []
        const finalRows =
          t.name === 'Setting'
            ? [...rows.filter((r) => !isSyncMetaKey(r.key)), ...preserved]
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
            ? rows.filter((r) => !isSyncMetaKey(r.key)).length + preserved.length
            : rows.length
        const found = await txd(t.name).findMany()
        if (found.length !== expected) {
          throw new Error(`جدول ${t.name}: ${found.length} سطر به‌جای ${expected} کپی شد`)
        }
      }
    })

    // ۵) تنظیم نشان‌ها بر اساس مقادیر کپی‌شده (جلوگیری از echo)
    const wm = await readWatermarks(pair)
    const localMax = await maxUpdatedAtMap(pair.local, 'sqlite')
    for (const t of TABLES) {
      const iso = localMax.get(t.name)?.toISOString() ?? '1970-01-01T00:00:00.000Z'
      wm.push.set(t.name, iso)
      wm.pull.set(t.name, iso)
    }
    try {
      await ensureServerTombstones(pair)
      const tm = await pair.server.$queryRawUnsafe<Array<{ m: unknown }>>(
        `SELECT MAX(deletedAt) AS m FROM \`${TOMBSTONE_TABLE}\``
      )
      const d = asDate(tm[0]?.m)
      wm.tomb = d ? d.toISOString() : new Date().toISOString()
    } catch {
      wm.tomb = new Date().toISOString()
    }
    await writeWatermarks(pair, wm)

    await setMeta(pair, 'sync.lastSnapshotAt', new Date().toISOString())
    const total = [...data.values()].reduce((s, rows) => s + rows.length, 0)
    console.log(`[sync] snapshot server→local OK: ${total} rows`)
    return { rows: total }
  } finally {
    snapshotBusy = false
  }
}

/* ---------------------- همگام‌سازی کامل بعد از اتصال ---------------------- */

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
 * بعد از وصل شدن دوباره به هاست: حذف‌ها → push دلتا → اسنپ‌شات کامل.
 * اسنپ‌شات تضمین می‌کند بعد از دورهٔ آفلاین، دستگاه دقیقاً هم‌سان هاست شود.
 */
export async function runReconnectSync(pair: ClientPair, _offlineSince?: string | null): Promise<SyncSummary> {
  if (reconnectBusy) throw new Error('همگام‌سازی از قبل در حال اجراست')
  reconnectBusy = true
  const startedAt = new Date().toISOString()
  try {
    await ensureServerTombstones(pair)
    const journalReplayed = await replayJournal(pair)

    let pushed = 0
    const localMax = await maxUpdatedAtMap(pair.local, 'sqlite')
    const wm = await readWatermarks(pair)
    for (const t of TABLES) {
      const cur = localMax.get(t.name)
      const base = wm.push.get(t.name)
      if (!cur) continue
      if (!base || cur.getTime() > Date.parse(base)) {
        try {
          const since = base ? new Date(Date.parse(base) - OVERLAP_MS) : null
          pushed += await pushTableDelta(pair, t.name, since)
          wm.push.set(t.name, new Date().toISOString())
        } catch (e) {
          console.error(`[sync] reconnect push ${t.name} failed:`, (e as Error)?.message || e)
        }
      }
    }

    const snap = await snapshotServerToLocal(pair)

    await setMeta(pair, 'sync.lastSyncAt', new Date().toISOString())
    await setMeta(pair, 'sync.offlineSince', '')
    const summary: SyncSummary = {
      pushed,
      skipped: 0,
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

/* --------------------------- شمارش تغییرات در انتظار --------------------------- */

export async function pendingPushCount(pair: ClientPair): Promise<number> {
  let total = 0
  try {
    const wm = await readWatermarks(pair)
    for (const t of TABLES) {
      try {
        const base = wm.push.get(t.name)
        const since = base ? new Date(Date.parse(base) - OVERLAP_MS) : null
        const n = await del(pair.local, t.name).count?.({
          where: since ? { updatedAt: { gt: since } } : undefined,
        })
        total += Number(n ?? 0)
      } catch {
        /* جدولی خطا داد — ادامه */
      }
    }
  } catch {
    /* نشان‌ها خوانده نشد — صفر */
  }
  total += await countPendingJournal(pair)
  return total
}

/* --------------------------- انتقال کامل محلی → هاست --------------------------- */

let migrateBusy = false

export interface MigrateResult {
  copied: number
  updated: number
  perTable: { name: string; copied: number; updated: number }[]
}

/**
 * انتقال کامل دیتای دستگاه محلی به هاست — برای کاربر‌ای که مدت‌ها محلی
 * کار کرده و بعداً به هاست مهاجرت می‌کند. همهٔ ۱۹ جدول به‌ترتیبِ وابستگی
 * روی هاست upsert می‌شوند (سطر جدید → create، سطر موجود → update).
 * بعد از موفقیت، نشان‌های ارسال تنظیم می‌شوند تا دلتای تکراری نرود.
 */
export async function migrateLocalToServer(pair: ClientPair): Promise<MigrateResult> {
  if (migrateBusy) throw new Error('انتقال قبلی هنوز در حال اجراست')
  migrateBusy = true
  const perTable: MigrateResult['perTable'] = []
  let copied = 0
  let updated = 0
  try {
    for (const t of TABLES) {
      const localRows = await del(pair.local, t.name).findMany({ take: TAKE_LIMIT })
      let c = 0
      let u = 0
      if (localRows.length > 0) {
        const serverDel = del(pair.server, t.name)
        const ik = idKeyOf(t.name)
        const serverIds = new Set<string>()
        const serverRows = await serverDel.findMany({ select: { [ik]: true }, take: TAKE_LIMIT })
        for (const r of serverRows) serverIds.add(String((r as Row)[ik]))

        const toCreate: Row[] = []
        const toUpdate: Row[] = []
        for (const row of localRows) {
          if (t.name === 'Setting' && isSyncMetaKey(row.key)) continue
          const id = row[ik] != null ? String(row[ik]) : null
          if (!id) continue
          if (serverIds.has(id)) toUpdate.push(row)
          else toCreate.push(row)
        }

        for (let i = 0; i < toCreate.length; i += CHUNK) {
          await createManySafe(serverDel, toCreate.slice(i, i + CHUNK))
        }
        c = toCreate.length

        for (let i = 0; i < toUpdate.length; i += CHUNK) {
          const chunk = toUpdate.slice(i, i + CHUNK)
          await pair.server.$transaction(async (tx) => {
            const txd = (tx as unknown as Record<string, Delegate>)[t.name]
            for (const row of chunk) {
              const { [ik]: _id, ...data } = row
              void _id
              await txd.update({ where: { [ik]: String(row[ik]) }, data })
            }
          })
        }
        u = toUpdate.length
      }
      copied += c
      updated += u
      perTable.push({ name: t.name, copied: c, updated: u })
      if (c + u > 0) console.log(`[sync] migrate ${t.name}: +${c} ~${u}`)
    }

    // نشان ارسال = جدیدترین updatedAt محلی هر جدول — هیچ‌چیز دوباره push نمی‌شود
    const wm = await readWatermarks(pair)
    const localMax = await maxUpdatedAtMap(pair.local, 'sqlite')
    for (const t of TABLES) {
      const iso = localMax.get(t.name)?.toISOString()
      if (iso) wm.push.set(t.name, iso)
    }
    await writeWatermarks(pair, wm)

    return { copied, updated, perTable }
  } finally {
    migrateBusy = false
  }
}

/* --------------------------- مطابق‌سازی دوره‌ای (تور ایمنی) --------------------------- */

/**
 * مقایسهٔ تعداد سطرها بین هاست و محلی — اگر ناهم‌خوانی باشد اسنپ‌شات
 * کامل لازم می‌شود (حالت‌های نادر: حذف مستقیم روی هاست، خطای تاریخی).
 * خروجی: نام جداول ناهم‌خوان (خالی = سالم).
 */
export async function countMismatchTables(pair: ClientPair): Promise<string[]> {
  const localMax = TABLES
  const mismatched: string[] = []
  for (const t of localMax) {
    try {
      const localCount = await del(pair.local, t.name).count?.()
      const serverCount = await del(pair.server, t.name).count?.()
      if (localCount !== serverCount) mismatched.push(t.name)
    } catch {
      /* جدولی خطا داد — نادیده */
    }
  }
  return mismatched
}

/** پاک‌سازی سنگ‌قبرهای قدیمی هاست (بیش از ۳۰ روز) */
export async function pruneServerTombstones(pair: ClientPair): Promise<void> {
  try {
    await ensureServerTombstones(pair)
    const cutoff = new Date(Date.now() - TOMBSTONE_TTL_MS)
    await pair.server.$executeRawUnsafe(
      `DELETE FROM \`${TOMBSTONE_TABLE}\` WHERE deletedAt < ?`,
      cutoff
    )
  } catch (e) {
    console.error('[sync] tombstone prune failed:', e)
  }
}
