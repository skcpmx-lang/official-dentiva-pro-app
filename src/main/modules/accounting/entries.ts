import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { conflictError, notFoundError, stateError, validationError } from '@shared/errors'
import { toLocalDate } from '@shared/datetime'
import { nextCode } from '../../db/counters'
import type { zCategoryInput, zEntryFilter, zEntryInput } from '@shared/contracts'
import { z } from 'zod'

export type CategoryInput = z.infer<typeof zCategoryInput>
export type EntryInput = z.infer<typeof zEntryInput>
export type EntryFilter = z.infer<typeof zEntryFilter>
export type AccountingKind = 'income' | 'expense'

export interface CategoryRecord {
  id: number
  name: string
  kind: AccountingKind
  isSystem: boolean
  isActive: boolean
  usageCount: number
  totalMicro: number
}

export interface EntryRecord {
  id: number
  entryNo: string
  kind: AccountingKind
  categoryId: number | null
  categoryName: string
  entryDate: string
  amountMicro: number
  method: string
  reference: string | null
  party: string | null
  description: string
  notes: string | null
  status: 'active' | 'void'
  voidReason: string | null
  voidedAt: number | null
  createdByName: string | null
  createdAt: number
  updatedAt: number
}

interface EntryRow {
  id: number
  entry_no: string
  kind: AccountingKind
  category_id: number | null
  category_name: string
  entry_date: string
  amount_micro: number
  method: string
  reference: string | null
  party: string | null
  description: string
  notes: string | null
  status: 'active' | 'void'
  void_reason: string | null
  voided_at: number | null
  created_by_name: string | null
  created_at: number
  updated_at: number
}

const SELECT_ENTRY = `
  SELECT e.id, e.entry_no, e.kind, e.category_id, e.category_name, e.entry_date, e.amount_micro, e.method,
         e.reference, e.party, e.description, e.notes, e.status, e.void_reason, e.voided_at,
         u.full_name AS created_by_name, e.created_at, e.updated_at
    FROM accounting_entries e
    LEFT JOIN users u ON u.id = e.created_by
`

function mapEntry(row: EntryRow): EntryRecord {
  return {
    id: row.id,
    entryNo: row.entry_no,
    kind: row.kind,
    categoryId: row.category_id,
    categoryName: row.category_name,
    entryDate: row.entry_date,
    amountMicro: row.amount_micro,
    method: row.method,
    reference: row.reference,
    party: row.party,
    description: row.description,
    notes: row.notes,
    status: row.status,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/* ------------------------------------------------------------------- categories */

export function listCategories(ctx: ServiceContext, includeInactive: boolean): CategoryRecord[] {
  assertPermission(ctx, 'accounting.view')
  const rows = ctx.db
    .prepare(
      `SELECT c.id, c.name, c.kind, c.is_system, c.is_active,
              (SELECT COUNT(*) FROM accounting_entries e WHERE e.category_id = c.id AND e.status = 'active') AS usage_count,
              (SELECT COALESCE(SUM(e.amount_micro), 0) FROM accounting_entries e WHERE e.category_id = c.id AND e.status = 'active') AS total_micro
         FROM expense_categories c
        ${includeInactive ? '' : 'WHERE c.is_active = 1'}
        ORDER BY c.kind ASC, c.sort_order ASC, c.name ASC`
    )
    .all() as Array<{ id: number, name: string, kind: AccountingKind, is_system: number, is_active: number, usage_count: number, total_micro: number }>
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    kind: row.kind,
    isSystem: row.is_system === 1,
    isActive: row.is_active === 1,
    usageCount: row.usage_count,
    totalMicro: row.total_micro
  }))
}

export function saveCategory(ctx: ServiceContext, input: CategoryInput): CategoryRecord {
  assertPermission(ctx, 'accounting.create')
  const name = input.name.trim()
  const duplicate = ctx.db.prepare('SELECT id FROM expense_categories WHERE name = ? COLLATE NOCASE AND id <> ?').get(name, input.id ?? -1) as { id: number } | undefined
  if (duplicate) throw conflictError(`A category named “${name}” already exists.`, { name: 'Already used' })

  const id = ctx.db.transaction(() => {
    if (input.id) {
      const existing = ctx.db.prepare('SELECT id, is_system FROM expense_categories WHERE id = ?').get(input.id) as { id: number, is_system: number } | undefined
      if (!existing) throw notFoundError('category', input.id)
      ctx.db.prepare('UPDATE expense_categories SET name = @name, kind = @kind, is_active = @isActive WHERE id = @id').run({
        id: input.id,
        name,
        kind: input.kind,
        isActive: input.isActive ? 1 : 0
      })
      ctx.audit.write({ module: 'accounting', action: 'category.update', entityType: 'expense_category', entityId: input.id, summary: `Updated category ${name}`, detail: { kind: input.kind } })
      return input.id
    }
    const sortOrder = (ctx.db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM expense_categories').get() as { next: number }).next
    const result = ctx.db
      .prepare('INSERT INTO expense_categories (name, kind, is_system, is_active, sort_order) VALUES (@name, @kind, 0, @isActive, @sortOrder)')
      .run({ name, kind: input.kind, isActive: input.isActive ? 1 : 0, sortOrder })
    const created = Number(result.lastInsertRowid)
    ctx.audit.write({ module: 'accounting', action: 'category.create', entityType: 'expense_category', entityId: created, summary: `Added category ${name}`, detail: { kind: input.kind } })
    return created
  })()

  return listCategories(ctx, true).find((category) => category.id === id)!
}

export function archiveCategory(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'accounting.delete')
  const row = ctx.db.prepare('SELECT id, name, is_system FROM expense_categories WHERE id = ?').get(input.id) as { id: number, name: string, is_system: number } | undefined
  if (!row) throw notFoundError('category', input.id)
  if (row.is_system === 1) throw stateError('Built-in categories cannot be archived; deactivate them or rename them instead.')
  const used = ctx.db.prepare("SELECT COUNT(*) AS count FROM accounting_entries WHERE category_id = ? AND status = 'active'").get(input.id) as { count: number }
  if (used.count > 0) throw stateError(`That category is used by ${used.count} entry(ies), so it stays available for reporting. Deactivate it instead.`)

  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE expense_categories SET is_active = 0 WHERE id = ?').run(input.id)
    ctx.audit.write({
      module: 'accounting',
      action: 'category.archive',
      entityType: 'expense_category',
      entityId: input.id,
      summary: `Archived category ${row.name}`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}

/* ---------------------------------------------------------------------- entries */

function entryWhere(filter: EntryFilter, today: string): { sql: string, params: Record<string, unknown> } {
  const clauses: string[] = ['1 = 1']
  const params: Record<string, unknown> = {}
  if (!filter.includeVoid) clauses.push("e.status = 'active'")
  if (filter.kind) {
    clauses.push('e.kind = @kind')
    params.kind = filter.kind
  }
  if (filter.categoryId) {
    clauses.push('e.category_id = @categoryId')
    params.categoryId = filter.categoryId
  }
  if (filter.method) {
    clauses.push('e.method = @method')
    params.method = filter.method
  }
  if (filter.search && filter.search.trim() !== '') {
    params.term = `%${filter.search.trim()}%`
    clauses.push('(e.description LIKE @term OR e.party LIKE @term OR e.reference LIKE @term OR e.category_name LIKE @term OR e.entry_no LIKE @term)')
  }
  if (filter.range && filter.range.preset !== 'all') {
    const bounds = rangeBounds(filter.range, today)
    if (bounds) {
      clauses.push('e.entry_date >= @dateFrom AND e.entry_date <= @dateTo')
      params.dateFrom = bounds.from
      params.dateTo = bounds.to
    }
  }
  return { sql: `WHERE ${clauses.join(' AND ')}`, params }
}

interface DateBounds {
  from: string
  to: string
}

export function rangeBounds(range: { preset: string, from?: string | null, to?: string | null }, today: string): DateBounds | null {
  const shift = (days: number): string => {
    const date = new Date(`${today}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - days)
    return date.toISOString().slice(0, 10)
  }
  switch (range.preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: shift(1), to: shift(1) }
    case 'last7':
      return { from: shift(6), to: today }
    case 'last30':
      return { from: shift(29), to: today }
    case 'last90':
      return { from: shift(89), to: today }
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'lastYear':
      return { from: shift(364), to: today }
    case 'custom': {
      if (!range.from && !range.to) return null
      return { from: range.from ?? '0000-01-01', to: range.to ?? '9999-12-31' }
    }
    default:
      return null
  }
}

export function listEntries(ctx: ServiceContext, filter: EntryFilter): {
  items: EntryRecord[]
  total: number
  limit: number
  offset: number
  totals: { incomeMicro: number, expenseMicro: number, netMicro: number }
} {
  assertPermission(ctx, 'accounting.view')
  const { sql, params } = entryWhere(filter, toLocalDate(ctx.now()))
  const aggregate = ctx.db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN e.kind = 'income' AND e.status = 'active' THEN e.amount_micro ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN e.kind = 'expense' AND e.status = 'active' THEN e.amount_micro ELSE 0 END), 0) AS expense
         FROM accounting_entries e ${sql}`
    )
    .get(params) as { count: number, income: number, expense: number }
  const rows = ctx.db
    .prepare(`${SELECT_ENTRY} ${sql} ORDER BY e.entry_date DESC, e.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.limit, offset: filter.offset }) as EntryRow[]
  return {
    items: rows.map(mapEntry),
    total: aggregate.count,
    limit: filter.limit,
    offset: filter.offset,
    totals: { incomeMicro: aggregate.income, expenseMicro: aggregate.expense, netMicro: aggregate.income - aggregate.expense }
  }
}

export function getEntry(ctx: ServiceContext, id: number): EntryRecord {
  assertPermission(ctx, 'accounting.view')
  const row = ctx.db.prepare(`${SELECT_ENTRY} WHERE e.id = ?`).get(id) as EntryRow | undefined
  if (!row) throw notFoundError('accounting entry', id)
  return mapEntry(row)
}

function assertDayOpen(ctx: ServiceContext, date: string): void {
  const closed = ctx.db
    .prepare('SELECT id FROM day_closes WHERE close_date = ? AND reopened_at IS NULL')
    .get(date) as { id: number } | undefined
  if (closed) throw stateError(`${date} is closed. Reopen the day before changing its entries.`)
}

export function saveEntry(ctx: ServiceContext, input: EntryInput): EntryRecord {
  assertPermission(ctx, input.id ? 'accounting.edit' : 'accounting.create')
  assertDayOpen(ctx, input.entryDate)

  const now = ctx.now()
  const id = ctx.db.transaction(() => {
    if (input.id) {
      const existing = ctx.db.prepare('SELECT id, entry_no, entry_date, status FROM accounting_entries WHERE id = ?').get(input.id) as
        | { id: number, entry_no: string, entry_date: string, status: string }
        | undefined
      if (!existing) throw notFoundError('accounting entry', input.id)
      if (existing.status === 'void') throw stateError('A void entry cannot be edited; record a fresh entry instead.')
      assertDayOpen(ctx, existing.entry_date)
      ctx.db
        .prepare(
          `UPDATE accounting_entries
              SET kind = @kind, category_id = @categoryId, category_name = @categoryName, entry_date = @entryDate,
                  entry_at = @entryAt, amount_micro = @amountMicro, method = @method, reference = @reference,
                  party = @party, description = @description, notes = @notes, updated_at = @now
            WHERE id = @id`
        )
        .run({
          id: input.id,
          kind: input.kind,
          categoryId: input.categoryId ?? null,
          categoryName: input.categoryName,
          entryDate: input.entryDate,
          entryAt: Date.parse(`${input.entryDate}T12:00:00`),
          amountMicro: input.amountMicro,
          method: input.method,
          reference: input.reference ?? null,
          party: input.party ?? null,
          description: input.description,
          notes: input.notes ?? null,
          now
        })
      ctx.audit.write({
        module: 'accounting',
        action: 'entry.update',
        entityType: 'accounting_entry',
        entityId: input.id,
        summary: `Updated ${input.kind} ${existing.entry_no} (${input.amountMicro} µ)`,
        detail: { category: input.categoryName }
      })
      return input.id
    }

    const entryNo = nextCode(ctx.db, 'accounting', now)
    const result = ctx.db
      .prepare(
        `INSERT INTO accounting_entries (entry_no, kind, category_id, category_name, entry_date, entry_at, amount_micro, method,
                                         reference, party, description, notes, status, created_by, created_at, updated_at)
         VALUES (@entryNo, @kind, @categoryId, @categoryName, @entryDate, @entryAt, @amountMicro, @method,
                 @reference, @party, @description, @notes, 'active', @userId, @now, @now)`
      )
      .run({
        entryNo,
        kind: input.kind,
        categoryId: input.categoryId ?? null,
        categoryName: input.categoryName,
        entryDate: input.entryDate,
        entryAt: Date.parse(`${input.entryDate}T12:00:00`),
        amountMicro: input.amountMicro,
        method: input.method,
        reference: input.reference ?? null,
        party: input.party ?? null,
        description: input.description,
        notes: input.notes ?? null,
        userId: ctx.actor.userId,
        now
      })
    const created = Number(result.lastInsertRowid)
    ctx.audit.write({
      module: 'accounting',
      action: 'entry.create',
      entityType: 'accounting_entry',
      entityId: created,
      summary: `Recorded ${input.kind} ${entryNo} · ${input.categoryName} · ${input.amountMicro} µ`,
      detail: { method: input.method, party: input.party ?? null }
    })
    return created
  })()

  return getEntry(ctx, id)
}

/** Voiding keeps the entry with its reason; money is never quietly edited out of the books. */
export function voidEntry(ctx: ServiceContext, input: { id: number, reason: string }): EntryRecord {
  assertPermission(ctx, 'accounting.delete')
  const entry = getEntry(ctx, input.id)
  if (entry.status === 'void') return entry
  assertDayOpen(ctx, entry.entryDate)

  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db
      .prepare("UPDATE accounting_entries SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?")
      .run(input.reason, now, ctx.actor.userId, now, input.id)
    ctx.audit.write({
      module: 'accounting',
      action: 'entry.void',
      entityType: 'accounting_entry',
      entityId: input.id,
      summary: `Voided ${entry.kind} ${entry.entryNo} (${entry.amountMicro} µ)`,
      detail: { reason: input.reason }
    })
  })()

  return getEntry(ctx, input.id)
}

/* ---------------------------------------------------------------------- summary */

export function accountingSummary(ctx: ServiceContext, from: string, to: string): {
  from: string
  to: string
  incomeMicro: number
  expenseMicro: number
  netMicro: number
  byCategory: Array<{ kind: AccountingKind, category: string, amountMicro: number, entries: number }>
  byMethod: Array<{ method: string, incomeMicro: number, expenseMicro: number }>
  daily: Array<{ date: string, incomeMicro: number, expenseMicro: number }>
} {
  assertPermission(ctx, 'accounting.view')
  const totals = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_micro ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_micro ELSE 0 END), 0) AS expense
         FROM accounting_entries WHERE status = 'active' AND entry_date >= ? AND entry_date <= ?`
    )
    .get(from, to) as { income: number, expense: number }
  const byCategory = ctx.db
    .prepare(
      `SELECT kind, category_name AS category, SUM(amount_micro) AS amount, COUNT(*) AS entries
         FROM accounting_entries WHERE status = 'active' AND entry_date >= ? AND entry_date <= ?
        GROUP BY kind, category_name ORDER BY amount DESC`
    )
    .all(from, to) as Array<{ kind: AccountingKind, category: string, amount: number, entries: number }>
  const byMethod = ctx.db
    .prepare(
      `SELECT method,
              COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_micro ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_micro ELSE 0 END), 0) AS expense
         FROM accounting_entries WHERE status = 'active' AND entry_date >= ? AND entry_date <= ?
        GROUP BY method ORDER BY method`
    )
    .all(from, to) as Array<{ method: string, income: number, expense: number }>
  const daily = ctx.db
    .prepare(
      `SELECT entry_date AS date,
              COALESCE(SUM(CASE WHEN kind = 'income' THEN amount_micro ELSE 0 END), 0) AS income,
              COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount_micro ELSE 0 END), 0) AS expense
         FROM accounting_entries WHERE status = 'active' AND entry_date >= ? AND entry_date <= ?
        GROUP BY entry_date ORDER BY entry_date`
    )
    .all(from, to) as Array<{ date: string, income: number, expense: number }>

  return {
    from,
    to,
    incomeMicro: totals.income,
    expenseMicro: totals.expense,
    netMicro: totals.income - totals.expense,
    byCategory: byCategory.map((row) => ({ kind: row.kind, category: row.category, amountMicro: row.amount, entries: row.entries })),
    byMethod: byMethod.map((row) => ({ method: row.method, incomeMicro: row.income, expenseMicro: row.expense })),
    daily: daily.map((row) => ({ date: row.date, incomeMicro: row.income, expenseMicro: row.expense }))
  }
}

/* --------------------------------------------------------------------- day close */

export function dayCloseView(ctx: ServiceContext, date: string): {
  date: string
  isClosed: boolean
  closedAt: number | null
  closedByName: string | null
  countedCashMicro: number | null
  cashCollectedMicro: number
  cashExpensesMicro: number
  expectedCashMicro: number
  varianceMicro: number | null
  byMethod: Array<{ method: string, amountMicro: number }>
  note: string | null
} {
  assertPermission(ctx, 'accounting.view')
  const row = ctx.db
    .prepare(
      `SELECT d.*, u.full_name AS closed_by_name FROM day_closes d LEFT JOIN users u ON u.id = d.closed_by
        WHERE d.close_date = ?`
    )
    .get(date) as
    | {
        counted_cash_micro: number
        expected_cash_micro: number
        variance_micro: number
        note: string | null
        closed_at: number
        closed_by_name: string | null
        reopened_at: number | null
      }
    | undefined

  const methodRows = ctx.db
    .prepare(
      `SELECT method, COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_micro ELSE amount_micro END), 0) AS amount
         FROM payments WHERE status = 'active' AND paid_date = ? GROUP BY method ORDER BY method`
    )
    .all(date) as Array<{ method: string, amount: number }>
  const cashCollected = methodRows.find((entry) => entry.method === 'cash')?.amount ?? 0
  const cashExpenses = (
    ctx.db
      .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS total FROM accounting_entries WHERE status = 'active' AND kind = 'expense' AND method = 'cash' AND entry_date = ?")
      .get(date) as { total: number }
  ).total
  const cashIncome = (
    ctx.db
      .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS total FROM accounting_entries WHERE status = 'active' AND kind = 'income' AND method = 'cash' AND entry_date = ?")
      .get(date) as { total: number }
  ).total
  const expected = cashCollected + cashIncome - cashExpenses
  const isClosed = Boolean(row && row.reopened_at === null)

  return {
    date,
    isClosed,
    closedAt: isClosed ? row!.closed_at : null,
    closedByName: isClosed ? row!.closed_by_name : null,
    countedCashMicro: isClosed ? row!.counted_cash_micro : null,
    cashCollectedMicro: cashCollected,
    cashExpensesMicro: cashExpenses,
    expectedCashMicro: isClosed ? row!.expected_cash_micro : expected,
    varianceMicro: isClosed ? row!.variance_micro : null,
    byMethod: methodRows.map((entry) => ({ method: entry.method, amountMicro: entry.amount })),
    note: isClosed ? row!.note : null
  }
}

export function closeDay(ctx: ServiceContext, input: { date: string, countedCashMicro: number, note?: string | null }): ReturnType<typeof dayCloseView> {
  assertPermission(ctx, 'accounting.edit')
  const existing = ctx.db.prepare('SELECT id, reopened_at FROM day_closes WHERE close_date = ?').get(input.date) as
    | { id: number, reopened_at: number | null }
    | undefined
  if (existing && existing.reopened_at === null) throw stateError(`${input.date} is already closed. Reopen it if something was missed.`)

  const expected = dayCloseView(ctx, input.date).expectedCashMicro
  const now = ctx.now()
  let closeRowId = existing?.id ?? 0
  ctx.db.transaction(() => {
    const variance = input.countedCashMicro - expected
    if (existing) {
      closeRowId = existing.id
      ctx.db
        .prepare(
          `UPDATE day_closes SET counted_cash_micro = @counted, expected_cash_micro = @expected, variance_micro = @variance,
                                note = @note, closed_by = @userId, closed_at = @now, reopened_at = NULL, reopened_by = NULL, reopen_reason = NULL
            WHERE id = @id`
        )
        .run({ id: existing.id, counted: input.countedCashMicro, expected, variance, note: input.note ?? null, userId: ctx.actor.userId, now })
    } else {
      const inserted = ctx.db
        .prepare(
          `INSERT INTO day_closes (close_date, counted_cash_micro, expected_cash_micro, variance_micro, note, closed_by, closed_at)
           VALUES (@date, @counted, @expected, @variance, @note, @userId, @now)`
        )
        .run({ date: input.date, counted: input.countedCashMicro, expected, variance, note: input.note ?? null, userId: ctx.actor.userId, now })
      closeRowId = Number(inserted.lastInsertRowid)
    }
    ctx.audit.write({
      module: 'accounting',
      action: 'day.close',
      entityType: 'day_close',
      entityId: closeRowId,
      summary: `Closed ${input.date}: counted ${input.countedCashMicro} µ against ${expected} µ expected (variance ${variance} µ)`,
      detail: { note: input.note ?? null }
    })
  })()

  return dayCloseView(ctx, input.date)
}

export function reopenDay(ctx: ServiceContext, input: { date: string, reason: string }): ReturnType<typeof dayCloseView> {
  assertPermission(ctx, 'accounting.edit')
  const row = ctx.db.prepare('SELECT id FROM day_closes WHERE close_date = ? AND reopened_at IS NULL').get(input.date) as { id: number } | undefined
  if (!row) throw validationError(`${input.date} is not closed.`, { date: 'Not closed' })

  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE day_closes SET reopened_at = ?, reopened_by = ?, reopen_reason = ? WHERE id = ?').run(now, ctx.actor.userId, input.reason, row.id)
    ctx.audit.write({
      module: 'accounting',
      action: 'day.reopen',
      entityType: 'day_close',
      entityId: row.id,
      summary: `Reopened ${input.date}`,
      detail: { reason: input.reason }
    })
  })()

  return dayCloseView(ctx, input.date)
}

export function dayCloses(ctx: ServiceContext, filter: { from: string, to: string, limit: number, offset: number }): { items: Array<ReturnType<typeof dayCloseView>>, total: number, limit: number, offset: number } {
  assertPermission(ctx, 'accounting.view')
  const rows = ctx.db
    .prepare('SELECT close_date FROM day_closes WHERE close_date >= ? AND close_date <= ? ORDER BY close_date DESC LIMIT ? OFFSET ?')
    .all(filter.from, filter.to, filter.limit, filter.offset) as Array<{ close_date: string }>
  const total = (ctx.db.prepare('SELECT COUNT(*) AS count FROM day_closes WHERE close_date >= ? AND close_date <= ?').get(filter.from, filter.to) as { count: number }).count
  return { items: rows.map((row) => dayCloseView(ctx, row.close_date)), total, limit: filter.limit, offset: filter.offset }
}
