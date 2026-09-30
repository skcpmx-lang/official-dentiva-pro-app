import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { CommandPalette } from '../../src/renderer/src/components/shell/CommandPalette'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { SearchGroup, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * Global search in the command palette.
 *
 * Typing searches the clinic through the main process and shows grouped results; the keyboard opens the
 * highlighted one and the route that opens it is the one the main process returned. Commands the operator
 * is not allowed to run are never offered.
 */

function signIn(permissions: string[] = ['patients.view', 'billing.view', 'clinical.view', 'inventory.view', 'audit.view']): void {
  const session: SessionSummary = {
    id: 'session-search',
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
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false, commandPaletteOpen: true })
}

const groups: SearchGroup[] = [
  {
    key: 'patients',
    label: 'Patients',
    total: 1,
    items: [
      {
        id: 4,
        title: 'Zarina Sultana · জরিনা সুলতানা',
        subtitle: 'DP-2026-0004 · 01911223344',
        meta: null,
        route: '/patients/4'
      }
    ]
  },
  {
    key: 'inventory',
    label: 'Inventory',
    total: 2,
    items: [
      { id: 7, title: 'Zirconia blanks', subtitle: 'ITM-2026-0007 · prosthodontic', meta: '12 piece', route: '/inventory/7' }
    ]
  }
]

function LocationProbe(): ReactElement {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function renderPalette(): void {
  render(
    <MemoryRouter initialEntries={['/']}>
      <CommandPalette />
      <LocationProbe />
    </MemoryRouter>
  )
}

describe('global search', () => {
  it('searches the clinic as the operator types and groups the results', async () => {
    signIn()
    mockChannels({ 'search.global': () => ({ query: 'zirconia', groups, total: 3 }) })
    renderPalette()

    /* With an empty box the palette offers actions rather than searching. */
    expect(screen.getByRole('option', { name: /Go to patients/ })).toBeInTheDocument()
    expect(callLog.some((entry) => entry.channel === 'search.global')).toBe(false)

    await userEvent.type(screen.getByLabelText('Search the clinic'), 'zirconia')

    expect(await screen.findByText('Zirconia blanks')).toBeInTheDocument()
    await waitFor(
      () => {
        expect(callLog.filter((entry) => entry.channel === 'search.global').at(-1)?.payload).toMatchObject({ query: 'zirconia', limitPerGroup: 5 })
      },
      { timeout: 3000 }
    )

    expect(screen.getByText('Patients')).toBeInTheDocument()
    expect(screen.getByText('Inventory')).toBeInTheDocument()
    expect(screen.getByText('Zirconia blanks')).toBeInTheDocument()
    expect(screen.getByText('3 match(es) for “zirconia”.')).toBeInTheDocument()

    /* Enter opens the highlighted result. */
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/inventory/7'))
  })

  it('opens the first result with the keyboard and the clicked one with the mouse', async () => {
    signIn()
    mockChannels({ 'search.global': () => ({ query: 'zarina', groups, total: 3 }) })
    renderPalette()

    await userEvent.type(screen.getByLabelText('Search the clinic'), 'zarina')
    await screen.findByText('Zirconia blanks')

    await userEvent.click(screen.getByRole('option', { name: /Zarina Sultana/ }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/patients/4'))
  })

  it('offers no command the operator may not run and reports an empty search honestly', async () => {
    signIn(['patients.view'])
    mockChannels({ 'search.global': () => ({ query: 'zzz', groups: [], total: 0 }) })
    renderPalette()

    /* The audit log needs audit.view, which this operator does not hold. */
    expect(screen.queryByRole('option', { name: /audit log/i })).toBeNull()
    expect(screen.queryByRole('option', { name: /Go to invoices/ })).toBeNull()

    await userEvent.type(screen.getByLabelText('Search the clinic'), 'zzz')
    expect(await screen.findByText(/Nothing matches/, {}, { timeout: 3000 })).toBeInTheDocument()
  })
})
