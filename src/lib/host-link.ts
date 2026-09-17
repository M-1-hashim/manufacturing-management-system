'use client'

/**
 * پیوند هاست — پیکربندی سرور مرکزی + حافظهٔ اعتبارنامه‌ها + لایهٔ HTTP مشترک
 *
 * برای هر دو پلتفرم:
 *  - APK (LOCAL_MODE): «هاست» = آدرس نسخهٔ وب نصب‌شده روی سرور؛ ورود از طریق
 *    پل بومی AndroidBridge.httpRequest (بدون محدودیت CORS) و در مرورگر با fetch عادی.
 *  - دسکتاپ/وب: فقط حافظهٔ اعتبارنامه‌ها (پیش‌پرکردن فرم ورود) استفاده می‌شود؛
 *    اتصال دیتابیس دسکتاپ از مسیر db-connection.txt الکترون می‌آید.
 *
 * کلیدهای localStorage:
 *  - setab-local.hostConfig  → { url, verifiedAt, serverVersion, cookie, cookieAt, lastPullAt, lastPullError }
 *  - setab-local.savedCreds  → base64(JSON{ username, password, savedAt })
 *    (پسورد متن ساده — همان موضع دیتابیس محلی و db-connection.txt دسکتاپ)
 *
 * قرارداد پل اندروید (MainActivity.java):
 *   AndroidBridge.httpRequest(tag, url, method, headersJson, body, timeoutMs)
 *   → پاسخ ناهمگام: window.__setabHttpResolve(tag, base64Payload)
 *     base64Payload = base64(UTF8(JSON{ status, headers:{"set-cookie"?:string,"content-type"?:string}, text }))
 */

// ---------------- انواع ----------------

export interface HostConfig {
  /** آدرس پایهٔ سرور — مثل https://erp.example.com یا https://host.com/erp */
  url: string
  verifiedAt?: string
  serverVersion?: string
  /** کوکی نشست هاست (mfg_session) — فقط از مسیر پل اندروید قابل خواندن است */
  cookie?: string
  cookieAt?: string
  lastPullAt?: string
  lastPullError?: string | null
}

export interface SavedCreds {
  username: string
  password: string
  savedAt: string
}

export interface BridgeHttpResult {
  status: number
  headers: Record<string, string>
  text: string
}

const HOST_KEY = 'setab-local.hostConfig'
const CREDS_KEY = 'setab-local.savedCreds'

// ---------------- base64 امن یونیکد ----------------

export function b64encode(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function b64decode(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

// ---------------- پیکربندی هاست ----------------

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* حافظه در دسترس نیست */
  }
}

export function getHostConfig(): HostConfig | null {
  const raw = safeGet(HOST_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as HostConfig
    if (!parsed?.url) return null
    return parsed
  } catch {
    return null
  }
}

export function saveHostConfig(cfg: HostConfig): void {
  safeSet(HOST_KEY, JSON.stringify(cfg))
}

export function updateHostConfig(patch: Partial<HostConfig>): HostConfig | null {
  const cur = getHostConfig()
  if (!cur) return null
  const next = { ...cur, ...patch }
  saveHostConfig(next)
  return next
}

export function clearHostConfig(): void {
  try {
    localStorage.removeItem(HOST_KEY)
  } catch {
    /* ignore */
  }
}

/** نرمال‌سازی آدرس واردشده: پیش‌فرض https، حذف / انتهایی و کوئری */
export function normalizeHostUrl(input: string): string {
  let u = String(input || '').trim()
  if (!u) return ''
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u
  u = u.replace(/[?#].*$/, '').replace(/\/+$/, '')
  return u
}

// ---------------- حافظهٔ اعتبارنامه‌ها ----------------

export function getSavedCreds(): SavedCreds | null {
  const raw = safeGet(CREDS_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(b64decode(raw)) as SavedCreds
    if (!parsed?.username || typeof parsed.password !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function saveCreds(username: string, password: string): void {
  const data: SavedCreds = { username, password, savedAt: new Date().toISOString() }
  safeSet(CREDS_KEY, b64encode(JSON.stringify(data)))
}

export function clearSavedCreds(): void {
  try {
    localStorage.removeItem(CREDS_KEY)
  } catch {
    /* ignore */
  }
}

// ---------------- پل HTTP اندروید + fallback مرورگر ----------------

interface PendingHttp {
  resolve: (r: BridgeHttpResult) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface BridgeHttpResponse {
  status?: number
  headers?: Record<string, string>
  text?: string
  error?: string
}

declare global {
  interface Window {
    __setabHttpResolve?: (tag: string, b64payload: string) => void
    __setabBridgeHttp?: {
      next: number
      pending: Map<string, PendingHttp>
    }
    /** fetch دست‌نخورده — موتور محلی (engine.ts) قبل از رهگیری آن را اینجا می‌گذارد */
    __setabOriginalFetch?: typeof fetch
  }
}

/** ثبت گیرندهٔ پاسخ پل — یک‌بار در اولین استفاده */
function ensureBridgeReceiver(): void {
  if (typeof window === 'undefined' || window.__setabHttpResolve) return
  window.__setabBridgeHttp = { next: 1, pending: new Map() }
  window.__setabHttpResolve = (tag: string, b64payload: string) => {
    const entry = window.__setabBridgeHttp?.pending.get(tag)
    if (!entry) return
    window.__setabBridgeHttp!.pending.delete(tag)
    clearTimeout(entry.timer)
    try {
      const payload = JSON.parse(b64decode(b64payload)) as BridgeHttpResponse
      if (payload.error) {
        entry.reject(new Error(payload.error))
        return
      }
      entry.resolve({
        status: Number(payload.status ?? 0),
        headers: payload.headers ?? {},
        text: String(payload.text ?? ''),
      })
    } catch (e) {
      entry.reject(new Error('پاسخ نامعتبر از پل اندروید: ' + String(e)))
    }
  }
}

/**
 * درخواست HTTP به هاست — داخل اپ اندروید از پل بومی (بدون CORS) و در مرورگر
 * از fetch با credentials:include (نیازمند CORS سمت سرور) استفاده می‌کند.
 */
export async function bridgeHttp(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<BridgeHttpResult> {
  const method = (opts.method ?? 'GET').toUpperCase()
  const timeoutMs = opts.timeoutMs ?? 10000
  const bridge = typeof window !== 'undefined' ? window.AndroidBridge : undefined

  // مسیر پل بومی اندروید
  if (bridge && typeof (bridge as unknown as Record<string, unknown>).httpRequest === 'function') {
    ensureBridgeReceiver()
    const state = window.__setabBridgeHttp!
    const tag = 'h' + Date.now().toString(36) + '-' + state.next++
    return new Promise<BridgeHttpResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        state.pending.delete(tag)
        reject(new Error('پاسخی از سرور دریافت نشد (تایم‌اوت)'))
      }, timeoutMs)
      state.pending.set(tag, { resolve, reject, timer })
      try {
        bridge.httpRequest(
          tag,
          url,
          method,
          JSON.stringify(opts.headers ?? {}),
          opts.body ?? '',
          timeoutMs
        )
      } catch (e) {
        state.pending.delete(tag)
        clearTimeout(timer)
        reject(new Error('خطای پل اندروید: ' + String(e)))
      }
    })
  }

  // مسیر مرورگر — fetch عادی (کوکی‌ها توسط مرورگر مدیریت می‌شوند)
  // مهم: از fetch دست‌نخورده استفاده می‌کنیم نه window.fetch — وگرنه موتور محلی
  // همین درخواستِ «به هاست» را هم رهگیری می‌کرد و به خود هاست هرگز نمی‌رسید.
  const rawFetch =
    (typeof window !== 'undefined' && window.__setabOriginalFetch) || fetch
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await rawFetch(url, {
      method,
      headers: opts.headers,
      body: opts.body,
      credentials: 'include',
      signal: ctrl?.signal,
    })
    const text = await res.text()
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v
    })
    return { status: res.status, headers, text }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError' ? 'پاسخی از سرور دریافت نشد (تایم‌اوت)' : String(e)
    throw new Error(msg)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** نتیجهٔ HTTP → آبجکت JSON (خطای گویا اگر JSON نباشد) */
export function parseJsonResult(r: BridgeHttpResult): { status: number; headers: Record<string, string>; json: unknown } {
  let json: unknown = null
  try {
    json = r.text ? JSON.parse(r.text) : null
  } catch {
    throw new Error('پاسخ سرور JSON نبود (آدرس اشتباه است؟)')
  }
  return { status: r.status, headers: r.headers, json }
}

// ---------------- پروب دسترسی سرور ----------------

export interface HostProbe {
  ok: boolean
  version?: string
  /** جزئیات فنی خام خطا — برای نمایش کوچک زیر پیام اصلی */
  error?: string
  /** علت دسته‌بندی‌شدهٔ شکست — برای پیام کاربردی و راهنما */
  reason?: ProbeReason
  /** آدرسی که واقعاً پاسخ داد (ممکن است http باشد اگر https جواب نداد) */
  triedUrl?: string
  /** تعداد کاندیداهای تست‌شده */
  attempts?: number
}

export type ProbeReason = 'DNS' | 'TIMEOUT' | 'CONN' | 'NOT_APP' | 'HTTP' | 'SERVER_ERROR' | 'UNKNOWN'

/** دسته‌بندی خطای سطح حمل‌ونقل (پل اندروید/فچ مرورگر) */
function classifyTransportError(msg: string): ProbeReason {
  const m = msg.replace(/\s+/g, ' ')
  if (/تایم‌اوت|timeout|timed?\s*out/i.test(m)) return 'TIMEOUT'
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|Unable to resolve|unknown\s*host|not\s*known/i.test(m)) return 'DNS'
  if (
    /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ERR_CONNECTION|ERR_NAME|ERR_ADDRESS|ERR_SSL|ERR_TLS|socket|SSL|certificate|TLS|handshake|ناموفق بود/i.test(
      m
    )
  )
    return 'CONN'
  return 'UNKNOWN'
}

/**
 * تست دسترسی: GET {url}/api/download/setup?info=1 — عمومی و بی‌اثر.
 *
 * اگر کاربر پروتکل را ننوشته باشد (فقط مثلاً «erp.example.com»)، اول https و
 * در شکستِ سطح اتصال، http هم امتحان می‌شود — خیلی از هاست‌ها بدون گواهی SSL
 * هستند و قبلاً https اجباری باعث «وصل نمی‌شود» می‌شد.
 * در موفقیت triedUrl همان آدرسی است که واقعاً جواب داد (برای ذخیره).
 */
export async function probeHost(baseUrl: string, timeoutMs = 8000): Promise<HostProbe> {
  const raw = String(baseUrl || '').trim()
  const base = normalizeHostUrl(raw)
  if (!base) return { ok: false, error: 'آدرس خالی است', reason: 'UNKNOWN' }

  const explicit = /^https?:\/\//i.test(raw)
  const candidates = explicit ? [base] : [base, base.replace(/^https:\/\//i, 'http://')]

  let lastError = ''
  let lastReason: ProbeReason = 'UNKNOWN'

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    try {
      const r = await bridgeHttp(`${c}/api/download/setup?info=1`, { method: 'GET', timeoutMs })
      let json: unknown = null
      let isJson = true
      try {
        json = r.text ? JSON.parse(r.text) : null
      } catch {
        isJson = false
      }
      if (r.status >= 200 && r.status < 400 && isJson && json && typeof json === 'object') {
        const version = (json as { version?: string }).version
        return { ok: true, version, triedUrl: c, attempts: i + 1 }
      }
      if (r.status >= 500) {
        lastError = `کد ${r.status} از سرور`; lastReason = 'SERVER_ERROR'
      } else if (r.status === 404) {
        lastError = `کد 404 — مسیر /api/download/setup پیدا نشد`; lastReason = 'NOT_APP'
      } else if (!isJson) {
        lastError = `پاسخ HTML بود (کد ${r.status}) — نسخهٔ وب برنامه روی این آدرس اجرا نمی‌شود`
        lastReason = 'NOT_APP'
      } else {
        lastError = `کد ${r.status}`; lastReason = 'HTTP'
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      lastError = msg
      lastReason = classifyTransportError(msg)
    }
    // کاندیدای بعدی فقط وقتی پروتکل را کاربر مشخص نکرده باشد وجود دارد
  }

  return { ok: false, error: lastError, reason: lastReason, attempts: candidates.length }
}
