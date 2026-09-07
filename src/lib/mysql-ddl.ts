/*
 * DDL جداول MySQL — دقیقاً منطبق بر prisma/schema.mysql.prisma
 *
 * هدف: ساخت خودکار ۱۹ جدول روی هاست اشتراکی (Namecheap/cPanel) بدون
 * نیاز به phpMyAdmin یا خط فرمان — از داخل برنامه (ویزارد راه‌اندازی
 * اولیه یا کارت «راه‌اندازی هاست» در تنظیمات).
 *
 * نکته‌ها:
 * - همه با CREATE TABLE IF NOT EXISTS — اجرای تکراری امن است
 * - نام‌ها/ستون‌ها/ایندکس‌ها/کلیدهای خارجی مطابق قرارداد Prisma هستند
 *   تا اگر روزی «prisma db push» روی همان هاست اجرا شود تفاوتی حس نشود
 * - ترتیب: والدین اول (برای FK)
 */

export interface DdlTable {
  name: string
  sql: string
}

const CHARSET = 'DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'

function fk(
  table: string,
  column: string,
  refTable: string,
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT'
): string {
  const name = `${table}_${column}_fkey`
  return (
    `CONSTRAINT \`${name}\` FOREIGN KEY (\`${column}\`) REFERENCES \`${refTable}\`(\`id\`) ` +
    `ON DELETE ${onDelete} ON UPDATE CASCADE`
  )
}

export const MYSQL_TABLES: DdlTable[] = [
  {
    name: 'User',
    sql:
      `CREATE TABLE IF NOT EXISTS \`User\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`username\` VARCHAR(191) NOT NULL,\n` +
      `  \`password\` VARCHAR(191) NOT NULL,\n` +
      `  \`fullName\` VARCHAR(191) NOT NULL,\n` +
      `  \`role\` VARCHAR(191) NOT NULL DEFAULT 'viewer',\n` +
      `  \`department\` VARCHAR(191) NOT NULL DEFAULT 'general',\n` +
      `  \`active\` BOOLEAN NOT NULL DEFAULT true,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  UNIQUE INDEX \`User_username_key\`(\`username\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'AuditLog',
    sql:
      `CREATE TABLE IF NOT EXISTS \`AuditLog\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`userId\` VARCHAR(191) NULL,\n` +
      `  \`userName\` VARCHAR(191) NULL,\n` +
      `  \`action\` VARCHAR(191) NOT NULL,\n` +
      `  \`entity\` VARCHAR(191) NOT NULL,\n` +
      `  \`entityId\` VARCHAR(191) NULL,\n` +
      `  \`details\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`AuditLog_createdAt_idx\`(\`createdAt\`),\n` +
      `  INDEX \`AuditLog_action_idx\`(\`action\`),\n` +
      `  INDEX \`AuditLog_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'ProductCategory',
    sql:
      `CREATE TABLE IF NOT EXISTS \`ProductCategory\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  UNIQUE INDEX \`ProductCategory_name_key\`(\`name\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Product',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Product\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`code\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`categoryId\` VARCHAR(191) NULL,\n` +
      `  \`unit\` VARCHAR(191) NOT NULL DEFAULT 'عدد',\n` +
      `  \`barcode\` VARCHAR(191) NULL,\n` +
      `  \`description\` TEXT NULL,\n` +
      `  \`costPrice\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`salePrice\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`wholesalePrice\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`minStock\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`stock\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`imageUrl\` LONGTEXT NULL,\n` +
      `  \`active\` BOOLEAN NOT NULL DEFAULT true,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  UNIQUE INDEX \`Product_code_key\`(\`code\`),\n` +
      `  INDEX \`Product_categoryId_idx\`(\`categoryId\`),\n` +
      `  INDEX \`Product_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('Product', 'categoryId', 'ProductCategory', 'SET NULL')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Supplier',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Supplier\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`phone\` VARCHAR(191) NULL,\n` +
      `  \`address\` TEXT NULL,\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`Supplier_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'RawMaterial',
    sql:
      `CREATE TABLE IF NOT EXISTS \`RawMaterial\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`code\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`unit\` VARCHAR(191) NOT NULL DEFAULT 'کیلوگرام',\n` +
      `  \`purchasePrice\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`stock\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`minStock\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`maxStock\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`expiryDate\` DATETIME(3) NULL,\n` +
      `  \`supplierId\` VARCHAR(191) NULL,\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  UNIQUE INDEX \`RawMaterial_code_key\`(\`code\`),\n` +
      `  INDEX \`RawMaterial_supplierId_idx\`(\`supplierId\`),\n` +
      `  INDEX \`RawMaterial_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('RawMaterial', 'supplierId', 'Supplier', 'SET NULL')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Formula',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Formula\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`productId\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`version\` INTEGER NOT NULL DEFAULT 1,\n` +
      `  \`outputQty\` DOUBLE NOT NULL DEFAULT 1,\n` +
      `  \`laborCost\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`overheadCost\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`isActive\` BOOLEAN NOT NULL DEFAULT true,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  INDEX \`Formula_productId_idx\`(\`productId\`),\n` +
      `  INDEX \`Formula_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('Formula', 'productId', 'Product', 'RESTRICT')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'FormulaItem',
    sql:
      `CREATE TABLE IF NOT EXISTS \`FormulaItem\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`formulaId\` VARCHAR(191) NOT NULL,\n` +
      `  \`rawMaterialId\` VARCHAR(191) NOT NULL,\n` +
      `  \`quantity\` DOUBLE NOT NULL,\n` +
      `  \`percentage\` DOUBLE NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`FormulaItem_formulaId_idx\`(\`formulaId\`),\n` +
      `  INDEX \`FormulaItem_rawMaterialId_idx\`(\`rawMaterialId\`),\n` +
      `  INDEX \`FormulaItem_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('FormulaItem', 'formulaId', 'Formula', 'CASCADE')},\n` +
      `  ${fk('FormulaItem', 'rawMaterialId', 'RawMaterial', 'RESTRICT')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'ProductionOrder',
    sql:
      `CREATE TABLE IF NOT EXISTS \`ProductionOrder\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`orderNumber\` VARCHAR(191) NOT NULL,\n` +
      `  \`formulaId\` VARCHAR(191) NOT NULL,\n` +
      `  \`productId\` VARCHAR(191) NOT NULL,\n` +
      `  \`quantity\` DOUBLE NOT NULL,\n` +
      `  \`producedQty\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`wasteQty\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`status\` VARCHAR(191) NOT NULL DEFAULT 'pending',\n` +
      `  \`qcStatus\` VARCHAR(191) NULL,\n` +
      `  \`qcNotes\` TEXT NULL,\n` +
      `  \`materialCost\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`laborCost\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`overheadCost\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`totalCost\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`startDate\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`endDate\` DATETIME(3) NULL,\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  UNIQUE INDEX \`ProductionOrder_orderNumber_key\`(\`orderNumber\`),\n` +
      `  INDEX \`ProductionOrder_formulaId_idx\`(\`formulaId\`),\n` +
      `  INDEX \`ProductionOrder_productId_idx\`(\`productId\`),\n` +
      `  INDEX \`ProductionOrder_status_idx\`(\`status\`),\n` +
      `  INDEX \`ProductionOrder_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('ProductionOrder', 'formulaId', 'Formula', 'RESTRICT')},\n` +
      `  ${fk('ProductionOrder', 'productId', 'Product', 'RESTRICT')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Customer',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Customer\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`phone\` VARCHAR(191) NULL,\n` +
      `  \`address\` TEXT NULL,\n` +
      `  \`type\` VARCHAR(191) NOT NULL DEFAULT 'retail',\n` +
      `  \`balance\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  INDEX \`Customer_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Sale',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Sale\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`invoiceNumber\` VARCHAR(191) NOT NULL,\n` +
      `  \`customerId\` VARCHAR(191) NULL,\n` +
      `  \`customerName\` VARCHAR(191) NULL,\n` +
      `  \`date\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`currency\` VARCHAR(191) NOT NULL DEFAULT 'AFN',\n` +
      `  \`exchangeRate\` DOUBLE NOT NULL DEFAULT 1,\n` +
      `  \`subtotal\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`discount\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`taxRate\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`taxAmount\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`total\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`paidAmount\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`paymentMethod\` VARCHAR(191) NOT NULL DEFAULT 'cash',\n` +
      `  \`status\` VARCHAR(191) NOT NULL DEFAULT 'paid',\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  UNIQUE INDEX \`Sale_invoiceNumber_key\`(\`invoiceNumber\`),\n` +
      `  INDEX \`Sale_customerId_idx\`(\`customerId\`),\n` +
      `  INDEX \`Sale_date_idx\`(\`date\`),\n` +
      `  INDEX \`Sale_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('Sale', 'customerId', 'Customer', 'SET NULL')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'SaleItem',
    sql:
      `CREATE TABLE IF NOT EXISTS \`SaleItem\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`saleId\` VARCHAR(191) NOT NULL,\n` +
      `  \`productId\` VARCHAR(191) NOT NULL,\n` +
      `  \`quantity\` DOUBLE NOT NULL,\n` +
      `  \`unitPrice\` DOUBLE NOT NULL,\n` +
      `  \`discount\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`total\` DOUBLE NOT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`SaleItem_saleId_idx\`(\`saleId\`),\n` +
      `  INDEX \`SaleItem_productId_idx\`(\`productId\`),\n` +
      `  INDEX \`SaleItem_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('SaleItem', 'saleId', 'Sale', 'CASCADE')},\n` +
      `  ${fk('SaleItem', 'productId', 'Product', 'RESTRICT')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Warehouse',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Warehouse\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`location\` VARCHAR(191) NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`Warehouse_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'InventoryTransaction',
    sql:
      `CREATE TABLE IF NOT EXISTS \`InventoryTransaction\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`date\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`type\` VARCHAR(191) NOT NULL,\n` +
      `  \`itemType\` VARCHAR(191) NOT NULL,\n` +
      `  \`itemId\` VARCHAR(191) NOT NULL,\n` +
      `  \`itemName\` VARCHAR(191) NOT NULL,\n` +
      `  \`unit\` VARCHAR(191) NOT NULL,\n` +
      `  \`quantity\` DOUBLE NOT NULL,\n` +
      `  \`warehouseId\` VARCHAR(191) NULL,\n` +
      `  \`reference\` VARCHAR(191) NULL,\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`InventoryTransaction_date_idx\`(\`date\`),\n` +
      `  INDEX \`InventoryTransaction_warehouseId_idx\`(\`warehouseId\`),\n` +
      `  INDEX \`InventoryTransaction_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('InventoryTransaction', 'warehouseId', 'Warehouse', 'SET NULL')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Expense',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Expense\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`date\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`category\` VARCHAR(191) NOT NULL DEFAULT 'عمومی',\n` +
      `  \`description\` TEXT NOT NULL,\n` +
      `  \`amount\` DOUBLE NOT NULL,\n` +
      `  \`currency\` VARCHAR(191) NOT NULL DEFAULT 'AFN',\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`Expense_date_idx\`(\`date\`),\n` +
      `  INDEX \`Expense_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Employee',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Employee\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`name\` VARCHAR(191) NOT NULL,\n` +
      `  \`position\` VARCHAR(191) NOT NULL,\n` +
      `  \`phone\` VARCHAR(191) NULL,\n` +
      `  \`salary\` DOUBLE NOT NULL DEFAULT 0,\n` +
      `  \`hireDate\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`active\` BOOLEAN NOT NULL DEFAULT true,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL,\n` +
      `  INDEX \`Employee_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Attendance',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Attendance\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`employeeId\` VARCHAR(191) NOT NULL,\n` +
      `  \`date\` DATETIME(3) NOT NULL,\n` +
      `  \`status\` VARCHAR(191) NOT NULL DEFAULT 'present',\n` +
      `  \`shift\` VARCHAR(191) NULL,\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`Attendance_employeeId_idx\`(\`employeeId\`),\n` +
      `  INDEX \`Attendance_date_idx\`(\`date\`),\n` +
      `  INDEX \`Attendance_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('Attendance', 'employeeId', 'Employee', 'CASCADE')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'SalaryPayment',
    sql:
      `CREATE TABLE IF NOT EXISTS \`SalaryPayment\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`employeeId\` VARCHAR(191) NOT NULL,\n` +
      `  \`month\` VARCHAR(191) NOT NULL,\n` +
      `  \`amount\` DOUBLE NOT NULL,\n` +
      `  \`date\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`notes\` TEXT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  INDEX \`SalaryPayment_employeeId_idx\`(\`employeeId\`),\n` +
      `  INDEX \`SalaryPayment_updatedAt_idx\`(\`updatedAt\`),\n` +
      `  PRIMARY KEY (\`id\`),\n` +
      `  ${fk('SalaryPayment', 'employeeId', 'Employee', 'CASCADE')}\n` +
      `) ${CHARSET}`,
  },
  {
    name: 'Setting',
    sql:
      `CREATE TABLE IF NOT EXISTS \`Setting\` (\n` +
      `  \`key\` VARCHAR(191) NOT NULL,\n` +
      `  \`value\` LONGTEXT NOT NULL,\n` +
      `  \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  \`updatedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n` +
      `  PRIMARY KEY (\`key\`)\n` +
      `) ${CHARSET}`,
  },
  {
    name: '_SyncTombstones',
    sql:
      `CREATE TABLE IF NOT EXISTS \`_SyncTombstones\` (\n` +
      `  \`id\` VARCHAR(191) NOT NULL,\n` +
      `  \`tbl\` VARCHAR(191) NOT NULL,\n` +
      `  \`recordId\` VARCHAR(191) NOT NULL,\n` +
      `  \`deletedAt\` DATETIME(3) NOT NULL,\n` +
      `  INDEX \`_SyncTombstones_deletedAt_idx\`(\`deletedAt\`),\n` +
      `  INDEX \`_SyncTombstones_tbl_recordId_idx\`(\`tbl\`, \`recordId\`),\n` +
      `  PRIMARY KEY (\`id\`)\n` +
      `) ${CHARSET}`,
  },
]

export const MYSQL_TABLE_NAMES = MYSQL_TABLES.map((t) => t.name)
