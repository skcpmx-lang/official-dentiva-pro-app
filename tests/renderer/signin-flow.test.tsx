import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginScreen } from '../../src/renderer/src/features/auth/LoginScreen'
import { AppShell } from '../../src/renderer/src/components/shell/AppShell'
import { ConfirmDialogHost, Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { createHarness, type TestHarness } from '../integration/helpers'
import { createRouterHarness, type RouterHarness } from '../integration/routerHarness'
import { mockFallbackChannel } from './setup'
import {
  ADMIN,
  E2E_ACTIVATION_CODE,
  administratorStepPayload,
  clinicStepPayload,
  dentistStepPayload,
  preferencesStepPayload,
  setupCompletePayload
} from '../e2e/support/scenario'

/**
 * Sign-in, against the real main process.
 *
 * Every other renderer test answers the bridge by hand, and every integration test calls the services
 * directly — so nothing exercised the hop the packaged application makes when the operator presses
 * *Sign in*: the screen asks the router for `auth.login`, applies the bootstrap payload it gets back and
 * navigates. Here the bridge is a pass-through to the production router over a real database, so what
 * this test proves is exactly what the end-to-end workflows were failing on: the workspace is reached,
 * and the session the shell reads is the session the main process created.
 */

let harness: TestHarness
let router: RouterHarness

beforeAll(async () => {
  harness = createHarness()
  router = createRouterHarness(harness)
  process.env.DENTIVA_ACTIVATION_CODE = E2E_ACTIVATION_CODE

  /* A clinic set up the way the end-to-end workflows set one up. */
  await router.call('activation.submit', { code: E2E_ACTIVATION_CODE })
  await router.call('setup.clinic', clinicStepPayload())
  await router.call('setup.dentists', dentistStepPayload())
  await router.call('setup.administrator', administratorStepPayload())
  await router.call('setup.preferences', preferencesStepPayload())
  await router.call('setup.complete', setupCompletePayload())

})

/**
 * The interface talks to the same router the packaged application uses. A refusal is thrown the way the
 * real bridge throws it — an error carrying the application's own code and message — so screens that
 * catch errors behave exactly as they do in the installed application.
 */
const passthrough = async (channel: string, payload: unknown): Promise<unknown> => {
  const envelope = await router.router.handle(7, channel, payload)
  if (!envelope.ok) {
    const error = new Error(`${envelope.error.message}`) as Error & { code?: string }
    error.code = envelope.error.code
    throw error
  }
  return envelope.data
}

beforeEach(() => {
  // `resetBridge` runs between tests, so the pass-through to the real main process is reinstalled here.
  mockFallbackChannel(passthrough)
  useAppStore.setState({ session: null, clinic: null, stage: 'activation', locked: false, settings: {} })
})

afterAll(() => {
  delete process.env.DENTIVA_ACTIVATION_CODE
  mockFallbackChannel(null)
  harness.cleanup()
})

describe('signing in from the sign-in screen', () => {
  it('reaches the workspace and leaves the shell with the session the main process made', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/" element={<div>workspace reached</div>} />
          {/* The wizard is where the application goes when setup is still pending. */}
          <Route path="/setup" element={<div>setup pending</div>} />
          <Route path="/account/password" element={<div>password change required</div>} />
        </Routes>
      </MemoryRouter>
    )

    /* The screen offers the remembered username, exactly as the installed application does. */
    const username = document.querySelector('#username') as HTMLInputElement
    const password = document.querySelector('#password') as HTMLInputElement
    await waitFor(() => expect(username.value).toBe(ADMIN.username))
    await user.clear(username)
    await user.type(username, ADMIN.username)
    await user.type(password, ADMIN.password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByText('workspace reached')).toBeInTheDocument(), { timeout: 15_000 })

    /* The session the shell renders from is the one the main process created, with its permissions. */
    const session = useAppStore.getState().session
    expect(session?.username).toBe(ADMIN.username)
    expect(session?.permissions).toContain('patients.view')
    expect(useAppStore.getState().stage).toBe('ready')
    expect(useAppStore.getState().clinic?.name).toBe('Tangail Dental Care')
  })

  it('refuses a wrong password and says so, without leaving the screen', async () => {
    const user = userEvent.setup()

    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/" element={<div>workspace reached</div>} />
        </Routes>
      </MemoryRouter>
    )

    const username = document.querySelector('#username') as HTMLInputElement
    await waitFor(() => expect(username.value).toBe(ADMIN.username))
    await user.clear(username)
    await user.type(username, ADMIN.username)
    await user.type(document.querySelector('#password') as HTMLInputElement, 'WrongPassword#1')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 15_000 })
    expect(screen.getByRole('alert').textContent ?? '').toContain('username or password')
    expect(useAppStore.getState().session).toBeNull()
    expect(screen.queryByText('workspace reached')).toBeNull()
  })
})

describe('signing out from the workspace', () => {
  it('ends the session through the account menu and the confirmation, and returns to the sign-in screen', async () => {
    const user = userEvent.setup()

    const login = await router.call<{ session: unknown, clinic: unknown }>('auth.login', {
      username: ADMIN.username,
      password: ADMIN.password
    })
    useAppStore.setState({
      session: login.session as never,
      clinic: login.clinic as never,
      stage: 'ready',
      locked: false
    })

    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<AppShell />} />
          <Route path="/login" element={<LoginScreen />} />
        </Routes>
        <ConfirmDialogHost />
        <Toaster />
      </MemoryRouter>
    )

    /* Signing out is deliberately two steps: the account menu, then a confirmation — a stray click must
       not end a shift in the middle of a record. */
    await user.click(await screen.findByRole('button', { name: 'User menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }))

    const confirm = await screen.findByRole('dialog', { name: 'Sign out of Dentiva Pro?' })
    await user.click(within(confirm).getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(document.querySelector('#username')).toBeTruthy(), { timeout: 10_000 })
    expect(useAppStore.getState().session).toBeNull()
    expect(useAppStore.getState().locked).toBe(false)

    /* And the session is really gone in the main process: the next call is refused, not served from a
       session the shell merely stopped rendering. */
    await expect(router.call('patients.list', { limit: 1, offset: 0 })).rejects.toThrow(/E_UNAUTHENTICATED/)
  })
})
