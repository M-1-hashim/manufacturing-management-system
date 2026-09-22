import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getLiveRates } from '@/lib/exchange-rate'

// GET /api/dashboard — همه داده‌های خلاصه داشبورد در یک درخواست
export async function GET() {
  try {
    // تجدید خودکار اسعار (sarafi.af) — کش حافظه ۱ ساعته؛ فقط وقتی تجدید خودکار فعال باشد
    // تنظیمات به‌روز می‌شود تا مصارف/گزارش‌ها همیشه نرخ تازه را ببینند. هرگز مسیر را نمی‌شکند.
    await getLiveRates().catch(() => null)
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const day14Start = new Date(now.getTime() - 13 * 86400000)
    const day90Start = new Date(now.getTime() - 89 * 86400000)
    // برای روند 14 روزه باید از اول ماه هم عقب‌تر برویم اگر لازم شد
    const trendStart = monthStart < day14Start ? monthStart : day14Start
    const month6Start = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const pad = (x: number) => String(x).padStart(2, '0')
    // نرخ تبدیل به افغانی (برای فروش‌های دالری/کلداری)
    const toAfn = (r: number | null | undefined) => (r && r > 0 ? r : 1)

    const [salesWindow, sales90, unpaidSales, recentSaleRows, expenses, products, materials, orders, settingRows] =
      await Promise.all([
        db.sale.findMany({
          where: { date: { gte: trendStart } },
          select: { date: true, total: true, exchangeRate: true },
        }),
        db.sale.findMany({
          where: { date: { gte: day90Start } },
          select: {
            exchangeRate: true,
            items: {
              select: { quantity: true, total: true, product: { select: { name: true } } },
            },
          },
        }),
        db.sale.findMany({
          where: { status: { in: ['unpaid', 'partial'] } },
          select: { total: true, paidAmount: true, exchangeRate: true },
        }),
        db.sale.findMany({
          orderBy: { date: 'desc' },
          take: 8,
          select: {
            invoiceNumber: true,
            total: true,
            status: true,
            date: true,
            customerName: true,
            exchangeRate: true,
            customer: { select: { name: true } },
            _count: { select: { items: true } },
          },
        }),
        db.expense.findMany({
          where: { date: { gte: monthStart } },
          select: { amount: true, currency: true },
        }),
        db.product.findMany({
          select: { name: true, stock: true, minStock: true, unit: true, costPrice: true },
        }),
        db.rawMaterial.findMany({
          select: { name: true, stock: true, minStock: true, unit: true, purchasePrice: true },
        }),
        db.productionOrder.findMany({
          where: { startDate: { gte: month6Start } },
          select: { status: true, quantity: true, producedQty: true, startDate: true },
        }),
        // نرخ‌های ارز از تنظیمات — یک‌بار در هر درخواست
        db.setting.findMany({
          where: { key: { in: ['usdRate', 'pkrRate'] } },
          select: { key: true, value: true },
        }),
      ])

    // ---- آمار کلی ----
    let salesThisMonth = 0
    let salesToday = 0
    for (const s of salesWindow) {
      const v = s.total * toAfn(s.exchangeRate)
      if (s.date >= monthStart) salesThisMonth += v
      if (s.date >= todayStart) salesToday += v
    }

    let receivables = 0
    for (const s of unpaidSales) {
      receivables += (s.total - s.paidAmount) * toAfn(s.exchangeRate)
    }

    // مصارف به ارز خودشان ثبت می‌شوند — نرخ تبدیل به افغانی (نرخ ناموجود/نامعتبر → ۱)
    const usdRate = toAfn(Number(settingRows.find((r) => r.key === 'usdRate')?.value))
    const pkrRate = toAfn(Number(settingRows.find((r) => r.key === 'pkrRate')?.value))
    const expenseRate = (currency: string | null | undefined) =>
      currency === 'USD' ? usdRate : currency === 'PKR' ? pkrRate : 1

    // جمع مصارف ماه فقط بعد از تبدیل همهٔ ارزها به افغانی
    const expensesThisMonth = expenses.reduce((a, e) => a + e.amount * expenseRate(e.currency), 0)

    // موجودی کم (فقط اقلام که حداقل موجودی برایشان تعیین شده)
    const lowStockProducts = products.filter((p) => p.minStock > 0 && p.stock <= p.minStock)
    const lowStockMaterials = materials.filter((m) => m.minStock > 0 && m.stock <= m.minStock)

    const productsValue = products.reduce((a, p) => a + p.stock * p.costPrice, 0)
    const materialsValue = materials.reduce((a, m) => a + m.stock * m.purchasePrice, 0)

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

    // ---- روند فروش 14 روز اخیر (روزهای خالی صفر) ----
    const trendMap = new Map<string, number>()
    for (const s of salesWindow) {
      const d = s.date
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

    // ---- روند تولید 6 ماه اخیر ----
    const prodMap = new Map<string, { planned: number; produced: number }>()
    for (const o of orders) {
      const key = `${o.startDate.getFullYear()}-${o.startDate.getMonth()}`
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

    // ---- محصولات پرفروش 90 روز اخیر (تاپ 5) ----
    const prodAgg = new Map<string, { qty: number; revenue: number }>()
    for (const s of sales90) {
      const r = toAfn(s.exchangeRate)
      for (const it of s.items) {
        const name = it.product?.name ?? '—'
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

    // ---- آخرین فروش‌ها (8 بل) ----
    const recentSales = recentSaleRows.map((s) => ({
      invoiceNumber: s.invoiceNumber,
      customerName: s.customer?.name ?? s.customerName ?? '—',
      total: Math.round(s.total * toAfn(s.exchangeRate)),
      status: s.status,
      date: s.date.toISOString(),
      itemsCount: s._count.items,
    }))

    // ---- هشدار موجودی کم (محصولات + مواد، حداکثر 10) ----
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

    return NextResponse.json({
      stats,
      salesTrend,
      productionTrend,
      topProducts,
      recentSales,
      lowStock,
      statusCounts,
    })
  } catch (e) {
    console.error('dashboard GET', e)
    return NextResponse.json({ error: 'خطا در دریافت داده‌های داشبورد' }, { status: 500 })
  }
}
