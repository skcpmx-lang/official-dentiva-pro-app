import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SetupWizard } from '../../src/renderer/src/features/setup/SetupWizard'
import { ConfirmDialogHost } from '../../src/renderer/src/components/ui/overlay'
import { createHarness, type TestHarness } from '../integration/helpers'
import { createRouterHarness, type RouterHarness } from '../integration/routerHarness'
import { mockFallbackChannel } from './setup'
import { ADMIN, CLINIC, E2E_ACTIVATION_CODE, administratorStepPayload, clinicStepPayload, dentistStepPayload } from '../e2e/support/scenario'

/**
 * The setup wizard, end to end, against the real main process.
 *
 * Every step of the wizard writes to the database and then reloads the setup status. That reload used to
 * decide the current step again, so saving the preferences put the wizard back on the preferences step —
 * the review step, and with it the *Finish setup* button, could vanish before an operator ever saw it.
 * The end-to-end workflows timed out clicking that button; this test is the local reproduction, and it
 * carries the wizard through to the sign-in screen the way the installed application does it.
 */

let harness: TestHarness
let router: RouterHarness

/** The interface talks to the same router the packaged application uses; refusals arrive as errors. */
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
  process.env.DENTIVA_ACTIVATION_CODE = E2E_ACTIVATION_CODE
  /* Each test owns its installation: a wizard finishes the setup, and a clinic is set up once. */
  harness = createHarness()
  router = createRouterHarness(harness)
  mockFallbackChannel(passthrough)
})

afterEach(() => {
  delete process.env.DENTIVA_ACTIVATION_CODE
  mockFallbackChannel(null)
  harness.cleanup()
})

function renderWizard(): void {
  render(
    <MemoryRouter initialEntries={['/setup']}>
      <Routes>
        <Route path="/setup" element={<SetupWizard />} />
        <Route path="/login" element={<div>sign-in screen reached</div>} />
      </Routes>
      {/* The wizard confirms finishing setup through the application's own dialog host. */}
      <ConfirmDialogHost />
    </MemoryRouter>
  )
}

describe('finishing setup', () => {
  it('reaches the review step after the preferences and completes the clinic setup', async () => {
    const user = userEvent.setup()

    /* A clinic whose first three steps are already saved — the wizard resumes on the preferences step. */
    await router.call('activation.submit', { code: E2E_ACTIVATION_CODE })
    await router.call('setup.clinic', clinicStepPayload())
    await router.call('setup.dentists', dentistStepPayload())
    await router.call('setup.administrator', administratorStepPayload())

    renderWizard()

    /* 1 · the wizard resumes where the operator left off, showing everything saved so far. */
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save and review' })).toBeEnabled(), { timeout: 15_000 })

    /* 2 · saving the preferences moves to the review step, and the reload cannot pull it back. */
    await user.click(screen.getByRole('button', { name: 'Save and review' }))

    const finish = await screen.findByRole('button', { name: 'Finish setup' }, { timeout: 15_000 })
    expect(finish).toBeEnabled()
    /* The summary is what the operator reviews: the clinic, its dentist and the administrator. */
    expect(screen.getByText(CLINIC.name)).toBeInTheDocument()
    expect(screen.getByText(/Dr\. Ayesha Rahman/)).toBeInTheDocument()
    expect(screen.getByText(`${ADMIN.fullName} (${ADMIN.username})`)).toBeInTheDocument()

    /* 3 · the status reloads that follow must not take the review step away again. */
    await new Promise((resolve) => setTimeout(resolve, 400))
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeEnabled()

    /* 4 · finishing asks for the clinic name as the confirmation phrase. */
    await user.click(finish)
    const dialog = await screen.findByRole('dialog', { name: 'Finish setup and open Dentiva Pro?' })
    await user.type(within(dialog).getByLabelText('Confirmation phrase'), CLINIC.name)
    await user.click(within(dialog).getByRole('button', { name: 'Finish setup' }))

    /* 5 · setup is complete in the database, and the wizard hands over to the sign-in screen. */
    await waitFor(() => expect(screen.getByText('sign-in screen reached')).toBeInTheDocument(), { timeout: 15_000 })
    const status = await router.call<{ needsSetup: boolean, hasAdministrator: boolean }>('setup.status', {})
    expect(status.needsSetup).toBe(false)
    expect(status.hasAdministrator).toBe(true)
  })

  it('keeps the review step reachable when the operator steps back to the preferences', async () => {
    const user = userEvent.setup()

    /* The same installation, but nothing is finished yet. */
    await router.call('activation.submit', { code: E2E_ACTIVATION_CODE })
    await router.call('setup.clinic', clinicStepPayload())
    await router.call('setup.dentists', dentistStepPayload())
    await router.call('setup.administrator', administratorStepPayload())

    renderWizard()
    const save = await screen.findByRole('button', { name: 'Save and review' }, { timeout: 15_000 })
    await user.click(save)
    await screen.findByRole('button', { name: 'Finish setup' }, { timeout: 15_000 })

    /* Stepping back and forward again is part of an honest wizard: nothing is lost and nothing is forced. */
    await user.click(screen.getByRole('button', { name: 'Back' }))
    const backOnPreferences = await screen.findByRole('button', { name: 'Save and review' }, { timeout: 15_000 })
    await user.click(backOnPreferences)

    const finish = await screen.findByRole('button', { name: 'Finish setup' }, { timeout: 15_000 })
    expect(finish).toBeEnabled()

    /* The preferences the operator saved on the way are still the ones the clinic is running with. */
    const stored = await router.call<Record<string, string>>('setup.summary', {})
    expect(stored).toBeDefined()
    const settings = harness.database.db.prepare("SELECT value FROM settings WHERE key = 'practice.appointmentDuration'").get() as { value: string }
    expect(settings.value).toBe('30')
  })
})
