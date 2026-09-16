'use client'

/**
 * هندلر داشبورد — آینهٔ دقیق src/app/api/dashboard/route.ts
 * آمار کلی + روند ۱۴ روزهٔ فروش + روند ۶ ماههٔ تولید + پرفروش‌ها +
 * آخرین ۸ بل + هشدار موجودی کم — همه از کولکشن‌های localStorage.
 */

import { route, type RouteDef } from '../types'
import { getSetting, readCol, type Row } from '../db'

interface LocalSale extends Row {
  date: string
  total: number
  exchangeRate: number
  status: string
  paidAmount: number
  invoiceNumber: string
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
  minStock: number
  unit: string
  costPrice: number
}
interface LocalRawMaterial extends Row {
  name: string
  stock: number
  minStock: number
  unit: string
  purchasePrice: number
}
interface LocalProductionOrder extends Row {
  status: string
  quantity: number
  producedQty: number
  startDate: string
}
interface LocalCustomer extends Row {
  name: string
}
interface LocalExpense extends Row {
  amount: number
  currency: string
  date: string
}

function timeOf(v: unknown): number {
  const t = new Date(String(v ?? '')).getTime()
  return isNaN(t) ? 0 : t
}

/** ISO امن — رکورد خراب به‌جای کرش، تاریخ epoch می‌گیرد */
function isoOf(v: unknown): string {
  const d = new Date(String(v ?? ''))
  return isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString()
}

export const routes: RouteDef[] = [
  // GET /api/dashboard — همه داده‌های خلاصه در یک درخواست
  route('GET', '/api/dashboard', () => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const day14Start = new Date(now.getTime() - 13 * 86400000)
    const day90Start = new Date(now.getTime() - 89 * 86400000)
    // برای روند ۱۴ روزه باید از اول ماه هم عقب‌تر برویم اگر لازم شد
    const trendStart = monthStart < day14Start ? monthStart : day14Start
    const month6Start = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const pad = (x: number) => String(x).padStart(2, '0')
    // نرخ تبدیل به افغانی (برای فروش‌های دالری/کلداری)
    const toAfn = (r: number | null | undefined) => (r && r > 0 ? r : 1)

    // نرخ‌های ارز از تنظیمات — یک‌بار برای هر درخواست
    // (مصارف به ارز خودشان ثبت می‌شوند — نرخ ناموجود/نامعتبر → ۱)
    const usdRate = toAfn(Number(getSetting('usdRate')))
    const pkrRate = toAfn(Number(getSetting('pkrRate')))
    const expenseRate = (currency: string | null | undefined) =>
      currency === 'USD' ? usdRate : currency === 'PKR' ? pkrRate : 1

    const allSales = readCol<LocalSale>('sales')
    const saleItems = readCol<LocalSaleItem>('saleItems')
    const products = readCol<LocalProduct>('products')
    const materials = readCol<LocalRawMaterial>('rawMaterials')
    const allOrders = readCol<LocalProductionOrder>('productionOrders')

    // ---- آمار کلی ----
    const salesWindow = allSales.filter((s) => timeOf(s.date) >= trendStart.getTime())
    let salesThisMonth = 0
    let salesToday = 0
    for (const s of salesWindow) {
      const v = s.total * toAfn(s.exchangeRate)
      if (timeOf(s.date) >= monthStart.getTime()) salesThisMonth += v
      if (timeOf(s.date) >= todayStart.getTime()) salesToday += v
    }

    let receivables = 0
    for (const s of allSales) {
      if (s.status === 'unpaid' || s.status === 'partial') {
        receivables += (s.total - s.paidAmount) * toAfn(s.exchangeRate)
      }
    }

    // جمع مصارف ماه فقط بعد از تبدیل همهٔ ارزها به افغانی
    const expensesThisMonth = readCol<LocalExpense>('expenses')
      .filter((e) => timeOf(e.date) >= monthStart.getTime())
      .reduce((a, e) => a + e.amount * expenseRate(e.currency), 0)

    // موجودی کم (فقط اقلام که حداقل موجودی برایشان تعیین شده)
    const lowStockProducts = products.filter((p) => p.minStock > 0 && p.stock <= p.minStock)
    const lowStockMaterials = materials.filter((m) => m.minStock > 0 && m.stock <= m.minStock)

    const productsValue = products.reduce((a, p) => a + p.stock * p.costPrice, 0)
    const materialsValue = materials.reduce((a, m) => a + m.stock * m.purchasePrice, 0)

    const orders = allOrders.filter((o) => timeOf(o.startDate) >= month6Start.getTime())
    const statusCounts: Record<string, number> = {
      pending: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    }
    for (const o of orders) {
      statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1
    }

    const stats = {
      salesThisMonth: Math.round(salesThisMonth),
      salesToday: Math.round(salesToday),
      productionActive: (statusCounts.in_progress ?? 0) + (statusCounts.pending ?? 0),
      productionCompleted: statusCounts.completed ?? 0,
      productsCount: products.length,
      lowStockProductsCount: lowStockProducts.length,
      lowStockMaterialsCount: lowStockMaterials.length,
      expensesThisMonth: Math.round(expensesThisMonth),
      receivables: Math.round(receivables),
      inventoryValue: Math.round(productsValue + materialsValue),
    }

    // ---- روند فروش ۱۴ روز اخیر (روزهای خالی صفر) ----
    const trendMap = new Map<string, number>()
    for (const s of salesWindow) {
      const d = new Date(s.date)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      trendMap.set(key, (trendMap.get(key) ?? 0) + s.total * toAfn(s.exchangeRate))
    }
    const salesTrend: { date: string; label: string; total: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      salesTrend.push({
        date: d.toISOString(),
        label: `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`,
        total: Math.round(trendMap.get(key) ?? 0),
      })
    }

    // ---- روند تولید ۶ ماه اخیر ----
    const prodMap = new Map<string, { planned: number; produced: number }>()
    for (const o of orders) {
      const d = new Date(o.startDate)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const cur = prodMap.get(key) ?? { planned: 0, produced: 0 }
      cur.planned += o.quantity
      cur.produced += o.producedQty
      prodMap.set(key, cur)
    }
    const productionTrend: { label: string; planned: number; produced: number }[] = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = `${d.getFullYear()}-${d.getMonth()}`
      const cur = prodMap.get(key)
      productionTrend.push({
        label: `${d.getFullYear()}/${pad(d.getMonth() + 1)}`,
        planned: Math.round(cur?.planned ?? 0),
        produced: Math.round(cur?.produced ?? 0),
      })
    }

    // ---- محصولات پرفروش ۹۰ روز اخیر (تاپ ۵) ----
    const sales90 = allSales.filter((s) => timeOf(s.date) >= day90Start.getTime())
    const prodAgg = new Map<string, { qty: number; revenue: number }>()
    for (const s of sales90) {
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
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)

    // ---- آخرین فروش‌ها (۸ بل) ----
    const recentRows = [...allSales].sort((a, b) => timeOf(b.date) - timeOf(a.date)).slice(0, 8)
    const customers = readCol<LocalCustomer>('customers')
    const recentSales = recentRows.map((s) => ({
      invoiceNumber: s.invoiceNumber,
      customerName:
        customers.find((c) => c.id === s.customerId)?.name ?? s.customerName ?? '—',
      total: Math.round(s.total * toAfn(s.exchangeRate)),
      status: s.status,
      date: isoOf(s.date),
      itemsCount: saleItems.filter((i) => i.saleId === s.id).length,
    }))

    // ---- هشدار موجودی کم (محصولات + مواد، حداکثر ۱۰) ----
    const lowStockAll: {
      type: 'product' | 'material'
      name: string
      stock: number
      minStock: number
      unit: string
    }[] = []
    for (const p of lowStockProducts) {
      lowStockAll.push({ type: 'product', name: p.name, stock: p.stock, minStock: p.minStock, unit: p.unit })
    }
    for (const m of lowStockMaterials) {
      lowStockAll.push({ type: 'material', name: m.name, stock: m.stock, minStock: m.minStock, unit: m.unit })
    }
    // شدیدترین کاستی اول (نسبت موجودی به حداقل)
    lowStockAll.sort((a, b) => a.stock / a.minStock - b.stock / b.minStock)
    const lowStock = lowStockAll.slice(0, 10)

    return {
      stats,
      salesTrend,
      productionTrend,
      topProducts,
      recentSales,
      lowStock,
      statusCounts,
    }
  }),
]
