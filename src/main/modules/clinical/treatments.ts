import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, conflictError, notFoundError } from '@shared/errors'
import { normalizeBengali, foldForSearch } from '@shared/bengali'
import type { zTreatmentInput } from '@shared/contracts'
import { z } from 'zod'

export type TreatmentInput = z.infer<typeof zTreatmentInput>

export interface TreatmentRecord {
  id: number
  code: string
  name: string
  nameBn: string | null
  category: string
  description: string | null
  defaultPriceMicro: number
  durationMin: number
  isActive: boolean
  notes: string | null
  usageCount: number
  updatedAt: number
}

interface TreatmentRow {
  id: number
  code: string
  name: string
  name_bn: string | null
  category: string
  description: string | null
  default_price_micro: number
  duration_min: number
  is_active: number
  notes: string | null
  created_at: number
  updated_at: number
}

/**
 * Treatment catalogue.
 *
 * The catalogue is the source of prices and durations: a receptionist picks a treatment and the current
 * price is copied onto the visit and the invoice line, so later price changes never rewrite history.
 * Codes are generated per category (`REST-0007`) unless the clinic supplies its own.
 */

const CATEGORY_PREFIX: Record<string, string> = {
  diagnostic: 'DIAG',
  preventive: 'PREV',
  restorative: 'REST',
  endodontic: 'ENDO',
  surgical: 'SURG',
  prosthetic: 'PROS',
  orthodontic: 'ORTH',
  cosmetic: 'COSM',
  general: 'GEN'
}

function mapTreatment(row: TreatmentRow, usageCount: number): TreatmentRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    nameBn: row.name_bn,
    category: row.category,
    description: row.description,
    defaultPriceMicro: row.default_price_micro,
    durationMin: row.duration_min,
    isActive: row.is_active === 1,
    notes: row.notes,
    usageCount,
    updatedAt: row.updated_at
  }
}

function usageCountFor(ctx: ServiceContext, treatmentId: number): number {
  const row = ctx.db.prepare('SELECT COUNT(*) AS count FROM visit_treatments WHERE treatment_id = ?').get(treatmentId) as { count: number }
  return row.count
}

function nextTreatmentCode(ctx: ServiceContext, category: string): string {
  const prefix = CATEGORY_PREFIX[category] ?? 'MISC'
  const row = ctx.db
    .prepare(
      `SELECT code FROM treatments WHERE code LIKE ? AND code GLOB '${prefix}-[0-9]*'
       ORDER BY CAST(substr(code, ${prefix.length + 2}) AS INTEGER) DESC LIMIT 1`
    )
    .get(`${prefix}-%`) as { code: string } | undefined
  const last = row ? Number.parseInt(row.code.slice(prefix.length + 1), 10) : 0
  const next = Number.isFinite(last) ? last + 1 : 1
  return `${prefix}-${String(next).padStart(4, '0')}`
}

export function listTreatments(
  ctx: ServiceContext,
  filter: { search?: string, category?: string, includeInactive?: boolean } = {}
): TreatmentRecord[] {
  assertPermission(ctx, 'clinical.view')
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  // Archived (soft-deleted) treatments are part of history: with "include inactive" they are listed so
  // an old invoice line can still be explained, but they are never offered for new work.
  if (!filter.includeInactive) clauses.push('is_deleted = 0', 'is_active = 1')
  if (clauses.length === 0) clauses.push('1 = 1')
  if (filter.category) {
    clauses.push('category = @category')
    params.category = filter.category
  }
  if (filter.search && filter.search.trim().length > 0) {
    clauses.push('(name_fold LIKE @search OR name LIKE @searchRaw OR code LIKE @searchRaw)')
    params.search = `%${foldForSearch(filter.search.trim())}%`
    params.searchRaw = `%${filter.search.trim()}%`
  }
  const rows = ctx.db
    .prepare(`SELECT * FROM treatments WHERE ${clauses.join(' AND ')} ORDER BY category, name COLLATE NOCASE`)
    .all(params) as TreatmentRow[]
  return rows.map((row) => mapTreatment(row, usageCountFor(ctx, row.id)))
}

export function getTreatment(ctx: ServiceContext, id: number): TreatmentRecord {
  assertPermission(ctx, 'clinical.view')
  const row = ctx.db.prepare('SELECT * FROM treatments WHERE id = ? AND is_deleted = 0').get(id) as TreatmentRow | undefined
  if (!row) throw notFoundError('treatment', id)
  return mapTreatment(row, usageCountFor(ctx, id))
}

export function saveTreatment(ctx: ServiceContext, input: TreatmentInput): TreatmentRecord {
  assertPermission(ctx, input.id ? 'clinical.edit' : 'clinical.create')
  const errors: Record<string, string> = {}
  const name = normalizeBengali(input.name).trim()
  if (name.length < 2) errors.name = 'Enter the treatment name.'
  if (input.defaultPriceMicro < 0) errors.defaultPriceMicro = 'The price cannot be negative.'
  if (input.nameBn && /\?{2,}/.test(input.nameBn)) errors.nameBn = 'Bengali text was corrupted. Please re-enter it.'
  if (Object.keys(errors).length > 0) {
    throw new AppError('E_VALIDATION', 'Please correct the highlighted treatment details.', { fieldErrors: errors })
  }

  const now = ctx.now()
  return ctx.db.transaction(() => {
    if (input.id) {
      const existing = ctx.db.prepare('SELECT * FROM treatments WHERE id = ? AND is_deleted = 0').get(input.id) as TreatmentRow | undefined
      if (!existing) throw notFoundError('treatment', input.id)
      const duplicate = ctx.db
        .prepare('SELECT id FROM treatments WHERE is_deleted = 0 AND id <> ? AND name_fold = ?')
        .get(input.id, foldForSearch(name)) as { id: number } | undefined
      if (duplicate) throw conflictError(`Another treatment is already named “${name}”.`, { duplicateTreatmentId: duplicate.id })

      ctx.db
        .prepare(
          `UPDATE treatments SET name = @name, name_fold = @nameFold, name_bn = @nameBn, category = @category,
             description = @description, default_price_micro = @price, duration_min = @duration, is_active = @isActive,
             notes = @notes, updated_at = @now WHERE id = @id`
        )
        .run({
          id: input.id,
          name,
          nameFold: foldForSearch(name),
          nameBn: input.nameBn ?? null,
          category: input.category,
          description: input.description ?? null,
          price: input.defaultPriceMicro,
          duration: input.durationMin,
          isActive: input.isActive ? 1 : 0,
          notes: input.notes ?? null,
          now
        })
      ctx.audit.write({
        module: 'treatments',
        action: 'update',
        entityType: 'treatment',
        entityId: input.id,
        summary: `Updated treatment “${name}”`,
        detail: { priceMicro: input.defaultPriceMicro, category: input.category }
      })
      return getTreatment(ctx, input.id)
    }

    const duplicate = ctx.db.prepare('SELECT id FROM treatments WHERE is_deleted = 0 AND name_fold = ?').get(foldForSearch(name)) as
      | { id: number }
      | undefined
    if (duplicate) throw conflictError(`A treatment named “${name}” already exists.`, { duplicateTreatmentId: duplicate.id })

    const code = input.code && input.code.trim().length > 0 ? input.code.trim().toUpperCase() : nextTreatmentCode(ctx, input.category)
    const codeTaken = ctx.db.prepare('SELECT id FROM treatments WHERE code = ?').get(code) as { id: number } | undefined
    if (codeTaken) throw conflictError(`The treatment code “${code}” is already in use.`, { fieldErrors: { code: 'This code is already used.' } })

    const result = ctx.db
      .prepare(
        `INSERT INTO treatments (code, name, name_fold, name_bn, category, description, default_price_micro, duration_min, is_active, notes, created_at, updated_at)
         VALUES (@code, @name, @nameFold, @nameBn, @category, @description, @price, @duration, @isActive, @notes, @now, @now)`
      )
      .run({
        code,
        name,
        nameFold: foldForSearch(name),
        nameBn: input.nameBn ?? null,
        category: input.category,
        description: input.description ?? null,
        price: input.defaultPriceMicro,
        duration: input.durationMin,
        isActive: input.isActive ? 1 : 0,
        notes: input.notes ?? null,
        now
      })
    const id = Number(result.lastInsertRowid)
    ctx.audit.write({
      module: 'treatments',
      action: 'create',
      entityType: 'treatment',
      entityId: id,
      summary: `Added treatment “${name}” (${code})`,
      detail: { priceMicro: input.defaultPriceMicro, category: input.category }
    })
    return getTreatment(ctx, id)
  })()
}

export function archiveTreatment(ctx: ServiceContext, input: { id: number, reason?: string | null }): { ok: true } {
  assertPermission(ctx, 'clinical.delete')
  const row = ctx.db.prepare('SELECT * FROM treatments WHERE id = ? AND is_deleted = 0').get(input.id) as TreatmentRow | undefined
  if (!row) throw notFoundError('treatment', input.id)
  const now = ctx.now()
  ctx.db
    .prepare('UPDATE treatments SET is_deleted = 1, is_active = 0, updated_at = ? WHERE id = ?')
    .run(now, input.id)
  ctx.audit.write({
    module: 'treatments',
    action: 'archive',
    entityType: 'treatment',
    entityId: input.id,
    summary: `Archived treatment “${row.name}”`,
    detail: { reason: input.reason ?? null, historicalUseCount: usageCountFor(ctx, input.id) }
  })
  return { ok: true }
}

export function treatmentCategories(ctx: ServiceContext): Array<{ category: string, count: number }> {
  assertPermission(ctx, 'clinical.view')
  return ctx.db
    .prepare('SELECT category, COUNT(*) AS count FROM treatments WHERE is_deleted = 0 AND is_active = 1 GROUP BY category ORDER BY category')
    .all() as Array<{ category: string, count: number }>
}

/** Prices are copied onto visit treatments and invoice lines; see `visits.ts` and `billing.ts`. */
export function treatmentPriceMicro(ctx: ServiceContext, treatmentId: number): number {
  const row = ctx.db.prepare('SELECT default_price_micro FROM treatments WHERE id = ? AND is_deleted = 0').get(treatmentId) as
    | { default_price_micro: number }
    | undefined
  if (!row) throw notFoundError('treatment', treatmentId)
  return row.default_price_micro
}

export function countTreatments(ctx: ServiceContext): number {
  const row = ctx.db.prepare('SELECT COUNT(*) AS count FROM treatments WHERE is_deleted = 0').get() as { count: number }
  return row.count
}
