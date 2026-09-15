// مدیریت نشست (Session) با توکن امضاشده HMAC-SHA256
// از Web Crypto استفاده می‌کند تا هم در middleware (edge) و هم در route های node کار کند

export interface SessionPayload {
  uid: string
  username: string
  fullName: string
  role: string
  department: string
  exp: number // epoch millis
}

export const SESSION_COOKIE = 'mfg_session'
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 روز

function getSecret(): string {
  return process.env.SESSION_SECRET || 'mfg-erp-afghanistan-secret-key-2024'
}

// ---------- base64url ----------
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  const bin = atob(s)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// ---------- hex ----------
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

async function hmac(data: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return new Uint8Array(sig)
}

/** ساخت توکن نشست از payload کاربر */
export async function signSession(
  user: { id: string; username: string; fullName: string; role: string; department: string }
): Promise<string> {
  const payload: SessionPayload = {
    uid: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    department: user.department,
    exp: Date.now() + SESSION_TTL_MS,
  }
  const payloadStr = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await hmac(payloadStr)
  return `${payloadStr}.${bytesToHex(sig)}`
}

/** اعتبارسنجی توکن — در صورت معتبر بودن payload را برمی‌گرداند */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null
  const dot = token.lastIndexOf('.')
  if (dot < 0) return null
  const payloadStr = token.slice(0, dot)
  const sigHex = token.slice(dot + 1)
  try {
    const expected = await hmac(payloadStr)
    const given = hexToBytes(sigHex)
    if (expected.length !== given.length) return null
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i]
    if (diff !== 0) return null
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payloadStr))) as SessionPayload
    if (!payload.uid || !payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** استخراج نشست از هدر کوکی درخواست */
export async function getSessionFromRequest(req: Request): Promise<SessionPayload | null> {
  const cookieHeader = req.headers.get('cookie') || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  if (!match) return null
  return verifySession(match[1])
}

export const SESSION_MAX_AGE_S = SESSION_TTL_MS / 1000
