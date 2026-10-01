import { z } from 'zod'
import { channel, zDateRange, zLocalDate, zOptionalText, zTrimmed } from '../ipc'
import { zActionResult } from './system'

/* -------------------------------------------------------------------------- */
/* Value objects                                                              */
/* -------------------------------------------------------------------------- */

/** Stock categories used by the seeded catalogue and the screen filters. */
export const INVENTORY_CATEGORIES = [
  'consumable',
  'restorative',
  'endodontic',
  'prosthetic',
  'orthodontic',
  'instrument',
  'sterilisation',
  'pharmaceutical',
  'office',
  'general'
] as const
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

/**
 * Movement ledger vocabulary.
 *
 * Stock is never edited in place: every change is an append-only movement, and a wrong movement is
 * corrected by an opposite movement that references it. Inbound types add, outbound types subtract.
 */
export const MOVEMENT_TYPES = [
  'opening',
  'purchase',
  'return_in',
  'adjustment_in',
  'usage',
  'adjustment_out',
  'expired',
  'damaged',
  'return_out'
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const INBOUND_MOVEMENT_TYPES: readonly MovementType[] = ['opening', 'purchase', 'return_in', 'adjustment_in']

export function isInboundMovement(type: MovementType): boolean {
  return INBOUND_MOVEMENT_TYPES.includes(type)
}

/** Purchase payment state, derived from `paid_micro` against `total_micro`. */
export const PURCHASE_STATUSES = ['unpaid', 'partial', 'paid', 'void'] as const

export const zSupplierInput = z.object({
  id: z.number().int().positive().nullish(),
  name: zTrimmed(2, 140, 'Supplier name'),
  contactPerson: zOptionalText(120),
  phone: zOptionalText(32),
  altPhone: zOptionalText(32),
  email: zOptionalText(160),
  address: zOptionalText(400),
  notes: zOptionalText(1000),
  isActive: z.boolean().default(true)
})

export const zSupplier = zSupplierInput.extend({
  id: z.number(),
  purchases: z.number(),
  totalPurchasedMicro: z.number(),
  dueMicro: z.number(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const zInventoryItemInput = z.object({
  id: z.number().int().positive().nullish(),
  code: zOptionalText(24),
  name: zTrimmed(2, 160, 'Item name'),
  category: z.enum(INVENTORY_CATEGORIES).default('general'),
  unit: zTrimmed(1, 16, 'Unit'),
  supplierId: z.number().int().positive().nullish(),
  purchasePriceMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  sellingPriceMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  reorderLevel: z.number().min(0).max(1_000_000).default(0),
  expiryTracking: z.boolean().default(false),
  location: zOptionalText(80),
  notes: zOptionalText(1000),
  isActive: z.boolean().default(true)
})

export const zInventoryItem = zInventoryItemInput.extend({
  id: z.number(),
  code: z.string(),
  supplierName: z.string().nullable(),
  quantityOnHand: z.number(),
  stockValueMicro: z.number(),
  isLowStock: z.boolean(),
  nearestExpiry: zLocalDate.nullable(),
  expiredBatches: z.number(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const zInventoryList = z.object({
  items: z.array(zInventoryItem),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  totals: z.object({
    stockValueMicro: z.number(),
    lowStock: z.number(),
    expiringSoon: z.number(),
    expired: z.number()
  }),
  categories: z.array(z.object({ category: z.string(), count: z.number() }))
})

export const zInventoryFilter = z.object({
  search: z.string().max(120).optional(),
  category: z.string().max(40).optional(),
  supplierId: z.number().int().positive().optional(),
  lowStock: z.boolean().optional(),
  expiringWithinDays: z.number().int().min(1).max(365).optional(),
  includeInactive: z.boolean().default(false),
  sort: z.enum(['name', 'stock', 'value', 'expiry']).default('name'),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0)
})

export const zBatchInput = z.object({
  id: z.number().int().positive().nullish(),
  batchNo: zOptionalText(60),
  expiryDate: zLocalDate.nullish(),
  unitCostMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  supplierId: z.number().int().positive().nullish(),
  note: zOptionalText(300)
})

export const zBatch = zBatchInput.extend({
  id: z.number(),
  itemId: z.number(),
  quantity: z.number(),
  receivedAt: z.number(),
  isExpired: z.boolean(),
  daysToExpiry: z.number().nullable()
})

export const zMovementInput = z.object({
  itemId: z.number().int().positive(),
  batchId: z.number().int().positive().nullish(),
  /** A new batch for expiry-tracked items when none exists yet (opening stock, adjustments). */
  batch: zBatchInput.optional(),
  movementType: z.enum(MOVEMENT_TYPES),
  quantity: z.number().positive().max(1_000_000),
  unitCostMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  reason: zTrimmed(3, 300, 'Reason'),
  reference: zOptionalText(120),
  supplierId: z.number().int().positive().nullish(),
  at: z.number().int().positive().nullish()
})

export const zMovement = z.object({
  id: z.number(),
  itemId: z.number(),
  itemCode: z.string(),
  itemName: z.string(),
  unit: z.string(),
  batchId: z.number().nullable(),
  batchNo: z.string().nullable(),
  movementType: z.enum(MOVEMENT_TYPES),
  quantity: z.number(),
  signedQuantity: z.number(),
  unitCostMicro: z.number(),
  valueMicro: z.number(),
  reason: z.string().nullable(),
  reference: z.string().nullable(),
  supplierName: z.string().nullable(),
  byUserName: z.string().nullable(),
  at: z.number(),
  movementDate: zLocalDate,
  createdAt: z.number()
})

export const zInventoryDetail = z.object({
  item: zInventoryItem,
  batches: z.array(zBatch),
  movements: z.array(zMovement),
  recentUsage: z.array(z.object({ date: zLocalDate, quantity: z.number() }))
})

export const zPurchaseLineInput = z.object({
  itemId: z.number().int().positive(),
  batchNo: zOptionalText(60),
  expiryDate: zLocalDate.nullish(),
  quantity: z.number().positive().max(1_000_000),
  unitCostMicro: z.number().int().min(0).max(999_999_999_999),
  notes: zOptionalText(300)
})

export const zPurchaseInput = z.object({
  id: z.number().int().positive().nullish(),
  supplierId: z.number().int().positive().nullish(),
  invoiceRef: zOptionalText(80),
  purchaseDate: zLocalDate,
  paidMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  paymentMethod: z.string().max(32).default('cash'),
  notes: zOptionalText(1000),
  lines: z.array(zPurchaseLineInput).min(1).max(200)
})

export const zPurchaseLine = zPurchaseLineInput.extend({
  id: z.number(),
  itemCode: z.string(),
  itemName: z.string(),
  unit: z.string(),
  lineTotalMicro: z.number(),
  batchId: z.number().nullable()
})

export const zPurchase = z.object({
  id: z.number(),
  purchaseNo: z.string(),
  supplierId: z.number().nullable(),
  supplierName: z.string().nullable(),
  invoiceRef: z.string().nullable(),
  purchaseDate: zLocalDate,
  totalMicro: z.number(),
  paidMicro: z.number(),
  dueMicro: z.number(),
  status: z.enum(PURCHASE_STATUSES),
  notes: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lines: z.array(zPurchaseLine)
})

export const zPurchasePage = z.object({
  items: z.array(zPurchase),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  totals: z.object({ purchasedMicro: z.number(), paidMicro: z.number(), dueMicro: z.number() })
})

/* -------------------------------------------------------------------------- */
/* Channel registry                                                           */
/* -------------------------------------------------------------------------- */

export const inventoryChannels = {
  'inventory.list': channel(zInventoryFilter, zInventoryList),
  'inventory.get': channel(z.object({ id: z.number().int().positive() }), zInventoryDetail),
  'inventory.save': channel(zInventoryItemInput, zInventoryItem),
  'inventory.archive': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 300, 'Reason') }), zActionResult),
  'inventory.movement.add': channel(zMovementInput, zInventoryDetail),
  'inventory.movement.reverse': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 300, 'Reason') }), zInventoryDetail),
  'inventory.movements': channel(
    z.object({
      itemId: z.number().int().positive().optional(),
      movementType: z.enum(MOVEMENT_TYPES).optional(),
      supplierId: z.number().int().positive().optional(),
      search: z.string().max(120).optional(),
      range: zDateRange.optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0)
    }),
    z.object({ items: z.array(zMovement), total: z.number(), limit: z.number(), offset: z.number() })
  ),
  'inventory.movements.export': channel(
    z.object({ itemId: z.number().int().positive().optional(), range: zDateRange.optional(), limit: z.number().int().min(1).max(5000).default(5000), offset: z.number().int().min(0).default(0) }),
    z.object({ path: z.string().nullable(), rowCount: z.number().int() })
  ),
  'inventory.lowStock': channel(z.object({}).default({}), z.array(zInventoryItem)),
  'inventory.expiring': channel(z.object({ withinDays: z.number().int().min(1).max(365).default(90) }), z.array(zBatch)),
  'inventory.batches': channel(z.object({ itemId: z.number().int().positive() }), z.array(zBatch)),

  /* ----------------------------------------------------------------- suppliers */
  'suppliers.list': channel(
    z.object({ search: z.string().max(120).optional(), includeInactive: z.boolean().default(false) }).default({ includeInactive: false }),
    z.array(zSupplier)
  ),
  'suppliers.get': channel(z.object({ id: z.number().int().positive() }), zSupplier),
  'suppliers.save': channel(zSupplierInput, zSupplier),
  'suppliers.archive': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 300, 'Reason') }), zActionResult),

  /* ----------------------------------------------------------------- purchases */
  'purchases.list': channel(
    z.object({
      supplierId: z.number().int().positive().optional(),
      status: z.enum(PURCHASE_STATUSES).optional(),
      search: z.string().max(120).optional(),
      range: zDateRange.optional(),
      limit: z.number().int().min(1).max(100).default(25),
      offset: z.number().int().min(0).default(0)
    }),
    zPurchasePage
  ),
  'purchases.get': channel(z.object({ id: z.number().int().positive() }), zPurchase),
  'purchases.save': channel(zPurchaseInput, zPurchase),
  'purchases.setPaid': channel(
    z.object({ id: z.number().int().positive(), paidMicro: z.number().int().min(0).max(999_999_999_999), method: z.string().max(32).default('cash'), note: zOptionalText(300) }),
    zPurchase
  ),
  'purchases.export': channel(
    z.object({ supplierId: z.number().int().positive().optional(), range: zDateRange.optional(), limit: z.number().int().min(1).max(5000).default(5000), offset: z.number().int().min(0).default(0) }),
    z.object({ path: z.string().nullable(), rowCount: z.number().int() })
  )
}
