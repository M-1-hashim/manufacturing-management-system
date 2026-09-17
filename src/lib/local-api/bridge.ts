'use client'

/**
 * پل ارتباطی با لایهٔ Android (MainActivity) — فقط داخل اپ اندروید موجود است.
 * از آن برای ذخیرهٔ فایل‌های کاپی احتیاطی در پوشهٔ Downloads دستگاه استفاده می‌شود
 * چون دانلود blob: URL در WebView کار نمی‌کند.
 *
 * MainActivity.java یک @JavascriptInterface با نام saveFile(name, base64) دارد.
 */

declare global {
  interface Window {
    AndroidBridge?: {
      saveFile: (name: string, base64: string) => boolean
      toast: (message: string) => void
      /**
       * درخواست HTTP بومی — پاسخ ناهمگام با window.__setabHttpResolve(tag, base64)
       * (قرارداد کامل در src/lib/host-link.ts)
       */
      httpRequest: (
        tag: string,
        url: string,
        method: string,
        headersJson: string,
        body: string,
        timeoutMs: number
      ) => void
    }
  }
}

/** آیا داخل اپ اندروید اجرا می‌شویم؟ */
export function isAndroidApp(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.AndroidBridge
  } catch {
    return false
  }
}

/** رشتهٔ UTF-8 → base64 */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/**
 * ذخیرهٔ فایل متنی در Downloads دستگاه (از طریق پل اندروید).
 * اگر پل موجود نباشد false برمی‌گرداند تا UI مسیر جایگزین (blob دانلود مرورگر) را برود.
 */
export function saveFileLocal(fileName: string, content: string): boolean {
  if (!isAndroidApp()) return false
  try {
    return window.AndroidBridge!.saveFile(fileName, utf8ToBase64(content))
  } catch (e) {
    console.error('[android-bridge] saveFile failed', e)
    return false
  }
}
