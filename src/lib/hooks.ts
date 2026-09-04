'use client'

// هوک دریافت داده از API با وضعیت بارگذاری و خطا
import { useCallback, useEffect, useRef, useState } from 'react'
import { notifyAuthFailure } from '@/lib/auth-client'

interface UseFetchResult<T> {
  data: T | null
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFetch<T>(url: string | null, deps: unknown[] = []): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (!url) return
    let cancelled = false
    // شروع درخواست در فریم بعدی تا از setState همزمان در بدنه افکت جلوگیری شود
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      setLoading(true)
      setError(null)
      fetch(url, { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) {
            // انقضای نشست → خروج خودکار و بازگشت به صفحه ورود
            if (res.status === 401) notifyAuthFailure()
            // استخراج پیام خطای سرور برای نمایش تمیز (به‌جای متن خام HTTP)
            let msg = `خطا در دریافت داده (${res.status})`
            try {
              const json = (await res.json()) as { error?: string }
              if (json?.error) msg = json.error
            } catch {
              /* بدنه غیر JSON */
            }
            throw new Error(msg)
          }
          return res.json()
        })
        .then((json) => {
          if (!cancelled && mounted.current) {
            setData(json)
            setLoading(false)
          }
        })
        .catch((e) => {
          if (!cancelled && mounted.current) {
            setError(e?.message ?? 'خطا در دریافت داده')
            setLoading(false)
          }
        })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
     
  }, [url, tick, ...deps])

  const refetch = useCallback(() => setTick((t) => t + 1), [])
  return { data, loading, error, refetch }
}
