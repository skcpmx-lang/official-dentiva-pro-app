import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from '../../src/renderer/src/App'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { createHarness, type TestHarness } from '../integration/helpers'
import { createRouterHarness, type RouterHarness } from '../integration/routerHarness'
import { callLog, mockFallbackChannel } from './setup'
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
 * The whole interface, against the real main process.
 *
 * This is the end-to-end workflow's critical path with the window replaced by jsdom: the real `App`,
 * the real hash router, the real screens, and — behind the bridge — the production IPC router over a
 * real database. It exists because the packaged workflows kept failing on the hop from the sign-in
 * screen to the dashboard, where nothing in the sandbox could see them; here that hop is a local test,
 * and it says exactly which channel refused and what the screen showed.
 */

let harness: TestHarness
let router: RouterHarness

const passthrough = async (channel: string, payload: unknown): Promise<unknown> => {
  const envelope = await router.router.handle(7, channel, payload)
  if (!envelope.ok) {
    const error = new Error(envelope.error.message) as Error & { code?: string }
    error.code = envelope.error.code
    throw error
  }
  return envelope.data
}

beforeAll(async () => {
  harness = createHarness()
  router = createRouterHarness(harness)
  process.env.DENTIVA_ACTIVATION_CODE = E2E_ACTIVATION_CODE

  await router.call('activation.submit', { code: E2E_ACTIVATION_CODE })
  await router.call('setup.clinic', clinicStepPayload())
  await router.call('setup.dentists', dentistStepPayload())
  await router.call('setup.administrator', administratorStepPayload())
  await router.call('setup.preferences', preferencesStepPayload())
  await router.call('setup.complete', setupCompletePayload())
})

beforeEach(() => {
  mockFallbackChannel(passthrough)
  useAppStore.setState({ session: null, clinic: null, stage: 'login', locked: false, settings: {}, ready: false })
})

afterAll(() => {
  delete process.env.DENTIVA_ACTIVATION_CODE
  mockFallbackChannel(null)
  harness.cleanup()
})

describe('arriving in the workspace', () => {
  it('signs in on the real screens and shows the dashboard', async () => {
    const user = userEvent.setup()
    render(<App />)

    /* The application boots to the sign-in screen because a clinic with an administrator exists. */
    await waitFor(() => expect(document.querySelector('#username')).not.toBeNull(), { timeout: 15_000 })

    const username = document.querySelector('#username') as HTMLInputElement
    const password = document.querySelector('#password') as HTMLInputElement
    await waitFor(() => expect(username.value).toBe(ADMIN.username))
    await user.clear(username)
    await user.type(username, ADMIN.username)
    await user.type(password, ADMIN.password)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    /* The assertion the packaged workflows make: the dashboard is on screen. */
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Good day, welcome back' })).toBeInTheDocument(), {
      timeout: 20_000
    })

    expect(useAppStore.getState().session?.username).toBe(ADMIN.username)
    expect(useAppStore.getState().stage).toBe('ready')

    /* The shell really did read its own data through the router, not from a stub. */
    const dashboardCalls = callLog.filter((entry) => entry.channel === 'dashboard.summary')
    expect(dashboardCalls.length).toBeGreaterThan(0)
  })
})
