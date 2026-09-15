'use client'

/**
 * دیتای اولیهٔ حالت محلی — نمونهٔ واقعی کارخانهٔ افغانی
 * پورت‌شده از prisma/seed.ts و prisma/seed-users.ts
 * فقط بار اول اجرا (وقتی هیچ دیتایی نیست) درج می‌شود.
 */

import { newRow, nowISO, readCol, uid, writeCol, type Row } from './db'

type U = Row & Record<string, unknown>

const DAY = 86400000

export const SEED_FLAG = 'setab-local.seeded'

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString()
}

export function ensureSeeded(): void {
  try {
    if (localStorage.getItem(SEED_FLAG) === '1') return
    const products = readCol('products')
    const users = readCol('users')
    // اگر دیتای واقعی از قبل هست (مثلاً بازیابی)، دست نزن
    if (users.length > 0 || products.length > 0) {
      localStorage.setItem(SEED_FLAG, '1')
      return
    }
    seedAll()
    localStorage.setItem(SEED_FLAG, '1')
  } catch (e) {
    console.error('[local-seed] failed', e)
  }
}

function seedAll(): void {
  // ---- کاربران (مطابق seed-users.ts) ----
  const users: U[] = [
    { username: 'admin', password: 'admin123', fullName: 'مدیر سیستم', role: 'admin', department: 'general', active: true },
    { username: 'manager', password: 'manager123', fullName: 'احمد کریمی', role: 'manager', department: 'general', active: true },
    { username: 'prodstaff', password: 'prod123', fullName: 'محمود نوری — مسئول تولید', role: 'operator', department: 'production', active: true },
    { username: 'salesstaff', password: 'sales123', fullName: 'فرید احمدی — مسئول فروش', role: 'operator', department: 'sales', active: true },
    { username: 'storestaff', password: 'store123', fullName: 'نجیب‌الله رحیمی — انباردار', role: 'operator', department: 'inventory', active: true },
    { username: 'finstaff', password: 'fin123', fullName: 'زکیه سادات — حسابدار', role: 'operator', department: 'finance', active: true },
    { username: 'hrstaff', password: 'hr123', fullName: 'سمیع‌الله جواد — منابع انسانی', role: 'operator', department: 'hr', active: true },
    { username: 'viewer', password: 'viewer123', fullName: 'بازرس کیفیت', role: 'viewer', department: 'general', active: true },
  ].map((u) => newRow(u))
  writeCol('users', users)

  // ---- تنظیمات ----
  const settings: U[] = [
    { key: 'companyName', value: 'کارخانه تولیدی البرز' },
    { key: 'companyAddress', value: 'کابل، چهل‌ستون، منطقه صنعتی' },
    { key: 'companyPhone', value: '۰۷۰۰۰۰۰۰۰۰' },
    { key: 'usdRate', value: '70' },
    { key: 'pkrRate', value: '0.25' },
    { key: 'ratesUpdatedAt', value: nowISO() },
    { key: 'ratesSource', value: 'database' },
    { key: 'ratesAutoSync', value: '0' }, // حالت محلی — نرخ دستی
    { key: 'defaultTax', value: '2' },
  ].map((s) => newRow(s))
  writeCol('settings', settings)

  // ---- انبار ----
  const wh = newRow({ name: 'انبار مرکزی', location: 'کابل' })
  writeCol('warehouses', [wh])

  // ---- کټگوری‌ها ----
  const catNames = ['لبنیات', 'نوشیدنی‌ها', 'شوینده‌ها', 'قندی و شیرینی']
  const cats: Record<string, string> = {}
  writeCol(
    'productCategories',
    catNames.map((name) => {
      const c = newRow({ name })
      cats[name] = c.id
      return c
    })
  )

  // ---- تأمین‌کنندگان ----
  const supNames = ['تجارتخانه رحیمی', 'شرکت وارداتی هرات', 'بازرگانی میوند', 'تأمینیات کابل']
  const suppliers: Record<string, string> = {}
  writeCol(
    'suppliers',
    supNames.map((name) => {
      const s = newRow({ name, phone: '0790123456', address: 'کابل، منطقه تجارتی', notes: '' })
      suppliers[name] = s.id
      return s
    })
  )

  // ---- محصولات ----
  const prodData: [string, string, string, string, number, number, number, number, number, string][] = [
    // code, name, category, unit, cost, sale, wholesale, minStock, stock, barcode
    ['P-001', 'شیر پاستوریزه ۱ لیتر', 'لبنیات', 'عدد', 38, 50, 45, 50, 320, '1000001'],
    ['P-002', 'دوغ بطری ۵۰۰ ملی', 'لبنیات', 'عدد', 18, 28, 24, 80, 65, '1000002'],
    ['P-003', 'آب‌میوه سیب ۱ لیتر', 'نوشیدنی‌ها', 'عدد', 55, 80, 70, 40, 210, '1000003'],
    ['P-004', 'نوشابه گازدار ۲ لیتر', 'نوشیدنی‌ها', 'عدد', 45, 70, 60, 60, 180, '1000004'],
    ['P-005', 'صابون لباسشویی ۲۵۰ گرم', 'شوینده‌ها', 'عدد', 20, 35, 30, 100, 480, '1000005'],
    ['P-006', 'مایع ظرفشویی ۱ لیتر', 'شوینده‌ها', 'عدد', 40, 65, 58, 50, 35, '1000006'],
    ['P-007', 'توفر شکلاتی ۵۰ گرم', 'قندی و شیرینی', 'عدد', 15, 30, 25, 200, 850, '1000007'],
  ]
  const products: Record<string, string> = {}
  writeCol(
    'products',
    prodData.map(([code, name, cat, unit, cost, sale, wholesale, minStock, stock, barcode]) => {
      const p = newRow({
        code, name, categoryId: cats[cat], unit, costPrice: cost, salePrice: sale,
        wholesalePrice: wholesale, minStock, stock, barcode, description: null, active: true,
      })
      products[code] = p.id
      return p
    })
  )

  // ---- مواد خام ----
  const matData: [string, string, string, number, number, number, number, string][] = [
    ['M-001', 'شیر خام', 'لیتر', 28, 1800, 500, 5000, 'تجارتخانه رحیمی'],
    ['M-002', 'شکر سفید', 'کیلوگرام', 55, 2400, 600, 6000, 'شرکت وارداتی هرات'],
    ['M-003', 'اسانس سیب', 'لیتر', 320, 45, 20, 200, 'بازرگانی میوند'],
    ['M-004', 'روغن پالم', 'کیلوگرام', 120, 850, 300, 3000, 'شرکت وارداتی هرات'],
    ['M-005', 'سود کاستیک', 'کیلوگرام', 90, 220, 100, 1000, 'بازرگانی میوند'],
    ['M-006', 'بطری پلاستیک ۱ لیتر', 'عدد', 8, 5200, 2000, 20000, 'تأمینیات کابل'],
    ['M-007', 'بطری پلاستیک ۵۰۰ ملی', 'عدد', 5, 1500, 2000, 20000, 'تأمینیات کابل'],
    ['M-008', 'کاکائو پودر', 'کیلوگرام', 450, 120, 50, 500, 'بازرگانی میوند'],
    ['M-009', 'کیسه بسته‌بندی', 'عدد', 2, 9800, 3000, 30000, 'تأمینیات کابل'],
    ['M-010', 'برچسب لیبل', 'عدد', 1, 12500, 4000, 40000, 'تأمینیات کابل'],
  ]
  const materials: Record<string, string> = {}
  writeCol(
    'rawMaterials',
    matData.map(([code, name, unit, price, stock, minStock, maxStock, supplier]) => {
      const m = newRow({
        code, name, unit, purchasePrice: price, stock, minStock, maxStock,
        supplierId: suppliers[supplier], notes: null,
        expiryDate: code === 'M-001' ? isoDaysAgo(-3) : null,
      })
      materials[code] = m.id
      return m
    })
  )

  // ---- فرمول‌ها (BOM) ----
  const formulas: U[] = []
  const formulaItems: U[] = []
  function makeFormula(
    productCode: string, name: string, outputQty: number, labor: number, overhead: number,
    items: [string, number][]
  ): U {
    const f = newRow({
      productId: products[productCode], name, version: 1, outputQty,
      laborCost: labor, overheadCost: overhead, notes: null, isActive: true,
    })
    formulas.push(f)
    for (const [code, qty] of items) {
      formulaItems.push(
        newRow({ formulaId: f.id, rawMaterialId: materials[code], quantity: qty, percentage: null })
      )
    }
    return f
  }
  makeFormula('P-001', 'فرمول شیر پاستوریزه (۱ لیتر)', 1, 4, 3, [['M-001', 1.05], ['M-006', 1], ['M-010', 1]])
  makeFormula('P-002', 'فرمول دوغ ۵۰۰ ملی', 1, 2.5, 2, [['M-001', 0.5], ['M-007', 1], ['M-010', 1]])
  makeFormula('P-003', 'فرمول آب‌میوه سیب', 1, 6, 5, [['M-002', 0.12], ['M-003', 0.01], ['M-006', 1], ['M-010', 1]])
  makeFormula('P-005', 'فرمول صابون لباسشویی', 1, 3, 2, [['M-005', 0.08], ['M-004', 0.05], ['M-009', 1]])
  writeCol('formulas', formulas)
  writeCol('formulaItems', formulaItems)

  // ---- مشتریان ----
  const custData: [string, string, string, string][] = [
    ['فروشگاه بزرگ آریانا', 'wholesale', '0788123456', 'کابل، شهر نو'],
    ['مارکت صدیقی', 'wholesale', '0700112233', 'کابل، کارته نو'],
    ['خریدار حقیقی - ناصر', 'retail', '0777556677', 'کابل'],
    ['فروشگاه پامیر', 'wholesale', '0799998888', 'مزار شریف'],
  ]
  const customers: Record<string, string> = {}
  writeCol(
    'customers',
    custData.map(([name, type, phone, address]) => {
      const c = newRow({ name, type, phone, address, balance: 0, notes: null })
      customers[name] = c.id
      return c
    })
  )

  // ---- فروش‌ها (۳۰ روز اخیر) ----
  let invNo = 1000
  const saleSamples: [string, number, [string, number, number][], string, number][] = [
    ['فروشگاه بزرگ آریانا', 2, [['P-001', 60, 45], ['P-003', 40, 70]], 'transfer', 2],
    ['مارکت صدیقی', 5, [['P-005', 100, 30], ['P-007', 200, 25]], 'cash', 2],
    ['خریدار حقیقی - ناصر', 8, [['P-001', 5, 50], ['P-004', 6, 70]], 'cash', 2],
    ['فروشگاه پامیر', 12, [['P-002', 120, 24], ['P-006', 30, 58]], 'credit', 2],
    ['فروشگاه بزرگ آریانا', 15, [['P-003', 80, 70], ['P-004', 60, 60]], 'transfer', 2],
    ['مارکت صدیقی', 20, [['P-001', 45, 45]], 'cash', 2],
    ['فروشگاه پامیر', 25, [['P-005', 150, 30], ['P-007', 300, 25]], 'transfer', 2],
  ]
  const sales: U[] = []
  const saleItems: U[] = []
  for (const [cust, daysAgo, items, method, tax] of saleSamples) {
    const its = items.map(([code, qty, price]) => ({
      productId: products[code], quantity: qty, unitPrice: price, discount: 0, total: qty * price,
    }))
    const subtotal = its.reduce((a, i) => a + i.total, 0)
    const taxAmount = Math.round(subtotal * (tax / 100))
    const total = subtotal + taxAmount
    const status = method === 'credit' ? 'unpaid' : 'paid'
    const s = newRow({
      invoiceNumber: `INV-${++invNo}`, customerId: customers[cust], customerName: cust,
      date: isoDaysAgo(daysAgo), currency: 'AFN', exchangeRate: 1,
      subtotal, discount: 0, taxRate: tax, taxAmount, total,
      paidAmount: status === 'paid' ? total : 0, paymentMethod: method, status, notes: null,
    })
    sales.push(s)
    for (const it of its) saleItems.push(newRow({ saleId: s.id, ...it }))
    if (method === 'credit') {
      // ماندهٔ قرض مشتری برای فروش نسیه
      const row = readCol<U>('customers').find((c) => c.id === customers[cust])
      if (row) {
        row.balance = (Number(row.balance ?? 0) || 0) + total
        writeCol('customers', readCol<U>('customers'))
      }
    }
  }
  writeCol('sales', sales)
  writeCol('saleItems', saleItems)

  // ---- سفارش‌های تولید ----
  const prodOrders: [string, string, number, number, number, string, string | null, number][] = [
    ['P-001', 'فرمول شیر پاستوریزه (۱ لیتر)', 300, 295, 5, 'completed', 'passed', 6],
    ['P-002', 'فرمول دوغ ۵۰۰ ملی', 200, 196, 4, 'completed', 'passed', 10],
    ['P-003', 'فرمول آب‌میوه سیب', 250, 0, 0, 'in_progress', null, 1],
    ['P-005', 'فرمول صابون لباسشویی', 500, 0, 0, 'pending', null, 0],
  ]
  const fByProduct: Record<string, U> = {}
  for (const f of formulas) fByProduct[String(f.productId)] = f
  writeCol(
    'productionOrders',
    prodOrders.map(([pCode, fName, qty, produced, waste, status, qc, daysAgo]) => {
      const f = formulas.find((x) => x.name === fName)!
      const scale = (produced || qty) / Number(f.outputQty)
      const fIts = formulaItems.filter((i) => i.formulaId === f.id)
      const matRows = readCol<U>('rawMaterials')
      let matCost = 0
      for (const i of fIts) {
        const mat = matRows.find((m) => m.id === i.rawMaterialId)
        if (mat) matCost += Number(i.quantity) * scale * Number(mat.purchasePrice)
      }
      const labor = Number(f.laborCost) * scale
      const overhead = Number(f.overheadCost) * scale
      return newRow({
        orderNumber: `PR-${Math.floor(Math.random() * 90000) + 10000}`,
        formulaId: f.id, productId: products[pCode], quantity: qty, producedQty: produced, wasteQty: waste,
        status, qcStatus: qc, qcNotes: null,
        materialCost: Math.round(matCost), laborCost: Math.round(labor), overheadCost: Math.round(overhead),
        totalCost: Math.round(matCost + labor + overhead),
        startDate: isoDaysAgo(daysAgo), endDate: status === 'completed' ? isoDaysAgo(Math.max(daysAgo - 1, 0)) : null,
        notes: null,
      })
    })
  )

  // ---- تراکنش‌های انبار ----
  const txSamples: [string, string, string, string, string, number, string, number][] = [
    ['in', 'material', 'M-001', 'شیر خام', 'لیتر', 2000, 'خرید تأمین‌کننده', 7],
    ['out', 'material', 'M-001', 'شیر خام', 'لیتر', 315, 'PR تولید شیر', 6],
    ['in', 'product', 'P-001', 'شیر پاستوریزه ۱ لیتر', 'عدد', 295, 'PR تولید شیر', 6],
    ['out', 'product', 'P-001', 'شیر پاستوریزه ۱ لیتر', 'عدد', 105, 'INV-1001', 2],
    ['out', 'product', 'P-005', 'صابون لباسشویی ۲۵۰ گرم', 'عدد', 250, 'INV-1002', 5],
    ['in', 'material', 'M-002', 'شکر سفید', 'کیلوگرام', 1500, 'خرید تأمین‌کننده', 12],
  ]
  writeCol(
    'inventoryTransactions',
    txSamples.map(([type, itemType, code, name, unit, qty, ref, daysAgo]) =>
      newRow({
        type, itemType, itemId: materials[code] ?? products[code], itemName: name,
        unit, quantity: qty, warehouseId: wh.id, reference: ref, notes: null, date: isoDaysAgo(daysAgo),
      })
    )
  )

  // ---- مصارف ----
  const expenseSamples: [string, string, number, number][] = [
    ['برق', 'بیل برق ماهانه + جنراتور', 28000, 9],
    ['حقوق', 'حقوق کارگران خط تولید', 120000, 10],
    ['کرایه', 'کرایه ساختمان کارخانه', 45000, 11],
    ['حمل‌ونقل', 'کرایه موترهای توزیع', 18000, 4],
    ['تعمیرات', 'تعمیر ماشین پاستوریزه', 15000, 14],
  ]
  writeCol(
    'expenses',
    expenseSamples.map(([category, description, amount, daysAgo]) =>
      newRow({ category, description, amount, currency: 'AFN', date: isoDaysAgo(daysAgo) })
    )
  )

  // ---- کارکنان + حاضری + معاش ----
  const empData: [string, string, number][] = [
    ['محمود نوری', 'سرپرست خط تولید', 18000],
    ['عبدالرحمن احمدی', 'کارگر تولید', 12000],
    ['فاطمه یوسفی', 'کنترل کیفیت', 15000],
    ['شکریه رحیمی', 'حسابدار', 16000],
    ['کریم شاه', 'راننده توزیع', 13000],
  ]
  const employees = empData.map(([name, position, salary]) =>
    newRow({ name, position, salary, phone: '0790123000', hireDate: isoDaysAgo(400), active: true })
  )
  writeCol('employees', employees)

  const attendance: U[] = []
  const salaries: U[] = []
  for (const emp of employees) {
    for (let d = 1; d <= 5; d++) {
      const status = (emp.id.length + d) % 7 === 0 ? 'absent' : 'present'
      attendance.push(newRow({ employeeId: emp.id, date: isoDaysAgo(d), status, shift: 'صبح', notes: null }))
    }
    salaries.push(
      newRow({ employeeId: emp.id, month: '1403-12', amount: Number(emp.salary), date: isoDaysAgo(10), notes: null })
    )
  }
  writeCol('attendance', attendance)
  writeCol('salaries', salaries)

  // ---- رخداد اولیه ----
  writeCol('auditLogs', [
    newRow({
      userId: users[0].id, userName: 'admin', action: 'bootstrap', entity: 'settings',
      entityId: null, details: 'راه‌اندازی اولیهٔ نسخهٔ محلی (اندروید)',
    }),
  ])
}
