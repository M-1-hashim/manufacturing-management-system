'use client'

/**
 * هندلرهای فورمولاها (BOM) — آینهٔ src/app/api/formulas/**
 * GET/POST/PUT همیشه فورمولا را با product و items (هر قلم با rawMaterial) برمی‌گردانند؛
 * PUT علاوه بر تصحیح، ساخت «نسخهٔ جدید» (createNewVersion) را هم پشتیبانی می‌کند؛
 * DELETE اقلام فورمولا را زنجیره‌ای حذف می‌کند (onDelete: Cascade)
 */

import { ApiError, bodyAs, route, type RouteDef } from '../types'
import { newRow, readCol, withUpdate, writeCol, type Row } from '../db'

export interface LocalProductLite extends Row {
  code: string
  name: string
  unit: string
  costPrice: number
  stock: number
}

export interface LocalMaterialLite extends Row {
  code: string
  name: string
  unit: string
  purchasePrice: number
  stock: number
}

interface LocalFormula extends Row {
  productId: string
  name: string
  version: number
  outputQty: number
  laborCost: number
  overheadCost: number
  notes: string | null
  isActive: boolean
}

interface LocalFormulaItem extends Row {
  formulaId: string
  rawMaterialId: string
  quantity: number
  percentage: number | null
}

/** فورمولا با روابط توکار — مطابق include: { product: true, items: { include: { rawMaterial: true } } } */
export interface HydratedFormula extends Row {
  product: LocalProductLite | null
  items: (LocalFormulaItem & { rawMaterial: LocalMaterialLite | null })[]
}

/** کامل‌سازی روابط فورمولا — توسط هندلر تولید هم استفاده می‌شود */
export function hydrateFormula(f: Row): HydratedFormula {
  const product = readCol<LocalProductLite>('products').find((p) => p.id === f.productId) ?? null
  const materials = readCol<LocalMaterialLite>('rawMaterials')
  const items = readCol<LocalFormulaItem>('formulaItems')
    .filter((it) => it.formulaId === f.id)
    .map((it) => ({ ...it, rawMaterial: materials.find((m) => m.id === it.rawMaterialId) ?? null }))
  return { ...f, product, items }
}

interface ItemIn {
  rawMaterialId: string
  quantity: number
}

/** نرمال‌سازی اقلام ورودی (اعداد ممکن است رشته باشند) */
function parseItems(items: unknown[]): ItemIn[] {
  return items.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>
    return { rawMaterialId: String(o.rawMaterialId ?? ''), quantity: Number(o.quantity) || 0 }
  })
}

/** فیصد هر ماده نسبت به مجموع — دقیقاً با فرمول هاست */
function buildItemData(items: ItemIn[]) {
  const sumQty = items.reduce((a, it) => a + (Number(it.quantity) || 0), 0)
  return items.map((it) => ({
    rawMaterialId: String(it.rawMaterialId),
    quantity: Number(it.quantity) || 0,
    percentage:
      sumQty > 0
        ? Math.round(((Number(it.quantity) || 0) / sumQty) * 100 * 100) / 100
        : null,
  }))
}

/** مرتب‌سازی مطابق orderBy: [{ productId: 'asc' }, { version: 'desc' }] */
function byProductThenVersion(a: LocalFormula, b: LocalFormula): number {
  if (a.productId !== b.productId) return a.productId < b.productId ? -1 : 1
  return Number(b.version) - Number(a.version)
}

export const routes: RouteDef[] = [
  // GET /api/formulas — لیست کامل فورمولاها با محصول و مواد
  route('GET', '/api/formulas', () =>
    readCol<LocalFormula>('formulas').sort(byProductThenVersion).map(hydrateFormula)
  ),

  // POST /api/formulas — ایجاد فورمولا همراه اقلامش
  route('POST', '/api/formulas', (ctx) => {
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const productId = typeof body.productId === 'string' ? body.productId : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const items = parseItems(Array.isArray(body.items) ? body.items : [])

    if (!productId || !name) throw new ApiError(400, 'محصول و نام فورمولا الزامی است')
    if (items.length === 0) throw new ApiError(400, 'حداقل یک ماده اولیه لازم است')
    for (const it of items) {
      if (!it.rawMaterialId || !(it.quantity > 0)) {
        throw new ApiError(400, 'مقدار هر ماده باید زیادتر از صفر باشد')
      }
    }
    if (!readCol<LocalProductLite>('products').some((p) => p.id === productId)) {
      throw new ApiError(400, 'محصول یافت نشد')
    }

    const created: LocalFormula = newRow({
      productId,
      name,
      version: Number(body.version) > 0 ? Math.floor(Number(body.version)) : 1,
      outputQty: Number(body.outputQty) > 0 ? Number(body.outputQty) : 1,
      laborCost: Number(body.laborCost) || 0,
      overheadCost: Number(body.overheadCost) || 0,
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      isActive: body.isActive !== false,
    })

    const formulas = readCol<LocalFormula>('formulas')
    formulas.push(created)
    writeCol('formulas', formulas)

    const itemRows = readCol<LocalFormulaItem>('formulaItems')
    itemRows.push(
      ...buildItemData(items).map(
        (d) => newRow({ formulaId: created.id, ...d }) as LocalFormulaItem
      )
    )
    writeCol('formulaItems', itemRows)

    return hydrateFormula(created)
  }),

  // PUT /api/formulas/:id — تصحیح فورمولا یا ساخت نسخهٔ جدید (createNewVersion)
  route('PUT', '/api/formulas/:id', (ctx, params) => {
    const id = params[0]
    const body = bodyAs<Record<string, unknown>>(ctx.body) ?? {}
    const formulas = readCol<LocalFormula>('formulas')
    const existing = formulas.find((f) => f.id === id)
    if (!existing) throw new ApiError(404, 'فورمولا یافت نشد')

    let items: ItemIn[] | null = null
    if (Array.isArray(body.items)) {
      items = parseItems(body.items)
      for (const it of items) {
        if (!it.rawMaterialId || !(it.quantity > 0)) {
          throw new ApiError(400, 'مقدار هر ماده باید زیادتر از صفر باشد')
        }
      }
    }

    // ---- ساخت نسخهٔ جدید برای همین محصول ----
    if (body.createNewVersion === true) {
      const maxVersion = formulas
        .filter((f) => f.productId === existing.productId)
        .reduce((a, f) => Math.max(a, Number(f.version) || 0), 0)
      const nextVersion = maxVersion + 1

      const itemSource: ItemIn[] =
        items && items.length > 0
          ? items
          : readCol<LocalFormulaItem>('formulaItems')
              .filter((it) => it.formulaId === id)
              .map((it) => ({ rawMaterialId: it.rawMaterialId, quantity: Number(it.quantity) }))
      const itemData = buildItemData(itemSource)
      if (itemData.length === 0) throw new ApiError(400, 'حداقل یک ماده اولیه لازم است')

      // نسخهٔ قدیمی غیرفعال و نسخهٔ جدید فعال ثبت می‌شود
      const deactivated = withUpdate(existing, { isActive: false })
      writeCol(
        'formulas',
        formulas.map((f) => (f.id === id ? deactivated : f))
      )

      const created: LocalFormula = newRow({
        productId: existing.productId,
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
        version: nextVersion,
        outputQty: Number(body.outputQty) > 0 ? Number(body.outputQty) : existing.outputQty,
        laborCost: body.laborCost !== undefined ? Number(body.laborCost) || 0 : existing.laborCost,
        overheadCost:
          body.overheadCost !== undefined ? Number(body.overheadCost) || 0 : existing.overheadCost,
        notes:
          body.notes !== undefined
            ? typeof body.notes === 'string' && body.notes.trim()
              ? body.notes.trim()
              : null
            : existing.notes,
        isActive: true,
      })
      const all = readCol<LocalFormula>('formulas')
      all.push(created)
      writeCol('formulas', all)

      const itemRows = readCol<LocalFormulaItem>('formulaItems')
      itemRows.push(
        ...itemData.map((d) => newRow({ formulaId: created.id, ...d }) as LocalFormulaItem)
      )
      writeCol('formulaItems', itemRows)

      return hydrateFormula(created)
    }

    // ---- تصحیح همان فورمولا ----
    const updated = withUpdate(existing, {
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name,
      outputQty: Number(body.outputQty) > 0 ? Number(body.outputQty) : existing.outputQty,
      laborCost: body.laborCost !== undefined ? Number(body.laborCost) || 0 : existing.laborCost,
      overheadCost:
        body.overheadCost !== undefined ? Number(body.overheadCost) || 0 : existing.overheadCost,
      notes:
        body.notes !== undefined
          ? typeof body.notes === 'string' && body.notes.trim()
            ? body.notes.trim()
            : null
          : existing.notes,
      isActive: typeof body.isActive === 'boolean' ? body.isActive : existing.isActive,
    })
    writeCol(
      'formulas',
      formulas.map((f) => (f.id === id ? updated : f))
    )

    // تعویض اتمیک اقلام: حذف قدیمی‌ها و درج جدیدها
    if (items) {
      const kept = readCol<LocalFormulaItem>('formulaItems').filter((it) => it.formulaId !== id)
      const fresh = buildItemData(items).map(
        (d) => newRow({ formulaId: id, ...d }) as LocalFormulaItem
      )
      writeCol('formulaItems', [...kept, ...fresh])
    }

    return hydrateFormula(updated)
  }),

  // DELETE /api/formulas/:id — حذف (اگر در سفارش‌های تولید استفاده نشده باشد)
  route('DELETE', '/api/formulas/:id', (_ctx, params) => {
    const id = params[0]
    const formulas = readCol<LocalFormula>('formulas')
    if (!formulas.some((f) => f.id === id)) throw new ApiError(404, 'فورمولا یافت نشد')

    const ordersCount = readCol<Row>('productionOrders').filter((o) => o.formulaId === id).length
    if (ordersCount > 0) {
      throw new ApiError(
        400,
        'این فورمولا در سفارش‌های تولید استفاده شده است و قابل حذف نیست. برای تغییر، نسخه جدید بسازید.'
      )
    }

    writeCol('formulas', formulas.filter((f) => f.id !== id))
    // حذف زنجیره‌ای اقلام
    writeCol(
      'formulaItems',
      readCol<LocalFormulaItem>('formulaItems').filter((it) => it.formulaId !== id)
    )
    return { ok: true }
  }),
]
