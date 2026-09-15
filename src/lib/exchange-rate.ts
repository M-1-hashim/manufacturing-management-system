// اسعار لحظه‌ای — دریافت از API عمومی واقعی (رایگان بدون کلید)
// منبع اصلی: exchangerate-api.com (open.er-api.com)
// منبع کاپی احتیاطی: fawazahmed0 currency-api روی CDN jsDelivr
// کش حافظه 1 ساعته + ذخیره در دیتابیس تا حتی هنگام قطع انترنت، آخرین نرخ در دسترس باشد
import { db } from '@/lib/db'

export interface LiveRates {
  usd: number // 1 USD = ? AFN
  pkr: number // 1 PKR = ? AFN
  source: string // منبع نرخ
  updatedAt: string // آخرین تجدید نرخ از سوی منبع (ISO)
  fetchedAt: string // زمان دریافت روی هاست (ISO)
  cached: boolean // از کش حافظه هاست
  stale: boolean // true → انترنت در دسترس نبود؛ آخرین نرخ ذخیره‌شده در دیتابیس
  nextUpdate?: string // تجدید بعدی منبع (ISO)
}

const TTL_MS = 60 * 60 * 1000 // کش حافظه هاست: 1 ساعت
const FETCH_TIMEOUT_MS = 8000
const DEFAULT_USD = 70 // fallback نهایی اگر هیچ منبعی نبود
const DEFAULT_PKR = 0.25

let mem: LiveRates | null = null
let memAt = 0
let inflight: Promise<LiveRates> | null = null

async function fetchJson(url: string): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

interface ProviderResult {
  usd: number
  pkr: number
  source: string
  updatedAt: string
  nextUpdate?: string
}

const round2 = (n: number) => Math.round(n * 100) / 100

// ---- منبع اصلی: open.er-api.com ----
async function fromErApi(): Promise<ProviderResult> {
  const j = (await fetchJson('https://open.er-api.com/v6/latest/USD')) as {
    result?: string
    rates?: Record<string, number>
    time_last_update_unix?: number
    time_next_update_unix?: number
  }
  if (j.result !== 'success' || !j.rates?.AFN || Number(j.rates.AFN) <= 0) {
    throw new Error('er-api: AFN rate missing')
  }
  // نرخ‌های API نسبت به USD هستند: 1 USD = X AFN و 1 USD = Y PKR
  // نرخ کلدار به افغانی = AFN_per_USD ÷ PKR_per_USD
  const afnPerUsd = Number(j.rates.AFN)
  const pkrPerUsd = j.rates.PKR ? Number(j.rates.PKR) : 0
  return {
    usd: round2(afnPerUsd),
    pkr: pkrPerUsd > 0 ? round2(afnPerUsd / pkrPerUsd) : 0,
    source: 'exchangerate-api.com',
    updatedAt: new Date((j.time_last_update_unix ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    nextUpdate: j.time_next_update_unix
      ? new Date(j.time_next_update_unix * 1000).toISOString()
      : undefined,
  }
}

// ---- منبع کاپی احتیاطی: currency-api روی jsDelivr ----
async function fromJsDelivr(): Promise<ProviderResult> {
  const j = (await fetchJson(
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json'
  )) as { date?: string; usd?: Record<string, number> }
  if (!j.usd?.afn || Number(j.usd.afn) <= 0) throw new Error('jsdelivr: AFN rate missing')
  // نرخ‌های API نسبت به USD هستند: 1 USD = X AFN و 1 USD = Y PKR
  const afnPerUsd = Number(j.usd.afn)
  const pkrPerUsd = j.usd.pkr ? Number(j.usd.pkr) : 0
  return {
    usd: round2(afnPerUsd),
    pkr: pkrPerUsd > 0 ? round2(afnPerUsd / pkrPerUsd) : 0,
    source: 'currency-api (jsDelivr)',
    updatedAt: j.date ? new Date(`${j.date}T00:00:00Z`).toISOString() : new Date().toISOString(),
  }
}

async function fetchLive(): Promise<ProviderResult> {
  const providers = [fromErApi, fromJsDelivr]
  let lastErr: unknown = null
  for (const p of providers) {
    try {
      return await p()
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('هیچ منبع اسعار در دسترس نیست')
}

async function readDbRates(): Promise<Record<string, string>> {
  try {
    const rows = await db.setting.findMany({
      where: { key: { in: ['usdRate', 'pkrRate', 'ratesUpdatedAt', 'ratesSource'] } },
    })
    const out: Record<string, string> = {}
    for (const r of rows) out[r.key] = r.value
    return out
  } catch {
    return {}
  }
}

async function isAutoSyncEnabled(): Promise<boolean> {
  try {
    const row = await db.setting.findUnique({ where: { key: 'ratesAutoSync' } })
    return row?.value !== '0' // پیش‌فرض: فعال
  } catch {
    return true
  }
}

async function persistRates(live: ProviderResult): Promise<void> {
  if (!(await isAutoSyncEnabled())) return // حالت دستی → نرخ‌های دیتابیس دست‌نخورده می‌مانند
  const upsert = (key: string, value: string) =>
    db.setting.upsert({ where: { key }, update: { value }, create: { key, value } })
  await Promise.all([
    upsert('usdRate', String(live.usd)),
    live.pkr > 0 ? upsert('pkrRate', String(live.pkr)) : Promise.resolve(),
    upsert('ratesUpdatedAt', live.updatedAt),
    upsert('ratesSource', live.source),
  ])
}

/**
 * نرخ‌های لحظه‌ای را برمی‌گرداند.
 * force=true → کش حافظه نادیده گرفته می‌شود (تجدید دستی از تنظیمات)
 */
export async function getLiveRates(force = false): Promise<LiveRates> {
  if (!force && mem && Date.now() - memAt < TTL_MS) return { ...mem, cached: true }

  if (!inflight) {
    inflight = (async (): Promise<LiveRates> => {
      try {
        const live = await fetchLive()
        const result: LiveRates = {
          usd: live.usd,
          pkr: live.pkr > 0 ? live.pkr : DEFAULT_PKR,
          source: live.source,
          updatedAt: live.updatedAt,
          fetchedAt: new Date().toISOString(),
          cached: false,
          stale: false,
          nextUpdate: live.nextUpdate,
        }
        mem = result
        memAt = Date.now()
        try {
          await persistRates(live)
        } catch {
          /* ذخیره در دیتابیس حیاتی نیست */
        }
        return result
      } catch {
        // انترنت قطع / منابع در دسترس نیست → آخرین نرخ ذخیره‌شده در دیتابیس
        const dbv = await readDbRates()
        const result: LiveRates = {
          usd: Number(dbv.usdRate) > 0 ? Number(dbv.usdRate) : DEFAULT_USD,
          pkr: Number(dbv.pkrRate) > 0 ? Number(dbv.pkrRate) : DEFAULT_PKR,
          source: dbv.ratesSource || 'database',
          updatedAt: dbv.ratesUpdatedAt || new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          cached: false,
          stale: true,
        }
        mem = result
        memAt = Date.now()
        return result
      } finally {
        inflight = null
      }
    })()
  }
  return inflight
}
