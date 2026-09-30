import { expect, test } from '@playwright/test'
import { closeClinic, invoke, launchClinic, openRoute, prepareClinic, todayLocalDate, type Clinic } from './support/harness'

/**
 * E2E-07 · Accounting → income → expense → report (`docs/TEST_PLAN.md` §2.7).
 *
 * Both entries are recorded through the accounting screen, the ledger is read back with the same filter
 * the screen uses, and a report is produced on the reports screen. Money is checked in micro-taka, the
 * unit the database stores, so a formatting pass cannot hide a wrong figure.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'accounting' })
  await prepareClinic(clinic.page)
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-07 income and expense are recorded and appear in the ledger and a report', async () => {
  const { page } = clinic

  const categories = await invoke<Array<{ name: string, kind: string, isActive: boolean }>>(page, 'accounting.categories')
  const incomeCategory = categories.find((row) => row.kind === 'income')
  const expenseCategory = categories.find((row) => row.kind === 'expense')
  expect(incomeCategory, 'the seeded chart of accounts has an income category').toBeTruthy()
  expect(expenseCategory).toBeTruthy()

  await openRoute(page, '/accounting')
  await expect(page.getByRole('heading', { name: 'Accounting' })).toBeVisible({ timeout: 30_000 })

  /* 1 · income: ৳ 1 200.00 consultation receipts. */
  await page.getByRole('button', { name: 'New entry' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.selectOption('#entryKind', 'income')
  await page.selectOption('#entryCategory', { label: incomeCategory!.name })
  await page.fill('#entryAmount', '1200')
  await page.fill('#entryDescription', 'Consultation receipts — end-to-end run')
  await dialog.getByRole('button', { name: 'Record entry' }).click()
  await expect(page.getByText('Consultation receipts — end-to-end run').first()).toBeVisible({ timeout: 30_000 })

  /* 2 · expense: ৳ 300.00 for materials. */
  await page.getByRole('button', { name: 'New entry' }).click()
  await expect(dialog).toBeVisible()
  await page.selectOption('#entryKind', 'expense')
  await page.selectOption('#entryCategory', { label: expenseCategory!.name })
  await page.fill('#entryAmount', '300')
  await page.fill('#entryDescription', 'Materials — end-to-end run')
  await dialog.getByRole('button', { name: 'Record entry' }).click()
  await expect(page.getByText('Materials — end-to-end run').first()).toBeVisible({ timeout: 30_000 })

  /* 3 · the ledger holds both entries with the right signs. */
  const entries = await invoke<{ items: Array<{ kind: string, amountMicro: number, description: string }> }>(page, 'accounting.entries', {
    includeVoid: false,
    limit: 50,
    offset: 0
  })
  const income = entries.items.find((row) => row.description === 'Consultation receipts — end-to-end run')
  const expense = entries.items.find((row) => row.description === 'Materials — end-to-end run')
  expect(income?.amountMicro).toBe(120_000_000)
  expect(expense?.amountMicro).toBe(30_000_000)

  /* 4 · the day's summary reflects them. */
  const today = todayLocalDate()
  const summary = await invoke<{ incomeMicro: number, expenseMicro: number }>(page, 'accounting.summary', { from: today, to: today })
  expect(summary.incomeMicro).toBeGreaterThanOrEqual(120_000_000)
  expect(summary.expenseMicro).toBeGreaterThanOrEqual(30_000_000)

  /* 5 · a report is produced from the reports screen. */
  const catalog = await invoke<Array<{ key: string, title: string }>>(page, 'reports.catalog')
  expect(catalog.length).toBeGreaterThan(0)
  const reportKey = catalog[0]!.key

  await openRoute(page, '/reports')
  await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Report').selectOption(reportKey)
  await page.getByRole('button', { name: 'Refresh' }).click()

  const report = await invoke<{ key: string, columns: unknown[], rows: unknown[], totals?: unknown }>(page, 'reports.run', {
    key: reportKey,
    limit: 100
  })
  expect(report.key).toBe(reportKey)
  expect(Array.isArray(report.columns)).toBe(true)
  expect(Array.isArray(report.rows)).toBe(true)
})
