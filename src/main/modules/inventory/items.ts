import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { conflictError, notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch } from '@shared/bengali'
import { toLocalDate } from '@shared/datetime'
import { nextCode } from '../../db/counters'
import { isInboundMovement, type zBatchInput, type zInventoryItemInput, type zInventoryFilter, type zMovementInput } from '@shared/contracts'
import { z } from 'zod'

export type InventoryItemInput = z.infer<typeof zInventoryItemInput>
export type InventoryFilter = z.infer<typeof zInventoryFilter>
export type BatchInput = z.infer<typeof zBatchInput>
export type MovementInput = z.infer<typeof zMovementInput>

export interface InventoryItemRecord {
  id: number
  code: string
  name: string
  category: string
  unit: string
  supplierId: number | null
  supplierName: string | null
  purchasePriceMicro: number
  sellingPriceMicro: number
  reorderLevel: number
  expiryTracking: boolean
  location: string | null
  notes: string | null
  isActive: boolean
  quantityOnHand: number
  stockValueMicro: number
  isLowStock: boolean
  nearestExpiry: string | null
  expiredBatches: number
  createdAt: number
  updatedAt: number
}

export interface BatchRecord {
  id: number
  itemId: number
  batchNo: string | null
  expiryDate: string | null
  quantity: number
  unitCostMicro: number
  supplierId: number | null
  receivedAt: number
  note: string | null
  isExpired: boolean
  daysToExpiry: number | null
}

export interface MovementRecord {
  id: number
  itemId: number
  itemCode: string
  itemName: string
  unit: string
  batchId: number | null
  batchNo: string | null
  movementType: string
  quantity: number
  signedQuantity: number
  unitCostMicro: number
  valueMicro: number
  reason: string | null
  reference: string | null
  supplierName: string | null
  byUserName: string | null
  at: number
  movementDate: string
  createdAt: number
}

interface ItemRow {
  id: number
  code: string
  name: string
  category: string
  unit: string
  supplier_id: number | null
  supplier_name: string | null
  purchase_price_micro: number
  selling_price_micro: number
  reorder_level: number
  expiry_tracking: number
  location: string | null
  notes: string | null
  is_active: number
  quantity_on_hand: number
  stock_value_micro: number
  nearest_expiry: string | null
  expired_batches: number
  created_at: number
  updated_at: number
}

const SELECT_ITEM = `
  SELECT i.id, i.code, i.name, i.category, i.unit, i.supplier_id, s.name AS supplier_name,
         i.purchase_price_micro, i.selling_price_micro, i.reorder_level, i.expiry_tracking,
         i.location, i.notes, i.is_active, i.created_at, i.updated_at,
         COALESCE(v.quantity_on_hand, 0) AS quantity_on_hand,
         COALESCE(v.stock_value_micro, 0) AS stock_value_micro,
         (SELECT MIN(b.expiry_date) FROM inventory_batches b
           WHERE b.item_id = i.id AND b.quantity > 0 AND b.expiry_date IS NOT NULL) AS nearest_expiry,
         (SELECT COUNT(*) FROM inventory_batches b
           WHERE b.item_id = i.id AND b.quantity > 0 AND b.expiry_date IS NOT NULL
             AND b.expiry_date < date('now','localtime')) AS expired_batches
    FROM inventory_items i
    LEFT JOIN inventory_current v ON v.item_id = i.id
    LEFT JOIN suppliers s ON s.id = i.supplier_id
`

export function mapItem(row: ItemRow): InventoryItemRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    unit: row.unit,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    purchasePriceMicro: row.purchase_price_micro,
    sellingPriceMicro: row.selling_price_micro,
    reorderLevel: row.reorder_level,
    expiryTracking: row.expiry_tracking === 1,
    location: row.location,
    notes: row.notes,
    isActive: row.is_active === 1,
    quantityOnHand: row.quantity_on_hand,
    stockValueMicro: row.stock_value_micro,
    isLowStock: row.reorder_level > 0 && row.quantity_on_hand <= row.reorder_level,
    nearestExpiry: row.nearest_expiry,
    expiredBatches: row.expired_batches,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function loadItem(ctx: ServiceContext, id: number): InventoryItemRecord {
  const row = ctx.db.prepare(`${SELECT_ITEM} WHERE i.id = ? AND i.is_deleted = 0`).get(id) as ItemRow | undefined
  if (!row) throw notFoundError('inventory item', id)
  return mapItem(row)
}

export function listItems(ctx: ServiceContext, filter: InventoryFilter): {
  items: InventoryItemRecord[]
  total: number
  limit: number
  offset: number
  totals: { stockValueMicro: number, lowStock: number, expiringSoon: number, expired: number }
  categories: Array<{ category: string, count: number }>
} {
  assertPermission(ctx, 'inventory.view')
  const clauses: string[] = ['i.is_deleted = 0']
  const params: Record<string, unknown> = {}
  if (!filter.includeInactive) clauses.push('i.is_active = 1')
  if (filter.category) {
    clauses.push('i.category = @category')
    params.category = filter.category
  }
  if (filter.supplierId) {
    clauses.push('i.supplier_id = @supplierId')
    params.supplierId = filter.supplierId
  }
  if (filter.search && filter.search.trim() !== '') {
    params.term = `%${filter.search.trim()}%`
    params.fold = `%${foldForSearch(filter.search)}%`
    clauses.push('(i.name LIKE @term OR i.name_fold LIKE @fold OR i.code LIKE @term OR i.location LIKE @term)')
  }
  if (filter.lowStock) clauses.push('i.reorder_level > 0 AND COALESCE(v.quantity_on_hand, 0) <= i.reorder_level')
  if (filter.expiringWithinDays) {
    clauses.push(
      `EXISTS (SELECT 1 FROM inventory_batches b WHERE b.item_id = i.id AND b.quantity > 0 AND b.expiry_date IS NOT NULL
                AND b.expiry_date <= date('now','localtime', '+' || @expiringDays || ' days'))`
    )
    params.expiringDays = filter.expiringWithinDays
  }

  const where = `WHERE ${clauses.join(' AND ')}`
  const count = ctx.db.prepare(`SELECT COUNT(*) AS count FROM inventory_items i LEFT JOIN inventory_current v ON v.item_id = i.id ${where}`).get(params) as { count: number }

  const aggregate = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(v.stock_value_micro, 0)), 0) AS stock_value,
              COALESCE(SUM(CASE WHEN i.reorder_level > 0 AND COALESCE(v.quantity_on_hand, 0) <= i.reorder_level THEN 1 ELSE 0 END), 0) AS low_stock
         FROM inventory_items i LEFT JOIN inventory_current v ON v.item_id = i.id
        WHERE i.is_deleted = 0 AND i.is_active = 1`
    )
    .get({}) as { stock_value: number, low_stock: number }
  const alerts = ctx.db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
           WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL AND i.is_deleted = 0
             AND b.expiry_date >= date('now','localtime') AND b.expiry_date <= date('now','localtime','+90 days')) AS expiring,
         (SELECT COUNT(*) FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
           WHERE b.quantity > 0 AND b.expiry_date IS NOT NULL AND i.is_deleted = 0
             AND b.expiry_date < date('now','localtime')) AS expired`
    )
    .get({}) as { expiring: number, expired: number }

  const order = filter.sort === 'stock' ? 'v.quantity_on_hand IS NULL, v.quantity_on_hand ASC' : filter.sort === 'value' ? 'v.stock_value_micro DESC' : filter.sort === 'expiry' ? 'nearest_expiry IS NULL, nearest_expiry ASC' : 'i.name_fold ASC'
  const items = ctx.db
    .prepare(`${SELECT_ITEM} ${where} ORDER BY ${order}, i.id ASC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.limit, offset: filter.offset }) as ItemRow[]

  const categories = ctx.db
    .prepare('SELECT category, COUNT(*) AS count FROM inventory_items WHERE is_deleted = 0 AND is_active = 1 GROUP BY category ORDER BY category')
    .all({}) as Array<{ category: string, count: number }>

  return {
    items: items.map(mapItem),
    total: count.count,
    limit: filter.limit,
    offset: filter.offset,
    totals: { stockValueMicro: aggregate.stock_value, lowStock: aggregate.low_stock, expiringSoon: alerts.expiring, expired: alerts.expired },
    categories
  }
}

export function saveItem(ctx: ServiceContext, input: InventoryItemInput): InventoryItemRecord {
  assertPermission(ctx, input.id ? 'inventory.edit' : 'inventory.create')
  if (input.supplierId) {
    const supplier = ctx.db.prepare('SELECT id FROM suppliers WHERE id = ? AND is_deleted = 0').get(input.supplierId)
    if (!supplier) throw notFoundError('supplier', input.supplierId)
  }
  const now = ctx.now()
  const fold = foldForSearch(input.name)
  const duplicate = ctx.db
    .prepare('SELECT id, code FROM inventory_items WHERE is_deleted = 0 AND name_fold = ? AND id <> ?')
    .get(fold, input.id ?? -1) as { id: number, code: string } | undefined
  if (duplicate) throw conflictError(`“${input.name}” already exists as item ${duplicate.code}.`, { name: `Already used by ${duplicate.code}` })

  const id = ctx.db.transaction(() => {
    if (input.id) {
      const existing = ctx.db.prepare('SELECT id, code FROM inventory_items WHERE id = ? AND is_deleted = 0').get(input.id) as { id: number, code: string } | undefined
      if (!existing) throw notFoundError('inventory item', input.id)
      const code = input.code && input.code.trim() !== '' ? input.code.trim().toUpperCase() : existing.code
      ctx.db
        .prepare(
          `UPDATE inventory_items
              SET code = @code, name = @name, name_fold = @fold, category = @category, unit = @unit, supplier_id = @supplierId,
                  purchase_price_micro = @purchasePriceMicro, selling_price_micro = @sellingPriceMicro, reorder_level = @reorderLevel,
                  expiry_tracking = @expiryTracking, location = @location, notes = @notes, is_active = @isActive, updated_at = @now
            WHERE id = @id`
        )
        .run({
          id: input.id,
          code,
          name: input.name,
          fold,
          category: input.category,
          unit: input.unit,
          supplierId: input.supplierId ?? null,
          purchasePriceMicro: input.purchasePriceMicro,
          sellingPriceMicro: input.sellingPriceMicro,
          reorderLevel: input.reorderLevel,
          expiryTracking: input.expiryTracking ? 1 : 0,
          location: input.location ?? null,
          notes: input.notes ?? null,
          isActive: input.isActive ? 1 : 0,
          now
        })
      ctx.audit.write({
        module: 'inventory',
        action: 'item.update',
        entityType: 'inventory_item',
        entityId: input.id,
        summary: `Updated item ${code} · ${input.name}`,
        detail: { category: input.category, reorderLevel: input.reorderLevel }
      })
      return input.id
    }

    const code = input.code && input.code.trim() !== '' ? input.code.trim().toUpperCase() : nextCode(ctx.db, 'item', now)
    const result = ctx.db
      .prepare(
        `INSERT INTO inventory_items (code, name, name_fold, category, unit, supplier_id, purchase_price_micro, selling_price_micro,
                                      reorder_level, expiry_tracking, location, notes, is_active, created_at, updated_at)
         VALUES (@code, @name, @fold, @category, @unit, @supplierId, @purchasePriceMicro, @sellingPriceMicro,
                 @reorderLevel, @expiryTracking, @location, @notes, @isActive, @now, @now)`
      )
      .run({
        code,
        name: input.name,
        fold,
        category: input.category,
        unit: input.unit,
        supplierId: input.supplierId ?? null,
        purchasePriceMicro: input.purchasePriceMicro,
        sellingPriceMicro: input.sellingPriceMicro,
        reorderLevel: input.reorderLevel,
        expiryTracking: input.expiryTracking ? 1 : 0,
        location: input.location ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ? 1 : 0,
        now
      })
    const created = Number(result.lastInsertRowid)
    ctx.audit.write({
      module: 'inventory',
      action: 'item.create',
      entityType: 'inventory_item',
      entityId: created,
      summary: `Added item ${code} · ${input.name}`,
      detail: { category: input.category, unit: input.unit }
    })
    return created
  })()

  return loadItem(ctx, id)
}

export function archiveItem(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'inventory.delete')
  const item = loadItem(ctx, input.id)
  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE inventory_items SET is_deleted = 1, is_active = 0, updated_at = ? WHERE id = ?').run(now, input.id)
    ctx.audit.write({
      module: 'inventory',
      action: 'item.archive',
      entityType: 'inventory_item',
      entityId: input.id,
      summary: `Archived item ${item.code} · ${item.name} (${item.quantityOnHand} ${item.unit} on hand)`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}

/* ---------------------------------------------------------------------- batches */

export function loadBatch(ctx: ServiceContext, id: number): BatchRecord {
  const row = ctx.db
    .prepare(
      `SELECT b.id, b.item_id, b.batch_no, b.expiry_date, b.quantity, b.unit_cost_micro, b.supplier_id, b.received_at, b.note
         FROM inventory_batches b WHERE b.id = ?`
    )
    .get(id) as
    | { id: number, item_id: number, batch_no: string | null, expiry_date: string | null, quantity: number, unit_cost_micro: number, supplier_id: number | null, received_at: number, note: string | null }
    | undefined
  if (!row) throw notFoundError('batch', id)
  return mapBatch(row)
}

interface BatchRow {
  id: number
  item_id: number
  batch_no: string | null
  expiry_date: string | null
  quantity: number
  unit_cost_micro: number
  supplier_id: number | null
  received_at: number
  note: string | null
}

export function mapBatch(row: BatchRow, today = toLocalDate(Date.now())): BatchRecord {
  const days = row.expiry_date === null ? null : Math.round((Date.parse(`${row.expiry_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  return {
    id: row.id,
    itemId: row.item_id,
    batchNo: row.batch_no,
    expiryDate: row.expiry_date,
    quantity: row.quantity,
    unitCostMicro: row.unit_cost_micro,
    supplierId: row.supplier_id,
    receivedAt: row.received_at,
    note: row.note,
    isExpired: days !== null && days < 0,
    daysToExpiry: days
  }
}

export function batchesForItem(ctx: ServiceContext, itemId: number): BatchRecord[] {
  const rows = ctx.db
    .prepare(
      `SELECT id, item_id, batch_no, expiry_date, quantity, unit_cost_micro, supplier_id, received_at, note
         FROM inventory_batches WHERE item_id = ? ORDER BY (expiry_date IS NULL), expiry_date ASC, id ASC`
    )
    .all(itemId) as BatchRow[]
  const today = toLocalDate(ctx.now())
  return rows.map((row) => mapBatch(row, today))
}

/** Batches with stock that expire inside the window (or have already expired), soonest first. */
export function expiringBatches(ctx: ServiceContext, withinDays: number): BatchRecord[] {
  assertPermission(ctx, 'inventory.view')
  const rows = ctx.db
    .prepare(
      `SELECT b.id, b.item_id, b.batch_no, b.expiry_date, b.quantity, b.unit_cost_micro, b.supplier_id, b.received_at, b.note
         FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
        WHERE i.is_deleted = 0 AND b.quantity > 0 AND b.expiry_date IS NOT NULL
          AND b.expiry_date <= date('now','localtime', '+' || ? || ' days')
        ORDER BY b.expiry_date ASC, b.id ASC`
    )
    .all(withinDays) as BatchRow[]
  const today = toLocalDate(ctx.now())
  return rows.map((row) => mapBatch(row, today))
}

/** Items at or below their reorder level, worst first — the low-stock worklist. */
export function lowStockItems(ctx: ServiceContext): InventoryItemRecord[] {
  assertPermission(ctx, 'inventory.view')
  const rows = ctx.db
    .prepare(
      `${SELECT_ITEM}
        WHERE i.is_deleted = 0 AND i.is_active = 1 AND i.reorder_level > 0 AND COALESCE(v.quantity_on_hand, 0) <= i.reorder_level
        ORDER BY (COALESCE(v.quantity_on_hand, 0) / NULLIF(i.reorder_level, 0)) ASC, i.name_fold ASC`
    )
    .all({}) as ItemRow[]
  return rows.map(mapItem)
}

/* ------------------------------------------------------------------- movements */

export function mapMovement(row: {
  id: number
  item_id: number
  item_code: string
  item_name: string
  unit: string
  batch_id: number | null
  batch_no: string | null
  movement_type: string
  quantity: number
  unit_cost_micro: number
  reason: string | null
  reference: string | null
  supplier_name: string | null
  by_user_name: string | null
  at: number
  movement_date: string
  created_at: number
}): MovementRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    itemCode: row.item_code,
    itemName: row.item_name,
    unit: row.unit,
    batchId: row.batch_id,
    batchNo: row.batch_no,
    movementType: row.movement_type,
    quantity: Math.abs(row.quantity),
    signedQuantity: row.quantity,
    unitCostMicro: row.unit_cost_micro,
    valueMicro: Math.round(Math.abs(row.quantity) * row.unit_cost_micro),
    reason: row.reason,
    reference: row.reference,
    supplierName: row.supplier_name,
    byUserName: row.by_user_name,
    at: row.at,
    movementDate: row.movement_date,
    createdAt: row.created_at
  }
}

export interface ApplyMovementOptions {
  itemId: number
  batchId: number | null
  movementType: string
  /** Always positive; the ledger stores the signed delta. */
  quantity: number
  unitCostMicro: number
  reason: string
  reference: string | null
  supplierId: number | null
  at: number
  /** Skips the negative-stock guard only for a reversal that undoes an earlier movement. */
  allowNegative?: boolean
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

/**
 * Write one movement into the ledger.
 *
 * Callers must already be inside a transaction (or wrap this call). The quantity stored is signed, the
 * batch cache for the touched batch is recomputed from the ledger, and the item's average cost is left
 * untouched — costs live on batches and movements, never overwritten by a later purchase.
 */
export function applyMovement(ctx: ServiceContext, options: ApplyMovementOptions): MovementRecord {
  const item = ctx.db
    .prepare('SELECT id, is_active, is_deleted, expiry_tracking FROM inventory_items WHERE id = ?')
    .get(options.itemId) as { id: number, is_active: number, is_deleted: number, expiry_tracking: number } | undefined
  if (!item) throw notFoundError('inventory item', options.itemId)
  if (item.is_deleted === 1) throw stateError('That item is archived, so its stock can no longer change.')

  const inbound = isInboundMovement(options.movementType as never)
  const signed = inbound ? options.quantity : -options.quantity
  if (item.expiry_tracking === 1 && inbound && options.batchId === null) {
    throw validationError('This item tracks expiry, so stock must be received into a batch.', { batchId: 'Choose or create a batch' })
  }
  if (item.expiry_tracking === 1 && options.batchId !== null) {
    const batch = ctx.db.prepare('SELECT id, item_id FROM inventory_batches WHERE id = ?').get(options.batchId) as { id: number, item_id: number } | undefined
    if (!batch) throw notFoundError('batch', options.batchId)
    if (batch.item_id !== options.itemId) throw validationError('That batch belongs to a different item.', { batchId: 'Batch mismatch' })
  }

  if (!inbound && !options.allowNegative) {
    const stock = ctx.db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_movements WHERE item_id = ?').get(options.itemId) as { total: number }
    if (stock.total - options.quantity < 0) {
      throw stateError(`Only ${stock.total} in stock, so ${options.quantity} cannot be taken out. Record a count correction first if the shelf disagrees.`)
    }
  }

  const at = options.at
  const now = ctx.now()
  const result = ctx.db
    .prepare(
      `INSERT INTO inventory_movements (item_id, batch_id, movement_type, quantity, unit_cost_micro, reason, reference, supplier_id, at, movement_date, by_user_id, created_at)
       VALUES (@itemId, @batchId, @movementType, @quantity, @unitCostMicro, @reason, @reference, @supplierId, @at, @movementDate, @userId, @now)`
    )
    .run({
      itemId: options.itemId,
      batchId: options.batchId,
      movementType: options.movementType,
      quantity: signed,
      unitCostMicro: options.unitCostMicro,
      reason: options.reason,
      reference: options.reference,
      supplierId: options.supplierId,
      at,
      movementDate: toLocalDate(at),
      userId: ctx.actor.userId,
      now
    })
  if (options.batchId !== null) recalculateBatch(ctx, options.batchId)

  const row = ctx.db.prepare(`${MOVEMENT_SELECT} WHERE m.id = ?`).get(Number(result.lastInsertRowid)) as never
  return mapMovement(row)
}

/** The batch quantity is a cache of the ledger; recompute it so the two can never drift. */
export function recalculateBatch(ctx: ServiceContext, batchId: number): void {
  ctx.db.prepare('UPDATE inventory_batches SET quantity = COALESCE((SELECT SUM(quantity) FROM inventory_movements WHERE batch_id = ?), 0) WHERE id = ?').run(batchId, batchId)
}

export function itemStock(ctx: ServiceContext, itemId: number): number {
  const row = ctx.db.prepare('SELECT COALESCE(SUM(quantity), 0) AS total FROM inventory_movements WHERE item_id = ?').get(itemId) as { total: number }
  return row.total
}
