import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DashboardScreen } from '../../src/renderer/src/features/dashboard/DashboardScreen'
import { PreferencesScreen } from '../../src/renderer/src/features/settings/PreferencesScreen'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { ReactElement } from 'react'
import type { DashboardSummary, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * Personal dashboard preferences.
 *
 * The screen has to write what it shows and the dashboard has to follow what was written: a layout
 * stored but ignored would be a dead control. These tests drive the screen, inspect the payload it
 * sends, and then render the dashboard with a saved layout to check the panels it asks for.
 */

function signIn(permissions: string[]): void {
  const session: SessionSummary = {
    id: 'session-preferences',
    userId: 4,
    username: 'ayesha',
    fullName: 'Dr Ayesha Rahman',
    roleCode: 'dentist',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 10,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false })
}

const summary: DashboardSummary = {
  range: { preset: 'last7', from: null, to: null },
  kpis: [],
  appointments: [],
  queue: { waiting: 0, inProgress: 0, completedToday: 0 },
  duePatients: [],
  lowStock: [],
  expiringBatches: [],
  revenueSeries: [],
  dentistLoad: [],
  recentActivity: [],
  notifications: { unread: 0, critical: 0 },
  generatedAt: 1_760_000_000_000
}

function renderScreen(element: ReactElement): void {
  render(
    <MemoryRouter>
      {element}
      <ConfirmDialogHost />
      <Toaster />
    </MemoryRouter>
  )
}

describe('my preferences', () => {
  it('writes the chosen period, panel order and muted alerts', async () => {
    signIn(['billing.view', 'inventory.view', 'appointments.view', 'clinical.view', 'queue.view', 'audit.view'])
    mockChannels({
      'preferences.get': () => ({
        'dashboard.range': 'last7',
        'dashboard.panels': JSON.stringify(['kpis', 'dues', 'lowStock']),
        'notifications.muted': JSON.stringify(['stock.low'])
      }),
      'preferences.recent': () => []
    })
    renderScreen(<PreferencesScreen />)

    /* The stored layout is what the screen opens with: dues is on, collections is off. */
    const dues = await screen.findByRole('checkbox', { name: /Outstanding dues/ })
    await waitFor(() => expect(dues).toBeChecked())
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /Collections/ })).not.toBeChecked())
    expect(screen.getByRole('checkbox', { name: /Low stock Items at or below/ })).toBeChecked()
    /* Only stock.low was muted, so the other alert types are still on. */
    expect(screen.getByRole('checkbox', { name: /Stock near expiry/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^Low stock$/ })).not.toBeChecked()

    /* Move the low-stock panel up, switch Collections on and untick the low-stock alert. */
    await userEvent.click(screen.getByRole('button', { name: 'Move Low stock up' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /Collections/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: /^Low stock$/ }))
    await userEvent.selectOptions(screen.getByLabelText('Dashboard opening period'), 'today')
    await userEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => {
      const saved = callLog.filter((entry) => entry.channel === 'preferences.set').at(-1)
      expect(saved).toBeDefined()
      const values = (saved!.payload as { values: Record<string, string> }).values
      expect(values['dashboard.range']).toBe('today')
      expect(JSON.parse(values['dashboard.panels']!)).toEqual(['kpis', 'lowStock', 'dues', 'collections'])
      /* The alert list holds muted types; stock.low was already muted and is now unmuted. */
      expect(JSON.parse(values['notifications.muted']!)).not.toContain('stock.low')
    })
  })

  it('refuses to leave the dashboard with no panels at all', async () => {
    signIn(['billing.view'])
    mockChannels({
      'preferences.get': () => ({ 'dashboard.panels': JSON.stringify(['collections']) }),
      'preferences.recent': () => []
    })
    renderScreen(<PreferencesScreen />)

    const collections = await screen.findByRole('checkbox', { name: /Collections/ })
    await waitFor(() => expect(collections).toBeChecked())
    await userEvent.click(collections)

    /* The last panel stays on: an empty dashboard is a blank screen, not a layout. */
    expect(collections).toBeChecked()
    expect(screen.getByText('Keep one panel')).toBeInTheDocument()
  })

  it('renders only the panels the operator kept, in the saved order, on the stored period', async () => {
    signIn(['billing.view', 'inventory.view', 'audit.view'])
    mockChannels({
      'dashboard.summary': () => summary,
      'preferences.get': () => ({
        'dashboard.range': 'today',
        'dashboard.panels': JSON.stringify(['kpis', 'recent', 'dues'])
      }),
      'preferences.recent': () => [
        { kind: 'patient', id: 12, title: 'Zarina Sultana', subtitle: 'DP-2026-0012', route: '/patients/12' }
      ]
    })
    renderScreen(<DashboardScreen />)

    /* The period comes from the preference rather than the built-in default. */
    await waitFor(() => {
      const call = callLog.filter((entry) => entry.channel === 'dashboard.summary').at(-1)
      expect(call?.payload).toMatchObject({ range: { preset: 'today' } })
    })

    /* Kept panels are present… */
    expect(await screen.findByText('Recently viewed')).toBeInTheDocument()
    expect(screen.getByText('Outstanding dues')).toBeInTheDocument()
    expect(screen.getByText('Zarina Sultana')).toBeInTheDocument()

    /* …panels that were not kept are not rendered at all. */
    expect(screen.queryByText('Recent activity')).toBeNull()
    expect(screen.queryByText('Low stock')).toBeNull()
    expect(screen.queryByText('Expiring batches')).toBeNull()
  })
})
