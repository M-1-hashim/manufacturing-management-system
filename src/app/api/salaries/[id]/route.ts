import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// DELETE /api/salaries/[id] — حذف پرداخت معاش
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.salaryPayment.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'پرداخت یافت نشد' }, { status: 404 })
    await db.salaryPayment.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('salaries DELETE', e)
    return NextResponse.json({ error: 'خطا در حذف پرداخت معاش' }, { status: 500 })
  }
}
