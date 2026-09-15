// اطمینان از وجود جدول‌ها و ایندکس‌ها در دیتابیس محلی (SQLite)
// در نسخهٔ دسکتاپ اگر فایل db محلی از نو ساخته شود (نصب اولیه)، برنامه
// بدون «prisma db push» هم باید بالا بیاید — این ماژول جدول‌های غایب را
// با CREATE TABLE IF NOT EXISTS می‌سازد و ستون‌های غایب را ALTER می‌کند.
import { dbInternal } from '@/lib/db'

const D_EPOCH = '1970-01-01 00:00:00 +00:00'

interface TableSpec {
  name: string
  ddl: string
  columns: { name: string; ddl: string }[]
  indexes?: string[]
}

const SPECS: TableSpec[] = [
  {
    name: 'User',
    ddl: `CREATE TABLE IF NOT EXISTS "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "username" TEXT NOT NULL,
      "password" TEXT NOT NULL,
      "fullName" TEXT NOT NULL,
      "role" TEXT NOT NULL DEFAULT 'viewer',
      "department" TEXT NOT NULL DEFAULT 'general',
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [],
  },
  {
    name: 'AuditLog',
    ddl: `CREATE TABLE IF NOT EXISTS "AuditLog" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT,
      "userName" TEXT,
      "action" TEXT NOT NULL,
      "entity" TEXT NOT NULL,
      "entityId" TEXT,
      "details" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE INDEX IF NOT EXISTS "AuditLog_updatedAt_idx" ON "AuditLog"("updatedAt")'],
  },
  {
    name: 'ProductCategory',
    ddl: `CREATE TABLE IF NOT EXISTS "ProductCategory" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [
      'CREATE UNIQUE INDEX IF NOT EXISTS "ProductCategory_name_key" ON "ProductCategory"("name")',
      'CREATE INDEX IF NOT EXISTS "ProductCategory_updatedAt_idx" ON "ProductCategory"("updatedAt")',
    ],
  },
  {
    name: 'Product',
    ddl: `CREATE TABLE IF NOT EXISTS "Product" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "categoryId" TEXT,
      "unit" TEXT NOT NULL DEFAULT 'عدد',
      "barcode" TEXT,
      "description" TEXT,
      "costPrice" REAL NOT NULL DEFAULT 0,
      "salePrice" REAL NOT NULL DEFAULT 0,
      "wholesalePrice" REAL NOT NULL DEFAULT 0,
      "minStock" REAL NOT NULL DEFAULT 0,
      "stock" REAL NOT NULL DEFAULT 0,
      "imageUrl" TEXT,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [
      'CREATE UNIQUE INDEX IF NOT EXISTS "Product_code_key" ON "Product"("code")',
      'CREATE INDEX IF NOT EXISTS "Product_updatedAt_idx" ON "Product"("updatedAt")',
    ],
  },
  {
    name: 'Supplier',
    ddl: `CREATE TABLE IF NOT EXISTS "Supplier" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "phone" TEXT,
      "address" TEXT,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE INDEX IF NOT EXISTS "Supplier_updatedAt_idx" ON "Supplier"("updatedAt")'],
  },
  {
    name: 'RawMaterial',
    ddl: `CREATE TABLE IF NOT EXISTS "RawMaterial" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "unit" TEXT NOT NULL DEFAULT 'کیلوگرام',
      "purchasePrice" REAL NOT NULL DEFAULT 0,
      "stock" REAL NOT NULL DEFAULT 0,
      "minStock" REAL NOT NULL DEFAULT 0,
      "maxStock" REAL NOT NULL DEFAULT 0,
      "expiryDate" DATETIME,
      "supplierId" TEXT,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE UNIQUE INDEX IF NOT EXISTS "RawMaterial_code_key" ON "RawMaterial"("code")'],
  },
  {
    name: 'Formula',
    ddl: `CREATE TABLE IF NOT EXISTS "Formula" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "productId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "version" INTEGER NOT NULL DEFAULT 1,
      "outputQty" REAL NOT NULL DEFAULT 1,
      "laborCost" REAL NOT NULL DEFAULT 0,
      "overheadCost" REAL NOT NULL DEFAULT 0,
      "notes" TEXT,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [],
  },
  {
    name: 'FormulaItem',
    ddl: `CREATE TABLE IF NOT EXISTS "FormulaItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "formulaId" TEXT NOT NULL,
      "rawMaterialId" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "percentage" REAL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [
      'CREATE INDEX IF NOT EXISTS "FormulaItem_formulaId_idx" ON "FormulaItem"("formulaId")',
      'CREATE INDEX IF NOT EXISTS "FormulaItem_updatedAt_idx" ON "FormulaItem"("updatedAt")',
    ],
  },
  {
    name: 'ProductionOrder',
    ddl: `CREATE TABLE IF NOT EXISTS "ProductionOrder" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "orderNumber" TEXT NOT NULL,
      "formulaId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "producedQty" REAL NOT NULL DEFAULT 0,
      "wasteQty" REAL NOT NULL DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "qcStatus" TEXT,
      "qcNotes" TEXT,
      "materialCost" REAL NOT NULL DEFAULT 0,
      "laborCost" REAL NOT NULL DEFAULT 0,
      "overheadCost" REAL NOT NULL DEFAULT 0,
      "totalCost" REAL NOT NULL DEFAULT 0,
      "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endDate" DATETIME,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [
      'CREATE UNIQUE INDEX IF NOT EXISTS "ProductionOrder_orderNumber_key" ON "ProductionOrder"("orderNumber")',
      'CREATE INDEX IF NOT EXISTS "ProductionOrder_updatedAt_idx" ON "ProductionOrder"("updatedAt")',
    ],
  },
  {
    name: 'Customer',
    ddl: `CREATE TABLE IF NOT EXISTS "Customer" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "phone" TEXT,
      "address" TEXT,
      "type" TEXT NOT NULL DEFAULT 'retail',
      "balance" REAL NOT NULL DEFAULT 0,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [],
  },
  {
    name: 'Sale',
    ddl: `CREATE TABLE IF NOT EXISTS "Sale" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "invoiceNumber" TEXT NOT NULL,
      "customerId" TEXT,
      "customerName" TEXT,
      "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "currency" TEXT NOT NULL DEFAULT 'AFN',
      "exchangeRate" REAL NOT NULL DEFAULT 1,
      "subtotal" REAL NOT NULL DEFAULT 0,
      "discount" REAL NOT NULL DEFAULT 0,
      "taxRate" REAL NOT NULL DEFAULT 0,
      "taxAmount" REAL NOT NULL DEFAULT 0,
      "total" REAL NOT NULL DEFAULT 0,
      "paidAmount" REAL NOT NULL DEFAULT 0,
      "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
      "status" TEXT NOT NULL DEFAULT 'paid',
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE UNIQUE INDEX IF NOT EXISTS "Sale_invoiceNumber_key" ON "Sale"("invoiceNumber")'],
  },
  {
    name: 'SaleItem',
    ddl: `CREATE TABLE IF NOT EXISTS "SaleItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "saleId" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "unitPrice" REAL NOT NULL,
      "discount" REAL NOT NULL DEFAULT 0,
      "total" REAL NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [
      'CREATE INDEX IF NOT EXISTS "SaleItem_saleId_idx" ON "SaleItem"("saleId")',
      'CREATE INDEX IF NOT EXISTS "SaleItem_updatedAt_idx" ON "SaleItem"("updatedAt")',
    ],
  },
  {
    name: 'Warehouse',
    ddl: `CREATE TABLE IF NOT EXISTS "Warehouse" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "location" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE INDEX IF NOT EXISTS "Warehouse_updatedAt_idx" ON "Warehouse"("updatedAt")'],
  },
  {
    name: 'InventoryTransaction',
    ddl: `CREATE TABLE IF NOT EXISTS "InventoryTransaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "type" TEXT NOT NULL,
      "itemType" TEXT NOT NULL,
      "itemId" TEXT NOT NULL,
      "itemName" TEXT NOT NULL,
      "unit" TEXT NOT NULL,
      "quantity" REAL NOT NULL,
      "warehouseId" TEXT,
      "reference" TEXT,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE INDEX IF NOT EXISTS "InventoryTransaction_updatedAt_idx" ON "InventoryTransaction"("updatedAt")'],
  },
  {
    name: 'Expense',
    ddl: `CREATE TABLE IF NOT EXISTS "Expense" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "category" TEXT NOT NULL DEFAULT 'عمومی',
      "description" TEXT NOT NULL,
      "amount" REAL NOT NULL,
      "currency" TEXT NOT NULL DEFAULT 'AFN',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE INDEX IF NOT EXISTS "Expense_updatedAt_idx" ON "Expense"("updatedAt")'],
  },
  {
    name: 'Employee',
    ddl: `CREATE TABLE IF NOT EXISTS "Employee" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "position" TEXT NOT NULL,
      "phone" TEXT,
      "salary" REAL NOT NULL DEFAULT 0,
      "hireDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [],
  },
  {
    name: 'Attendance',
    ddl: `CREATE TABLE IF NOT EXISTS "Attendance" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "date" DATETIME NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'present',
      "shift" TEXT,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: ['CREATE INDEX IF NOT EXISTS "Attendance_updatedAt_idx" ON "Attendance"("updatedAt")'],
  },
  {
    name: 'SalaryPayment',
    ddl: `CREATE TABLE IF NOT EXISTS "SalaryPayment" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "employeeId" TEXT NOT NULL,
      "month" TEXT NOT NULL,
      "amount" REAL NOT NULL,
      "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "notes" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [],
  },
  {
    name: 'Setting',
    ddl: `CREATE TABLE IF NOT EXISTS "Setting" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "value" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    columns: [],
    indexes: [],
  },
]

let ran: Promise<void> | null = null

async function run(): Promise<void> {
  const { sqlite } = dbInternal.getClients()
  if (!sqlite) return
  for (const spec of SPECS) {
    try {
      await sqlite.$executeRawUnsafe(spec.ddl)
      // ستون‌های غایب در جدول‌های قدیمی — با مقدار پیش‌فرض ثابت
      for (const col of spec.columns) {
        try {
          await sqlite.$executeRawUnsafe(`ALTER TABLE "${spec.name}" ADD COLUMN ${col.ddl}`)
        } catch {
          /* ستون از قبل هست */
        }
      }
      for (const idx of spec.indexes ?? []) {
        await sqlite.$executeRawUnsafe(idx)
      }
    } catch (e) {
      console.error(`[local-schema] failed on ${spec.name}:`, e)
    }
  }
  console.log(`[local-schema] OK — ${SPECS.length} tables ensured`)
}

/** یک‌بار در هر پروسه اجرا می‌شود؛ خطاها برنامه را نمی‌شکنند */
export function ensureLocalSchema(): Promise<void> {
  if (!ran) {
    ran = run().catch((e) => {
      console.error('[local-schema] ensure failed:', e)
      ran = null
    })
  }
  return ran
}
