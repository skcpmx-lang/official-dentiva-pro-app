import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import {
  archiveItem,
  batchesForItem,
  expiringBatches,
  listItems,
  loadItem,
  lowStockItems,
  saveItem,
  type InventoryItemInput
} from '@main/modules/inventory/items'
import { inventoryDetail, listMovements, recordMovement, reverseMovement } from '@main/modules/inventory/movements'
import { listPurchases, savePurchase, setPurchasePaid } from '@main/modules/inventory/purchases'
import { archiveSupplier, getSupplier, listSuppliers, saveSupplier, type SupplierInput } from '@main/modules/inventory/suppliers'
import { PERMISSION_CODES } from '@shared/permissions'
import { fromLocalDate, toLocalDate } from '@shared/datetime'

/**
 * Inventory integration tests.
 *
 * Stock is a ledger, so these tests follow quantities through every path that can change them: opening
 * stock, purchases into batches, first-expiry-first-out issues, count corrections and reversals. They also
 * pin the guards that stop nonsense: no negative stock, no expiry-tracked stock without a batch, no
 * editing a received purchase, and no stock movement without the adjustment permission.
 */

let harness: TestHarness

const TODAY = toLocalDate(Date.now())
const DAY = 86_400_000

function itemInput(overrides: Partial<InventoryItemInput> = {}): InventoryItemInput {
  return {
    id: null,
    code: null,
    name: 'Composite resin',
    category: 'restorative',
    unit: 'syringe',
    supplierId: null,
    purchasePriceMicro: 120_000,
    sellingPriceMicro: 0,
    reorderLevel: 5,
    expiryTracking: false,
    location: 'Cabinet A',
    notes: null,
    isActive: true,
    ...overrides
  } as InventoryItemInput
}

function supplierInput(overrides: Partial<SupplierInput> = {}): SupplierInput {
  return {
    id: null,
    name: 'Dhaka Dental Supplies',
    contactPerson: 'Mr Karim',
    phone: '01711000000',
    altPhone: null,
    email: null,
    address: 'Mirpur, Dhaka',
    notes: null,
    isActive: true,
    ...overrides
  } as SupplierInput
}

function move(type: string, quantity: number, extra: Record<string, unknown> = {}): ReturnType<typeof recordMovement> {
  return recordMovement(harness.ctx(), {
    itemId: extra.itemId as number,
    batchId: null,
    movementType: type,
    quantity,
    unitCostMicro: 120_000,
    reason: 'Stock take',
    reference: null,
    supplierId: null,
    at: null,
    ...extra
  } as never)
}

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.cleanup()
})

describe('inventory items', () => {
  it('creates items with an ITM code, refuses duplicate names and reports stock value and low stock', () => {
    const item = saveItem(harness.ctx(), itemInput())
    expect(item.code).toMatch(/^ITM-\d{4}-\d{4}$/)
    expect(item.code).not.toBe('INV-0000-0000')
    /* A brand-new item with no stock is, honestly, below its reorder level. */
    expect(item.isLowStock).toBe(true)

    expect(() => saveItem(harness.ctx(), itemInput({ name: '  composite RESIN ' }))).toThrow(/already exists/i)

    recordMovement(harness.ctx(), {
      itemId: item.id,
      batchId: null,
      movementType: 'opening',
      quantity: 10,
      unitCostMicro: 120_000,
      reason: 'Opening stock at go-live',
      reference: null,
      supplierId: null,
      at: null,
      batch: undefined
    } as never)

    const afterStock = loadItem(harness.ctx(), item.id)
    expect(afterStock.quantityOnHand).toBe(10)
    expect(afterStock.stockValueMicro).toBe(1_200_000)
    expect(afterStock.isLowStock).toBe(false)

    const page = listItems(harness.ctx(), { includeInactive: false, sort: 'name', limit: 50, offset: 0 } as never)
    expect(page.totals.stockValueMicro).toBe(1_200_000)
    expect(page.categories).toEqual([{ category: 'restorative', count: 1 }])
    expect(page.items[0]?.quantityOnHand).toBe(10)

    /* Item code is editable but must stay unique. */
    const renamed = saveItem(harness.ctx(), itemInput({ id: item.id, name: 'Composite resin (A2)', code: 'CR-A2' }))
    expect(renamed.code).toBe('CR-A2')
  })

  it('flags low stock against the reorder level and archives without deleting history', () => {
    const item = saveItem(harness.ctx(), itemInput({ reorderLevel: 4 }))
    move('opening', 6, { itemId: item.id })
    move('usage', 3, { itemId: item.id, reason: 'Used in restoration' })

    const low = lowStockItems(harness.ctx())
    expect(low.map((entry) => entry.id)).toEqual([item.id])
    expect(low[0]?.quantityOnHand).toBe(3)
    expect(low[0]?.isLowStock).toBe(true)

    archiveItem(harness.ctx(), { id: item.id, reason: 'No longer stocked' })
    expect(() => loadItem(harness.ctx(), item.id)).toThrow(/could not be found/i)
    expect(listItems(harness.ctx(), { includeInactive: false, sort: 'name', limit: 50, offset: 0 } as never).items).toHaveLength(0)

    /* The ledger survives archiving, so past consumption stays explainable. */
    const movements = listMovements(harness.ctx(), { itemId: item.id, limit: 50, offset: 0 })
    expect(movements.items).toHaveLength(2)
  })

  it('never lets stock go negative and keeps the ledger append-only', () => {
    const item = saveItem(harness.ctx(), itemInput())
    move('opening', 5, { itemId: item.id })

    expect(() => move('usage', 6, { itemId: item.id, reason: 'Over-issued by mistake' })).toThrow(/only 5 in stock/i)
    expect(loadItem(harness.ctx(), item.id).quantityOnHand).toBe(5)

    const detail = inventoryDetail(harness.ctx(), item.id)
    expect(detail.movements).toHaveLength(1)
    expect(detail.movements[0]?.signedQuantity).toBe(5)
    expect(detail.movements[0]?.valueMicro).toBe(600_000)
    expect(detail.recentUsage).toEqual([])
  })
})

describe('expiry tracking and batches', () => {
  it('requires a batch for expiry-tracked items and issues first-expiry-first-out', () => {
    const item = saveItem(harness.ctx(), itemInput({ name: 'Lidocaine cartridge', expiryTracking: true, unit: 'cartridge', category: 'pharmaceutical' }))

    /* Expiry-tracked stock cannot arrive without a batch… */
    expect(() => move('opening', 10, { itemId: item.id })).toThrow(/tracks expiry/i)

    /* …but the movement can create one on the fly. */
    move('opening', 50, {
      itemId: item.id,
      batch: { batchNo: 'LOT-OLD', expiryDate: toLocalDate(Date.now() + 30 * DAY), unitCostMicro: 90_000, supplierId: null, note: null }
    })
    move('opening', 50, {
      itemId: item.id,
      batch: { batchNo: 'LOT-NEW', expiryDate: toLocalDate(Date.now() + 400 * DAY), unitCostMicro: 90_000, supplierId: null, note: null }
    })

    const batches = batchesForItem(harness.ctx(), item.id)
    expect(batches).toHaveLength(2)
    expect(batches[0]?.batchNo).toBe('LOT-OLD')
    expect(batches[0]?.daysToExpiry).toBe(30)
    expect(batches[1]?.batchNo).toBe('LOT-NEW')

    /* Issuing 60 without naming a batch must empty the older lot first and split across lots. */
    const after = recordMovement(harness.ctx(), {
      itemId: item.id,
      batchId: null,
      movementType: 'usage',
      quantity: 60,
      unitCostMicro: 0,
      reason: 'Used for two extractions',
      reference: 'V-2610-0004',
      supplierId: null,
      at: null
    } as never)
    expect(after.item.quantityOnHand).toBe(40)
    const oldLot = after.batches.find((batch) => batch.batchNo === 'LOT-OLD')
    const newLot = after.batches.find((batch) => batch.batchNo === 'LOT-NEW')
    expect(oldLot?.quantity).toBe(0)
    expect(newLot?.quantity).toBe(40)

    /* The ledger explains the split rather than hiding it. */
    const usageMovements = after.movements.filter((movement) => movement.movementType === 'usage')
    expect(usageMovements).toHaveLength(2)
    /* The ledger is shown newest first, so the newer lot movement comes first in the list. */
    expect(usageMovements.map((movement) => movement.batchNo)).toEqual(['LOT-NEW', 'LOT-OLD'])
    expect(usageMovements.reduce((sum, movement) => sum + movement.quantity, 0)).toBe(60)

    expect(() => move('usage', 41, { itemId: item.id, reason: 'More than the shelf holds' })).toThrow(/unexpired batches/i)
  })

  it('reports batches that are expiring or already expired', () => {
    const item = saveItem(harness.ctx(), itemInput({ name: 'Fluoride varnish', expiryTracking: true, category: 'pharmaceutical' }))
    move('opening', 20, {
      itemId: item.id,
      batch: { batchNo: 'EXP-SOON', expiryDate: toLocalDate(Date.now() + 20 * DAY), unitCostMicro: 60_000, supplierId: null, note: null }
    })
    move('opening', 20, {
      itemId: item.id,
      batch: { batchNo: 'EXPIRED', expiryDate: toLocalDate(Date.now() - 5 * DAY), unitCostMicro: 60_000, supplierId: null, note: null }
    })

    const soon = expiringBatches(harness.ctx(), 30)
    expect(soon.map((batch) => batch.batchNo)).toEqual(['EXPIRED', 'EXP-SOON'])
    expect(soon[0]?.isExpired).toBe(true)
    expect(soon[1]?.isExpired).toBe(false)

    const page = listItems(harness.ctx(), { includeInactive: false, sort: 'expiry', limit: 50, offset: 0 } as never)
    expect(page.items[0]?.expiredBatches).toBe(1)
    expect(page.items[0]?.nearestExpiry).toBe(toLocalDate(Date.now() - 5 * DAY))
    expect(page.totals.expired).toBe(1)
    expect(page.totals.expiringSoon).toBe(1)
  })
})

describe('movement corrections', () => {
  it('reverses a movement by writing an opposite entry and refuses a second reversal', () => {
    const item = saveItem(harness.ctx(), itemInput())
    move('opening', 10, { itemId: item.id })
    const wrong = recordMovement(harness.ctx(), {
      itemId: item.id,
      batchId: null,
      movementType: 'adjustment_out',
      quantity: 4,
      unitCostMicro: 0,
      reason: 'Damaged syringe',
      reference: null,
      supplierId: null,
      at: null
    } as never)
    const wrongId = wrong.movements[0]!.id
    expect(loadItem(harness.ctx(), item.id).quantityOnHand).toBe(6)

    const corrected = reverseMovement(harness.ctx(), { id: wrongId, reason: 'The syringe was actually usable' })
    expect(corrected.item.quantityOnHand).toBe(10)
    const reversal = corrected.movements.find((movement) => movement.reference === `REV-${wrongId}`)
    expect(reversal?.movementType).toBe('adjustment_in')
    expect(reversal?.reason).toContain('Reversal of movement')

    expect(() => reverseMovement(harness.ctx(), { id: wrongId, reason: 'Trying again' })).toThrow(/already been reversed/i)

    /* Reversing an inbound movement that has since been consumed is refused rather than going negative. */
    move('usage', 9, { itemId: item.id, reason: 'Issued to the surgery' })
    expect(() => reverseMovement(harness.ctx(), { id: corrected.movements.find((movement) => movement.movementType === 'opening')!.id, reason: 'Opening count was wrong' })).toThrow(/negative/i)
  })
})

describe('purchases and suppliers', () => {
  it('receives a purchase into batches, updates stock and tracks what is still owed', () => {
    const supplier = saveSupplier(harness.ctx(), supplierInput())
    const gloves = saveItem(harness.ctx(), itemInput({ name: 'Nitrile gloves (M)', category: 'consumable', unit: 'box', supplierId: supplier.id }))
    const composite = saveItem(harness.ctx(), itemInput({ name: 'Composite resin', expiryTracking: true, unit: 'syringe' }))

    const purchase = savePurchase(harness.ctx(), {
      id: null,
      supplierId: supplier.id,
      invoiceRef: 'INV-SUP-2291',
      purchaseDate: TODAY,
      paidMicro: 500_000,
      paymentMethod: 'bkash',
      notes: 'Monthly restock',
      lines: [
        { itemId: gloves.id, batchNo: null, expiryDate: null, quantity: 20, unitCostMicro: 250_000 },
        { itemId: composite.id, batchNo: 'LOT-77', expiryDate: toLocalDate(Date.now() + 200 * DAY), quantity: 10, unitCostMicro: 1_150_000 }
      ]
    } as never)

    expect(purchase.purchaseNo).toMatch(/^PO-\d{4}-\d{4}$/)
    expect(purchase.totalMicro).toBe(20 * 250_000 + 10 * 1_150_000)
    expect(purchase.paidMicro).toBe(500_000)
    expect(purchase.status).toBe('partial')
    expect(purchase.dueMicro).toBe(purchase.totalMicro - 500_000)
    expect(purchase.lines).toHaveLength(2)
    expect(purchase.lines[1]?.batchNo).toBe('LOT-77')

    expect(loadItem(harness.ctx(), gloves.id).quantityOnHand).toBe(20)
    expect(loadItem(harness.ctx(), composite.id).quantityOnHand).toBe(10)
    const compositeBatches = batchesForItem(harness.ctx(), composite.id)
    expect(compositeBatches).toHaveLength(1)
    expect(compositeBatches[0]?.batchNo).toBe('LOT-77')
    expect(compositeBatches[0]?.quantity).toBe(10)

    /* Supplier roll-ups read from the purchases, not from a stale counter. */
    const withRollup = getSupplier(harness.ctx(), supplier.id)
    expect(withRollup.purchases).toBe(1)
    expect(withRollup.totalPurchasedMicro).toBe(purchase.totalMicro)
    expect(withRollup.dueMicro).toBe(purchase.dueMicro)
    expect(listSuppliers(harness.ctx(), { includeInactive: false }).map((entry) => entry.id)).toEqual([supplier.id])

    const settled = setPurchasePaid(harness.ctx(), { id: purchase.id, paidMicro: purchase.totalMicro, method: 'bank', note: 'Cleared' })
    expect(settled.status).toBe('paid')
    expect(settled.dueMicro).toBe(0)
    expect(getSupplier(harness.ctx(), supplier.id).dueMicro).toBe(0)

    const page = listPurchases(harness.ctx(), { limit: 50, offset: 0 })
    expect(page.totals).toEqual({ purchasedMicro: purchase.totalMicro, paidMicro: purchase.totalMicro, dueMicro: 0 })
  })

  it('refuses to edit a received purchase, to overpay it, or to receive expiry-tracked stock without a date', () => {
    const supplier = saveSupplier(harness.ctx(), supplierInput())
    const item = saveItem(harness.ctx(), itemInput({ expiryTracking: true, name: 'Articaine cartridge' }))

    expect(() =>
      savePurchase(harness.ctx(), {
        id: null,
        supplierId: supplier.id,
        invoiceRef: null,
        purchaseDate: TODAY,
        paidMicro: 0,
        paymentMethod: 'cash',
        notes: null,
        lines: [{ itemId: item.id, batchNo: 'LOT-1', expiryDate: null, quantity: 10, unitCostMicro: 100_000 }]
      } as never)
    ).toThrow(/needs an expiry date/i)

    const purchase = savePurchase(harness.ctx(), {
      id: null,
      supplierId: supplier.id,
      invoiceRef: null,
      purchaseDate: TODAY,
      paidMicro: 0,
      paymentMethod: 'cash',
      notes: null,
      lines: [{ itemId: item.id, batchNo: 'LOT-1', expiryDate: toLocalDate(Date.now() + 90 * DAY), quantity: 10, unitCostMicro: 100_000 }]
    } as never)

    expect(() => savePurchase(harness.ctx(), { ...purchase, lines: purchase.lines.map((line) => ({ ...line, quantity: 99 })) } as never)).toThrow(/cannot be edited/i)
    expect(() => setPurchasePaid(harness.ctx(), { id: purchase.id, paidMicro: purchase.totalMicro + 1, method: 'cash' })).toThrow(/cannot be more than the purchase total/i)

    /* Reusing the same batch number and expiry tops up the existing lot instead of duplicating it. */
    savePurchase(harness.ctx(), {
      id: null,
      supplierId: supplier.id,
      invoiceRef: null,
      purchaseDate: TODAY,
      paidMicro: 0,
      paymentMethod: 'cash',
      notes: null,
      lines: [{ itemId: item.id, batchNo: 'LOT-1', expiryDate: toLocalDate(Date.now() + 90 * DAY), quantity: 5, unitCostMicro: 100_000 }]
    } as never)
    const batches = batchesForItem(harness.ctx(), item.id)
    expect(batches).toHaveLength(1)
    expect(batches[0]?.quantity).toBe(15)
  })

  it('archiving a supplier keeps its purchases but detaches the items', () => {
    const supplier = saveSupplier(harness.ctx(), supplierInput())
    const item = saveItem(harness.ctx(), itemInput({ supplierId: supplier.id }))

    archiveSupplier(harness.ctx(), { id: supplier.id, reason: 'Switched to another distributor' })
    expect(() => getSupplier(harness.ctx(), supplier.id)).toThrow(/could not be found/i)
    expect(listSuppliers(harness.ctx(), { includeInactive: true })).toHaveLength(0)
    expect(loadItem(harness.ctx(), item.id).supplierId).toBeNull()
  })
})

describe('inventory permissions', () => {
  it('enforces stock and purchasing permissions in the service, not only in the UI', () => {
    const supplier = saveSupplier(harness.ctx(), supplierInput())
    const item = saveItem(harness.ctx(), itemInput())

    const viewer = harness.ctx(['inventory.view', 'suppliers.view'])
    expect(listItems(viewer, { includeInactive: false, sort: 'name', limit: 50, offset: 0 } as never).items).toHaveLength(1)
    expect(listSuppliers(viewer, { includeInactive: false })).toHaveLength(1)
    expect(() => recordMovement(viewer, { itemId: item.id, batchId: null, movementType: 'opening', quantity: 1, unitCostMicro: 0, reason: 'Nope', reference: null, supplierId: null, at: null } as never)).toThrow(/permission/i)
    expect(() => saveItem(viewer, itemInput({ name: 'Something else' }))).toThrow(/permission/i)
    expect(() => archiveItem(viewer, { id: item.id, reason: 'Nope' })).toThrow(/permission/i)
    expect(() => savePurchase(viewer, { id: null, supplierId: supplier.id, invoiceRef: null, purchaseDate: TODAY, paidMicro: 0, paymentMethod: 'cash', notes: null, lines: [{ itemId: item.id, batchNo: null, expiryDate: null, quantity: 1, unitCostMicro: 1 }] } as never)).toThrow(/permission/i)
    expect(() => saveSupplier(viewer, supplierInput({ name: 'Another supplier' }))).toThrow(/permission/i)

    /* The stock-take permission can adjust but not create items. */
    const adjuster = harness.ctx(PERMISSION_CODES.filter((code) => code !== 'inventory.create' && code !== 'inventory.delete'))
    expect(() => recordMovement(adjuster, { itemId: item.id, batchId: null, movementType: 'usage', quantity: 1, unitCostMicro: 0, reason: 'Used', reference: null, supplierId: null, at: null } as never)).toThrow(/only 0 in stock/i)
    expect(() => saveItem(adjuster, itemInput({ name: 'New item' }))).toThrow(/permission/i)
  })

  it('filters the ledger by item, type and date', () => {
    const item = saveItem(harness.ctx(), itemInput())
    const other = saveItem(harness.ctx(), itemInput({ name: 'Gauze roll' }))
    recordMovement(harness.ctx(), {
      itemId: other.id,
      batchId: null,
      movementType: 'opening',
      quantity: 5,
      unitCostMicro: 30_000,
      reason: 'Opening count',
      reference: null,
      supplierId: null,
      at: null
    } as never)
    recordMovement(harness.ctx(), {
      itemId: item.id,
      batchId: null,
      movementType: 'opening',
      quantity: 4,
      unitCostMicro: 100_000,
      reason: 'Opening count',
      reference: null,
      supplierId: null,
      at: fromLocalDate('2026-09-01') + 12 * 3_600_000
    } as never)
    recordMovement(harness.ctx(), {
      itemId: other.id,
      batchId: null,
      movementType: 'adjustment_out',
      quantity: 1,
      unitCostMicro: 0,
      reason: 'Damaged in storage',
      reference: null,
      supplierId: null,
      at: null
    } as never)

    const firstOfSeptember = listMovements(harness.ctx(), { range: { preset: 'custom', from: '2026-09-01', to: '2026-09-01' }, limit: 50, offset: 0 })
    expect(firstOfSeptember.items).toHaveLength(1)
    expect(firstOfSeptember.items[0]?.movementType).toBe('opening')
    expect(firstOfSeptember.total).toBe(1)

    /* Bounds are honoured in both directions: August has no movements, September to today has three. */
    expect(listMovements(harness.ctx(), { range: { preset: 'custom', from: '2026-08-01', to: '2026-08-31' }, limit: 50, offset: 0 }).total).toBe(0)
    expect(listMovements(harness.ctx(), { range: { preset: 'custom', from: '2026-09-01', to: toLocalDate(Date.now()) }, limit: 50, offset: 0 }).total).toBe(3)

    const byType = listMovements(harness.ctx(), { movementType: 'adjustment_out', limit: 50, offset: 0 })
    expect(byType.items.map((movement) => movement.itemName)).toEqual(['Gauze roll'])

    const bySearch = listMovements(harness.ctx(), { search: 'gauze', limit: 50, offset: 0 })
    expect(bySearch.items).toHaveLength(2)
    expect(bySearch.items.every((movement) => movement.itemName === 'Gauze roll')).toBe(true)
    expect(bySearch.items.reduce((sum, movement) => sum + movement.signedQuantity, 0)).toBe(4)

    /* Searching a reason reaches movements whose item name does not match. */
    const byReason = listMovements(harness.ctx(), { search: 'damaged', limit: 50, offset: 0 })
    expect(byReason.items.map((movement) => movement.movementType)).toEqual(['adjustment_out'])
  })
})
