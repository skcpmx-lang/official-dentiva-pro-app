import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch } from '@shared/bengali'
import { endOfDay, fromLocalDate, resolveRange, type InstantRange, type RangePreset } from '@shared/datetime'
import { nextCode } from '../../db/counters'
import { applyMovement } from './items'
import { assertBatchForLine, findOrCreateBatch } from './movements'
import type { zPurchaseInput } from '@shared/contracts'
import { z } from 'zod'

export type PurchaseInput = z.infer<typeof zPurchaseInput>

export interface PurchaseLineRecord {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  unit: string
  batchNo: string | null
  expiryDate: string | null
  quantity: number
  unitCostMicro: number
  lineTotalMicro: number
  batchId: number | null
  notes: string | null
}

export interface PurchaseRecord {
  id: number
  purchaseNo: string
  supplierId: number | null
  supplierName: string | null
  invoiceRef: string | null
  purchaseDate: string
  totalMicro: number
  paidMicro: number
  dueMicro: number
  status: string
  notes: string | null
  createdByName: string | null
  createdAt: number
  updatedAt: number
  lines: PurchaseLineRecord[]
}

interface PurchaseRow {
  id: number
  purchase_no: string
  supplier_id: number | null
  supplier_name: string | null
  invoice_ref: string | null
  purchase_date: string
  purchase_at: number
  total_micro: number
  paid_micro: number
  status: string
  notes: string | null
  created_by_name: string | null
  created_at: number
  updated_at: number
}

const SELECT_PURCHASE = `
  SELECT p.id, p.purchase_no, p.supplier_id, s.name AS supplier_name, p.invoice_ref, p.purchase_date, p.purchase_at,
         p.total_micro, p.paid_micro, p.status, p.notes, u.full_name AS created_by_name, p.created_at, p.updated_at
    FROM purchases p
    LEFT JOIN suppliers s ON s.id = p.supplier_id
    LEFT JOIN users u ON u.id = p.created_by
`

function mapPurchase(row: PurchaseRow, lines: PurchaseLineRecord[]): PurchaseRecord {
  const due = Math.max(0, row.total_micro - row.paid_micro)
  const status = row.status === 'void' ? 'void' : row.paid_micro >= row.total_micro && row.total_micro > 0 ? 'paid' : row.paid_micro > 0 ? 'partial' : 'unpaid'
  return {
    id: row.id,
    purchaseNo: row.purchase_no,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    invoiceRef: row.invoice_ref,
    purchaseDate: row.purchase_date,
    totalMicro: row.total_micro,
    paidMicro: row.paid_micro,
    dueMicro: status === 'void' ? 0 : due,
    status,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines
  }
}

function loadLines(ctx: ServiceContext, purchaseId: number): PurchaseLineRecord[] {
  const rows = ctx.db
    .prepare(
      `SELECT l.id, l.item_id, i.code AS item_code, i.name AS item_name, i.unit, l.batch_no, l.expiry_date,
              l.quantity, l.unit_cost_micro, l.line_total_micro, l.notes
         FROM purchase_lines l JOIN inventory_items i ON i.id = l.item_id
        WHERE l.purchase_id = ? ORDER BY l.id ASC`
    )
    .all(purchaseId) as Array<{
    id: number
    item_id: number
    item_code: string
    item_name: string
    unit: string
    batch_no: string | null
    expiry_date: string | null
    quantity: number
    unit_cost_micro: number
    line_total_micro: number
    notes: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    unit: row.unit,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    quantity: row.quantity,
    unitCostMicro: row.unit_cost_micro,
    lineTotalMicro: row.line_total_micro,
    batchId: null,
    notes: row.notes
  }))
}

export function getPurchase(ctx: ServiceContext, id: number): PurchaseRecord {
  assertPermission(ctx, 'suppliers.view')
  const row = ctx.db.prepare(`${SELECT_PURCHASE} WHERE p.id = ?`).get(id) as PurchaseRow | undefined
  if (!row) throw notFoundError('purchase', id)
  const lines = loadLines(ctx, id)
  /* The batch created or reused per line is what the movement ledger points at. */
  const batches = ctx.db
    .prepare(
      `SELECT l.id AS line_id,
              (SELECT m.batch_id FROM inventory_movements m
                WHERE m.reference = p.purchase_no || '/L' || l.id ORDER BY m.id LIMIT 1) AS batch_id
         FROM purchase_lines l JOIN purchases p ON p.id = l.purchase_id
        WHERE l.purchase_id = ?`
    )
    .all(id) as Array<{ line_id: number, batch_id: number | null }>
  for (const line of lines) {
    line.batchId = batches.find((entry) => entry.line_id === line.id)?.batch_id ?? null
  }
  return mapPurchase(row, lines)
}

export function listPurchases(ctx: ServiceContext, filter: { supplierId?: number, status?: string, search?: string, range?: { preset: string, from?: string | null, to?: string | null }, limit: number, offset: number }): {
  items: PurchaseRecord[]
  total: number
  limit: number
  offset: number
  totals: { purchasedMicro: number, paidMicro: number, dueMicro: number }
} {
  assertPermission(ctx, 'suppliers.view')
  const clauses: string[] = []
  const params: Record<string, unknown> = {}
  if (filter.supplierId) {
    clauses.push('p.supplier_id = @supplierId')
    params.supplierId = filter.supplierId
  }
  if (filter.status) {
    clauses.push('p.status = @status')
    params.status = filter.status
  }
  if (filter.search && filter.search.trim() !== '') {
    params.term = `%${filter.search.trim()}%`
    params.fold = `%${foldForSearch(filter.search)}%`
    clauses.push('(p.purchase_no LIKE @term OR s.name LIKE @term OR s.name_fold LIKE @fold OR p.invoice_ref LIKE @term)')
  }
  if (filter.range && filter.range.preset !== 'all') {
    const resolved = instantRange(filter.range)
    if (resolved) {
      clauses.push('p.purchase_at >= @from AND p.purchase_at <= @to')
      params.from = resolved.from
      params.to = resolved.to
    }
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const aggregate = ctx.db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN p.status <> 'void' THEN p.total_micro ELSE 0 END), 0) AS purchased,
              COALESCE(SUM(CASE WHEN p.status <> 'void' THEN p.paid_micro ELSE 0 END), 0) AS paid
         FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ${where}`
    )
    .get(params) as { count: number, purchased: number, paid: number }
  const rows = ctx.db
    .prepare(`${SELECT_PURCHASE} ${where} ORDER BY p.purchase_at DESC, p.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.limit, offset: filter.offset }) as PurchaseRow[]
  return {
    items: rows.map((row) => mapPurchase(row, loadLines(ctx, row.id))),
    total: aggregate.count,
    limit: filter.limit,
    offset: filter.offset,
    totals: { purchasedMicro: aggregate.purchased, paidMicro: aggregate.paid, dueMicro: Math.max(0, aggregate.purchased - aggregate.paid) }
  }
}

function instantRange(range: { preset: string, from?: string | null, to?: string | null }): InstantRange | null {
  if (range.preset === 'custom') {
    if (!range.from && !range.to) return null
    return {
      from: range.from ? fromLocalDate(range.from) : 0,
      to: range.to ? endOfDay(fromLocalDate(range.to)) : Number.MAX_SAFE_INTEGER
    }
  }
  const resolved = resolveRange(range.preset as RangePreset)
  return { from: resolved.from, to: resolved.to }
}

/**
 * Receive stock.
 *
 * A purchase writes one batch and one inbound movement per line inside a single transaction, so either the
 * whole delivery is on the shelf and in the ledger or nothing is. Lines can only be edited by voiding the
 * purchase (not possible here) or recording a corrective movement — stock history is never rewritten.
 */
export function savePurchase(ctx: ServiceContext, input: PurchaseInput): PurchaseRecord {
  assertPermission(ctx, 'suppliers.manage')
  if (input.supplierId) {
    const supplier = ctx.db.prepare('SELECT id FROM suppliers WHERE id = ? AND is_deleted = 0').get(input.supplierId)
    if (!supplier) throw notFoundError('supplier', input.supplierId)
  }
  if (input.id) {
    throw validationError('A received purchase cannot be edited. Record a corrective stock movement instead.', { id: 'Purchases are immutable' })
  }

  for (const line of input.lines) {
    const item = ctx.db.prepare('SELECT id FROM inventory_items WHERE id = ? AND is_deleted = 0').get(line.itemId)
    if (!item) throw notFoundError('inventory item', line.itemId)
    assertBatchForLine(ctx, line.itemId, line.expiryDate ?? null)
  }

  const total = input.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitCostMicro), 0)
  if (input.paidMicro > total) throw validationError('The amount paid cannot be more than the purchase total.', { paidMicro: 'Above the total' })

  const at = Date.parse(`${input.purchaseDate}T12:00:00`)
  const now = ctx.now()
  const purchaseId = ctx.db.transaction(() => {
    const purchaseNo = nextCode(ctx.db, 'purchase', now)
    const result = ctx.db
      .prepare(
        `INSERT INTO purchases (purchase_no, supplier_id, invoice_ref, purchase_date, purchase_at, total_micro, paid_micro, status, notes, created_by, created_at, updated_at)
         VALUES (@purchaseNo, @supplierId, @invoiceRef, @purchaseDate, @at, @total, @paid, @status, @notes, @userId, @now, @now)`
      )
      .run({
        purchaseNo,
        supplierId: input.supplierId ?? null,
        invoiceRef: input.invoiceRef ?? null,
        purchaseDate: input.purchaseDate,
        at,
        total,
        paid: input.paidMicro,
        status: input.paidMicro >= total ? 'paid' : input.paidMicro > 0 ? 'partial' : 'unpaid',
        notes: input.notes ?? null,
        userId: ctx.actor.userId,
        now
      })
    const created = Number(result.lastInsertRowid)

    input.lines.forEach((line, index) => {
      const lineTotal = Math.round(line.quantity * line.unitCostMicro)
      const batchId = findOrCreateBatch(ctx, {
        itemId: line.itemId,
        batchNo: line.batchNo ?? null,
        expiryDate: line.expiryDate ?? null,
        unitCostMicro: line.unitCostMicro,
        supplierId: input.supplierId ?? null,
        note: null,
        at
      })
      const lineResult = ctx.db
        .prepare(
          `INSERT INTO purchase_lines (purchase_id, item_id, batch_no, expiry_date, quantity, unit_cost_micro, line_total_micro, notes)
           VALUES (@purchaseId, @itemId, @batchNo, @expiryDate, @quantity, @unitCostMicro, @lineTotal, @notes)`
        )
        .run({
          purchaseId: created,
          itemId: line.itemId,
          batchNo: line.batchNo ?? null,
          expiryDate: line.expiryDate ?? null,
          quantity: line.quantity,
          unitCostMicro: line.unitCostMicro,
          lineTotal: lineTotal,
          notes: line.notes ?? null
        })
      const lineId = Number(lineResult.lastInsertRowid)
      applyMovement(ctx, {
        itemId: line.itemId,
        batchId,
        movementType: 'purchase',
        quantity: line.quantity,
        unitCostMicro: line.unitCostMicro,
        reason: `Purchase ${purchaseNo} line ${index + 1}`,
        reference: `${purchaseNo}/L${lineId}`,
        supplierId: input.supplierId ?? null,
        at
      })
    })

    ctx.audit.write({
      module: 'inventory',
      action: 'purchase.create',
      entityType: 'purchase',
      entityId: created,
      summary: `Received purchase ${purchaseNo} (${input.lines.length} line(s), ${total} µ)`,
      detail: { supplierId: input.supplierId ?? null, paidMicro: input.paidMicro }
    })
    return created
  })()

  return getPurchase(ctx, purchaseId)
}

/** Record (or correct) how much of a purchase has been paid; the supplier due follows automatically. */
export function setPurchasePaid(ctx: ServiceContext, input: { id: number, paidMicro: number, method: string, note?: string | null }): PurchaseRecord {
  assertPermission(ctx, 'suppliers.manage')
  const purchase = getPurchase(ctx, input.id)
  if (purchase.status === 'void') throw stateError('That purchase is void, so its payment cannot change.')
  if (input.paidMicro > purchase.totalMicro) throw validationError('The amount paid cannot be more than the purchase total.', { paidMicro: 'Above the total' })

  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db
      .prepare('UPDATE purchases SET paid_micro = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(input.paidMicro, input.paidMicro >= purchase.totalMicro ? 'paid' : input.paidMicro > 0 ? 'partial' : 'unpaid', now, input.id)
    ctx.audit.write({
      module: 'inventory',
      action: 'purchase.paid',
      entityType: 'purchase',
      entityId: input.id,
      summary: `${purchase.purchaseNo}: paid ${input.paidMicro} µ of ${purchase.totalMicro} µ by ${input.method}${input.note ? ` (${input.note})` : ''}`,
      detail: { previousPaidMicro: purchase.paidMicro, method: input.method }
    })
  })()
  return getPurchase(ctx, input.id)
}

