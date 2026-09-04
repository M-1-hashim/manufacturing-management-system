// Seed script — realistic Afghan factory sample data
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // ---- Users ----
  const users = [
    { username: 'admin', password: 'admin123', fullName: 'مدیر سیستم', role: 'admin' },
    { username: 'manager', password: 'manager123', fullName: 'احمد کریمی', role: 'manager' },
    { username: 'operator', password: 'operator123', fullName: 'محمود نوری', role: 'operator' },
  ]
  for (const u of users) {
    await db.user.upsert({ where: { username: u.username }, update: {}, create: u })
  }

  // ---- Settings ----
  const settings = [
    { key: 'companyName', value: 'کارخانه تولیدی البرز' },
    { key: 'companyAddress', value: 'کابل،چهل‌ستون،منطقه صنعتی' },
    { key: 'companyPhone', value: '۰۷۰۰۰۰۰۰۰۰' },
    { key: 'usdRate', value: '70' }, // 1 USD = 70 AFN
    { key: 'pkrRate', value: '0.25' }, // 1 PKR = 0.25 AFN
    { key: 'defaultTax', value: '2' },
  ]
  for (const s of settings) {
    await db.setting.upsert({ where: { key: s.key }, update: {}, create: s })
  }

  // ---- Warehouse ----
  const wh = await db.warehouse.create({ data: { name: 'انبار مرکزی', location: 'کابل' } })

  // ---- Categories ----
  const catData = [
    { name: 'لبنیات' },
    { name: 'نوشیدنی‌ها' },
    { name: 'شوینده‌ها' },
    { name: 'قندی و شیرینی' },
  ]
  const cats: Record<string, string> = {}
  for (const c of catData) {
    const found = await db.productCategory.upsert({ where: { name: c.name }, update: {}, create: c })
    cats[c.name] = found.id
  }

  // ---- Suppliers ----
  const supNames = ['تجارتخانه رحیمی', 'شرکت وارداتی هرات', 'بازرگانی میوند', 'تأمینیات کابل']
  const suppliers: Record<string, string> = {}
  for (const n of supNames) {
    const s = await db.supplier.create({
      data: { name: n, phone: '0790123456', address: 'کابل، مناطقه تجارتی', notes: '' },
    })
    suppliers[n] = s.id
  }

  // ---- Products ----
  const prodData = [
    { code: 'P-001', name: 'شیر پاستوریزه ۱ لیتر', category: 'لبنیات', unit: 'عدد', costPrice: 38, salePrice: 50, wholesalePrice: 45, minStock: 50, stock: 320, barcode: '1000001' },
    { code: 'P-002', name: 'دوغ بطری ۵۰۰ ملی', category: 'لبنیات', unit: 'عدد', costPrice: 18, salePrice: 28, wholesalePrice: 24, minStock: 80, stock: 65, barcode: '1000002' },
    { code: 'P-003', name: 'آب‌میوه سیب ۱ لیتر', category: 'نوشیدنی‌ها', unit: 'عدد', costPrice: 55, salePrice: 80, wholesalePrice: 70, minStock: 40, stock: 210, barcode: '1000003' },
    { code: 'P-004', name: 'نوشابه گازدار ۲ لیتر', category: 'نوشیدنی‌ها', unit: 'عدد', costPrice: 45, salePrice: 70, wholesalePrice: 60, minStock: 60, stock: 180, barcode: '1000004' },
    { code: 'P-005', name: 'صابون لباسشویی ۲۵۰ گرم', category: 'شوینده‌ها', unit: 'عدد', costPrice: 20, salePrice: 35, wholesalePrice: 30, minStock: 100, stock: 480, barcode: '1000005' },
    { code: 'P-006', name: 'مایع ظرفشویی ۱ لیتر', category: 'شوینده‌ها', unit: 'عدد', costPrice: 40, salePrice: 65, wholesalePrice: 58, minStock: 50, stock: 35, barcode: '1000006' },
    { code: 'P-007', name: 'توفر شکلاتی ۵۰ گرم', category: 'قندی و شیرینی', unit: 'عدد', costPrice: 15, salePrice: 30, wholesalePrice: 25, minStock: 200, stock: 850, barcode: '1000007' },
  ]
  const products: Record<string, string> = {}
  for (const p of prodData) {
    const { category, ...rest } = p
    const created = await db.product.upsert({
      where: { code: p.code },
      update: {},
      create: { ...rest, categoryId: cats[category] },
    })
    products[p.code] = created.id
  }

  // ---- Raw Materials ----
  const matData = [
    { code: 'M-001', name: 'شیر خام', unit: 'لیتر', purchasePrice: 28, stock: 1800, minStock: 500, maxStock: 5000, supplier: 'تجارتخانه رحیمی' },
    { code: 'M-002', name: 'شکر سفید', unit: 'کیلوگرام', purchasePrice: 55, stock: 2400, minStock: 600, maxStock: 6000, supplier: 'شرکت وارداتی هرات' },
    { code: 'M-003', name: 'اسانس سیب', unit: 'لیتر', purchasePrice: 320, stock: 45, minStock: 20, maxStock: 200, supplier: 'بازرگانی میوند' },
    { code: 'M-004', name: 'روغن پالم', unit: 'کیلوگرام', purchasePrice: 120, stock: 850, minStock: 300, maxStock: 3000, supplier: 'شرکت وارداتی هرات' },
    { code: 'M-005', name: 'سود کاستیک', unit: 'کیلوگرام', purchasePrice: 90, stock: 220, minStock: 100, maxStock: 1000, supplier: 'بازرگانی میوند' },
    { code: 'M-006', name: 'بطری پلاستیک ۱ لیتر', unit: 'عدد', purchasePrice: 8, stock: 5200, minStock: 2000, maxStock: 20000, supplier: 'تأمینیات کابل' },
    { code: 'M-007', name: 'بطری پلاستیک ۵۰۰ ملی', unit: 'عدد', purchasePrice: 5, stock: 1500, minStock: 2000, maxStock: 20000, supplier: 'تأمینیات کابل' },
    { code: 'M-008', name: 'کاکائو پودر', unit: 'کیلوگرام', purchasePrice: 450, stock: 120, minStock: 50, maxStock: 500, supplier: 'بازرگانی میوند' },
    { code: 'M-009', name: 'کیسه بسته‌بندی', unit: 'عدد', purchasePrice: 2, stock: 9800, minStock: 3000, maxStock: 30000, supplier: 'تأمینیات کابل' },
    { code: 'M-010', name: 'برچسب لیبل', unit: 'عدد', purchasePrice: 1, stock: 12500, minStock: 4000, maxStock: 40000, supplier: 'تأمینیات کابل' },
  ]
  const materials: Record<string, string> = {}
  for (const m of matData) {
    const { supplier, ...rest } = m
    const created = await db.rawMaterial.upsert({
      where: { code: m.code },
      update: {},
      create: { ...rest, supplierId: suppliers[supplier], expiryDate: m.code === 'M-001' ? new Date(Date.now() + 3 * 86400000) : null },
    })
    materials[m.code] = created.id
  }

  // ---- Formulas (BOM) ----
  async function makeFormula(productId: string, name: string, outputQty: number, labor: number, overhead: number, items: [string, number][]) {
    return db.formula.create({
      data: {
        productId, name, outputQty, laborCost: labor, overheadCost: overhead,
        items: { create: items.map(([code, qty]) => ({ rawMaterialId: materials[code], quantity: qty })) },
      },
    })
  }

  const f1 = await makeFormula(products['P-001'], 'فرمول شیر پاستوریزه (۱ لیتر)', 1, 4, 3, [['M-001', 1.05], ['M-006', 1], ['M-010', 1]])
  const f2 = await makeFormula(products['P-002'], 'فرمول دوغ ۵۰۰ ملی', 1, 2.5, 2, [['M-001', 0.5], ['M-007', 1], ['M-010', 1]])
  const f3 = await makeFormula(products['P-003'], 'فرمول آب‌میوه سیب', 1, 6, 5, [['M-002', 0.12], ['M-003', 0.01], ['M-006', 1], ['M-010', 1]])
  const f4 = await makeFormula(products['P-005'], 'فرمول صابون لباسشویی', 1, 3, 2, [['M-005', 0.08], ['M-004', 0.05], ['M-009', 1]])

  // ---- Customers ----
  const custNames = [
    { name: 'فروشگاه بزرگ آریانا', type: 'wholesale', phone: '0788123456', address: 'کابل، شهر نو' },
    { name: 'مارکت صدیقی', type: 'wholesale', phone: '0700112233', address: 'کابل، کارته نو' },
    { name: 'خریدار حقیقی - ناصر', type: 'retail', phone: '0777556677', address: 'کابل' },
    { name: 'فروشگاه پامیر', type: 'wholesale', phone: '0799998888', address: 'مزار شریف' },
  ]
  const customers: Record<string, string> = {}
  for (const c of custNames) {
    const created = await db.customer.create({ data: c })
    customers[c.name] = created.id
  }

  // ---- Sales (last 30 days) ----
  let invNo = 1000
  const saleSamples = [
    { cust: 'فروشگاه بزرگ آریانا', daysAgo: 2, items: [['P-001', 60, 45], ['P-003', 40, 70]], method: 'transfer', tax: 2 },
    { cust: 'مارکت صدیقی', daysAgo: 5, items: [['P-005', 100, 30], ['P-007', 200, 25]], method: 'cash', tax: 2 },
    { cust: 'خریدار حقیقی - ناصر', daysAgo: 8, items: [['P-001', 5, 50], ['P-004', 6, 70]], method: 'cash', tax: 2 },
    { cust: 'فروشگاه پامیر', daysAgo: 12, items: [['P-002', 120, 24], ['P-006', 30, 58]], method: 'credit', tax: 2 },
    { cust: 'فروشگاه بزرگ آریانا', daysAgo: 15, items: [['P-003', 80, 70], ['P-004', 60, 60]], method: 'transfer', tax: 2 },
    { cust: 'مارکت صدیقی', daysAgo: 20, items: [['P-001', 45, 45]], method: 'cash', tax: 2 },
    { cust: 'فروشگاه پامیر', daysAgo: 25, items: [['P-005', 150, 30], ['P-007', 300, 25]], method: 'transfer', tax: 2 },
  ]
  for (const s of saleSamples) {
    const items = s.items.map(([code, qty, price]) => {
      const q = qty as number, pr = price as number
      return { productId: products[code as string], quantity: q, unitPrice: pr, discount: 0, total: q * pr }
    })
    const subtotal = items.reduce((a, i) => a + i.total, 0)
    const taxAmount = Math.round(subtotal * (s.tax / 100))
    const total = subtotal + taxAmount
    const status = s.method === 'credit' ? 'unpaid' : 'paid'
    await db.sale.create({
      data: {
        invoiceNumber: `INV-${++invNo}`,
        customerId: customers[s.cust],
        customerName: s.cust,
        date: new Date(Date.now() - s.daysAgo * 86400000),
        subtotal, discount: 0, taxRate: s.tax, taxAmount, total,
        paidAmount: status === 'paid' ? total : 0,
        paymentMethod: s.method, status,
        items: { create: items },
      },
    })
  }

  // ---- Production Orders ----
  const prodOrders = [
    { f: f1.id, p: products['P-001'], qty: 300, produced: 295, waste: 5, status: 'completed', qc: 'passed', daysAgo: 6 },
    { f: f2.id, p: products['P-002'], qty: 200, produced: 196, waste: 4, status: 'completed', qc: 'passed', daysAgo: 10 },
    { f: f3.id, p: products['P-003'], qty: 250, produced: 0, waste: 0, status: 'in_progress', qc: null, daysAgo: 1 },
    { f: f4.id, p: products['P-005'], qty: 500, produced: 0, waste: 0, status: 'pending', qc: null, daysAgo: 0 },
  ]
  for (const o of prodOrders) {
    const formula = await db.formula.findUnique({ where: { id: o.f }, include: { items: { include: { rawMaterial: true } } } })
    const mult = (o.produced || o.qty) / formula!.outputQty
    const matCost = formula!.items.reduce((a, i) => a + i.quantity * mult * i.rawMaterial.purchasePrice, 0)
    const scale = (o.produced || o.qty) / formula!.outputQty
    const labor = formula!.laborCost * scale
    const overhead = formula!.overheadCost * scale
    await db.productionOrder.create({
      data: {
        orderNumber: `PR-${Date.now() % 100000 + Math.floor(Math.random() * 1000)}`,
        formulaId: o.f, productId: o.p, quantity: o.qty, producedQty: o.produced, wasteQty: o.waste,
        status: o.status, qcStatus: o.qc,
        materialCost: Math.round(matCost), laborCost: Math.round(labor), overheadCost: Math.round(overhead),
        totalCost: Math.round(matCost + labor + overhead),
        startDate: new Date(Date.now() - o.daysAgo * 86400000),
        endDate: o.status === 'completed' ? new Date(Date.now() - (o.daysAgo - 1) * 86400000) : null,
      },
    })
  }

  // ---- Inventory Transactions ----
  const txSamples = [
    { type: 'in', itemType: 'material', id: 'M-001', name: 'شیر خام', unit: 'لیتر', qty: 2000, ref: 'خرید تأمین‌کننده', daysAgo: 7 },
    { type: 'out', itemType: 'material', id: 'M-001', name: 'شیر خام', unit: 'لیتر', qty: 315, ref: 'PR تولید شیر', daysAgo: 6 },
    { type: 'in', itemType: 'product', id: 'P-001', name: 'شیر پاستوریزه ۱ لیتر', unit: 'عدد', qty: 295, ref: 'PR تولید شیر', daysAgo: 6 },
    { type: 'out', itemType: 'product', id: 'P-001', name: 'شیر پاستوریزه ۱ لیتر', unit: 'عدد', qty: 105, ref: 'INV-1001', daysAgo: 2 },
    { type: 'out', itemType: 'product', id: 'P-005', name: 'صابون لباسشویی ۲۵۰ گرم', unit: 'عدد', qty: 250, ref: 'INV-1002', daysAgo: 5 },
    { type: 'in', itemType: 'material', id: 'M-002', name: 'شکر سفید', unit: 'کیلوگرام', qty: 1500, ref: 'خرید تأمین‌کننده', daysAgo: 12 },
  ]
  for (const t of txSamples) {
    await db.inventoryTransaction.create({
      data: {
        type: t.type, itemType: t.itemType, itemId: materials[t.id] ?? products[t.id], itemName: t.name,
        unit: t.unit, quantity: t.qty, warehouseId: wh.id, reference: t.ref,
        date: new Date(Date.now() - t.daysAgo * 86400000),
      },
    })
  }

  // ---- Expenses ----
  const expenseSamples = [
    { category: 'برق', description: 'بیل برق ماهانه + جنراتور', amount: 28000, daysAgo: 9 },
    { category: 'حقوق', description: 'حقوق کارگران خط تولید', amount: 120000, daysAgo: 10 },
    { category: 'کرایه', description: 'کرایه ساختمان کارخانه', amount: 45000, daysAgo: 11 },
    { category: 'حمل‌ونقل', description: 'کرایه موترهای توزیع', amount: 18000, daysAgo: 4 },
    { category: 'تعمیرات', description: 'تعمیر ماشین پاستوریزه', amount: 15000, daysAgo: 14 },
  ]
  for (const e of expenseSamples) {
    const { daysAgo, ...rest } = e
    await db.expense.create({ data: { ...rest, date: new Date(Date.now() - daysAgo * 86400000) } })
  }

  // ---- Employees + Attendance + Salaries ----
  const empData = [
    { name: 'محمود نوری', position: 'سرپرست خط تولید', salary: 18000 },
    { name: 'عبدالرحمن احمدی', position: 'کارگر تولید', salary: 12000 },
    { name: 'فاطمه یوسفی', position: 'کنترل کیفیت', salary: 15000 },
    { name: 'شکریه رحیمی', position: 'حسابدار', salary: 16000 },
    { name: 'کریم شاه', position: 'راننده توزیع', salary: 13000 },
  ]
  const emps = []
  for (const e of empData) {
    emps.push(await db.employee.create({ data: { ...e, phone: '0790123000', hireDate: new Date(Date.now() - 400 * 86400000) } }))
  }
  // Attendance for last 5 days
  for (const emp of emps) {
    for (let d = 1; d <= 5; d++) {
      const status = (emp.id.charCodeAt(3) + d) % 7 === 0 ? 'absent' : 'present'
      await db.attendance.create({
        data: { employeeId: emp.id, date: new Date(Date.now() - d * 86400000), status, shift: 'صبح' },
      })
    }
    await db.salaryPayment.create({
      data: { employeeId: emp.id, month: '1403-12', amount: emp.salary, date: new Date(Date.now() - 10 * 86400000) },
    })
  }

  console.log('✅ Seed completed successfully!')
  const counts = {
    products: await db.product.count(),
    materials: await db.rawMaterial.count(),
    formulas: await db.formula.count(),
    sales: await db.sale.count(),
    orders: await db.productionOrder.count(),
    customers: await db.customer.count(),
    employees: await db.employee.count(),
  }
  console.log(counts)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(async () => { await db.$disconnect() })
