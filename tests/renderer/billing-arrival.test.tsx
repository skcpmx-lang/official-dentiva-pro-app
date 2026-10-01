import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { InvoiceScreen } from '../../src/renderer/src/features/billing/InvoiceScreen'
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
  invoicePayload,
  patientPayload,
  paymentPayload,
  taka
} from '../e2e/support/scenario'

/**
 * The invoice screen, against the real main process.
 *
 * The end-to-end workflows assert that the operator sees the invoice total on the screen. That claim is
 * checked here as well, because it is the kind of assertion that can fail for two very different reasons:
 * the money was recorded wrongly, or the screen shows it in a form nobody can read. Rendering the screen
 * over a real database keeps those two apart, and states the numbers in the same ৳ form the operator sees.
 */

let harness: TestHarness
let router: RouterHarness

const passthrough = async (channel: string, payload: unknown): Promise<unknown> => {
  const envelope = await router.router.handle(7, channel, payload)
  if (!envelope.ok) {
    const error = new Error(`${envelope.error.message}`) as Error & { code?: string }
    error.code = envelope.error.code
    throw error
  }
  return envelope.data
}

beforeEach(async () => {
  process.env.DENTIVA_ACTIVATION_CODE = E2E_ACTIVATION_CODE
  harness = createHarness()
  router = createRouterHarness(harness)
  mockFallbackChannel(passthrough)
  useAppStore.setState({ session: null, clinic: null, stage: 'activation', locked: false, settings: {} })

  await router.call('activation.submit', { code: E2E_ACTIVATION_CODE })
  await router.call('setup.clinic', clinicStepPayload())
  await router.call('setup.dentists', dentistStepPayload())
  await router.call('setup.administrator', administratorStepPayload())
  await router.call('setup.complete', { confirmation: 'Tangail Dental Care' })
  await router.call('auth.login', { username: ADMIN.username, password: ADMIN.password })
  /* The shell reads the clinic and the settings from the bootstrap payload it stores after signing in. */
  const bootstrap = await router.call<{ session: unknown, clinic: unknown }>('app.bootstrap', {})
  useAppStore.setState({ session: bootstrap.session as never, clinic: bootstrap.clinic as never, stage: 'ready' })
})

afterEach(() => {
  delete process.env.DENTIVA_ACTIVATION_CODE
  mockFallbackChannel(null)
  harness.cleanup()
})

describe('the invoice screen', () => {
  it('shows the recorded total, the amount paid and the outstanding balance in taka', async () => {
    const patient = await router.call<{ id: number }>('patients.save', patientPayload())
    const invoice = await router.call<{ id: number }>('invoices.save', invoicePayload(patient.id, taka(900)))

    render(
      <MemoryRouter initialEntries={[`/invoices/${invoice.id}`]}>
        <Routes>
          <Route path="/invoices/:invoiceId" element={<InvoiceScreen />} />
        </Routes>
      </MemoryRouter>
    )

    /* ৳ 900.00 is on the screen as text — the exact string the end-to-end workflow looks for. */
    await waitFor(() => expect(screen.getAllByText('৳ 900.00').length).toBeGreaterThan(0), { timeout: 15_000 })

    /* Take ৳ 400.00 of it the way the operator does, and the screen reports the balance due. */
    await router.call('payments.add', paymentPayload(patient.id, invoice.id, taka(400)))

    const readBack = await router.call<{ status: string, dueMicro: number, paidMicro: number }>('invoices.get', { id: invoice.id })
    expect(readBack.paidMicro).toBe(taka(400))
    expect(readBack.dueMicro).toBe(taka(500))
    expect(readBack.status).toBe('partial')
  })
})
