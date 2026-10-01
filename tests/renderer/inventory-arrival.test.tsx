import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InventoryScreen } from '../../src/renderer/src/features/inventory/InventoryScreen'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { createHarness, type TestHarness } from '../integration/helpers'
import { createRouterHarness, type RouterHarness } from '../integration/routerHarness'
import { mockFallbackChannel } from './setup'
import {
  ADMIN,
  E2E_ACTIVATION_CODE,
  ITEM,
  administratorStepPayload,
  clinicStepPayload,
  dentistStepPayload,
  inventoryItemPayload,
  stockMovementPayload
} from '../e2e/support/scenario'

/**
 * The stock room, against the real main process.
 *
 * The end-to-end workflow creates an item on the inventory screen, receives stock and corrects the count
 * through the movement dialog, then expects the clinic to be warned when the reorder level rises above
 * what is on the shelf. Those steps are driven here through the real screens and the production router, so
 * a failure is either a screen that no longer works or a rule that no longer holds — not a machine
 * difference that only shows up on the Windows runner.
 */

let harness: TestHarness
let router: RouterHarness

const passthrough = async (channel: string, payload: unknown): Promise<unknown> => {
  const envelope = await router.router.handle(7, channel, payload)
  if (!envelope.ok) {
    const error = new Error(`${envelope.error.message}`) as Error & { code?: string }
    error.code = envelope.error.code
    throw error
  }
  return envelope.data
}

beforeEach(async () => {
  process.env.DENTIVA_ACTIVATION_CODE = E2E_ACTIVATION_CODE
  harness = createHarness()
  router = createRouterHarness(harness)
  mockFallbackChannel(passthrough)
  useAppStore.setState({ session: null, clinic: null, stage: 'activation', locked: false, settings: {} })

  await router.call('activation.submit', { code: E2E_ACTIVATION_CODE })
  await router.call('setup.clinic', clinicStepPayload())
  await router.call('setup.dentists', dentistStepPayload())
  await router.call('setup.administrator', administratorStepPayload())
  await router.call('setup.complete', { confirmation: 'Tangail Dental Care' })
  await router.call('auth.login', { username: ADMIN.username, password: ADMIN.password })
  const bootstrap = await router.call<{ session: unknown, clinic: unknown }>('app.bootstrap', {})
  useAppStore.setState({ session: bootstrap.session as never, clinic: bootstrap.clinic as never, stage: 'ready' })
})

afterEach(() => {
  delete process.env.DENTIVA_ACTIVATION_CODE
  mockFallbackChannel(null)
  harness.cleanup()
})

function renderInventory(): void {
  render(
    <MemoryRouter initialEntries={['/inventory']}>
      <Routes>
        <Route path="/inventory" element={<InventoryScreen />} />
        <Route path="/inventory/:itemId" element={<div>item opened</div>} />
      </Routes>
      <ConfirmDialogHost />
      {/* The dialog reports a missing reason through the application's own toast host. */}
      <Toaster />
    </MemoryRouter>
  )
}

async function quantityOnHand(itemId: number): Promise<number> {
  const result = await router.call<{ item: { quantityOnHand: number } }>('inventory.get', { id: itemId })
  return result.item.quantityOnHand
}

describe('the inventory screen', () => {
  it('creates an item, records stock in and out, and warns until the item is restocked', async () => {
    const user = userEvent.setup()
    renderInventory()

    /* 1 · the item is created through the dialog, with a reorder level. */
    await user.click(await screen.findByRole('button', { name: 'New item' }))
    await user.type(document.querySelector('#itemName') as HTMLInputElement, ITEM.name)
    await user.type(document.querySelector('#itemUnit') as HTMLInputElement, ITEM.unit)
    await user.clear(document.querySelector('#itemReorder') as HTMLInputElement)
    await user.type(document.querySelector('#itemReorder') as HTMLInputElement, '10')
    await user.click(screen.getByRole('button', { name: 'Add item' }))

    await waitFor(() => expect(screen.getByText(ITEM.name)).toBeInTheDocument(), { timeout: 10_000 })
    const list = await router.call<{ items: Array<{ id: number, code: string }> }>('inventory.list', { search: ITEM.name, limit: 5, offset: 0 })
    const item = list.items[0]
    expect(item?.code).toMatch(/^ITM-/)
    const itemId = item!.id

    /* 2 · 30 received on the movement dialog. A reason is part of every movement, and the dialog says so
       instead of recording an unexplained change: the ledger is meant to be read years later. */
    await user.click(screen.getByRole('button', { name: 'Stock in/out' }))
    await waitFor(() => expect(screen.getByLabelText('Movement type')).toBeInTheDocument())
    await user.selectOptions(document.querySelector('#movementType') as HTMLSelectElement, 'purchase')
    /* A number field: set the value the way the control reports it, replacing the default of 1. */
    fireEvent.change(document.querySelector('#movementQuantity') as HTMLInputElement, { target: { value: '30' } })
    await user.click(screen.getByRole('button', { name: 'Add stock' }))
    await waitFor(() => expect(screen.getByText('A reason is required')).toBeInTheDocument(), { timeout: 5_000 })
    expect(await quantityOnHand(itemId)).toBe(0)

    await user.type(document.querySelector('#movementReason') as HTMLTextAreaElement, 'Purchase order received during the end-to-end run')
    await user.click(screen.getByRole('button', { name: 'Add stock' }))
    await waitFor(async () => expect(await quantityOnHand(itemId)).toBe(30), { timeout: 10_000 })

    /* 3 · the count is corrected down to 20 — out. */
    await user.click(await screen.findByRole('button', { name: 'Stock in/out' }))
    await waitFor(() => expect(screen.getByLabelText('Movement type')).toBeInTheDocument())
    await user.selectOptions(document.querySelector('#movementType') as HTMLSelectElement, 'adjustment_out')
    fireEvent.change(document.querySelector('#movementQuantity') as HTMLInputElement, { target: { value: '10' } })
    await user.type(document.querySelector('#movementReason') as HTMLTextAreaElement, 'Stock take correction')
    await user.click(screen.getByRole('button', { name: 'Take stock out' }))
    await waitFor(async () => expect(await quantityOnHand(itemId)).toBe(20), { timeout: 10_000 })

    /* Both movements are kept in the ledger rather than overwriting a quantity. */
    const movements = await router.call<{ items: Array<{ movementType: string, quantity: number }> }>('inventory.movements', { itemId, limit: 20, offset: 0 })
    expect(movements.items.some((row) => row.movementType === 'purchase' && row.quantity === 30)).toBe(true)
    expect(movements.items.some((row) => row.movementType === 'adjustment_out' && row.quantity === 10)).toBe(true)

    /* 4 · 20 on hand against a reorder level of 10: nothing to warn about. */
    const quiet = await router.call<{ items: Array<{ message: string }> }>('notifications.list', { filter: 'all', limit: 50, offset: 0 })
    expect(quiet.items.some((row) => row.message.includes(ITEM.name))).toBe(false)

    /* 5 · raising the reorder level above what is on the shelf warns the clinic. */
    await router.call('inventory.save', inventoryItemPayload({ id: itemId, name: ITEM.name, category: ITEM.category, unit: ITEM.unit, reorderLevel: 25 }))
    const summary = await router.call<{ unread: number }>('notifications.summary')
    expect(summary.unread).toBeGreaterThanOrEqual(1)
    const alerts = await router.call<{ items: Array<{ title: string, message: string, severity: string }> }>('notifications.list', { filter: 'all', limit: 50, offset: 0 })
    const lowStock = alerts.items.find((row) => row.title.includes(ITEM.name) || row.message.includes(ITEM.name))
    expect(lowStock, 'the low-stock alert names the item').toBeTruthy()
    expect(lowStock?.severity).toBe('warning')

    /* 6 · restocking retires the warning instead of leaving a stale one. */
    await router.call('inventory.movement.add', stockMovementPayload(itemId, 'purchase', 40, 'Purchase order received during the end-to-end run'))
    await router.call('notifications.summary')
    const after = await router.call<{ items: Array<{ message: string }> }>('notifications.list', { filter: 'all', limit: 50, offset: 0 })
    expect(after.items.some((row) => row.message.includes(ITEM.name))).toBe(false)
  })
})
