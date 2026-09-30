import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InvoiceListScreen } from '../../src/renderer/src/features/billing/InvoiceListScreen'
import { InvoiceScreen } from '../../src/renderer/src/features/billing/InvoiceScreen'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { Invoice, InvoiceListItem, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * Billing screens.
 *
 * The invoice register and the payment desk are exercised the way the front desk uses them: filter the
 * register, open an invoice, take a payment, refund part of it and void a receipt. Every assertion is on
 * the channel payload the screen produced, so a button that no longer does real work fails the test (§90).
 */

const FULL = ['patients.view', 'patients.summary', 'billing.view', 'billing.create', 'billing.edit', 'billing.void', 'billing.export', 'payments.view', 'payments.create', 'payments.void', 'payments.refund']

function signIn(permissions: string[] = FULL): void {
  const session: SessionSummary = {
    id: 'session-billing',
    userId: 1,
    username: 'frontdesk',
    fullName: 'Front Desk',
    roleCode: 'receptionist',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

const AT = Date.UTC(2026, 9, 1, 10, 0, 0)

function invoiceFixture(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 21,
    invoiceNo: 'INV-2610-0001',
    patientId: 7,
    patientCode: 'DP-2609-0001',
    patientName: 'Rakib Hasan',
    patientNameBn: 'রাকিব হাসান',
    patientPhone: '01712345678',
    visitId: 9,
    appointmentId: null,
    status: 'partial',
    issueAt: AT,
    issueDate: '2026-10-01',
    dueDate: null,
    discountBp: 0,
    subtotalMicro: 45_000_000,
    discountMicro: 0,
    totalMicro: 45_000_000,
    paidMicro: 15_000_000,
    dueMicro: 30_000_000,
    refundedMicro: 0,
    printedCount: 0,
    lastPrintedAt: null,
    voidReason: null,
    voidedAt: null,
    notes: null,
    createdAt: AT,
    updatedAt: AT,
    lines: [
      {
        id: 1,
        treatmentId: 4,
        visitTreatmentId: 9,
        description: 'Composite filling · tooth 36',
        toothCodes: ['36'],
        quantity: 1,
        unitPriceMicro: 45_000_000,
        discountMicro: 0,
        notes: null,
        lineTotalMicro: 45_000_000,
        billed: true
      }
    ],
    payments: [
      {
        id: 31,
        receiptNo: 'RCP-2610-0001',
        kind: 'payment',
        amountMicro: 15_000_000,
        method: 'bkash',
        reference: 'BK-77812',
        paidAt: AT,
        status: 'active',
        receivedByName: 'Front Desk'
      }
    ],
    ...overrides
  }
}

function listItemFrom(invoice: Invoice): InvoiceListItem {
  return invoice as InvoiceListItem
}

function renderList(): void {
  render(
    <MemoryRouter initialEntries={['/invoices']}>
      <Routes>
        <Route path="/invoices" element={<InvoiceListScreen />} />
      </Routes>
      <Toaster />
    </MemoryRouter>
  )
}

function renderDetail(): void {
  render(
    <MemoryRouter initialEntries={['/invoices/21']}>
      <Routes>
        <Route path="/invoices/:invoiceId" element={<InvoiceScreen />} />
      </Routes>
      <ConfirmDialogHost />
      <Toaster />
    </MemoryRouter>
  )
}

describe('invoice register', () => {
  it('lists invoices with the filtered totals and asks for dues only when the switch is on', async () => {
    signIn()
    const partial = invoiceFixture()
    const paid = invoiceFixture({
      id: 22,
      invoiceNo: 'INV-2610-0002',
      patientName: 'Nusrat Jahan',
      patientNameBn: 'নুসরাত জাহান',
      status: 'paid',
      paidMicro: 45_000_000,
      dueMicro: 0,
      payments: []
    })
    mockChannels({
      'invoices.list': (payload) => ({
        items: [listItemFrom(partial), listItemFrom(paid)],
        total: 2,
        limit: 25,
        offset: 0,
        totals: { invoicedMicro: 90_000_000, paidMicro: 60_000_000, dueMicro: payload.hasDue ? 30_000_000 : 30_000_000, refundedMicro: 0 }
      })
    })

    renderList()

    expect(await screen.findByText('INV-2610-0001')).toBeInTheDocument()
    expect(screen.getByText('Nusrat Jahan')).toBeInTheDocument()
    /* Bengali patient names must survive the round trip to the screen (§5). */
    expect(screen.getByText('নুসরাত জাহান')).toBeInTheDocument()
    /* ৳ 9,000.00 invoiced and ৳ 6,000.00 collected, from the service totals for the whole filter. */
    expect(screen.getByText('৳ 9,000.00')).toBeInTheDocument()
    expect(screen.getByText('৳ 6,000.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: 'Only with dues' }))

    await waitFor(() => {
      const filter = callLog.filter((entry) => entry.channel === 'invoices.list').at(-1)?.payload as { hasDue?: boolean }
      expect(filter.hasDue).toBe(true)
    })
  })

  it('hides money-moving controls from a read-only role', async () => {
    signIn(['billing.view', 'patients.view'])
    mockChannels({
      'invoices.list': () => ({ items: [listItemFrom(invoiceFixture())], total: 1, limit: 25, offset: 0, totals: { invoicedMicro: 45_000_000, paidMicro: 15_000_000, dueMicro: 30_000_000, refundedMicro: 0 } })
    })

    renderList()

    expect(await screen.findByText('INV-2610-0001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Raise invoice/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Export CSV/ })).not.toBeInTheDocument()
  })
})

describe('invoice and payment desk', () => {
  it('shows the balance and records a payment for the outstanding amount', async () => {
    signIn()
    let invoice = invoiceFixture({ payments: [], paidMicro: 0, dueMicro: 45_000_000, status: 'unpaid' })
    mockChannels({
      'invoices.get': () => invoice,
      'patients.summary': () => ({ financials: { invoicedMicro: 45_000_000, paidMicro: 0, dueMicro: 45_000_000 } }) as never,
      'payments.add': (payload) => {
        invoice = invoiceFixture({
          paidMicro: 45_000_000,
          dueMicro: 0,
          status: 'paid',
          payments: [
            { id: 31, receiptNo: 'RCP-2610-0001', kind: 'payment', amountMicro: payload.amountMicro, method: payload.method ?? 'cash', reference: payload.reference ?? null, paidAt: payload.paidAt, status: 'active', receivedByName: 'Front Desk' }
          ]
        })
        return invoice as never
      }
    })

    renderDetail()

    /* Edit mode keeps the line in an input, so assert on its value. */
    expect(await screen.findByDisplayValue('Composite filling · tooth 36')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Take payment/ }))

    expect(screen.getByText(/Outstanding balance: ৳ 4,500.00/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    await waitFor(() => {
      const entry = callLog.find((call) => call.channel === 'payments.add')
      expect(entry).toBeDefined()
      expect(entry?.payload).toMatchObject({ invoiceId: 21, patientId: 7, kind: 'payment', amountMicro: 45_000_000, method: 'cash' })
    })
    /* The screen reloads the invoice so the strip reflects the stored totals, not local state. */
    await waitFor(() => expect(screen.getByText('RCP-2610-0001')).toBeInTheDocument())
  })

  it('makes a refund a two-step confirmation before writing it', async () => {
    signIn()
    mockChannels({
      'invoices.get': () => invoiceFixture(),
      'patients.summary': () => ({ financials: { invoicedMicro: 45_000_000, paidMicro: 15_000_000, dueMicro: 30_000_000 } }) as never,
      'payments.add': () => invoiceFixture() as never
    })

    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: /^Refund$/ }))

    expect(screen.getByText(/Money already collected on this invoice: ৳ 1,500.00/)).toBeInTheDocument()

    /* A refund needs an amount before the confirmation step is meaningful. */
    const amount = screen.getByLabelText(/Amount/)
    fireEvent.change(amount, { target: { value: '500' } })
    fireEvent.blur(amount)

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(callLog.some((call) => call.channel === 'payments.add')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Confirm refund' }))
    await waitFor(() => {
      const entry = callLog.find((call) => call.channel === 'payments.add')
      expect(entry?.payload).toMatchObject({ kind: 'refund', amountMicro: 5_000_000, invoiceId: 21 })
    })
  })

  it('voids an invoice only after the operator types the invoice number', async () => {
    signIn()
    mockChannels({
      'invoices.get': () => invoiceFixture({ status: 'unpaid', paidMicro: 0, dueMicro: 45_000_000, payments: [] }),
      'patients.summary': () => ({ financials: { invoicedMicro: 45_000_000, paidMicro: 0, dueMicro: 45_000_000 } }) as never,
      'invoices.void': (payload) => invoiceFixture({ status: 'void', voidReason: payload.reason, dueMicro: 0, paidMicro: 0, payments: [] }) as never
    })

    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: /^Void$/ }))

    const confirm = await screen.findByRole('button', { name: 'Void invoice' })
    expect(confirm).toBeDisabled()

    const phrase = screen.getByLabelText('Confirmation phrase')
    fireEvent.change(phrase, { target: { value: 'INV-2610-000' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(phrase, { target: { value: 'INV-2610-0001' } })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => {
      const entry = callLog.find((call) => call.channel === 'invoices.void')
      expect(entry?.payload).toMatchObject({ id: 21, reason: 'INV-2610-0001' })
    })
  })

  it('voids a receipt through the typed confirmation and reloads the invoice', async () => {
    signIn()
    mockChannels({
      'invoices.get': () => invoiceFixture(),
      'patients.summary': () => ({ financials: { invoicedMicro: 45_000_000, paidMicro: 15_000_000, dueMicro: 30_000_000 } }) as never,
      'payments.void': () => invoiceFixture({ paidMicro: 0, dueMicro: 45_000_000, status: 'unpaid' }) as never
    })

    renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: /Void receipt RCP-2610-0001/ }))

    const confirm = await screen.findByRole('button', { name: 'Void receipt' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Confirmation phrase'), { target: { value: 'RCP-2610-0001' } })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)

    await waitFor(() => {
      const entry = callLog.find((call) => call.channel === 'payments.void')
      expect(entry?.payload).toMatchObject({ id: 31, reason: 'RCP-2610-0001' })
    })
  })
})
