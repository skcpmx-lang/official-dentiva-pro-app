import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AppShell } from '../../src/renderer/src/components/shell/AppShell'
import { PatientListScreen } from '../../src/renderer/src/features/patients/PatientListScreen'
import { PermissionDenied } from '../../src/renderer/src/components/ui/primitives'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { mockChannels } from './setup'
import type { SessionSummary } from '../../src/renderer/src/lib/types'

function sessionWith(permissions: string[]): SessionSummary {
  return {
    id: 'session-test',
    userId: 1,
    username: 'reception',
    fullName: 'Reception Desk',
    roleCode: 'receptionist',
    permissions,
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
}

function renderShell(): void {
  render(
    <MemoryRouter initialEntries={['/patients']}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="/patients/*"
            element={
              <Routes>
                <Route path="/patients" element={<PatientListScreen />} />
              </Routes>
            }
          />
        </Route>
      </Routes>
    </MemoryRouter>
  )
}

describe('navigation and permissions in the user interface', () => {
  it('hides navigation for modules the signed-in role cannot use', () => {
    useAppStore.setState({
      session: sessionWith(['patients.view']),
      clinic: null,
      settings: {},
      stage: 'ready',
      locked: false
    })

    mockChannels({
      'patients.list': () => ({ items: [], total: 0, limit: 25, offset: 0 }),
      'patients.tags': () => []
    })

    renderShell()

    expect(screen.getByRole('link', { name: /patients/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /users/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /audit log/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /roles/i })).not.toBeInTheDocument()
  })

  it('shows the administration navigation for an owner session', () => {
    useAppStore.setState({
      session: sessionWith(['patients.view', 'users.view', 'roles.view', 'audit.view', 'settings.view']),
      clinic: null,
      settings: {},
      stage: 'ready',
      locked: false
    })

    mockChannels({
      'patients.list': () => ({ items: [], total: 0, limit: 25, offset: 0 }),
      'patients.tags': () => []
    })

    renderShell()

    expect(screen.getByRole('link', { name: /users/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /roles/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /audit log/i })).toBeInTheDocument()
  })

  it('renders the patient register empty state and never invents records', async () => {
    useAppStore.setState({
      session: sessionWith(['patients.view', 'patients.create']),
      clinic: null,
      settings: {},
      stage: 'ready',
      locked: false
    })

    mockChannels({
      'patients.list': (payload) => ({
        items: [],
        total: 0,
        limit: payload?.limit ?? 25,
        offset: payload?.offset ?? 0
      }),
      'patients.tags': () => []
    })

    render(
      <MemoryRouter>
        <PatientListScreen />
      </MemoryRouter>
    )

    await waitFor(() => expect(screen.getByText(/no patients yet/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /new patient/i })).toBeInTheDocument()
  })

  it('renders the permission-denied state with a recovery explanation', () => {
    useAppStore.setState({ session: sessionWith(['patients.view']) })
    render(<PermissionDenied />)
    expect(screen.getByText(/you do not have access to this area/i)).toBeInTheDocument()
  })
})
