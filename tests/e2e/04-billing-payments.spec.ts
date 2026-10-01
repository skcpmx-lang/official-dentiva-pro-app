import { expect, test } from '@playwright/test'
import {
  closeClinic,
  invoke,
  launchClinic,
  openRoute,
  prepareClinic,
  seedInvoice,
  seedPatient,
  type Clinic
} from './support/harness'
import { taka } from './support/scenario'

/**
 * E2E-04 · Patient → invoice → partial payment → due → second payment → fully paid
 * (`docs/TEST_PLAN.md` §2.4).
 *
 * The invoice is raised from a treatment line and both payments are taken through the payment dialog on
 * the invoice screen — the screen an operator actually uses at the desk. After each payment the status,
 * the paid total and the outstanding balance are read from the screen and from the database, so a UI
 * that merely looks right cannot pass.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic
let invoiceId: number
let patientId: number

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'billing' })
  const { page } = clinic
  await prepareClinic(page)

  const patient = await seedPatient(page, { fullName: 'Mehedi Hasan' })
  patientId = patient.id
  const invoice = await seedInvoice(page, patientId, taka(900))
  invoiceId = invoice.id
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-04 a partial payment leaves the correct due and the second payment settles it', async () => {
  const { page } = clinic
  await openRoute(page, `/invoices/${invoiceId}`)
  await expect(page.getByText('৳ 900.00').first()).toBeVisible({ timeout: 30_000 })

  /* 1 · take ৳ 400.00 of the ৳ 900.00. */
  await page.getByRole('button', { name: 'Take payment' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.fill('#paymentAmount', '400')
  await dialog.getByRole('button', { name: 'Record payment' }).click()

  /* 2 · the invoice reports ৳ 500.00 outstanding and a partial status. */
  await expect(page.getByText('৳ 500.00').first()).toBeVisible({ timeout: 30_000 })
  const afterFirst = await invoke<{ status: string, dueMicro: number, paidMicro: number }>(page, 'invoices.get', { id: invoiceId })
  expect(afterFirst.paidMicro).toBe(taka(400))
  expect(afterFirst.dueMicro).toBe(taka(500))
  expect(afterFirst.status).toBe('partial')

  /* 3 · pay the remainder. */
  await page.getByRole('button', { name: 'Take payment' }).first().click()
  await expect(dialog).toBeVisible()
  await page.fill('#paymentAmount', '500')
  await dialog.getByRole('button', { name: 'Record payment' }).click()

  /* 4 · the invoice is settled: no due, paid status, and the money is on the patient's record. */
  await expect(page.getByText('৳ 0.00').first()).toBeVisible({ timeout: 30_000 })
  const afterSecond = await invoke<{ status: string, dueMicro: number, paidMicro: number }>(page, 'invoices.get', { id: invoiceId })
  expect(afterSecond.dueMicro).toBe(0)
  expect(afterSecond.paidMicro).toBe(taka(900))
  expect(afterSecond.status).toBe('paid')

  const payments = await invoke<{ items: Array<{ amountMicro: number }> }>(page, 'payments.list', {
    patientId,
    limit: 20,
    offset: 0
  })
  expect(payments.items.map((row) => row.amountMicro).sort((left, right) => left - right)).toEqual([taka(400), taka(500)])

  /* 5 · overpayment is refused: the screen must not accept more than the outstanding balance. */
  await page.getByRole('button', { name: 'Take payment' }).first().click()
  await expect(dialog).toBeVisible()
  await page.fill('#paymentAmount', '100')
  await dialog.getByRole('button', { name: 'Record payment' }).click()
  await expect(page.getByText(/more than the outstanding balance|above the amount due/i).first()).toBeVisible({ timeout: 30_000 })
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  const unchanged = await invoke<{ paidMicro: number }>(page, 'invoices.get', { id: invoiceId })
  expect(unchanged.paidMicro).toBe(taka(900))
})
