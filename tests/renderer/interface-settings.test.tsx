import { describe, expect, it, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { LoginScreen } from '../../src/renderer/src/features/auth/LoginScreen'
import { applyInterfaceSettings, landingRoute, startsCollapsed } from '../../src/renderer/src/lib/interface'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { mockChannels } from './setup'
import type { ReactElement } from 'react'
import type { BootstrapResult, LoginResult } from '../../src/renderer/src/lib/types'

/**
 * Interface settings.
 *
 * Density, reduced motion, the starting sidebar position and the landing page are clinic settings, so
 * they have to do something: the first two reach the document root where the design tokens read them,
 * the third sets the shell's starting position and the fourth decides where a sign-in lands. A setting
 * that is offered in Settings but ignored would be exactly the kind of dead control the specification
 * forbids.
 */

afterEach(() => {
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.reducedMotion
})

const bootstrap: BootstrapResult = {
  stage: 'ready',
  build: { version: '1.0.0', buildNumber: 'local', gitSha: 'test', builtAt: '2026-01-01T00:00:00.000Z', electron: '44.5.1', chromium: '144', node: '24' },
  machine: {
    hostname: 'TEST-PC',
    platform: 'win32',
    osVersion: '10.0.19045',
    arch: 'x64',
    machineId: 'machine-test',
    totalMemoryBytes: 8_000_000_000,
    cpuCount: 4,
    locale: 'en-GB',
    timezone: 'Asia/Dhaka',
    displays: [{ width: 1920, height: 1080, scaleFactor: 1 }],
    printersAvailable: true
  },
  clinic: null,
  activation: { activated: true, activatedAt: 1_700_000_000_000, attempts: 0, lastAttemptAt: null, cooldownRemainingMs: 0, verifierIntact: true, codeHint: { min: 8, max: 32 } },
  setup: { activated: true, needsSetup: false, hasClinic: true, dentistCount: 1, hasAdministrator: true, adminUsername: 'admin' },
  maintenanceMode: false,
  settings: {},
  session: null
}

const loginResult: LoginResult = {
  session: {
    id: 'session-interface',
    userId: 1,
    username: 'admin',
    fullName: 'Shohan Khan',
    roleCode: 'administrator',
    permissions: ['patients.view'],
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 10,
    mustChangePassword: false
  },
  mustChangePassword: false,
  passwordExpired: false
}

function LocationProbe(): ReactElement {
  const location = useLocation()
  return <div data-testid="location">{location.pathname}</div>
}

describe('interface settings', () => {
  it('applies density and reduced motion to the document root and nothing else', () => {
    applyInterfaceSettings({ 'ui.density': 'compact', 'ui.reducedMotion': 'true' })
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.reducedMotion).toBe('true')

    applyInterfaceSettings({ 'ui.density': 'comfortable', 'ui.reducedMotion': 'false' })
    expect(document.documentElement.dataset.density).toBe('comfortable')
    expect(document.documentElement.dataset.reducedMotion).toBe('false')

    /* A missing or hand-edited value falls back to the shipped default rather than an unknown state. */
    applyInterfaceSettings({ 'ui.density': 'enormous', 'ui.reducedMotion': 'yes' })
    expect(document.documentElement.dataset.density).toBe('comfortable')
    expect(document.documentElement.dataset.reducedMotion).toBe('false')
  })

  it('maps the landing page setting to a route and defaults to the dashboard', () => {
    expect(landingRoute({ 'ui.landingPage': 'dashboard' })).toBe('/')
    expect(landingRoute({ 'ui.landingPage': 'appointments' })).toBe('/appointments')
    expect(landingRoute({ 'ui.landingPage': 'queue' })).toBe('/queue')
    expect(landingRoute({ 'ui.landingPage': 'patients' })).toBe('/patients')
    expect(landingRoute({})).toBe('/')
    expect(landingRoute({ 'ui.landingPage': 'somewhere-else' })).toBe('/')
    expect(startsCollapsed({ 'ui.sidebarCollapsed': 'true' })).toBe(true)
    expect(startsCollapsed({ 'ui.sidebarCollapsed': 'false' })).toBe(false)
  })

  it('signs in to the configured start page instead of always opening the dashboard', async () => {
    useAppStore.setState({ clinic: null, build: null, session: null, settings: {}, ready: true })
    mockChannels({
      'auth.rememberedUsername': () => ({ username: null }),
      'auth.login': () => loginResult,
      'app.bootstrap': () => ({ ...bootstrap, settings: { 'ui.landingPage': 'queue' }, session: loginResult.session })
    })

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/" element={<div>dashboard</div>} />
          <Route path="/queue" element={<div>queue screen</div>} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    )

    /* The Field wrapper does not link its label, so the inputs are addressed by their order on screen. */
    const inputs = await screen.findAllByRole('textbox')
    await userEvent.type(inputs[0]!, 'admin')
    await userEvent.type(document.querySelector('input[type="password"]')!, 'CorrectHorse1!')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/queue'))
    expect(screen.getByText('queue screen')).toBeInTheDocument()
  })
})
