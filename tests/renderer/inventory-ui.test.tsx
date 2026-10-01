import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InventoryScreen } from '../../src/renderer/src/features/inventory/InventoryScreen'
import { InventoryItemScreen } from '../../src/renderer/src/features/inventory/InventoryItemScreen'
import { SuppliersScreen } from '../../src/renderer/src/features/inventory/SuppliersScreen'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { InventoryItem, Purchase, SessionSummary, StockMovement, Supplier } from '../../src/renderer/src/lib/types'

/**
 * Inventory screens.
 *
 * These tests act like the person running the stock room: filter to what needs reordering, record a
 * movement with a reason, reverse a mistake, receive a delivery and log what is owed to the supplier.
 * Assertions are on the channel payloads, so a control that no longer changes data fails here (§90).
 */

const FULL = ['inventory.view', 'inventory.create', 'inventory.edit', 'inventory.adjust', 'inventory.delete', 'suppliers.view', 'suppliers.manage']

function signIn(permissions: string[] = FULL): void {
  const session: SessionSummary = {
    id: 'session-stock',
    userId: 1,
    username: 'storekeeper',
    fullName: 'Store Keeper',
    roleCode: 'assistant',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

const AT = Date.UTC(2026, 10, 2, 9, 0, 0)

function itemFixture(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 5,
    code: 'ITM-2611-0001',
    name: 'Composite resin A2',
    category: 'restorative',
    unit: 'syringe',
    supplierId: 3,
    supplierName: 'Dhaka Dental Supplies',
    purchasePriceMicro: 120_000,
    sellingPriceMicro: 0,
    reorderLevel: 5,
    expiryTracking: false,
    location: 'Cabinet A',
    notes: null,
    isActive: true,
    quantityOnHand: 3,
    stockValueMicro: 360_000,
    isLowStock: true,
    nearestExpiry: null,
    expiredBatches: 0,
    createdAt: AT,
    updatedAt: AT,
    ...overrides
  }
}

function supplierFixture(overrides: Partial<Supplier> = {}): Supplier {
  return {
    id: 3,
    name: 'Dhaka Dental Supplies',
    contactPerson: 'Mr Karim',
    phone: '01711000000',
    altPhone: null,
    email: null,
    address: 'Mirpur, Dhaka',
    notes: null,
    isActive: true,
    purchases: 1,
    totalPurchasedMicro: 5_000_000,
    dueMicro: 2_000_000,
    createdAt: AT,
    updatedAt: AT,
    ...overrides
  }
}

function movementFixture(overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: 41,
    itemId: 5,
    itemCode: 'ITM-2611-0001',
    itemName: 'Composite resin A2',
    unit: 'syringe',
    batchId: null,
    batchNo: null,
    movementType: 'opening',
    quantity: 10,
    signedQuantity: 10,
    unitCostMicro: 120_000,
    valueMicro: 1_200_000,
    reason: 'Opening stock at go-live',
    reference: null,
    supplierName: null,
    byUserName: 'Store Keeper',
    at: AT,
    movementDate: '2026-11-02',
    createdAt: AT,
    ...overrides
  }
}

function purchaseFixture(overrides: Partial<Purchase> = {}): Purchase {
  return {
    id: 9,
    purchaseNo: 'PO-2611-0001',
    supplierId: 3,
    supplierName: 'Dhaka Dental Supplies',
    invoiceRef: 'SUP-2291',
    purchaseDate: '2026-11-02',
    totalMicro: 5_000_000,
    paidMicro: 3_000_000,
    dueMicro: 2_000_000,
    status: 'partial',
    notes: null,
    createdByName: 'Store Keeper',
    createdAt: AT,
    updatedAt: AT,
    lines: [
      { id: 1, itemId: 5, itemCode: 'ITM-2611-0001', itemName: 'Composite resin A2', unit: 'syringe', batchNo: null, expiryDate: null, quantity: 20, unitCostMicro: 250_000, lineTotalMicro: 5_000_000, batchId: null, notes: null }
    ],
    ...overrides
  }
}

function renderList(): void {
  render(
    <MemoryRouter initialEntries={['/inventory']}>
      <Routes>
        <Route path="/inventory" element={<InventoryScreen />} />
      </Routes>
      <Toaster />
    </MemoryRouter>
  )
}

function renderItem(): void {
  render(
    <MemoryRouter initialEntries={['/inventory/5']}>
      <Routes>
        <Route path="/inventory/:itemId" element={<InventoryItemScreen />} />
      </Routes>
      <Toaster />
    </MemoryRouter>
  )
}

function renderSuppliers(): void {
  render(
    <MemoryRouter initialEntries={['/inventory/suppliers']}>
      <Routes>
        <Route path="/inventory/suppliers" element={<SuppliersScreen />} />
      </Routes>
      <ConfirmDialogHost />
      <Toaster />
    </MemoryRouter>
  )
}

describe('inventory list', () => {
  it('shows the stock position, marks what needs reordering and filters to low stock', async () => {
    signIn()
    mockChannels({
      'suppliers.list': () => [supplierFixture()],
      'inventory.list': (payload) => ({
        items: [itemFixture()],
        total: 1,
        limit: 100,
        offset: 0,
        totals: { stockValueMicro: 360_000, lowStock: payload.lowStock ? 1 : 12, expiringSoon: 2, expired: 1 },
        categories: [{ category: 'restorative', count: 1 }]
      })
    })

    renderList()

    expect(await screen.findByText('Composite resin A2')).toBeInTheDocument()
    expect(screen.getByText('Reorder at 5')).toBeInTheDocument()
    /* ৳ 36.00 of stock on the shelf, 12 items needing reorder, 2 batches expiring, 1 already expired. */
    expect(screen.getAllByText('৳ 36.00').length).toBeGreaterThan(0)
    expect(screen.getByText('12')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Below reorder level' }))
    await waitFor(() => {
      const filter = callLog.filter((entry) => entry.channel === 'inventory.list').at(-1)?.payload as { lowStock?: boolean }
      expect(filter.lowStock).toBe(true)
    })
  })

  it('records a stock movement with its reason and refuses one without', async () => {
    signIn()
    mockChannels({
      'suppliers.list': () => [supplierFixture()],
      'inventory.list': () => ({
        items: [itemFixture()],
        total: 1,
        limit: 100,
        offset: 0,
        totals: { stockValueMicro: 360_000, lowStock: 1, expiringSoon: 0, expired: 0 },
        categories: []
      }),
      'inventory.batches': () => [],
      'inventory.movement.add': (payload) => {
        expect(payload).toMatchObject({ itemId: 5, movementType: 'usage', quantity: 2, reason: 'Used for two fillings' })
        return { item: itemFixture({ quantityOnHand: 1, isLowStock: true }), batches: [], movements: [], recentUsage: [] }
      }
    })

    renderList()
    fireEvent.click(await screen.findByRole('button', { name: /Stock in\/out/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Take stock out' }))
    expect(callLog.some((call) => call.channel === 'inventory.movement.add')).toBe(false)

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Used for two fillings' } })
    fireEvent.change(screen.getByLabelText(/Quantity/), { target: { value: '2' } })
    fireEvent.blur(screen.getByLabelText(/Quantity/))
    fireEvent.click(screen.getByRole('button', { name: 'Take stock out' }))

    await waitFor(() => {
      const entry = callLog.find((call) => call.channel === 'inventory.movement.add')
      expect(entry?.payload).toMatchObject({ itemId: 5, quantity: 2, reason: 'Used for two fillings' })
    })
  })

  it('hides every stock-changing control from a read-only role', async () => {
    signIn(['inventory.view', 'suppliers.view'])
    mockChannels({
      'suppliers.list': () => [supplierFixture()],
      'inventory.list': () => ({
        items: [itemFixture()],
        total: 1,
        limit: 100,
        offset: 0,
        totals: { stockValueMicro: 360_000, lowStock: 1, expiringSoon: 0, expired: 0 },
        categories: []
      })
    })

    renderList()
    expect(await screen.findByText('Composite resin A2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /New item/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Stock in\/out/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit$/ })).not.toBeInTheDocument()
  })
})

describe('inventory item', () => {
  it('shows the ledger and reverses a wrong movement with a reason', async () => {
    signIn()
    mockChannels({
      'inventory.get': () => ({
        item: itemFixture(),
        batches: [],
        movements: [movementFixture({ id: 42, movementType: 'damaged', quantity: 2, signedQuantity: -2, reason: 'Dropped on the floor' }), movementFixture()],
        recentUsage: []
      }),
      'inventory.movement.reverse': (payload) => {
        expect(payload).toMatchObject({ id: 42, reason: 'The syringe was actually used' })
        return { item: itemFixture({ quantityOnHand: 5 }), batches: [], movements: [movementFixture()], recentUsage: [] }
      }
    })

    renderItem()

    expect(await screen.findByText('Damaged write-off')).toBeInTheDocument()
    expect(screen.getByText('Opening stock')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Reverse/ })[0]!)

    const confirm = screen.getByRole('button', { name: 'Reverse movement' })
    fireEvent.click(confirm)
    expect(callLog.some((call) => call.channel === 'inventory.movement.reverse')).toBe(false)

    fireEvent.change(screen.getByLabelText(/Why is this movement/), { target: { value: 'The syringe was actually used' } })
    fireEvent.click(confirm)

    await waitFor(() => {
      const entry = callLog.find((call) => call.channel === 'inventory.movement.reverse')
      expect(entry?.payload).toMatchObject({ id: 42, reason: 'The syringe was actually used' })
    })
  })
})

describe('suppliers and purchases', () => {
  it('lists what is owed and receives a delivery into stock', async () => {
    signIn()
    let saved = false
    mockChannels({
      'suppliers.list': () => [supplierFixture()],
      'purchases.list': () => ({
        items: [purchaseFixture()],
        total: 1,
        limit: 100,
        offset: 0,
        totals: { purchasedMicro: 5_000_000, paidMicro: 3_000_000, dueMicro: 2_000_000 }
      }),
      'inventory.list': () => ({
        items: [itemFixture()],
        total: 1,
        limit: 200,
        offset: 0,
        totals: { stockValueMicro: 360_000, lowStock: 1, expiringSoon: 0, expired: 0 },
        categories: []
      }),
      'purchases.save': (payload) => {
        saved = true
        expect(payload.lines).toEqual([{ itemId: 5, batchNo: null, expiryDate: null, quantity: 20, unitCostMicro: 250_000 }])
        expect(payload.supplierId).toBe(3)
        expect(payload.invoiceRef).toBe('SUP-2291')
        expect(payload.paidMicro).toBe(1_000_000)
        return purchaseFixture({ totalMicro: 5_000_000, paidMicro: 1_000_000, dueMicro: 4_000_000 }) as never
      }
    })

    renderSuppliers()

    expect((await screen.findAllByText('Dhaka Dental Supplies')).length).toBeGreaterThan(0)
    expect(screen.getByText('PO-2611-0001')).toBeInTheDocument()
    /* ৳ 200.00 owed to the supplier for the part-paid delivery. */
    expect(screen.getAllByText('৳ 200.00').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /Receive stock/ }))
    fireEvent.change(await screen.findByLabelText('Purchase supplier'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText(/Supplier invoice/), { target: { value: 'SUP-2291' } })
    fireEvent.change(screen.getByLabelText(/Line 1 item/), { target: { value: '5' } })
    /* Choosing an item prefills the last recorded cost. */
    await waitFor(() => expect((screen.getByLabelText(/Line 1 unit cost/) as HTMLInputElement).value).toBe('12'))
    fireEvent.change(screen.getByLabelText(/Line 1 unit cost/), { target: { value: '25.00' } })
    fireEvent.blur(screen.getByLabelText(/Line 1 unit cost/))
    fireEvent.change(screen.getByLabelText(/Line 1 quantity/), { target: { value: '20' } })
    fireEvent.blur(screen.getByLabelText(/Line 1 quantity/))
    fireEvent.change(screen.getByLabelText(/Paid now/), { target: { value: '100.00' } })
    fireEvent.blur(screen.getByLabelText(/Paid now/))

    fireEvent.click(screen.getByRole('button', { name: /^Receive ৳/ }))
    await waitFor(() => expect(saved).toBe(true))
  })
})
