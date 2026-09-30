import { afterAll, describe, expect, it } from 'vitest'
import { createHarness } from './helpers'
import { IpcRouter, type RouterDependencies } from '@main/ipc/router'
import { createSystemHandlers, type HandlerDeps } from '@main/ipc/handlers/system'
import { createPracticeHandlers } from '@main/ipc/handlers/practice'
import { createPatientHandlers } from '@main/ipc/handlers/patients'
import { createClinicalHandlers } from '@main/ipc/handlers/clinical'
import { createSchedulingHandlers } from '@main/ipc/handlers/scheduling'
import { createBillingHandlers } from '@main/ipc/handlers/billing'
import { createInventoryHandlers } from '@main/ipc/handlers/inventory'
import { createAccountingHandlers } from '@main/ipc/handlers/accounting'
import { createPrintingHandlers } from '@main/ipc/handlers/printing'
import { createBackupHandlers } from '@main/ipc/handlers/backup'
import { createNotificationHandlers } from '@main/ipc/handlers/notifications'
import { createDashboardHandlers } from '@main/ipc/handlers/dashboard'
import { SessionManager } from '@main/session/sessionManager'

/**
 * The pre-session journey through the real router.
 *
 * Every other integration test calls a service directly, and the renderer tests mock the bridge — which
 * is exactly how a contract drift slipped through: `app.bootstrap` answered a clinic profile whose name
 * is empty before the setup wizard runs, the declared output schema demanded at least two characters,
 * and the router turned the mismatch into `E_INTERNAL`. A packaged install therefore failed on its first
 * screen; only an end-to-end run could see it.
 *
 * This test drives the same path a first-time operator takes — bootstrap → activation → setup wizard →
 * login → dashboard — through `IpcRouter.handle`, so every answer is validated against the same input
 * and output schemas the packaged application uses.
 */

const harness = createHarness()

const deps = {
  db: harness.database.db,
  host: harness.host,
  sessions: new SessionManager(),
  invalidateActor: () => undefined,
  broadcast: () => undefined,
  refreshAutoLock: () => undefined,
  isMaintenanceMode: () => false,
  setMaintenanceMode: () => undefined,
  relaunch: () => undefined,
  currentDb: () => harness.database.db,
  closeDatabase: () => undefined,
  reopenDatabase: () => true,
  inspectDatabase: () => ({ ok: true, problems: [], counts: {} })
} as unknown as HandlerDeps

const router = new IpcRouter(deps as unknown as RouterDependencies)
for (const map of [
  createSystemHandlers(deps),
  createPracticeHandlers(deps),
  createPatientHandlers(deps),
  createClinicalHandlers(deps),
  createSchedulingHandlers(deps),
  createBillingHandlers(deps),
  createInventoryHandlers(deps),
  createAccountingHandlers(deps),
  createPrintingHandlers(deps),
  createBackupHandlers(deps),
  createNotificationHandlers(deps),
  createDashboardHandlers()
]) {
  router.register(map)
}

const WINDOW = 7

/** Calls a channel and fails with the application's own error text when it is refused. */
async function call<T>(channel: string, input: unknown = {}): Promise<T> {
  const envelope = await router.handle(WINDOW, channel, input)
  if (!envelope.ok) {
    throw new Error(`${channel} → ${envelope.error?.code}: ${envelope.error?.message}`)
  }
  return envelope.data as T
}

afterAll(() => harness.cleanup())

describe('a brand new installation', () => {
  it('bootstraps, activates, is set up and signed into through the router', async () => {
    /* 1 · nothing is configured yet, and the answer still satisfies the declared contract. */
    const fresh = await call<{ stage: string, clinic: { name: string } | null, activation: { activated: boolean }, setup: { needsSetup: boolean } }>('app.bootstrap')
    expect(fresh.stage).toBe('activation')
    expect(fresh.activation.activated).toBe(false)
    expect(fresh.setup.needsSetup).toBe(true)

    const environment = await call<{ dataDirectory: string, build: { version: string } }>('app.environment')
    expect(environment.dataDirectory).toBe(harness.dataDir)
    expect(environment.build.version).toBe('1.0.0')

    /* 2 · activation through the development-only environment verifier. */
    process.env.DENTIVA_ACTIVATION_CODE = '0000000000000000'
    try {
      const activated = await call<{ activated: true }>('activation.submit', { code: '0000000000000000' })
      expect(activated.activated).toBe(true)
      await expect(call('activation.submit', { code: '0000000000000000' })).resolves.toBeDefined()
    } finally {
      delete process.env.DENTIVA_ACTIVATION_CODE
    }

    const afterActivation = await call<{ stage: string }>('app.bootstrap')
    expect(afterActivation.stage).toBe('setup')

    /* 3 · the setup wizard, step by step, exactly as the screen calls it. */
    await call('setup.clinic', {
      name: 'Tangail Dental Care',
      nameBn: 'টাঙ্গাইল ডেন্টাল কেয়ার',
      logoPath: null,
      address: 'Victoria Road, Tangail',
      addressBn: null,
      phone: '01711000000',
      altPhone: null,
      email: null,
      website: null,
      openingTime: '09:00',
      closingTime: '20:00',
      weeklyClosedDays: [5],
      footerMessage: null,
      invoiceFooter: null,
      prescriptionFooter: null,
      emergencyInstruction: null
    })
    await call('setup.dentists', {
      dentists: [
        {
          fullName: 'Dr. Ayesha Rahman',
          fullNameBn: 'ডা. আয়েশা রহমান',
          phone: null,
          email: null,
          registrationNo: 'BMDC-12345',
          signatureLabel: 'Consultant Dental Surgeon',
          color: null,
          isActive: true,
          sortOrder: 1,
          designations: ['BDS'],
          qualifications: [],
          schedules: []
        }
      ]
    })
    await call('setup.administrator', {
      fullName: 'Shohan Khan',
      username: 'admin.dentiva',
      password: 'Tangail#2026',
      confirmPassword: 'Tangail#2026',
      dentistId: null
    })
    await call('setup.preferences', { values: {} })
    await call('setup.complete', { confirmation: 'Tangail Dental Care' })

    const beforeLogin = await call<{ stage: string, setup: { needsSetup: boolean, hasClinic: boolean, dentistCount: number, hasAdministrator: boolean } }>('app.bootstrap')
    expect(beforeLogin.stage).toBe('login')
    expect(beforeLogin.setup).toMatchObject({ needsSetup: false, hasClinic: true, dentistCount: 1, hasAdministrator: true })

    /* 4 · sign in, and read the shell data the dashboard needs on the first paint. */
    const login = await call<{ session: { username: string, permissions: string[] }, mustChangePassword?: boolean }>('auth.login', {
      username: 'admin.dentiva',
      password: 'Tangail#2026'
    })
    expect(login.session.username).toBe('admin.dentiva')
    expect(login.session.permissions).toContain('patients.view')

    const signedIn = await call<{ stage: string, session: { username: string } | null }>('app.bootstrap')
    expect(signedIn.stage).toBe('ready')
    expect(signedIn.session?.username).toBe('admin.dentiva')

    const sessionState = await call<{ authenticated: boolean }>('session.state')
    expect(sessionState.authenticated).toBe(true)
  })

  it('answers the channels the first screen depends on without leaking anything', async () => {
    const dashboard = await call<{ range: { preset: string }, kpis: unknown[], queue: { waiting: number } }>('dashboard.summary')
    expect(Array.isArray(dashboard.kpis)).toBe(true)
    expect(typeof dashboard.queue.waiting).toBe('number')

    const preferences = await call<Record<string, string>>('preferences.get')
    expect(typeof preferences).toBe('object')

    const notifications = await call<{ items: unknown[] }>('notifications.list')
    expect(Array.isArray(notifications.items)).toBe(true)

    const search = await call<{ groups: unknown[] }>('search.global', { query: 'ra' })
    expect(Array.isArray(search.groups)).toBe(true)

    const catalog = await call<unknown[]>('reports.catalog')
    expect(catalog.length).toBeGreaterThan(0)

    const page = await call<{ items: unknown[], total: number }>('patients.list', { limit: 10, offset: 0 })
    expect(page.total).toBe(0)
  })

  it('answers a signed-in owner and refuses an unknown window', async () => {
    // The owner holds every permission, so the audit log is readable and the answer is a normal envelope.
    const envelope = await router.handle(WINDOW, 'audit.list', { limit: 5, offset: 0 })
    expect(envelope.ok).toBe(true)
    const anonymous = await router.handle(9999, 'patients.list', { limit: 5, offset: 0 })
    expect(anonymous.ok).toBe(false)
    if (anonymous.ok) throw new Error('an unauthenticated window must not read patients')
    expect(anonymous.error.code).toBe('E_UNAUTHENTICATED')
  })
})
