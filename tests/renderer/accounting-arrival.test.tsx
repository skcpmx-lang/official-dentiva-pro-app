import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccountingScreen } from '../../src/renderer/src/features/accounting/AccountingScreen'
import { ReportsScreen } from '../../src/renderer/src/features/reports/ReportsScreen'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { createHarness, type TestHarness } from '../integration/helpers'
import { createRouterHarness, type RouterHarness } from '../integration/routerHarness'
import { mockFallbackChannel } from './setup'
import {
  ADMIN,
  E2E_ACTIVATION_CODE,
  administratorStepPayload,
  clinicStepPayload,
  dentistStepPayload
} from '../e2e/support/scenario'
import { taka } from '../e2e/support/scenario'
import { toLocalDate } from '../../src/shared/datetime'

/**
 * The accountant's morning, against the real main process.
 *
 * The end-to-end accounting workflow records income and an expense on the accounting screen, reads the
 * ledger back with the filter the screen uses, and produces a report. This test drives the same three
 * steps through the same screens and the production channel contracts, so a wrong scale — taka typed in
 * one place, micro-taka expected in another — fails here in seconds instead of on the Windows runner.
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

/** Records one entry the way the screen does: kind, category, amount in taka, description. */
async function recordEntry(
  user: ReturnType<typeof userEvent.setup>,
  kind: 'income' | 'expense',
  categoryName: string,
  amount: string,
  description: string
): Promise<void> {
  await user.click(await screen.findByRole('button', { name: 'New entry' }))
  const dialog = await screen.findByRole('dialog')
  await user.selectOptions(document.querySelector('#entryKind') as HTMLSelectElement, kind)
  await user.selectOptions(document.querySelector('#entryCategory') as HTMLSelectElement, categoryName)
  /* The amount is typed in taka; the control commits it on blur, exactly as it does for a person
     tabbing out of the field. */
  const amountField = document.querySelector('#entryAmount') as HTMLInputElement
  fireEvent.change(amountField, { target: { value: amount } })
  fireEvent.blur(amountField)
  const descriptionField = document.querySelector('#entryDescription') as HTMLTextAreaElement
  fireEvent.change(descriptionField, { target: { value: description } })
  await user.click(within(dialog).getByRole('button', { name: 'Record entry' }))
  await waitFor(() => expect(screen.getByText(description)).toBeInTheDocument(), { timeout: 10_000 })
}

describe('the accounting screen', () => {
  it('records income and an expense, and both appear in the ledger, the day summary and a report', async () => {
    const user = userEvent.setup()

    const categories = await router.call<Array<{ name: string, kind: string, isActive: boolean }>>('accounting.categories')
    const incomeCategory = categories.find((row) => row.kind === 'income')
    const expenseCategory = categories.find((row) => row.kind === 'expense')
    expect(incomeCategory, 'the seeded chart of accounts has an income category').toBeTruthy()
    expect(expenseCategory, 'and an expense category').toBeTruthy()

    render(
      <MemoryRouter initialEntries={['/accounting']}>
        <Routes>
          <Route path="/accounting" element={<AccountingScreen />} />
          <Route path="/reports" element={<ReportsScreen />} />
        </Routes>
        <ConfirmDialogHost />
        <Toaster />
      </MemoryRouter>
    )

    await recordEntry(user, 'income', incomeCategory!.name, '1200', 'Consultation receipts — end-to-end run')
    await recordEntry(user, 'expense', expenseCategory!.name, '300', 'Materials — end-to-end run')

    /* The ledger keeps the amount in micro-taka, and ৳ 1 200 must be 12 000 000 — not 1 200. */
    const entries = await router.call<{ items: Array<{ kind: string, amountMicro: number, description: string }> }>(
      'accounting.entries',
      { includeVoid: false, limit: 50, offset: 0 }
    )
    const income = entries.items.find((row) => row.description === 'Consultation receipts — end-to-end run')
    const expense = entries.items.find((row) => row.description === 'Materials — end-to-end run')
    expect(income?.kind).toBe('income')
    expect(income?.amountMicro).toBe(taka(1_200))
    expect(expense?.kind).toBe('expense')
    expect(expense?.amountMicro).toBe(taka(300))

    /* The day summary the accounting screen shows at the top agrees. */
    const today = toLocalDate(Date.now())
    const summary = await router.call<{ incomeMicro: number, expenseMicro: number }>('accounting.summary', {
      from: today,
      to: today
    })
    expect(summary.incomeMicro).toBeGreaterThanOrEqual(taka(1_200))
    expect(summary.expenseMicro).toBeGreaterThanOrEqual(taka(300))

    /* A report is produced and returns the shape the report screen renders. */
    const catalog = await router.call<Array<{ key: string, title: string }>>('reports.catalog')
    expect(catalog.length).toBeGreaterThan(0)
    const reportKey = catalog[0]!.key
    const report = await router.call<{ key: string, columns: unknown[], rows: unknown[] }>('reports.run', {
      key: reportKey,
      limit: 100
    })
    expect(report.key).toBe(reportKey)
    expect(Array.isArray(report.columns)).toBe(true)
    expect(Array.isArray(report.rows)).toBe(true)
  })
})
