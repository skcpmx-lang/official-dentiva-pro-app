import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch } from '@shared/bengali'
import { endOfDay, fromLocalDate, resolveRange, type InstantRange, type RangePreset } from '@shared/datetime'
import {applyMovement, batchesForItem, itemStock, loadItem, mapMovement, type BatchRecord, type InventoryItemRecord, type MovementInput, type MovementRecord
} from './items'
export type MovementFilter = {
  itemId?: number
  movementType?: string
  supplierId?: number
  search?: string
  range?: { preset: string, from?: string | null, to?: string | null }
  limit: number
  offset: number
}

export interface InventoryDetailRecord {
  item: InventoryItemRecord
  batches: BatchRecord[]
  movements: MovementRecord[]
  recentUsage: Array<{ date: string, quantity: number }>
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.item_id, i.code AS item_code, i.name AS item_name, i.unit, m.batch_id, b.batch_no,
         m.movement_type, m.quantity, m.unit_cost_micro, m.reason, m.reference, s.name AS supplier_name,
         u.full_name AS by_user_name, m.at, m.movement_date, m.created_at
    FROM inventory_movements m
    JOIN inventory_items i ON i.id = m.item_id
    LEFT JOIN inventory_batches b ON b.id = m.batch_id
    LEFT JOIN suppliers s ON s.id = m.supplier_id
    LEFT JOIN users u ON u.id = m.by_user_id
`

function movementWhere(filter: MovementFilter): { sql: string, params: Record<string, unknown> } {
  /* Archived items keep their ledger: history must stay explainable even after an item is retired. */
  const clauses: string[] = ['1 = 1']
  const params: Record<string, unknown> = {}
  if (filter.itemId) {
    clauses.push('m.item_id = @itemId')
    params.itemId = filter.itemId
  }
  if (filter.movementType) {
    clauses.push('m.movement_type = @movementType')
    params.movementType = filter.movementType
  }
  if (filter.supplierId) {
    clauses.push('m.supplier_id = @supplierId')
    params.supplierId = filter.supplierId
  }
  if (filter.search && filter.search.trim() !== '') {
    params.term = `%${filter.search.trim()}%`
    params.fold = `%${foldForSearch(filter.search)}%`
    clauses.push('(i.name LIKE @term OR i.name_fold LIKE @fold OR i.code LIKE @term OR m.reason LIKE @term OR m.reference LIKE @term OR b.batch_no LIKE @term)')
  }
  if (filter.range && filter.range.preset !== 'all') {
    const resolved = instantRange(filter.range)
    if (resolved) {
      clauses.push('m.at >= @from AND m.at <= @to')
      params.from = resolved.from
      params.to = resolved.to
    }
  }
  return { sql: `WHERE ${clauses.join(' AND ')}`, params }
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

export function listMovements(ctx: ServiceContext, filter: MovementFilter): { items: MovementRecord[], total: number, limit: number, offset: number } {
  assertPermission(ctx, 'inventory.view')
  const { sql, params } = movementWhere(filter)
  const count = ctx.db.prepare(`SELECT COUNT(*) AS count FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id LEFT JOIN inventory_batches b ON b.id = m.batch_id ${sql}`).get(params) as { count: number }
  const rows = ctx.db
    .prepare(`${MOVEMENT_SELECT} ${sql} ORDER BY m.at DESC, m.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.limit, offset: filter.offset }) as never[]
  return { items: rows.map(mapMovement), total: count.count, limit: filter.limit, offset: filter.offset }
}

/** Item detail: the header, its batches, the full ledger and the last 30 days of usage. */
export function inventoryDetail(ctx: ServiceContext, itemId: number): InventoryDetailRecord {
  assertPermission(ctx, 'inventory.view')
  const item = loadItem(ctx, itemId)
  const ledger = listMovements(ctx, { itemId, limit: 200, offset: 0 })
  const usage = ctx.db
    .prepare(
      `SELECT movement_date AS date, COALESCE(SUM(-quantity), 0) AS quantity
         FROM inventory_movements
        WHERE item_id = ? AND quantity < 0 AND movement_date >= date('now','localtime','-30 days')
        GROUP BY movement_date ORDER BY movement_date`
    )
    .all(itemId) as Array<{ date: string, quantity: number }>
  return { item, batches: batchesForItem(ctx, itemId), movements: ledger.items, recentUsage: usage }
}

/**
 * Record a stock movement.
 *
 * Inbound movements may create a batch on the fly for expiry-tracked items. Outbound movements on an
 * expiry-tracked item without an explicit batch are taken first-expiry-first-out, so the shelf rotates
 * the way a clinic actually uses it, and one logical issue may split into several batch movements.
 */
export function recordMovement(ctx: ServiceContext, input: MovementInput): InventoryDetailRecord {
  assertPermission(ctx, input.movementType === 'opening' ? 'inventory.create' : 'inventory.adjust')
  const item = loadItem(ctx, input.itemId)
  const at = input.at ?? ctx.now()
  const inbound = ['opening', 'purchase', 'return_in', 'adjustment_in'].includes(input.movementType)

  let batchId = input.batchId ?? null

  ctx.db.transaction(() => {
    if (input.batch && inbound) {
      batchId = findOrCreateBatch(ctx, {
        itemId: input.itemId,
        batchNo: input.batch.batchNo ?? null,
        expiryDate: input.batch.expiryDate ?? null,
        unitCostMicro: input.batch.unitCostMicro,
        supplierId: input.batch.supplierId ?? input.supplierId ?? item.supplierId,
        note: input.batch.note ?? null,
        at
      })
    }

    if (!inbound && item.expiryTracking && batchId === null) {
      const batches = batchesForItem(ctx, input.itemId).filter((batch) => batch.quantity > 0 && !batch.isExpired)
      let remaining = input.quantity
      if (batches.length === 0) {
        throw stateError(`No usable batch of ${item.name} has stock, so nothing can be issued. Receive stock or record a count correction first.`)
      }
      const available = batches.reduce((sum, batch) => sum + batch.quantity, 0)
      if (available < input.quantity) {
        throw stateError(`Only ${available} ${item.unit} of ${item.name} remains in unexpired batches, so ${input.quantity} cannot be issued.`)
      }
      for (const batch of batches) {
        if (remaining <= 0) break
        const take = Math.min(batch.quantity, remaining)
        applyMovement(ctx, {
          itemId: input.itemId,
          batchId: batch.id,
          movementType: input.movementType,
          quantity: take,
          unitCostMicro: input.unitCostMicro || batch.unitCostMicro,
          reason: input.reason,
          reference: input.reference ?? null,
          supplierId: input.supplierId ?? null,
          at
        })
        remaining -= take
      }
      ctx.audit.write({
        module: 'inventory',
        action: 'movement.add',
        entityType: 'inventory_item',
        entityId: input.itemId,
        summary: `Issued ${input.quantity} ${item.unit} of ${item.name} across ${batches.length} batch(es): ${input.reason}`,
        detail: { movementType: input.movementType, reference: input.reference ?? null }
      })
      return
    }

    applyMovement(ctx, {
      itemId: input.itemId,
      batchId,
      movementType: input.movementType,
      quantity: input.quantity,
      unitCostMicro: input.unitCostMicro,
      reason: input.reason,
      reference: input.reference ?? null,
      supplierId: input.supplierId ?? null,
      at
    })
    ctx.audit.write({
      module: 'inventory',
      action: 'movement.add',
      entityType: 'inventory_item',
      entityId: input.itemId,
      summary: `${inbound ? 'Added' : 'Removed'} ${input.quantity} ${item.unit} of ${item.name}: ${input.reason}`,
      detail: { movementType: input.movementType, reference: input.reference ?? null }
    })
  })()

  return inventoryDetail(ctx, input.itemId)
}

/**
 * Reverse a movement.
 *
 * The ledger is append-only; a correction writes the opposite movement referencing the original, keeps
 * the original visible and recomputes the batch cache. Reversals are allowed to make stock negative only
 * when undoing a movement whose effect was already consumed — in that case the operator has to record the
 * physical count anyway, so the reversal is refused instead.
 */
export function reverseMovement(ctx: ServiceContext, input: { id: number, reason: string }): InventoryDetailRecord {
  assertPermission(ctx, 'inventory.adjust')
  const original = ctx.db.prepare(`${MOVEMENT_SELECT} WHERE m.id = ?`).get(input.id) as never
  if (!original) throw notFoundError('stock movement', input.id)
  const record = mapMovement(original)
  if (record.reference && record.reference.startsWith('REV-')) throw stateError('A reversal cannot itself be reversed; record a fresh correct movement instead.')
  if (record.reason?.startsWith('Reversal of')) throw stateError('A reversal cannot itself be reversed; record a fresh correct movement instead.')

  const already = ctx.db
    .prepare("SELECT id FROM inventory_movements WHERE reference = ? OR reason = ?")
    .get(`REV-${record.id}`, `Reversal of movement #${record.id}`) as { id: number } | undefined
  if (already) throw stateError('That movement has already been reversed.')

  const item = loadItem(ctx, record.itemId)
  const inbound = record.signedQuantity > 0
  const quantity = Math.abs(record.signedQuantity)

  ctx.db.transaction(() => {
    if (inbound) {
      const stock = itemStock(ctx, record.itemId)
      if (stock - quantity < 0) {
        throw stateError(
          `Reversing would make ${item.name} negative (${stock} ${item.unit} on hand). Record a count correction for the difference instead.`
        )
      }
    }
    applyMovement(ctx, {
      itemId: record.itemId,
      batchId: record.batchId,
      movementType: inbound ? 'adjustment_out' : 'adjustment_in',
      quantity,
      unitCostMicro: record.unitCostMicro,
      reason: `Reversal of movement #${record.id}: ${input.reason}`,
      reference: `REV-${record.id}`,
      supplierId: null,
      at: ctx.now(),
      allowNegative: false
    })
    ctx.audit.write({
      module: 'inventory',
      action: 'movement.reverse',
      entityType: 'inventory_movement',
      entityId: record.id,
      summary: `Reversed movement #${record.id} (${record.quantity} ${item.unit})`,
      detail: { reason: input.reason }
    })
  })()

  return inventoryDetail(ctx, record.itemId)
}

/** Create a batch row and return its id; reuses an existing batch with the same number and expiry. */
export function findOrCreateBatch(
  ctx: ServiceContext,
  input: { itemId: number, batchNo: string | null, expiryDate: string | null, unitCostMicro: number, supplierId: number | null, note: string | null, at: number }
): number {
  if (input.batchNo) {
    const existing = ctx.db
      .prepare('SELECT id FROM inventory_batches WHERE item_id = ? AND batch_no = ? AND IFNULL(expiry_date, \'\') = IFNULL(?, \'\')')
      .get(input.itemId, input.batchNo, input.expiryDate) as { id: number } | undefined
    if (existing) return existing.id
  }
  const result = ctx.db
    .prepare(
      `INSERT INTO inventory_batches (item_id, batch_no, expiry_date, quantity, unit_cost_micro, supplier_id, received_at, note)
       VALUES (@itemId, @batchNo, @expiryDate, 0, @unitCostMicro, @supplierId, @at, @note)`
    )
    .run({
      itemId: input.itemId,
      batchNo: input.batchNo,
      expiryDate: input.expiryDate,
      unitCostMicro: input.unitCostMicro,
      supplierId: input.supplierId,
      at: input.at,
      note: input.note
    })
  return Number(result.lastInsertRowid)
}

/** Guard used by purchases: an expiry-tracked line must carry an expiry date. */
export function assertBatchForLine(ctx: ServiceContext, itemId: number, expiryDate: string | null): void {
  const item = ctx.db.prepare('SELECT name, expiry_tracking FROM inventory_items WHERE id = ?').get(itemId) as { name: string, expiry_tracking: number } | undefined
  if (!item) throw notFoundError('inventory item', itemId)
  if (item.expiry_tracking === 1 && !expiryDate) {
    throw validationError(`${item.name} tracks expiry, so the purchase line needs an expiry date.`, { expiryDate: 'Required for this item' })
  }
}

