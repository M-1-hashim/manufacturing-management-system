'use client'

/**
 * هندلر اسعار — آینهٔ src/app/api/exchange-rate/route.ts + LiveRates در src/lib/exchange-rate.ts
 * حالت محلی هرگز به انترنت وصل نمی‌شود — آخرین نرخ ذخیره‌شده در تنظیمات برمی‌گردد
 * (stale: true — صادقانه: نرخ از مقدار ذخیره‌شده است، نه منبع لحظه‌ای)
 * ?refresh=1 هم همین پاسخ را می‌دهد (کش/انترنتی در کار نیست)
 */

import { route, type RouteDef } from '../types'
import { getSetting, nowISO } from '../db'

// fallback های نهایی — مثل DEFAULT_USD/DEFAULT_PKR در src/lib/exchange-rate.ts
const DEFAULT_USD = 70
const DEFAULT_PKR = 0.25

export const routes: RouteDef[] = [
  // GET /api/exchange-rate (و ?refresh=1)
  route('GET', '/api/exchange-rate', () => {
    const usd = Number(getSetting('usdRate', String(DEFAULT_USD)))
    const pkr = Number(getSetting('pkrRate', String(DEFAULT_PKR)))
    return {
      usd: usd > 0 ? usd : DEFAULT_USD,
      pkr: pkr > 0 ? pkr : DEFAULT_PKR,
      source: getSetting('ratesSource', 'database') || 'database',
      updatedAt: getSetting('ratesUpdatedAt', '') || nowISO(),
      fetchedAt: nowISO(),
      cached: false,
      stale: true,
    }
  }),
]
