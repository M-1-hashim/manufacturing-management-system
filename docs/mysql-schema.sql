-- ============================================================
-- ManufacturingERP — ساختار دیتابیس MySQL (هاست اشتراکی)
-- ============================================================
-- طرز استفاده:
--   ۱) در cPanel وارد phpMyAdmin شوید
--   ۲) دیتابیس ساخته‌شده را از فهرست سمت راست انتخاب کنید
--   ۳) تب Import → این فایل را انتخاب کنید → Go
--   ۴) پیام موفقیت — جداول سامانه ساخته شد
-- این فایل فقط جداول خالی می‌سازد؛ دیتای قبلی را با بکاپ JSON
-- از داخل برنامه انتقال دهید (راهنمای کامل: DEPLOY-SHARED-HOSTING.fa.md)
-- ============================================================

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `fullName` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'viewer',
    `department` VARCHAR(191) NOT NULL DEFAULT 'general',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `userName` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `details` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    INDEX `AuditLog_action_idx`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductCategory` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ProductCategory_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `categoryId` VARCHAR(191) NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'عدد',
    `barcode` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `costPrice` DOUBLE NOT NULL DEFAULT 0,
    `salePrice` DOUBLE NOT NULL DEFAULT 0,
    `wholesalePrice` DOUBLE NOT NULL DEFAULT 0,
    `minStock` DOUBLE NOT NULL DEFAULT 0,
    `stock` DOUBLE NOT NULL DEFAULT 0,
    `imageUrl` LONGTEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Product_code_key`(`code`),
    INDEX `Product_categoryId_idx`(`categoryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Supplier` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RawMaterial` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL DEFAULT 'کیلوگرام',
    `purchasePrice` DOUBLE NOT NULL DEFAULT 0,
    `stock` DOUBLE NOT NULL DEFAULT 0,
    `minStock` DOUBLE NOT NULL DEFAULT 0,
    `maxStock` DOUBLE NOT NULL DEFAULT 0,
    `expiryDate` DATETIME(3) NULL,
    `supplierId` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RawMaterial_code_key`(`code`),
    INDEX `RawMaterial_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Formula` (
    `id` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `outputQty` DOUBLE NOT NULL DEFAULT 1,
    `laborCost` DOUBLE NOT NULL DEFAULT 0,
    `overheadCost` DOUBLE NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Formula_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FormulaItem` (
    `id` VARCHAR(191) NOT NULL,
    `formulaId` VARCHAR(191) NOT NULL,
    `rawMaterialId` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `percentage` DOUBLE NULL,

    INDEX `FormulaItem_formulaId_idx`(`formulaId`),
    INDEX `FormulaItem_rawMaterialId_idx`(`rawMaterialId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProductionOrder` (
    `id` VARCHAR(191) NOT NULL,
    `orderNumber` VARCHAR(191) NOT NULL,
    `formulaId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `producedQty` DOUBLE NOT NULL DEFAULT 0,
    `wasteQty` DOUBLE NOT NULL DEFAULT 0,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `qcStatus` VARCHAR(191) NULL,
    `qcNotes` TEXT NULL,
    `materialCost` DOUBLE NOT NULL DEFAULT 0,
    `laborCost` DOUBLE NOT NULL DEFAULT 0,
    `overheadCost` DOUBLE NOT NULL DEFAULT 0,
    `totalCost` DOUBLE NOT NULL DEFAULT 0,
    `startDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endDate` DATETIME(3) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductionOrder_orderNumber_key`(`orderNumber`),
    INDEX `ProductionOrder_formulaId_idx`(`formulaId`),
    INDEX `ProductionOrder_productId_idx`(`productId`),
    INDEX `ProductionOrder_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Customer` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `address` TEXT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT 'retail',
    `balance` DOUBLE NOT NULL DEFAULT 0,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sale` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NULL,
    `customerName` VARCHAR(191) NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `currency` VARCHAR(191) NOT NULL DEFAULT 'AFN',
    `exchangeRate` DOUBLE NOT NULL DEFAULT 1,
    `subtotal` DOUBLE NOT NULL DEFAULT 0,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `taxRate` DOUBLE NOT NULL DEFAULT 0,
    `taxAmount` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL DEFAULT 0,
    `paidAmount` DOUBLE NOT NULL DEFAULT 0,
    `paymentMethod` VARCHAR(191) NOT NULL DEFAULT 'cash',
    `status` VARCHAR(191) NOT NULL DEFAULT 'paid',
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Sale_invoiceNumber_key`(`invoiceNumber`),
    INDEX `Sale_customerId_idx`(`customerId`),
    INDEX `Sale_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SaleItem` (
    `id` VARCHAR(191) NOT NULL,
    `saleId` VARCHAR(191) NOT NULL,
    `productId` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `unitPrice` DOUBLE NOT NULL,
    `discount` DOUBLE NOT NULL DEFAULT 0,
    `total` DOUBLE NOT NULL,

    INDEX `SaleItem_saleId_idx`(`saleId`),
    INDEX `SaleItem_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Warehouse` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `InventoryTransaction` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `type` VARCHAR(191) NOT NULL,
    `itemType` VARCHAR(191) NOT NULL,
    `itemId` VARCHAR(191) NOT NULL,
    `itemName` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `quantity` DOUBLE NOT NULL,
    `warehouseId` VARCHAR(191) NULL,
    `reference` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `InventoryTransaction_date_idx`(`date`),
    INDEX `InventoryTransaction_warehouseId_idx`(`warehouseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Expense` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `category` VARCHAR(191) NOT NULL DEFAULT 'عمومی',
    `description` TEXT NOT NULL,
    `amount` DOUBLE NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'AFN',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Expense_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employee` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `position` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `salary` DOUBLE NOT NULL DEFAULT 0,
    `hireDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Attendance` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `date` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'present',
    `shift` VARCHAR(191) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Attendance_employeeId_idx`(`employeeId`),
    INDEX `Attendance_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SalaryPayment` (
    `id` VARCHAR(191) NOT NULL,
    `employeeId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(191) NOT NULL,
    `amount` DOUBLE NOT NULL,
    `date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SalaryPayment_employeeId_idx`(`employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(191) NOT NULL,
    `value` LONGTEXT NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Product` ADD CONSTRAINT `Product_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ProductCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RawMaterial` ADD CONSTRAINT `RawMaterial_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Formula` ADD CONSTRAINT `Formula_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FormulaItem` ADD CONSTRAINT `FormulaItem_formulaId_fkey` FOREIGN KEY (`formulaId`) REFERENCES `Formula`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FormulaItem` ADD CONSTRAINT `FormulaItem_rawMaterialId_fkey` FOREIGN KEY (`rawMaterialId`) REFERENCES `RawMaterial`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionOrder` ADD CONSTRAINT `ProductionOrder_formulaId_fkey` FOREIGN KEY (`formulaId`) REFERENCES `Formula`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProductionOrder` ADD CONSTRAINT `ProductionOrder_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sale` ADD CONSTRAINT `Sale_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItem` ADD CONSTRAINT `SaleItem_saleId_fkey` FOREIGN KEY (`saleId`) REFERENCES `Sale`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SaleItem` ADD CONSTRAINT `SaleItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `InventoryTransaction` ADD CONSTRAINT `InventoryTransaction_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Attendance` ADD CONSTRAINT `Attendance_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SalaryPayment` ADD CONSTRAINT `SalaryPayment_employeeId_fkey` FOREIGN KEY (`employeeId`) REFERENCES `Employee`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

