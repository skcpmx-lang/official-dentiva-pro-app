import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InvoiceScreen } from '../../src/renderer/src/features/billing/InvoiceScreen'
import { AppointmentsScreen } from '../../src/renderer/src/features/scheduling/AppointmentsScreen'
import { ReportsScreen } from '../../src/renderer/src/features/reports/ReportsScreen'
import { Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { Appointment, Invoice, PrintDocumentInfo, PrinterStatus, RenderedPrintDocument, ReportResult, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * The remaining printing surfaces.
 *
 * A receipt, an appointment slip and a report each carry their own identity into the print request — the
 * receipt its payment id, the slip its appointment id, the report its key and period. These tests assert
 * exactly that, because a print button that opens the wrong record is worse than no button at all.
 */

const PERMISSIONS = ['patients.view', 'patients.summary', 'billing.view', 'payments.view', 'appointments.view', 'reports.view', 'printing.print']

function signIn(): void {
  const session: SessionSummary = {
    id: 'session-print-surfaces',
    userId: 1,
    username: 'frontdesk',
    fullName: 'Front Desk',
    roleCode: 'receptionist',
    permissions: PERMISSIONS,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

const AT = Date.UTC(2026, 9, 1, 10, 0, 0)

const status: PrinterStatus = {
  printers: [{ name: 'HP LaserJet 1020', displayName: 'HP LaserJet 1020', description: 'USB001', status: 0, isDefault: true }],
  defaultPrinter: 'HP LaserJet 1020',
  available: true,
  missingFonts: []
}

const catalog: PrintDocumentInfo[] = [
  { type: 'payment_receipt', title: 'Payment receipt', description: 'Receipt for one payment', paperClasses: ['a4', 'thermal'], requiresEntity: true },
  { type: 'appointment_slip', title: 'Appointment slip', description: 'Slip for the patient', paperClasses: ['a4', 'thermal'], requiresEntity: true },
  { type: 'report', title: 'Report', description: 'Report table', paperClasses: ['a4'], requiresEntity: false }
]

function rendered(documentType: string, title: string): RenderedPrintDocument {
  return {
    documentType: documentType as RenderedPrintDocument['documentType'],
    title,
    fileName: `${documentType}.html`,
    html: `<html><body><h1>${title}</h1></body></html>`,
    paperClass: 'a4',
    layout: 'full',
    widthMicrons: 210000,
    heightMicrons: 297000,
    marginsMicrons: { top: 12000, right: 12000, bottom: 12000, left: 12000 },
    landscape: false,
    copies: 1,
    profileId: null,
    profileName: null,
    warnings: [],
    sizeBytes: 1024
  }
}

function printingMocks(): void {
  mockChannels({
    'printing.printers': () => status,
    'printing.documents': () => catalog,
    'printing.profiles': () => [],
    'printing.render': (input) => rendered(input.documentType, `${input.documentType} preview`),
    'printing.previewed': () => ({ ok: true as const })
  })
}

const invoice: Invoice = {
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
  ]
}

const appointment: Appointment = {
  id: 12,
  patientId: 7,
  dentistId: 2,
  scheduledAt: AT,
  durationMin: 20,
  reason: 'Scaling and polishing',
  notes: null,
  status: 'scheduled',
  patientCode: 'DP-2609-0001',
  patientName: 'Rakib Hasan',
  patientNameBn: 'রাকিব হাসান',
  patientPhone: '01712345678',
  dentistName: 'Dr. Shohan Khan',
  scheduledDate: '2026-10-01',
  cancelledReason: null,
  rescheduledFrom: null,
  visitId: null,
  createdAt: AT,
  updatedAt: AT,
  queueEntryId: null,
  queueNo: null,
  queueStatus: null
}

const report: ReportResult = {
  key: 'revenue_daily',
  title: 'Daily revenue',
  description: 'Collected money per day',
  from: '2026-09-01',
  to: '2026-09-30',
  generatedAt: AT,
  columns: [
    { key: 'date', header: 'Date', align: 'left', format: 'text' },
    { key: 'total', header: 'Collected', align: 'right', format: 'money' }
  ],
  rows: [{ date: '2026-09-30', total: 1_250_000 }],
  totals: [{ label: 'Total collected', value: 1_250_000, format: 'money' }],
  note: null
}

function lastRenderPayload(): Record<string, unknown> {
  const entry = callLog.filter((item) => item.channel === 'printing.render').at(-1)
  return (entry?.payload ?? {}) as Record<string, unknown>
}

describe('printing surfaces', () => {
  it('prints the receipt for the payment that was clicked', async () => {
    const user = userEvent.setup()
    signIn()
    printingMocks()
    mockChannels({ 'invoices.get': () => invoice })

    render(
      <MemoryRouter initialEntries={['/invoices/21']}>
        <Routes>
          <Route path="/invoices/:invoiceId" element={<InvoiceScreen />} />
        </Routes>
        <Toaster />
      </MemoryRouter>
    )

    await user.click(await screen.findByRole('button', { name: 'Print receipt RCP-2610-0001' }))

    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'printing.render')).toBe(true))
    const sent = lastRenderPayload()
    expect(sent.documentType).toBe('payment_receipt')
    expect(sent.entityId).toBe(31)
    await screen.findByTitle('Print preview')
  })

  it('prints the appointment slip for the appointment that was clicked', async () => {
    const user = userEvent.setup()
    signIn()
    printingMocks()
    mockChannels({
      'dentists.list': () => [],
      'appointments.day': () => ({ date: '2026-10-01', load: [], items: [appointment] }),
      'appointments.list': () => ({ items: [appointment], total: 1, limit: 100, offset: 0 })
    })

    render(
      <MemoryRouter>
        <AppointmentsScreen />
        <Toaster />
      </MemoryRouter>
    )

    await user.click(await screen.findByRole('button', { name: 'Print slip for Rakib Hasan' }))

    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'printing.render')).toBe(true))
    const sent = lastRenderPayload()
    expect(sent.documentType).toBe('appointment_slip')
    expect(sent.entityId).toBe(12)
  })

  it('prints the current report with its key and period', async () => {
    const user = userEvent.setup()
    signIn()
    printingMocks()
    mockChannels({
      'reports.catalog': () => [{ key: 'revenue_daily', title: 'Daily revenue', description: 'Collected money per day', usesRange: true, permission: 'reports.view' }],
      'reports.run': () => report
    })

    render(
      <>
        <ReportsScreen />
        <Toaster />
      </>
    )

    await user.click(await screen.findByRole('button', { name: 'Print / PDF' }))

    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'printing.render')).toBe(true))
    const sent = lastRenderPayload()
    expect(sent.documentType).toBe('report')
    expect(sent.reportKey).toBe('revenue_daily')
    expect(sent.reportFrom).toBe('2026-09-01')
    expect(sent.reportTo).toBe('2026-09-30')
  })
})
