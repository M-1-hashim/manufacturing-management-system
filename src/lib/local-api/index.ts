'use client'

/**
 * نقطهٔ ورود موتور API محلی
 * استفاده در src/app/page.tsx:
 *   import { LOCAL_MODE, installLocalApi } from '@/lib/local-api'
 *   if (LOCAL_MODE) installLocalApi()
 */

export { LOCAL_MODE, installLocalApi } from './engine'
export { ApiError } from './types'
