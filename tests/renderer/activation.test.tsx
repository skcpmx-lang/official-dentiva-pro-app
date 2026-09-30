import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ActivationScreen } from '../../src/renderer/src/features/auth/ActivationScreen'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { emitEvent, mockChannels } from './setup'
import type { ActivationState, BootstrapResult } from '../../src/renderer/src/lib/types'

const activationState: ActivationState = {
  activated: false,
  activatedAt: null,
  attempts: 1,
  lastAttemptAt: null,
  cooldownRemainingMs: 0,
  verifierIntact: true,
  codeHint: { min: 8, max: 32 }
}

const bootstrapOf = (stage: BootstrapResult['stage']): BootstrapResult => ({
  stage,
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
    printersAvailable: false
  },
  clinic: null,
  activation: { ...activationState, activated: true, activatedAt: 1_700_000_000_000 },
  setup: { activated: true, needsSetup: true, hasClinic: false, dentistCount: 0, hasAdministrator: false, adminUsername: null },
  maintenanceMode: false,
  settings: {},
  session: null
})

function renderActivation(): void {
  render(
    <MemoryRouter initialEntries={['/activation']}>
      <Routes>
        <Route path="/activation" element={<ActivationScreen />} />
        <Route path="/setup" element={<div>setup screen</div>} />
        <Route path="/login" element={<div>login screen</div>} />
        <Route path="/" element={<div>workspace</div>} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ActivationScreen', () => {
  it('verifies the code in the main process and moves to setup when the licence is accepted', async () => {
    useAppStore.setState({ activation: activationState, ready: true })
    mockChannels({
      'activation.submit': () => ({ activated: true as const, activatedAt: 1_700_000_000_000 }),
      'app.bootstrap': () => bootstrapOf('setup')
    })

    renderActivation()
    const input = screen.getByLabelText(/activation code/i)
    await userEvent.type(input, '1516-5919-3501-5165')
    await userEvent.click(screen.getByRole('button', { name: /activate/i }))

    await waitFor(() => expect(screen.getByText('setup screen')).toBeInTheDocument())
    expect(useAppStore.getState().activation?.activated).toBe(true)
  })

  it('shows the service error message and keeps the operator on the activation screen when the code is rejected', async () => {
    useAppStore.setState({ activation: activationState, ready: true })
    mockChannels({
      'activation.submit': () => {
        throw Object.assign(new Error('That activation code is not valid for this licence.'), {})
      },
      'activation.state': () => ({ ...activationState, attempts: 2, cooldownRemainingMs: 30_000 })
    })

    renderActivation()
    await userEvent.type(screen.getByLabelText(/activation code/i), '0000-0000-0000-0000')
    await userEvent.click(screen.getByRole('button', { name: /activate/i }))

    await waitFor(() => expect(screen.getByText(/not valid for this licence/i)).toBeInTheDocument())
    expect(screen.queryByText('setup screen')).not.toBeInTheDocument()
    expect(useAppStore.getState().activation?.attempts).toBe(2)
  })

  it('rejects an empty code before contacting the main process', async () => {
    useAppStore.setState({ activation: activationState, ready: true })
    mockChannels({})
    renderActivation()
    await userEvent.click(screen.getByRole('button', { name: /activate/i }))
    await waitFor(() => expect(screen.getByText(/enter the activation code/i)).toBeInTheDocument())
  })

  it('propagates a session-ended event to subscribers of the preload bridge', async () => {
    let seen: { reason: string } | null = null
    const unsubscribe = window.dentiva.on('session:ended', (payload) => {
      seen = payload
    })
    emitEvent('session:ended', { reason: 'logout' })
    unsubscribe()
    expect(seen).toEqual({ reason: 'logout' })
  })
})
