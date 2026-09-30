import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PrintingScreen } from '../../src/renderer/src/features/settings/PrintingScreen'
import { PrintHistoryScreen } from '../../src/renderer/src/features/printing/PrintHistoryScreen'
import { Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { PrintHistoryEntry, PrinterStatus, PrintProfile, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * Printing settings and print history.
 *
 * The profile form must send the paper, margins and default flag the operator chose, and the history
 * screen must be able to show a failed document and send it to the printer again.
 */

function signIn(permissions: string[] = ['printing.configure', 'printing.print']): void {
  const session: SessionSummary = {
    id: 'session-print',
    userId: 1,
    username: 'admin',
    fullName: 'Shohan Khan',
    roleCode: 'administrator',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

const status: PrinterStatus = {
  printers: [{ name: 'POS-80', displayName: 'POS-80 Receipt', description: 'USB002', status: 0, isDefault: true }],
  defaultPrinter: 'POS-80',
  available: true,
  missingFonts: []
}

const profile: PrintProfile = {
  id: 5,
  name: 'Reception A4',
  documentType: 'prescription',
  printerName: 'POS-80',
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

const failed: PrintHistoryEntry = {
  id: 77,
  documentType: 'prescription',
  title: 'Rx-2601-0007 · Ayesha Siddika',
  reference: 'Rx-2601-0007',
  profileId: 5,
  profileName: 'Reception A4',
  printerName: 'POS-80',
  paperClass: 'a4',
  action: 'print',
  result: 'failed',
  failureReason: 'The printer is not responding.',
  copies: 1,
  filePath: null,
  hasPayload: true,
  at: Date.UTC(2026, 1, 3, 9, 30),
  performedByName: 'Shohan Khan'
}

describe('printing settings', () => {
  it('saves a printer profile with the paper and defaults the operator chose', async () => {
    const user = userEvent.setup()
    signIn()
    mockChannels({
      'printing.printers': () => status,
      'printing.documents': () => [
        { type: 'prescription', title: 'Prescription', description: 'Rx sheet', paperClasses: ['a4', 'a5', 'thermal'], requiresEntity: true }
      ],
      'printing.profiles': () => [profile],
      'printing.profile.save': (input) => ({ ...profile, ...input, id: 6 })
    })

    render(
      <>
        <PrintingScreen />
        <Toaster />
      </>
    )

    expect(await screen.findByText('Reception A4')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'New profile' }))
    await user.type(screen.getByLabelText(/^Profile name/), 'Front desk A5')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'printing.profile.save')).toBe(true))
    const saved = callLog.filter((entry) => entry.channel === 'printing.profile.save').at(-1)?.payload as Record<string, unknown>
    expect(saved.name).toBe('Front desk A5')
    expect(saved.documentType).toBe('prescription')
    expect(saved.paperClass).toBe('a4')
    expect(saved.marginsMm).toEqual({ top: 12, right: 12, bottom: 12, left: 12 })
    await screen.findByText('Profile created')
  })
})

describe('print history', () => {
  it('shows a failed document, keeps it viewable and retries it', async () => {
    const user = userEvent.setup()
    signIn()
    mockChannels({
      'printing.history': () => ({ items: [failed], total: 1 }),
      'printing.history.payload': () => ({ html: '<html><body><h1>Rx-2601-0007</h1></body></html>', title: failed.title, fileName: 'Rx-2601-0007.html' }),
      'printing.retry': () => ({ ok: true, failureReason: null, printerName: 'POS-80', historyId: 77, filePath: null })
    })

    render(
      <>
        <PrintHistoryScreen />
        <Toaster />
      </>
    )

    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('The printer is not responding.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: `View ${failed.title}` }))
    const frame = await screen.findByTitle('Kept document')
    expect(frame.getAttribute('srcdoc')).toContain('Rx-2601-0007')
    await user.click(screen.getAllByRole('button', { name: 'Close' }).at(-1)!)

    await user.click(screen.getByRole('button', { name: `Retry ${failed.title}` }))
    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'printing.retry')).toBe(true))
    const retried = callLog.filter((entry) => entry.channel === 'printing.retry').at(-1)?.payload as Record<string, unknown>
    expect(retried.historyId).toBe(77)
    await screen.findByText('Sent to the printer again')
  })
})
