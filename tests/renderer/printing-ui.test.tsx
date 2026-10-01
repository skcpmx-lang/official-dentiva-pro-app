import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintDialog } from '../../src/renderer/src/features/printing/PrintDialog'
import { Toaster } from '../../src/renderer/src/components/ui/overlay'
import { callLog, mockChannels } from './setup'
import type { PrintOutcome, PrinterStatus, PrintProfile, PrintDocumentInfo, RenderedPrintDocument } from '../../src/renderer/src/lib/types'

/**
 * Print dialog.
 *
 * The dialog must show the very document the print engine produced and send exactly that document to the
 * printer. The failure test is the important one: a refused printer must never lose the document — the
 * preview stays, and retry / save-as-PDF keep working (§39, §95).
 */

const status: PrinterStatus = {
  printers: [
    { name: 'HP LaserJet 1020', displayName: 'HP LaserJet 1020', description: 'USB001', status: 0, isDefault: true },
    { name: 'POS-80', displayName: 'POS-80 Receipt', description: 'USB002', status: 0, isDefault: false }
  ],
  defaultPrinter: 'HP LaserJet 1020',
  available: true,
  missingFonts: []
}

const catalog: PrintDocumentInfo[] = [
  { type: 'prescription', title: 'Prescription', description: 'Rx sheet with clinic header', paperClasses: ['a4', 'a5', 'thermal'], requiresEntity: true },
  { type: 'test', title: 'Printer test page', description: 'Alignment grid', paperClasses: ['a4'], requiresEntity: false }
]

const profile: PrintProfile = {
  id: 5,
  name: 'Reception A4',
  documentType: 'prescription',
  printerName: 'HP LaserJet 1020',
  paperClass: 'a4',
  customWidthMm: null,
  customHeightMm: null,
  thermalWidthMm: 80,
  orientation: 'portrait',
  marginsMm: { top: 12, right: 12, bottom: 12, left: 12 },
  scaleBp: 10000,
  copies: 1,
  isDefault: true,
  isActive: true,
  notes: null,
  createdByName: 'Shohan Khan',
  createdAt: Date.UTC(2026, 0, 12),
  updatedAt: Date.UTC(2026, 0, 12)
}

const document: RenderedPrintDocument = {
  documentType: 'prescription',
  title: 'Rx-2601-0007 · Ayesha Siddika',
  fileName: 'Rx-2601-0007.html',
  html: '<html><body><h1>Rx-2601-0007</h1><p>Ayesha Siddika — অংসিদ্দিকা</p></body></html>',
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
  sizeBytes: 2048
}

function outcome(overrides: Partial<PrintOutcome> = {}): PrintOutcome {
  return { ok: true, failureReason: null, printerName: 'HP LaserJet 1020', historyId: 31, filePath: null, ...overrides }
}

function renderDialog(): void {
  render(
    <>
      <PrintDialog open target={{ documentType: 'prescription', entityId: 7, label: 'Rx-2601-0007' }} onClose={() => undefined} />
      <Toaster />
    </>
  )
}

describe('print dialog', () => {
  it('previews the rendered document and prints it to the selected printer', async () => {
    const user = userEvent.setup()
    mockChannels({
      'printing.printers': () => status,
      'printing.documents': () => catalog,
      'printing.profiles': () => [profile],
      'printing.render': () => document,
      'printing.previewed': () => ({ ok: true as const }),
      'printing.print': () => outcome()
    })

    renderDialog()

    const frame = await screen.findByTitle('Print preview')
    expect(frame.getAttribute('srcdoc')).toContain('Rx-2601-0007')
    expect(frame.getAttribute('srcdoc')).toContain('অংসিদ্দিকা')

    await user.click(screen.getByRole('button', { name: 'Print' }))

    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'printing.print')).toBe(true))
    const sent = callLog.filter((entry) => entry.channel === 'printing.print').at(-1)?.payload as Record<string, unknown>
    expect(sent.documentType).toBe('prescription')
    expect(sent.entityId).toBe(7)
    expect(sent.printerName).toBe('HP LaserJet 1020')
    expect(sent.copies).toBe(1)

    const previews = callLog.filter((entry) => entry.channel === 'printing.previewed')
    expect(previews).toHaveLength(1)
    expect((previews[0]?.payload as Record<string, unknown>).title).toBe(document.title)

    await screen.findByText(/Sent to the printer/i)
  })

  it('keeps the document when the printer fails and lets the operator retry or save a PDF', async () => {
    const user = userEvent.setup()
    let attempts = 0
    mockChannels({
      'printing.printers': () => status,
      'printing.documents': () => catalog,
      'printing.profiles': () => [profile],
      'printing.render': () => document,
      'printing.previewed': () => ({ ok: true as const }),
      'printing.print': () => {
        attempts += 1
        return attempts === 1 ? outcome({ ok: false, failureReason: 'The printer is not responding.', printerName: null, historyId: 32 }) : outcome({ historyId: 33 })
      },
      'printing.pdf': () => outcome({ ok: true, filePath: 'C:\\Users\\clinic\\Documents\\Rx-2601-0007.pdf', historyId: 34 })
    })

    renderDialog()

    await screen.findByTitle('Print preview')
    await user.click(screen.getByRole('button', { name: 'Print' }))

    await screen.findByText('Printing failed')
    expect(screen.getByText('The printer is not responding.')).toBeInTheDocument()
    expect(screen.getByTitle('Print preview')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(callLog.filter((entry) => entry.channel === 'printing.print')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Save as PDF' }))
    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'printing.pdf')).toBe(true))
    const saved = callLog.filter((entry) => entry.channel === 'printing.pdf').at(-1)?.payload as Record<string, unknown>
    expect(saved.targetPath).toBeNull()
    expect(saved.documentType).toBe('prescription')
    await screen.findByText(/PDF saved/i)
  })
})
