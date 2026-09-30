import { expect, test } from '@playwright/test'
import { closeClinic, invoke, launchClinic, openRoute, prepareClinic, type Clinic } from './support/harness'

/**
 * E2E-06 · Inventory → purchase → stock in → adjustment → low-stock notification
 * (`docs/TEST_PLAN.md` §2.6).
 *
 * The item is created on the inventory screen, stock is received and corrected through the stock dialog,
 * and the reorder level is then raised above the quantity on hand — the point at which the clinic must
 * be warned. The alert is checked through the notification channel and on the notification screen.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic
const ITEM = { name: 'Glass ionomer cement', unit: 'box' }

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'inventory' })
  await prepareClinic(clinic.page)
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-06 stock is received, corrected, and a low-stock alert is raised and retired', async () => {
  const { page } = clinic

  /* 1 · create the item on the inventory screen. */
  await openRoute(page, '/inventory')
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'New item' }).click()
  const itemDialog = page.getByRole('dialog')
  await expect(itemDialog).toBeVisible()
  await page.fill('#itemName', ITEM.name)
  await page.fill('#itemUnit', ITEM.unit)
  await page.fill('#itemReorder', '10')
  await itemDialog.getByRole('button', { name: 'Add item' }).click()
  await expect(page.getByText(ITEM.name).first()).toBeVisible({ timeout: 30_000 })

  const list = await invoke<{ items: Array<{ id: number, code: string }> }>(page, 'inventory.list', {
    search: ITEM.name,
    limit: 5,
    offset: 0
  })
  const item = list.items[0]
  expect(item?.code).toMatch(/^ITM-/)
  const itemId = item!.id

  /* 2 · receive 30 boxes — a purchase, recorded through the stock dialog on the row. */
  await page.getByRole('button', { name: 'Stock in/out' }).first().click()
  const movementDialog = page.getByRole('dialog')
  await expect(movementDialog).toBeVisible()
  await page.selectOption('#movementType', 'purchase')
  await page.fill('#movementQuantity', '30')
  await movementDialog.getByRole('button', { name: 'Add stock' }).click()

  await expect
    .poll(async () => (await invoke<{ item: { quantityOnHand: number } }>(page, 'inventory.get', { id: itemId })).item.quantityOnHand)
    .toBe(30)

  /* 3 · correct the count down to 20: a stock-take correction, out. */
  await page.getByRole('button', { name: 'Stock in/out' }).first().click()
  await expect(movementDialog).toBeVisible()
  await page.selectOption('#movementType', 'adjustment_out')
  await page.fill('#movementQuantity', '10')
  await movementDialog.getByRole('button', { name: 'Take stock out' }).click()

  await expect
    .poll(async () => (await invoke<{ item: { quantityOnHand: number } }>(page, 'inventory.get', { id: itemId })).item.quantityOnHand)
    .toBe(20)

  /* 4 · the ledger kept both movements instead of overwriting a quantity. */
  const movements = await invoke<{ items: Array<{ movementType: string, quantity: number }> }>(page, 'inventory.movements', {
    itemId,
    limit: 20,
    offset: 0
  })
  expect(movements.items.some((row) => row.movementType === 'purchase' && row.quantity === 30)).toBe(true)
  expect(movements.items.some((row) => row.movementType === 'adjustment_out' && row.quantity === 10)).toBe(true)

  /* 5 · nothing is being warned about yet: 20 in stock against a reorder level of 10. */
  const before = await invoke<{ items: Array<{ message: string }> }>(page, 'notifications.list', {
    filter: 'all',
    limit: 50,
    offset: 0
  })
  expect(before.items.some((row) => row.message.includes(ITEM.name))).toBe(false)

  /* 6 · raise the reorder level to 25 — the clinic must now be warned. */
  await invoke(page, 'inventory.save', {
    id: itemId,
    name: ITEM.name,
    category: 'restorative',
    unit: ITEM.unit,
    supplierId: null,
    purchasePriceMicro: 250_000,
    sellingPriceMicro: 400_000,
    reorderLevel: 25,
    expiryTracking: false,
    location: null,
    notes: null,
    isActive: true
  })

  const summary = await invoke<{ unread: number }>(page, 'notifications.summary')
  expect(summary.unread).toBeGreaterThanOrEqual(1)

  const alerts = await invoke<{ items: Array<{ title: string, message: string, severity: string }> }>(page, 'notifications.list', {
    filter: 'all',
    limit: 50,
    offset: 0
  })
  const lowStock = alerts.items.find((row) => row.title.includes(ITEM.name) || row.message.includes(ITEM.name))
  expect(lowStock, 'the low-stock alert names the item').toBeTruthy()
  expect(lowStock?.severity).toBe('warning')

  /* 7 · the notifications screen lists it for the operator. */
  await openRoute(page, '/notifications')
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(ITEM.name).first()).toBeVisible()

  /* 8 · restocking above the reorder level retires the alert rather than leaving a stale warning. */
  await invoke(page, 'inventory.movement.add', {
    itemId,
    movementType: 'purchase',
    quantity: 40,
    unitCostMicro: 250_000,
    reason: 'Purchase order received during the end-to-end run'
  })
  await invoke(page, 'notifications.summary')
  const after = await invoke<{ items: Array<{ message: string }> }>(page, 'notifications.list', {
    filter: 'all',
    limit: 50,
    offset: 0
  })
  expect(after.items.some((row) => row.message.includes(ITEM.name))).toBe(false)
})
