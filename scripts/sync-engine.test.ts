/*
 * تست گستردهٔ موتور همگام‌سازی لحظه‌ای (v1.0.10)
 *
 * دو دیتابیس SQLite مستقل:
 *   - server.db  → شبیه‌ساز هاست (MySQL)
 *   - device.db  → دیتابیس محلی دستگاه
 * کلاینت‌های Prisma واقعی (SQLite) — دقیقاً همان مسیر کد تولید.
 *
 * سناریوها (پوشش ۶ بند درخواست کاربر):
 *  ۱. تغییر محلی (افزودن/ویرایش/حذف) → syncTick → روی سرور اعمال
 *  ۲. تغییر سرور → syncTick → روی محلی اعمال
 *  ۳. همگام‌سازی لحظه‌ای پیوسته (چند تیک پشت سر هم، دلتای صفر = رفت‌وبرگشت کم)
 *  ۴. قطعی: تغییرها روی محلی صف می‌شوند → بعد از «وصل شدن» runReconnectSync همه را می‌فرستد
 *  ۵. سرعت: تیک بی‌کار < ۱۰۰ms، دلتای کوچک سریع
 *  ۶. سناریوهای پیچیده: LWW، حذف طرف دیگر، فرمول با آیتم (حذف/ایجاد دوباره)، tombstone
 */
import { PrismaClient } from '@prisma/client'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const dir = mkdtempSync(join(tmpdir(), 'sync-test-'))
const serverDb = new PrismaClient({ datasources: { db: { url: `file:${dir}/server.db` } } })
const deviceDb = new PrismaClient({ datasources: { db: { url: `file:${dir}/device.db` } } })

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ` — ${extra}` : ''}`)
  } else {
    fail++
    console.error(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

async function setupSchema(client: PrismaClient) {
  // همان DDLی که db push می‌سازد — ساده‌شده برای تست
  const stmts = [
    `CREATE TABLE IF NOT EXISTS "User" ("id" TEXT PRIMARY KEY NOT NULL, "username" TEXT NOT NULL UNIQUE, "password" TEXT NOT NULL, "fullName" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'viewer', "department" TEXT NOT NULL DEFAULT 'general', "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "ProductCategory" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL UNIQUE, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "Product" ("id" TEXT PRIMARY KEY NOT NULL, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "categoryId" TEXT, "unit" TEXT NOT NULL DEFAULT 'عدد', "barcode" TEXT, "description" TEXT, "costPrice" DOUBLE NOT NULL DEFAULT 0, "salePrice" DOUBLE NOT NULL DEFAULT 0, "wholesalePrice" DOUBLE NOT NULL DEFAULT 0, "minStock" DOUBLE NOT NULL DEFAULT 0, "stock" DOUBLE NOT NULL DEFAULT 0, "imageUrl" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "Supplier" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "address" TEXT, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "RawMaterial" ("id" TEXT PRIMARY KEY NOT NULL, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL, "unit" TEXT NOT NULL DEFAULT 'کیلوگرام', "purchasePrice" DOUBLE NOT NULL DEFAULT 0, "stock" DOUBLE NOT NULL DEFAULT 0, "minStock" DOUBLE NOT NULL DEFAULT 0, "maxStock" DOUBLE NOT NULL DEFAULT 0, "expiryDate" DATETIME, "supplierId" TEXT, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "RawMaterial_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "Formula" ("id" TEXT PRIMARY KEY NOT NULL, "productId" TEXT NOT NULL, "name" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "outputQty" DOUBLE NOT NULL DEFAULT 1, "laborCost" DOUBLE NOT NULL DEFAULT 0, "overheadCost" DOUBLE NOT NULL DEFAULT 0, "notes" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Formula_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "FormulaItem" ("id" TEXT PRIMARY KEY NOT NULL, "formulaId" TEXT NOT NULL, "rawMaterialId" TEXT NOT NULL, "quantity" DOUBLE NOT NULL, "percentage" DOUBLE, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "FormulaItem_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "FormulaItem_rawMaterialId_fkey" FOREIGN KEY ("rawMaterialId") REFERENCES "RawMaterial" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "ProductionOrder" ("id" TEXT PRIMARY KEY NOT NULL, "orderNumber" TEXT NOT NULL UNIQUE, "formulaId" TEXT NOT NULL, "productId" TEXT NOT NULL, "quantity" DOUBLE NOT NULL, "producedQty" DOUBLE NOT NULL DEFAULT 0, "wasteQty" DOUBLE NOT NULL DEFAULT 0, "status" TEXT NOT NULL DEFAULT 'pending', "qcStatus" TEXT, "qcNotes" TEXT, "materialCost" DOUBLE NOT NULL DEFAULT 0, "laborCost" DOUBLE NOT NULL DEFAULT 0, "overheadCost" DOUBLE NOT NULL DEFAULT 0, "totalCost" DOUBLE NOT NULL DEFAULT 0, "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "endDate" DATETIME, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "ProductionOrder_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "Formula" ("id") ON DELETE RESTRICT ON UPDATE CASCADE, CONSTRAINT "ProductionOrder_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "Customer" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "address" TEXT, "type" TEXT NOT NULL DEFAULT 'retail', "balance" DOUBLE NOT NULL DEFAULT 0, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "Sale" ("id" TEXT PRIMARY KEY NOT NULL, "invoiceNumber" TEXT NOT NULL UNIQUE, "customerId" TEXT, "customerName" TEXT, "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "currency" TEXT NOT NULL DEFAULT 'AFN', "exchangeRate" DOUBLE NOT NULL DEFAULT 1, "subtotal" DOUBLE NOT NULL DEFAULT 0, "discount" DOUBLE NOT NULL DEFAULT 0, "taxRate" DOUBLE NOT NULL DEFAULT 0, "taxAmount" DOUBLE NOT NULL DEFAULT 0, "total" DOUBLE NOT NULL DEFAULT 0, "paidAmount" DOUBLE NOT NULL DEFAULT 0, "paymentMethod" TEXT NOT NULL DEFAULT 'cash', "status" TEXT NOT NULL DEFAULT 'paid', "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "SaleItem" ("id" TEXT PRIMARY KEY NOT NULL, "saleId" TEXT NOT NULL, "productId" TEXT NOT NULL, "quantity" DOUBLE NOT NULL, "unitPrice" DOUBLE NOT NULL, "discount" DOUBLE NOT NULL DEFAULT 0, "total" DOUBLE NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "Warehouse" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "location" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "InventoryTransaction" ("id" TEXT PRIMARY KEY NOT NULL, "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "type" TEXT NOT NULL, "itemType" TEXT NOT NULL, "itemId" TEXT NOT NULL, "itemName" TEXT NOT NULL, "unit" TEXT NOT NULL, "quantity" DOUBLE NOT NULL, "warehouseId" TEXT, "reference" TEXT, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "Expense" ("id" TEXT PRIMARY KEY NOT NULL, "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "category" TEXT NOT NULL DEFAULT 'عمومی', "description" TEXT NOT NULL, "amount" DOUBLE NOT NULL, "currency" TEXT NOT NULL DEFAULT 'AFN', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "Employee" ("id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "position" TEXT NOT NULL, "phone" TEXT, "salary" DOUBLE NOT NULL DEFAULT 0, "hireDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "active" BOOLEAN NOT NULL DEFAULT true, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "Attendance" ("id" TEXT PRIMARY KEY NOT NULL, "employeeId" TEXT NOT NULL, "date" DATETIME NOT NULL, "status" TEXT NOT NULL DEFAULT 'present', "shift" TEXT, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "SalaryPayment" ("id" TEXT PRIMARY KEY NOT NULL, "employeeId" TEXT NOT NULL, "month" TEXT NOT NULL, "amount" DOUBLE NOT NULL, "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "notes" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "SalaryPayment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "AuditLog" ("id" TEXT PRIMARY KEY NOT NULL, "userId" TEXT, "userName" TEXT, "action" TEXT NOT NULL, "entity" TEXT NOT NULL, "entityId" TEXT, "details" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS "Setting" ("key" TEXT PRIMARY KEY NOT NULL, "value" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
  ]
  for (const s of stmts) await client.$executeRawUnsafe(s)
}


/**
 * شبیه‌سازی حذف از مسیر db proxy — همان کاری که wrapDelegateForJournal می‌کند:
 * حذف + ثبت ژورنال (_SyncJournal) بعد از موفقیت.
 */
async function journaledDelete(client: PrismaClient, delegate: string, where: Record<string, unknown>) {
  const res = await (client as unknown as Record<string, { deleteMany: (a: { where: unknown }) => Promise<{ count: number }> }>)[delegate].deleteMany({ where })
  await client.$executeRawUnsafe(
    `INSERT INTO _SyncJournal (ts, tbl, where_json) VALUES (?, ?, ?)`,
    new Date().toISOString(),
    delegate,
    JSON.stringify(where)
  )
  return res
}


async function probeP1(label: string) {
  const sp = await serverDb.product.findUnique({ where: { id: 'p1' } })
  const lp = await deviceDb.product.findUnique({ where: { id: 'p1' } })
  const fmt = (d: unknown) => (d instanceof Date ? d.toISOString().slice(17, 23) : String(d))
  console.log(`PROBE ${label}: server=${fmt(sp?.updatedAt)} stock=${sp?.stock} | local=${fmt(lp?.updatedAt)} stock=${lp?.stock} | now=${new Date().toISOString().slice(17, 23)}`)
}

async function main() {
  await setupSchema(serverDb)
  await setupSchema(deviceDb)

  const pair = { server: serverDb as never, local: deviceDb as never }
  const syncEngine = await import('../src/lib/sync-engine')

  console.log('\n━━ سناریو ۰: راه‌اندازی — کاربر و محصولات اولیه روی سرور')
  await serverDb.user.create({ data: { id: 'u1', username: 'admin', password: 'x', fullName: 'مدیر', role: 'admin', updatedAt: new Date() } })
  const cat = await serverDb.productCategory.create({ data: { id: 'c1', name: 'لبنیات', updatedAt: new Date() } })
  await serverDb.product.create({ data: { id: 'p1', code: 'P-001', name: 'ماست', categoryId: cat.id, stock: 10, updatedAt: new Date() } })
  await serverDb.rawMaterial.create({ data: { id: 'rm1', code: 'RM-001', name: 'شیر', stock: 100, purchasePrice: 30, updatedAt: new Date() } })

  console.log('\n━━ سناریو ۱: دستگاه جدید — اولین sync همهٔ سرور را می‌آورد (pull کامل)')
  let t = await syncEngine.syncTick(pair)
  check('pull اولیه انجام شد', t.ok && t.pulled >= 3, `pulled=${t.pulled}`)
  const localUser = await deviceDb.user.findUnique({ where: { username: 'admin' } })
  check('کاربر سرور روی دستگاه آمد', !!localUser)
  const localProduct = await deviceDb.product.findUnique({ where: { code: 'P-001' } })
  check('محصول سرور روی دستگاه آمد', !!localProduct)

  console.log('\n━━ سناریو ۲: تغییر محلی → تیک → روی سرور (بند ۱)')
  await deviceDb.customer.create({ data: { id: 'cu1', name: 'مشتری احمدی', phone: '07xx', updatedAt: new Date() } })
  await deviceDb.expense.create({ data: { id: 'e1', description: 'کرایهٔ دفتر', amount: 5000, updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  check('push انجام شد', t.pushed >= 2, `pushed=${t.pushed}`)
  const serverCustomer = await serverDb.customer.findUnique({ where: { id: 'cu1' } })
  const serverExpense = await serverDb.expense.findUnique({ where: { id: 'e1' } })
  check('مشتری روی سرور ثبت شد', !!serverCustomer)
  check('هزینه روی سرور ثبت شد', !!serverExpense)

  console.log('\n━━ سناریو ۳: ویرایش محلی → تیک → سرور به‌روز شد')
  await deviceDb.customer.update({ where: { id: 'cu1' }, data: { name: 'احمدی و شرکا', updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  const renamed = await serverDb.customer.findUnique({ where: { id: 'cu1' } })
  check('ویرایش به سرور رسید', renamed?.name === 'احمدی و شرکا', `pushed=${t.pushed}`)

  console.log('\n━━ سناریو ۴: تغییر سرور → تیک → روی دستگاه (بند ۲)')
  await serverDb.product.update({ where: { id: 'p1' }, data: { stock: 44, updatedAt: new Date() } })
  await serverDb.warehouse.create({ data: { id: 'w1', name: 'گدام مرکزی', updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  const deviceProduct = await deviceDb.product.findUnique({ where: { id: 'p1' } })
  const deviceWarehouse = await deviceDb.warehouse.findUnique({ where: { id: 'w1' } })
  check('موجودی جدید سرور روی دستگاه آمد', deviceProduct?.stock === 44, `pulled=${t.pulled}`)
  check('گدام جدید سرور روی دستگاه آمد', !!deviceWarehouse)
  await probeP1('after-sc4')

  console.log('\n━━ سناریو ۵: حذف محلی → ژورنال → تیک → سرور حذف + سنگ‌قبر (بند ۱-حذف)')
  await journaledDelete(deviceDb, 'expense', { id: 'e1' })
  t = await syncTickQuiet(syncEngine, pair)
  const serverGone = await serverDb.expense.findUnique({ where: { id: 'e1' } })
  check('حذف روی سرور اعمال شد', !serverGone, `deleted=${t.deleted}`)
  const tombs = await serverDb.$queryRawUnsafe<Array<{ n: number }>>(`SELECT COUNT(*) AS n FROM _SyncTombstones`)
  check('سنگ‌قبر روی سرور ثبت شد', Number(tombs[0].n) >= 1, `count=${tombs[0].n}`)

  console.log('\n━━ سناریو ۶: حذف سمت سرور (دستگاه دیگر) → سنگ‌قبر → دستگاه محلی حذف می‌شود')
  // شبیه‌سازی دستگاه B: حذف مشتری روی سرور + سنگ‌قبر
  await serverDb.customer.delete({ where: { id: 'cu1' } })
  await serverDb.$executeRawUnsafe(`INSERT INTO _SyncTombstones (id, tbl, recordId, deletedAt) VALUES (?, ?, ?, ?)`, 'tb1', 'Customer', 'cu1', new Date())
  t = await syncTickQuiet(syncEngine, pair)
  const deviceGone = await deviceDb.customer.findUnique({ where: { id: 'cu1' } })
  check('حذف دستگاه دیگر روی این دستگاه اعمال شد', !deviceGone, `deleted=${t.deleted}`)

  console.log('\n━━ سناریو ۷: LWW — نسخهٔ جدیدتر برنده است')
  const old = new Date(Date.now() - 60000)
  const now = new Date()
  // محلی قدیمی، سرور جدید
  await deviceDb.product.update({ where: { id: 'p1' }, data: { name: 'نسخهٔ قدیمی محلی', updatedAt: old } })
  await new Promise((r) => setTimeout(r, 15))
  await serverDb.product.update({ where: { id: 'p1' }, data: { name: 'نسخهٔ جدید سرور', updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  const lww1 = await deviceDb.product.findUnique({ where: { id: 'p1' } })
  check('سرور جدیدتر → محلی از سرور پیروی کرد', lww1?.name === 'نسخهٔ جدید سرور')
  // محلی جدید، سرور قدیمی
  await deviceDb.product.update({ where: { id: 'p1' }, data: { name: 'نسخهٔ جدید محلی', updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  const lww2 = await serverDb.product.findUnique({ where: { id: 'p1' } })
  await probeP1('after-sc7')
  check('محلی جدیدتر → سرور از محلی پیروی کرد', lww2?.name === 'نسخهٔ جدید محلی', `pushed=${t.pushed}`)

  console.log('\n━━ سناریو ۸: فرمول + آیتم‌ها — حذف/ایجاد دوبارهٔ آیتم‌ها در ویرایش (فرزند)')
  await deviceDb.formula.create({
    data: {
      id: 'f1', productId: 'p1', name: 'فرمول ماست', outputQty: 10,
      updatedAt: new Date(),
      items: { create: [{ id: 'fi1', rawMaterialId: 'rm1', quantity: 5, updatedAt: new Date() }] },
    },
  })
  t = await syncTickQuiet(syncEngine, pair)
  let serverItems = await serverDb.formulaItem.findMany({ where: { formulaId: 'f1' } })
  check('فرمول و آیتم به سرور رسید', serverItems.length === 1, `pushed=${t.pushed}`)

  // ویرایش فرمول: حذف آیتم قدیمی + آیتم جدید (همان الگوی PUT فرمول)
  await journaledDelete(deviceDb, 'formulaItem', { id: 'fi1' })
  await deviceDb.formulaItem.create({ data: { id: 'fi2', formulaId: 'f1', rawMaterialId: 'rm1', quantity: 7, updatedAt: new Date() } })
  await deviceDb.formula.update({ where: { id: 'f1' }, data: { name: 'فرمول ماست ۲', updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  serverItems = await serverDb.formulaItem.findMany({ where: { formulaId: 'f1' } })
  check('آیتم‌های سرور بعد از ویرایش درست است (۱ آیتم جدید)', serverItems.length === 1 && serverItems[0].id === 'fi2', `pushed=${t.pushed}`)

  console.log('\n━━ سناریو ۹: حذف/ایجاد آیتم سمت سرور → مطابق‌سازی دامنهٔ والد روی دستگاه')
  await serverDb.formulaItem.deleteMany({ where: { formulaId: 'f1' } })
  await serverDb.formulaItem.create({ data: { id: 'fi3', formulaId: 'f1', rawMaterialId: 'rm1', quantity: 9, updatedAt: new Date() } })
  await serverDb.formula.update({ where: { id: 'f1' }, data: { name: 'فرمول از سرور', updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  const deviceItems = await deviceDb.formulaItem.findMany({ where: { formulaId: 'f1' } })
  check('آیتم یتیم محلی حذف و آیتم سرور آمد', deviceItems.length === 1 && deviceItems[0].id === 'fi3', `pulled=${t.pulled}`)

  console.log('\n━━ سناریو ۱۰: قطعی — تغییرها صف می‌شوند، آب یا آتش نمی‌گیرند (بند ۴)')
  await probeP1('before-sc10-wait')
  await new Promise((r) => setTimeout(r, 40))
  await probeP1('after-sc10-wait')
  // هیچ تیکی زده نمی‌شود (شبیه‌سازی قطعی) — کاربر کار می‌کند
  await deviceDb.customer.create({ data: { id: 'cu2', name: 'مشتری آفلاین', updatedAt: new Date() } })
  await deviceDb.product.update({ where: { id: 'p1' }, data: { stock: 99, updatedAt: new Date() } })
  await deviceDb.sale.create({
    data: {
      id: 's1', invoiceNumber: 'INV-1', total: 500, paidAmount: 500, updatedAt: new Date(),
      items: { create: [{ id: 'si1', productId: 'p1', quantity: 2, unitPrice: 250, total: 500, updatedAt: new Date() }] },
    },
  })
  await journaledDelete(deviceDb, 'sale', { id: 's1' }) // حذف آفلاین → ژورنال
  const pending = await syncEngine.pendingPushCount(pair)
  check('تغییرهای آفلاین در صف شمرده می‌شوند', pending >= 3, `pending=${pending}`)

  console.log('\n━━ سناریو ۱۱: برگشت اتصال — runReconnectSync همه را می‌فرستد + اسنپ‌شات')
  // در همین فاصله سرور هم تغییر کرده (دستگاه دیگر فروش زده)
  await serverDb.sale.create({
    data: {
      id: 's2', invoiceNumber: 'INV-2', total: 800, paidAmount: 0, status: 'unpaid', updatedAt: new Date(),
      items: { create: [{ id: 'si2', productId: 'p1', quantity: 1, unitPrice: 800, total: 800, updatedAt: new Date() }] },
    },
  })
  const wmRaw = await syncEngine.getMeta(pair, 'sync.pushWm')
  const wmObj = JSON.parse(wmRaw ?? '{}') as Record<string, string>
  const lp = await deviceDb.product.findUnique({ where: { id: 'p1' } })
  const sp = await serverDb.product.findUnique({ where: { id: 'p1' } })
  console.log('DEBUG pushWm.Product =', wmObj.Product)
  console.log('DEBUG local  p1.updatedAt =', lp?.updatedAt instanceof Date ? lp.updatedAt.toISOString() : String(lp?.updatedAt), 'stock=', lp?.stock)
  console.log('DEBUG server p1.updatedAt =', sp?.updatedAt instanceof Date ? sp.updatedAt.toISOString() : String(sp?.updatedAt), 'stock=', sp?.stock)
  const summary = await syncEngine.runReconnectSync(pair, null)
  const serverCu2 = await serverDb.customer.findUnique({ where: { id: 'cu2' } })
  const serverStock = await serverDb.product.findUnique({ where: { id: 'p1' } })
  const deviceSale2 = await deviceDb.sale.findUnique({ where: { id: 's2' } })
  const deviceItemsAfter = await deviceDb.saleItem.findMany({ where: { saleId: 's2' } })
  check('مشتری آفلاین به سرور رسید', !!serverCu2)
  check('موجودی ۹۹ آفلاین به سرور رسید', serverStock?.stock === 99)
  check('فروش دستگاه دیگر به این دستگاه آمد', !!deviceSale2)
  check('آیتم‌های فروش سرور هم آمدند', deviceItemsAfter.length === 1)
  check('اسنپ‌شات کامل اجرا شد', summary.snapshotRows > 0, JSON.stringify({ pushed: summary.pushed, journal: summary.journalReplayed, rows: summary.snapshotRows }))

  console.log('\n━━ سناریو ۱۲: تیک بی‌کار — دلتای صفر و سرعت بالا (بند ۳ و ۵)')
  const t0 = Date.now()
  t = await syncTickQuiet(syncEngine, pair)
  const ms1 = Date.now() - t0
  check('تیک بی‌کار چیزی نمی‌فرستد', t.pushed === 0 && t.pulled === 0, `pushed=${t.pushed} pulled=${t.pulled}`)
  check('تیک بی‌کار سریع است (< ۲۰۰ms)', ms1 < 200, `${ms1}ms`)
  const t1 = Date.now()
  await syncTickQuiet(syncEngine, pair)
  const ms2 = Date.now() - t1
  check('تیک دوم هم سریع است', ms2 < 200, `${ms2}ms`)

  console.log('\n━━ سناریو ۱۳: سرعت همگام‌سازی دسته‌ای — ۲۰۰ سطر جدید در یک تیک')
  const many: { id: string; name: string; phone: string; updatedAt: Date }[] = []
  for (let i = 0; i < 200; i++) {
    many.push({ id: `bulk-${i}`, name: `مشتری ${i}`, phone: `07${i}`, updatedAt: new Date() })
  }
  await deviceDb.customer.createMany({ data: many })
  const t3 = Date.now()
  t = await syncTickQuiet(syncEngine, pair)
  const ms3 = Date.now() - t3
  const serverBulk = await serverDb.customer.count({ where: { id: { startsWith: 'bulk-' } } })
  check('هر ۲۰۰ سطر به سرور رسید', serverBulk === 200, `count=${serverBulk}`)
  check('دستهٔ ۲۰۰ سطری زیر ۵ ثانیه', ms3 < 5000, `${ms3}ms, pushed=${t.pushed}`)

  console.log('\n━━ سناریو ۱۴: Setting — همگام می‌شود ولی کلیدهای sync.* هرگز')
  await deviceDb.setting.create({ data: { key: 'company.name', value: 'کارخانهٔ نمونه', updatedAt: new Date() } })
  t = await syncTickQuiet(syncEngine, pair)
  const serverSetting = await serverDb.setting.findUnique({ where: { key: 'company.name' } })
  check('تنظیمات به سرور رسید', !!serverSetting)
  const serverSyncKeys = await serverDb.setting.count({ where: { key: { startsWith: 'sync.' } } })
  check('کلیدهای sync.* به سرور نرفتند', serverSyncKeys === 0, `count=${serverSyncKeys}`)

  console.log('\n━━ سناریو ۱۵: اسنپ‌شات — کلیدهای sync.* محلی حفظ می‌شوند')
  await snapshotQuiet(syncEngine, pair)
  const wm = await deviceDb.setting.findUnique({ where: { key: 'sync.pushWm' } })
  check('نشان‌های sync.* بعد از اسنپ‌شات حفظ شدند', !!wm)
  const companyAfter = await deviceDb.setting.findUnique({ where: { key: 'company.name' } })
  check('تنظیمات سرور بعد از اسنپ‌شات هست', !!companyAfter)

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`نتیجه: ${pass} پاس / ${fail} خطا`)
  if (fail > 0) process.exit(1)
}

async function syncTickQuiet(engine: typeof import('../src/lib/sync-engine'), pair: never) {
  return engine.syncTick(pair)
}
async function snapshotQuiet(engine: typeof import('../src/lib/sync-engine'), pair: never) {
  return engine.snapshotServerToLocal(pair)
}

main()
  .catch((e) => {
    console.error('FATAL:', e)
    process.exit(1)
  })
  .finally(async () => {
    await serverDb.$disconnect()
    await deviceDb.$disconnect()
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })
