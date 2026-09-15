'use client'

/**
 * هندلر گزارشات — آینهٔ دقیق src/app/api/reports/route.ts
 * GET ?range=N — فروش روزانه/ماهانه، مشتریان، پرفروش‌ها، روش پرداخت،
 * مصارف، خلاصهٔ تولید، ارزش‌گذاری انبار و گزارش مالیات.
 */

import { route, type RouteDef } from '../types'
import { readCol, type Row } from '../db'

interface LocalSale extends Row {
  date: string
  total: number
  exchangeRate: number
  taxRate: number
  taxAmount: number
  paymentMethod: string
  customerName: string | null
  customerId: string | null
}
interface LocalSaleItem extends Row {
  saleId: string
  productId: string
  quantity: number
  total: number
}
interface LocalProduct extends Row {
  name: string
  stock: number
  unit: string
  costPrice: number
}
interface LocalRawMaterial extends Row {
  name: string
  stock: number
  unit: string
  purchasePrice: number
}
interface LocalProductionOrder extends Row {
  status: string
  quantity: number
  producedQty: number
  wasteQty: number
  productId: string
  startDate: string
}
interface LocalCustomer extends Row {
  name: string
}
interface LocalExpense extends Row {
  category: string
  amount: number
  date: string
}

function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

export const routes: RouteDef[] = [
  // GET /api/reports?range=90 — گزارشات کامل (فروش، تولید، مالی، انبار)
  route('GET', '/api/reports', (ctx) => {
    let range = Number(ctx.url.searchParams.get('range') ?? '90')
    if (!Number.isFinite(range) || range <= 0) range = 90
    range = Math.min(365, Math.max(7, Math.round(range)))

    const now = new Date()
    const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range - 1))
    const month12Start = new Date(now.getFullYear(), now.getMonth() - 11, 1)

    const pad = (x: number) => String(x).padStart(2, '0')
    // نرخ تبدیل به افغانی
    const toAfn = (r: number | null | undefined) => (r && r > 0 ? r : 1)

    const allSales = readCol<LocalSale>('sales')
    const saleItems = readCol<LocalSaleItem>('saleItems')
    const products = readCol<LocalProduct>('products')
    const materials = readCol<LocalRawMaterial>('rawMaterials')
    const customers = readCol<LocalCustomer>('customers')

    const sales = allSales.filter((s) => timeOf(s.date) >= rangeStart.getTime())
    const sales12 = allSales.filter((s) => timeOf(s.date) >= month12Start.getTime())
    const expenses = readCol<LocalExpense>('expenses').filter(
      (e) => timeOf(e.date) >= rangeStart.getTime()
    )
    const orders = readCol<LocalProductionOrder>('productionOrders').filter(
      (o) => timeOf(o.startDate) >= rangeStart.getTime()
    )

    // ---- فروش به تفکیک روز (همه روزهای بازه حتی بدون فروش) ----
    const dayMap = new Map<string, { total: number; count: number }>()
    for (const s of sales) {
      const d = new Date(s.date)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const cur = dayMap.get(key) ?? { total: 0, count: 0 }
      cur.total += s.total * toAfn(s.exchangeRate)
      cur.count += 1
      dayMap.set(key, cur)
    }
    const salesByDay: { date: string; label: string; total: number; count: number }[] = []
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const cur = dayMap.get(key)
      salesByDay.push({
        date: d.toISOString(),
        label: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
        total: Math.round(cur?.total ?? 0),
        count: cur?.count ?? 0,
      })
    }

    // ---- فروش به تفکیک ماه (۱۲ ماه اخیر) ----
    const monthMap = new Map<string, number>()
    for (const s of sales12) {
      const d = new Date(s.date)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      monthMap.set(key, (monthMap.get(key) ?? 0) + s.total * toAfn(s.exchangeRate))
    }
    const salesByMonth: { label: string; total: number }[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      salesByMonth.push({
        label: `${d.getFullYear()}/${pad(d.getMonth() + 1)}`,
        total: Math.round(monthMap.get(key) ?? 0),
      })
    }

    // ---- فروش به تفکیک مشتری (تاپ ۱۰) ----
    const custAgg = new Map<string, { total: number; orders: number }>()
    for (const s of sales) {
      const name =
        customers.find((c) => c.id === s.customerId)?.name ?? s.customerName ?? 'مشتری متفرقه'
      const cur = custAgg.get(name) ?? { total: 0, orders: 0 }
      cur.total += s.total * toAfn(s.exchangeRate)
      cur.orders += 1
      custAgg.set(name, cur)
    }
    const salesByCustomer = Array.from(custAgg.entries())
      .map(([name, v]) => ({ name, total: Math.round(v.total), orders: v.orders }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)

    // ---- محصولات پرفروش (تاپ ۱۰) ----
    const prodAgg = new Map<string, { qty: number; revenue: number }>()
    for (const s of sales) {
      const r = toAfn(s.exchangeRate)
      for (const it of saleItems.filter((i) => i.saleId === s.id)) {
        const name = products.find((p) => p.id === it.productId)?.name ?? '—'
        const cur = prodAgg.get(name) ?? { qty: 0, revenue: 0 }
        cur.qty += it.quantity
        cur.revenue += it.total * r
        prodAgg.set(name, cur)
      }
    }
    const topProducts = Array.from(prodAgg.entries())
      .map(([name, v]) => ({
        name,
        qty: Math.round(v.qty * 100) / 100,
        revenue: Math.round(v.revenue),
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10)

    // ---- فروش به تفکیک روش پرداخت ----
    const METHOD_NAMES: Record<string, string> = {
      cash: 'نقد',
      credit: 'نسیه',
      transfer: 'حواله',
    }
    const payAgg = new Map<string, { total: number; count: number }>()
    for (const s of sales) {
      const cur = payAgg.get(s.paymentMethod) ?? { total: 0, count: 0 }
      cur.total += s.total * toAfn(s.exchangeRate)
      cur.count += 1
      payAgg.set(s.paymentMethod, cur)
    }
    const salesByPayment = Array.from(payAgg.entries())
      .map(([method, v]) => ({ method: METHOD_NAMES[method] ?? method, total: Math.round(v.total), count: v.count }))
      .sort((a, b) => b.total - a.total)

    // ---- مصارف به تفکیک دسته ----
    const expAgg = new Map<string, number>()
    for (const e of expenses) {
      expAgg.set(e.category, (expAgg.get(e.category) ?? 0) + e.amount)
    }
    const expensesByCategory = Array.from(expAgg.entries())
      .map(([category, total]) => ({ category, total: Math.round(total) }))
      .sort((a, b) => b.total - a.total)

    // ---- خلاصهٔ تولید ----
    const statusAgg = new Map<string, number>()
    const prodByProductAgg = new Map<string, { produced: number; waste: number }>()
    for (const o of orders) {
      statusAgg.set(o.status, (statusAgg.get(o.status) ?? 0) + 1)
      const name = products.find((p) => p.id === o.productId)?.name ?? '—'
      const cur = prodByProductAgg.get(name) ?? { produced: 0, waste: 0 }
      cur.produced += o.producedQty
      cur.waste += o.wasteQty
      prodByProductAgg.set(name, cur)
    }
    const productionSummary = {
      byStatus: Array.from(statusAgg.entries()).map(([status, count]) => ({ status, count })),
      byProduct: Array.from(prodByProductAgg.entries())
        .map(([productName, v]) => ({
          productName,
          produced: Math.round(v.produced * 100) / 100,
          waste: Math.round(v.waste * 100) / 100,
        }))
        .sort((a, b) => b.produced - a.produced)
        .slice(0, 10),
    }

    // ---- ارزش‌گذاری انبار (وضعیت فعلی) ----
    const prodValueAgg = products.map((p) => ({
      name: p.name,
      stock: p.stock,
      unit: p.unit,
      value: Math.round(p.stock * p.costPrice),
    }))
    const matValueAgg = materials.map((m) => ({
      name: m.name,
      stock: m.stock,
      unit: m.unit,
      value: Math.round(m.stock * m.purchasePrice),
    }))
    const productsValue = prodValueAgg.reduce((a, p) => a + p.value, 0)
    const materialsValue = matValueAgg.reduce((a, m) => a + m.value, 0)
    const inventoryValuation = {
      productsValue,
      materialsValue,
      total: productsValue + materialsValue,
      topProducts: prodValueAgg.sort((a, b) => b.value - a.value).slice(0, 10),
      topMaterials: matValueAgg.sort((a, b) => b.value - a.value).slice(0, 10),
    }

    // ---- گزارش مالیات (مجموعه بر اساس نرخ) ----
    let tax2Count = 0
    let tax2Amount = 0
    let tax10Count = 0
    let tax10Amount = 0
    let totalTax = 0
    for (const s of sales) {
      const tax = s.taxAmount * toAfn(s.exchangeRate)
      totalTax += tax
      const rate = Math.round(s.taxRate)
      if (rate === 2) {
        tax2Count += 1
        tax2Amount += tax
      } else if (rate === 10) {
        tax10Count += 1
        tax10Amount += tax
      }
    }
    const taxReport = {
      tax2Count,
      tax2Amount: Math.round(tax2Amount),
      tax10Count,
      tax10Amount: Math.round(tax10Amount),
      totalTax: Math.round(totalTax),
    }

    return {
      range,
      salesByDay,
      salesByMonth,
      salesByCustomer,
      topProducts,
      salesByPayment,
      expensesByCategory,
      productionSummary,
      inventoryValuation,
      taxReport,
    }
  }),
]
