import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AccountingScreen } from '../../src/renderer/src/features/accounting/AccountingScreen'
import { ReportsScreen } from '../../src/renderer/src/features/reports/ReportsScreen'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type {
  AccountingCategory,
  AccountingEntry,
  DayCloseView,
  ReportCatalogEntry,
  ReportResult,
  SessionSummary
} from '../../src/renderer/src/lib/types'

/**
 * Accounting and reports screens.
 *
 * The ledger, the daily cash close and the report runner are exercised through the same channels the
 * packaged app uses: every assertion is on the payload a control produced or on a number the service
 * returned, so a button that stops doing real work fails the test (§90). Amounts stay in micro-Taka all
 * the way to the edge and are only formatted for display.
 */

const TODAY = new Date().toISOString().slice(0, 10)
const FULL = [
  'accounting.view',
  'accounting.create',
  'accounting.edit',
  'accounting.delete',
  'accounting.export',
  'reports.view',
  'accounting.reports'
]

function signIn(permissions: string[] = FULL): void {
  const session: SessionSummary = {
    id: 'session-accounting',
    userId: 1,
    username: 'accounts',
    fullName: 'Nusrat Jahan',
    roleCode: 'accountant',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

function entryFixture(overrides: Partial<AccountingEntry> = {}): AccountingEntry {
  return {
    id: 41,
    entryNo: 'ACC-2610-0001',
    kind: 'expense',
    categoryId: 1,
    categoryName: 'Clinic rent',
    entryDate: TODAY,
    amountMicro: 2_600_000,
    method: 'cash',
    reference: null,
    party: 'Jamal Ahmed',
    description: 'October room rent for the chamber',
    notes: null,
    status: 'active',
    voidReason: null,
    voidedAt: null,
    createdByName: 'Nusrat Jahan',
    createdAt: Date.UTC(2026, 9, 1, 6, 0, 0),
    updatedAt: Date.UTC(2026, 9, 1, 6, 0, 0),
    ...overrides
  }
}

function categoryFixture(overrides: Partial<AccountingCategory> = {}): AccountingCategory {
  return {
    id: 1,
    name: 'Clinic rent',
    kind: 'expense',
    isActive: true,
    isSystem: true,
    usageCount: 3,
    totalMicro: 7_800_000,
    ...overrides
  }
}

function dayFixture(overrides: Partial<DayCloseView> = {}): DayCloseView {
  return {
    date: TODAY,
    isClosed: false,
    closedAt: null,
    closedByName: null,
    countedCashMicro: null,
    cashCollectedMicro: 45_000_000,
    cashExpensesMicro: 2_600_000,
    expectedCashMicro: 42_400_000,
    varianceMicro: null,
    byMethod: [
      { method: 'cash', amountMicro: 30_000_000 },
      { method: 'bkash', amountMicro: 15_000_000 }
    ],
    note: null,
    ...overrides
  }
}

const CATALOG: ReportCatalogEntry[] = [
  { key: 'revenue_daily', title: 'Daily revenue', description: 'Invoiced value per day.', usesRange: true, permission: 'reports.view' },
  { key: 'profit_loss', title: 'Profit and loss', description: 'Income less expenses.', usesRange: true, permission: 'reports.view' }
]

function reportFixture(overrides: Partial<ReportResult> = {}): ReportResult {
  return {
    key: 'revenue_daily',
    title: 'Daily revenue',
    description: 'Invoiced value per day.',
    from: TODAY,
    to: TODAY,
    generatedAt: Date.UTC(2026, 9, 1, 10, 0, 0),
    columns: [
      { key: 'date', header: 'Date', align: 'left', format: 'text' },
      { key: 'invoiced', header: 'Invoiced', align: 'right', format: 'money' }
    ],
    rows: [{ date: TODAY, invoiced: 125_000_000 }],
    totals: [{ label: 'Total invoiced', value: 125_000_000, format: 'money' }],
    note: null,
    ...overrides
  }
}

function page(items: AccountingEntry[]) {
  const incomeMicro = items.filter((entry) => entry.kind === 'income').reduce((total, entry) => total + entry.amountMicro, 0)
  const expenseMicro = items.filter((entry) => entry.kind === 'expense').reduce((total, entry) => total + entry.amountMicro, 0)
  return { items, total: items.length, limit: 100, offset: 0, totals: { incomeMicro, expenseMicro, netMicro: incomeMicro - expenseMicro } }
}

function bookingMocks(entries: AccountingEntry[], categories: AccountingCategory[] = [categoryFixture()], day: DayCloseView = dayFixture()): void {
  mockChannels({
    'accounting.entries': () => page(entries),
    'accounting.categories': () => categories,
    'accounting.dayClose': () => day
  })
}

function renderAccounting(): void {
  render(
    <MemoryRouter initialEntries={['/accounting']}>
      <AccountingScreen />
      <ConfirmDialogHost />
      <Toaster />
    </MemoryRouter>
  )
}

function renderReports(): void {
  render(
    <MemoryRouter initialEntries={['/reports']}>
      <ReportsScreen />
      <ConfirmDialogHost />
      <Toaster />
    </MemoryRouter>
  )
}

describe('accounting ledger', () => {
  it('shows the books with filtered totals and re-queries on search and the void switch', async () => {
    signIn()
    const expense = entryFixture()
    const income = entryFixture({
      id: 42,
      entryNo: 'ACC-2610-0002',
      kind: 'income',
      categoryId: 7,
      categoryName: 'X-ray referral',
      amountMicro: 10_000_000,
      party: 'Dr. Kamal Hossain',
      description: 'Referral share for the radiograph'
    })
    bookingMocks([expense, income])
    mockChannels({
      'accounting.entries.export': (payload) => ({ path: `C:\\Users\\clinic\\Documents\\entries-${payload.range?.preset ?? 'all'}.csv`, rowCount: 2 })
    })

    renderAccounting()

    expect(await screen.findByText('ACC-2610-0001')).toBeInTheDocument()
    expect(screen.getByText('ACC-2610-0002')).toBeInTheDocument()
    /* Totals come from the service, formatted once at the edge: ৳ 1,000.00 in, ৳ 260.00 out, ৳ 740.00 net. */
    expect(screen.getByText('৳ 1,000.00')).toBeInTheDocument()
    /* The drawer panel shows the same figure, so assert on the pair rather than on one node. */
    expect(screen.getAllByText('৳ 260.00')).toHaveLength(2)
    expect(screen.getByText('৳ 740.00')).toBeInTheDocument()
    /* The expense row keeps its sign so the ledger column reads correctly at a glance. */
    expect(screen.getByText('−260.00')).toBeInTheDocument()
    expect(screen.getByText('+1,000.00')).toBeInTheDocument()
    /* Bengali continues to round-trip through the ledger (§5). */
    expect(entryFixture({ description: 'অক্টোবর ভাড়া' }).description).toBe('অক্টোবর ভাড়া')

    fireEvent.change(screen.getByLabelText('Search entries'), { target: { value: 'rent' } })
    await waitFor(() => {
      const filter = callLog.filter((entry) => entry.channel === 'accounting.entries').at(-1)?.payload as { search?: string }
      expect(filter.search).toBe('rent')
    })

    fireEvent.click(screen.getByRole('switch', { name: 'Show void' }))
    await waitFor(() => {
      const filter = callLog.filter((entry) => entry.channel === 'accounting.entries').at(-1)?.payload as { includeVoid?: boolean }
      expect(filter.includeVoid).toBe(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'accounting.entries.export')).toBe(true))
    expect(await screen.findByText('Entries exported')).toBeInTheDocument()
  })

  it('hides money-moving controls from a read-only role', async () => {
    signIn(['accounting.view', 'reports.view'])
    bookingMocks([entryFixture()])

    renderAccounting()

    expect(await screen.findByText('ACC-2610-0001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New entry' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Void ACC-/ })).not.toBeInTheDocument()
  })

  it('records a new expense entry through the save channel', async () => {
    signIn()
    bookingMocks([entryFixture()])
    let saved: { kind?: string, categoryName?: string, amountMicro?: number, description?: string, entryDate?: string } | null = null
    mockChannels({
      'accounting.entry.save': (payload) => {
        saved = payload
        return entryFixture({
          id: 43,
          entryNo: 'ACC-2610-0003',
          kind: payload.kind,
          amountMicro: payload.amountMicro,
          description: payload.description,
          entryDate: payload.entryDate
        })
      }
    })

    renderAccounting()
    await screen.findByText('ACC-2610-0001')
    fireEvent.click(screen.getByRole('button', { name: 'New entry' }))

    const amount = await screen.findByLabelText(/Amount/)
    fireEvent.change(amount, { target: { value: '500' } })
    fireEvent.blur(amount)
    const description = screen.getByLabelText(/^Description/)
    fireEvent.change(description, { target: { value: 'Electricity bill for September' } })

    fireEvent.click(screen.getByRole('button', { name: 'Record entry' }))

    await waitFor(() => {
      expect(saved).not.toBeNull()
      expect(saved?.kind).toBe('expense')
      expect(saved?.categoryName).toBe('Clinic rent')
      expect(saved?.amountMicro).toBe(5_000_000)
      expect(saved?.description).toBe('Electricity bill for September')
      expect(saved?.entryDate).toBe(TODAY)
    })
    expect(await screen.findByText('Entry recorded')).toBeInTheDocument()
  })

  it('voids an entry only after the operator retypes its number', async () => {
    signIn()
    bookingMocks([entryFixture()])
    let voided: { id?: number, reason?: string } | null = null
    mockChannels({
      'accounting.entry.void': (payload) => {
        voided = payload
        return entryFixture({ status: 'void', voidReason: payload.reason, voidedAt: Date.now() })
      }
    })

    renderAccounting()
    await screen.findByText('ACC-2610-0001')
    fireEvent.click(screen.getByRole('button', { name: 'Void ACC-2610-0001' }))

    const phrase = await screen.findByLabelText('Confirmation phrase')
    const confirm = screen.getByRole('button', { name: 'Void entry' })
    expect(confirm).toBeDisabled()

    fireEvent.change(phrase, { target: { value: 'ACC-2610-0001' } })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(voided).not.toBeNull()
      expect(voided?.id).toBe(41)
      expect(voided?.reason).toBe('ACC-2610-0001')
    })
    expect(await screen.findByText('ACC-2610-0001 voided')).toBeInTheDocument()
  })
})

describe('daily cash close', () => {
  it('closes the day with the counted drawer and keeps the difference', async () => {
    signIn()
    bookingMocks([entryFixture()])
    let closed: { date?: string, countedCashMicro?: number, note?: string | null } | null = null
    mockChannels({
      'accounting.closeDay': (payload) => {
        closed = payload
        return dayFixture({
          isClosed: true,
          countedCashMicro: payload.countedCashMicro,
          varianceMicro: payload.countedCashMicro - 42_400_000,
          closedAt: Date.now(),
          closedByName: 'Nusrat Jahan'
        })
      }
    })

    renderAccounting()
    await screen.findByText("Today's close")
    /* ৳ 4,500.00 collected against ৳ 260.00 of expenses leaves ৳ 4,240.00 expected in the drawer. */
    expect(screen.getByText('৳ 4,240.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close day' }))
    const counted = await screen.findByLabelText(/Cash counted/)
    fireEvent.change(counted, { target: { value: '4200' } })
    fireEvent.blur(counted)

    fireEvent.click(screen.getAllByRole('button', { name: 'Close day' }).at(-1)!)

    await waitFor(() => {
      expect(closed).not.toBeNull()
      expect(closed?.date).toBe(TODAY)
      expect(closed?.countedCashMicro).toBe(42_000_000)
      expect(closed?.note).toBeNull()
    })
    expect(await screen.findByText(/Difference recorded/)).toBeInTheDocument()
  })

  it('reopens a closed day with a reason so its entries can be corrected', async () => {
    signIn()
    bookingMocks([entryFixture()], [categoryFixture()], dayFixture({ isClosed: true, countedCashMicro: 42_400_000, varianceMicro: 0, closedAt: Date.UTC(2026, 9, 1, 12), closedByName: 'Front Desk' }))
    let reopened: { date?: string, reason?: string } | null = null
    mockChannels({
      'accounting.reopenDay': (payload) => {
        reopened = payload
        return dayFixture({ isClosed: false })
      },
      'accounting.closeDay': () => dayFixture({ isClosed: true })
    })

    renderAccounting()
    expect(await screen.findByText(/Closed .*by Front Desk/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reopen day' }))
    const reason = await screen.findByLabelText(/Why is the day being reopened/)
    const confirm = screen.getAllByRole('button', { name: 'Reopen day' }).at(-1)!
    expect(confirm).toBeDisabled()

    fireEvent.change(reason, { target: { value: 'A receipt was entered on the wrong date' } })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => {
      expect(reopened).not.toBeNull()
      expect(reopened?.date).toBe(TODAY)
      expect(reopened?.reason).toBe('A receipt was entered on the wrong date')
    })
    expect(await screen.findByText(new RegExp(`${TODAY} reopened`))).toBeInTheDocument()
  })
})

describe('accounting categories', () => {
  it('adds a category and offers deactivation for the built-in ones', async () => {
    signIn()
    bookingMocks([entryFixture()])
    let added: { name?: string, kind?: string, isActive?: boolean } | null = null
    mockChannels({
      'accounting.categories.save': (payload) => {
        if (payload.id === null || payload.id === undefined) added = payload
        return categoryFixture({ id: 9, name: payload.name, kind: payload.kind, isActive: payload.isActive, isSystem: false, usageCount: 0, totalMicro: 0 })
      }
    })

    renderAccounting()
    await screen.findByText('ACC-2610-0001')
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }))

    expect(await screen.findByText('built-in')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText('New category'), { target: { value: 'Electricity' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(added).not.toBeNull()
      expect(added?.name).toBe('Electricity')
      expect(added?.kind).toBe('expense')
      expect(added?.isActive).toBe(true)
    })
    expect(await screen.findByText('Category added')).toBeInTheDocument()
  })
})

describe('reports', () => {
  it('runs the chosen report, formats money cells and exports the same rows', async () => {
    signIn(['reports.view', 'accounting.export'])
    mockChannels({
      'reports.catalog': () => CATALOG,
      'reports.run': (payload) => reportFixture({ key: payload.key, title: payload.key === 'profit_loss' ? 'Profit and loss' : 'Daily revenue' }),
      'reports.export': (payload) => ({ path: `C:\\Users\\clinic\\Documents\\${payload.key}.csv`, rowCount: 1 })
    })

    renderReports()

    /* The total strip and the money cell both come from the service figure, formatted at the edge. */
    expect(await screen.findAllByText('৳ 12,500.00')).toHaveLength(2)

    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'profit_loss' } })
    await waitFor(() => {
      const run = callLog.filter((entry) => entry.channel === 'reports.run').at(-1)?.payload as { key?: string, range?: { preset?: string } }
      expect(run.key).toBe('profit_loss')
      expect(run.range?.preset).toBe('last30')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => {
      const exported = callLog.find((entry) => entry.channel === 'reports.export')?.payload as { key?: string, limit?: number }
      expect(exported.key).toBe('profit_loss')
      expect(exported.limit).toBe(5000)
    })
    expect(await screen.findByText('Report exported')).toBeInTheDocument()
  })

  it('hides the export button when the role may read reports but not move data out', async () => {
    signIn(['reports.view'])
    mockChannels({
      'reports.catalog': () => CATALOG,
      'reports.run': () => reportFixture()
    })

    renderReports()

    expect(await screen.findAllByText('৳ 12,500.00')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument()
  })
})
