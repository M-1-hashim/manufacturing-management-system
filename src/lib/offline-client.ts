'use client'

// موتور حالت آفلاین — رهگیری fetch، کش‌کردن GET ها، صف‌کردن نوشتن‌ها
// و همگام‌سازی خودکار پس از بازگشت اتصال (ارسال آفلاین‌ها + دریافت داده‌های تازه)
import { toast } from 'sonner'
import { useAppStore } from '@/lib/store'
import {
  enqueueOp,
  listOps,
  removeOp,
  updateOp,
  countOps,
  cacheGet,
  cachePut,
  cacheClear,
  cacheInvalidatePrefix,
  type QueuedOp,
} from '@/lib/offline-db'

const SKIP_PREFIXES = ['/api/auth/', '/api/admin/'] // نشست/کاپی احتیاطی — صف و کش نمی‌شوند
const SYNC_INTERVAL_MS = 45_000
const MAX_ATTEMPTS = 5

const MSG = {
  fa: {
    queued: 'آفلاین ذخیره شد — پس از وصل شدن، خودکار همگام می‌شود',
    cached: 'نمایش داده‌های ذخیره‌شده (آفلاین)',
    synced: (n: number) => `${n} اجراؤات آفلاین با هاست همگام شد`,
    failed: (n: number) => `${n} اجراؤات همگام نشد و حذف شد`,
  },
  ps: {
    queued: 'افلاین خوندي شو — له نښلېدو وروسته اتوماتیک همغه کیږي',
    cached: 'د خوندي شویو معلوماتو نمایش (افلاین)',
    synced: (n: number) => `${n} افلاین عملیې سره همغه شول`,
    failed: (n: number) => `${n} عملیې همغه نه شوې`,
  },
  en: {
    queued: 'Saved offline — will sync automatically once back online',
    cached: 'Showing cached data (offline)',
    synced: (n: number) => `${n} offline operation(s) synced with server`,
    failed: (n: number) => `${n} operation(s) failed to sync and were removed`,
  },
} as const

function m<K extends keyof (typeof MSG)['fa']>(key: K, ...args: unknown[]): string {
  const lang = useAppStore.getState().lang
  const entry = MSG[lang][key] as unknown
  return typeof entry === 'function' ? (entry as (...a: unknown[]) => string)(...args) : (entry as string)
}

let originalFetch: typeof fetch | null = null
let installed = false
let syncing = false

// ---------------- ابزارها ----------------
function synthetic(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function apiUrl(urlStr: string): string {
  try {
    return new URL(urlStr, window.location.origin).pathname + new URL(urlStr, window.location.origin).search
  } catch {
    return urlStr
  }
}

function isSkipped(pathname: string): boolean {
  return SKIP_PREFIXES.some((p) => pathname.startsWith(p))
}

async function bodyTextOf(init?: RequestInit): Promise<string> {
  const b = init?.body
  if (typeof b === 'string') return b
  return ''
}

async function queueWrite(pathname: string, method: string, bodyText: string): Promise<Response> {
  const op: QueuedOp = {
    id: (crypto.randomUUID?.() ?? `op-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    user: useAppStore.getState().user?.username ?? '',
    url: pathname,
    method,
    body: bodyText,
    createdAt: Date.now(),
    attempts: 0,
  }
  await enqueueOp(op)
  // حذف داده‌های کش مرتبط تا پس از رفرش، داده کهنه نمایش داده نشود
  const prefix = pathname.split('/').slice(0, 3).join('/')
  await cacheInvalidatePrefix(prefix)
  void refreshPendingCount()
  toast.info(m('queued'))
  return synthetic({ offlineQueued: true }, { 'x-offline-queued': '1' })
}

// ---------------- رهگیری fetch ----------------
async function wrappedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const pathname = apiUrl(raw)
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const isApi = pathname.startsWith('/api/')

  // درخواست‌های خارجی و مسیرهای مستثنی مستقیم ارسال می‌شوند
  if (!isApi || isSkipped(pathname)) {
    return originalFetch!(input, init)
  }

  // ---------- GET: کش + نمایش آفلاین ----------
  if (method === 'GET') {
    if (!navigator.onLine) {
      const c = await cacheGet(pathname)
      if (c) {
        toast.info(m('cached'))
        return synthetic(c.body, { 'x-offline-cache': '1' })
      }
    }
    try {
      const res = await originalFetch!(input, init)
      if (res.ok) {
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('application/json')) {
          const clone = res.clone()
          void clone
            .json()
            .then((b) => cachePut(pathname, b))
            .catch(() => {})
        }
      }
      return res
    } catch (err) {
      // خطای شبکه (هاست در دسترس نیست) → از کش نمایش بده
      const c = await cacheGet(pathname)
      if (c) {
        toast.info(m('cached'))
        return synthetic(c.body, { 'x-offline-cache': '1' })
      }
      throw err
    }
  }

  // ---------- نوشتن: آفلاین → صف ----------
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  if (isWrite) {
    const bodyText = await bodyTextOf(init)
    if (!navigator.onLine) {
      return queueWrite(pathname, method, bodyText)
    }
    try {
      return await originalFetch!(input, init)
    } catch (err) {
      // هاست در دسترس نبود اما مرورگر آنلاین گزارش می‌شود → صف کن
      return queueWrite(pathname, method, bodyText)
    }
  }

  return originalFetch!(input, init)
}

// ---------------- همگام‌سازی ----------------
export async function trySync(): Promise<{ done: number; failed: number } | null> {
  if (syncing || !navigator.onLine) return null
  const user = useAppStore.getState().user
  if (!user) return null
  const ops = await listOps()
  if (ops.length === 0) return null

  syncing = true
  let done = 0
  let failed = 0
  let networkLost = false
  try {
    for (const op of ops) {
      // فقط اجراؤات همین کاربر همگام می‌شود
      if (op.user && op.user !== user.username) continue
      try {
        const res = await originalFetch!(op.url, {
          method: op.method,
          headers: {
            'Content-Type': 'application/json',
            'X-Synced-Op': op.id,
          },
          body: op.method === 'DELETE' ? undefined : op.body || undefined,
        })
        if (res.ok) {
          await removeOp(op.id)
          done++
        } else if (res.status === 401) {
          break // نشست ختم شده — پس از ورود دوباره کوشش می‌شود
        } else if (res.status >= 400 && res.status < 500) {
          await removeOp(op.id) // خطای دائمی (مثلاً اعتبارسنجی) — قابل تکرار نیست
          failed++
        } else {
          op.attempts += 1
          if (op.attempts >= MAX_ATTEMPTS) {
            await removeOp(op.id)
            failed++
          } else {
            await updateOp(op)
          }
        }
      } catch {
        op.attempts += 1
        if (op.attempts >= MAX_ATTEMPTS) {
          await removeOp(op.id)
          failed++
        } else {
          await updateOp(op)
        }
        networkLost = true
        break // اتصال قطع شد — دفعه بعد
      }
    }
  } finally {
    syncing = false
    await refreshPendingCount()
    if (done > 0) toast.success(m('synced', done))
    if (failed > 0) toast.error(m('failed', failed))
    if (done > 0) {
      // دریافت داده‌های تازه هاست — پاک‌سازی کش و بارگیری مجدد
      await cacheClear()
      if (!networkLost) {
        setTimeout(() => window.location.reload(), 1200)
      }
    }
  }
  return { done, failed }
}

export async function refreshPendingCount(): Promise<void> {
  const n = await countOps()
  useAppStore.getState().setPendingOps(n)
}

/** خروج/تغییر کاربر — کش داده‌های کاربر قبلی پاک می‌شود (صف اجراؤات باقی می‌ماند) */
export async function clearOfflineCache(): Promise<void> {
  await cacheClear()
}

/** نصب یک‌باره: رهگیری fetch + شنونده اتصال + تایمر همگام‌سازی */
export function installOfflineInterceptor(): void {
  if (typeof window === 'undefined' || installed) return
  installed = true
  originalFetch = window.fetch.bind(window)
  window.fetch = wrappedFetch as typeof fetch

  window.addEventListener('online', () => {
    void trySync()
  })
  window.addEventListener('offline', () => {
    void refreshPendingCount()
  })
  setInterval(() => {
    void trySync()
  }, SYNC_INTERVAL_MS)
  void refreshPendingCount()
}
