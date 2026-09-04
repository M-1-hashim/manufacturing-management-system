'use client'

// لایه ذخیره‌سازی آفلاین (IndexedDB) — صف عملیات نوشتن + کش پاسخ‌های GET
// در حالت آفلاین، نوشتن‌ها صف می‌شوند و پس از اتصال دوباره به سرور ارسال می‌گردند

const DB_NAME = 'mfg-offline'
const DB_VERSION = 1
const STORE_OPS = 'ops'
const STORE_CACHE = 'cache'
const MAX_CACHE_ENTRIES = 300

export interface QueuedOp {
  id: string
  user: string // نام کاربری سازنده — برای همگام‌سازی فقط توسط همان کاربر
  url: string
  method: string
  body: string // متن خام (JSON)
  createdAt: number
  attempts: number
}

function idbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE_OPS)) d.createObjectStore(STORE_OPS, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(STORE_CACHE)) d.createObjectStore(STORE_CACHE, { keyPath: 'url' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const tx = d.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
        tx.oncomplete = () => d.close()
      })
  )
}

// ---------------- صف عملیات نوشتن ----------------
export async function enqueueOp(op: QueuedOp): Promise<void> {
  if (!idbAvailable()) return
  try {
    await withStore(STORE_OPS, 'readwrite', (s) => s.put(op))
  } catch {
    /* حالت خصوصی مرورگر — نادیده گرفته می‌شود */
  }
}

export async function listOps(): Promise<QueuedOp[]> {
  if (!idbAvailable()) return []
  try {
    const all = await withStore<QueuedOp[]>(STORE_OPS, 'readonly', (s) => s.getAll() as IDBRequest<QueuedOp[]>)
    return all.sort((a, b) => a.createdAt - b.createdAt)
  } catch {
    return []
  }
}

export async function removeOp(id: string): Promise<void> {
  if (!idbAvailable()) return
  try {
    await withStore(STORE_OPS, 'readwrite', (s) => s.delete(id))
  } catch {
    /* بی‌اهمیت */
  }
}

export async function updateOp(op: QueuedOp): Promise<void> {
  await enqueueOp(op)
}

export async function countOps(): Promise<number> {
  if (!idbAvailable()) return 0
  try {
    return await withStore<number>(STORE_OPS, 'readonly', (s) => s.count())
  } catch {
    return 0
  }
}

// ---------------- کش پاسخ‌های GET ----------------
export async function cachePut(url: string, body: unknown): Promise<void> {
  if (!idbAvailable()) return
  try {
    await withStore(STORE_CACHE, 'readwrite', (s) => s.put({ url, body, ts: Date.now() }))
    // محدود کردن تعداد مدخل‌ها (حذف قدیمی‌ترین‌ها)
    const count = await withStore<number>(STORE_CACHE, 'readonly', (s) => s.count())
    if (count > MAX_CACHE_ENTRIES) {
      const all = await withStore<{ url: string; ts: number }[]>(STORE_CACHE, 'readonly', (s) => s.getAll() as IDBRequest<{ url: string; ts: number }[]>)
      const stale = all.sort((a, b) => a.ts - b.ts).slice(0, count - MAX_CACHE_ENTRIES)
      for (const e of stale) {
        await withStore(STORE_CACHE, 'readwrite', (s) => s.delete(e.url))
      }
    }
  } catch {
    /* بی‌اهمیت */
  }
}

export async function cacheGet(url: string): Promise<{ body: unknown; ts: number } | null> {
  if (!idbAvailable()) return null
  try {
    const rec = await withStore<{ url: string; body: unknown; ts: number } | undefined>(
      STORE_CACHE,
      'readonly',
      (s) => s.get(url) as IDBRequest<{ url: string; body: unknown; ts: number } | undefined>
    )
    return rec ? { body: rec.body, ts: rec.ts } : null
  } catch {
    return null
  }
}

export async function cacheClear(): Promise<void> {
  if (!idbAvailable()) return
  try {
    await withStore(STORE_CACHE, 'readwrite', (s) => s.clear())
  } catch {
    /* بی‌اهمیت */
  }
}

/** حذف مدخل‌های کش با پیشوند مشخص — پس از صف شدن یک نوشتن */
export async function cacheInvalidatePrefix(prefix: string): Promise<void> {
  if (!idbAvailable()) return
  try {
    const all = await withStore<{ url: string }[]>(STORE_CACHE, 'readonly', (s) => s.getAllKeys() as unknown as IDBRequest<string[]>)
    for (const url of all) {
      if (typeof url === 'string' && url.startsWith(prefix)) {
        await withStore(STORE_CACHE, 'readwrite', (s) => s.delete(url))
      }
    }
  } catch {
    /* بی‌اهمیت */
  }
}
