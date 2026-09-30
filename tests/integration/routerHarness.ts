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
import type { Envelope } from '@shared/errors'
import type { TestHarness } from './helpers'

/**
 * A real router over a real database.
 *
 * The service-level integration tests call services directly, and the renderer tests mock the bridge;
 * both miss the layer that actually broke in the packaged application — the channel contracts, which
 * validate every input and every output. These harnesses wire the production `IpcRouter` and every
 * handler factory to a scratch database, so a payload or a response that the contract rejects fails
 * here in seconds rather than in a Windows end-to-end run.
 */
export interface RouterHarness {
  router: IpcRouter
  sessions: SessionManager
  /** Calls a channel and fails with the application's own error text when it is refused. */
  call<T>(channel: string, input?: unknown): Promise<T>
  /** Calls a channel and returns the raw envelope, refusals included. */
  callRaw(channel: string, input?: unknown): Promise<Envelope<unknown>>
  /** Calls a channel from any window id — used to sign a second operator in on their own window. */
  handle(windowId: number, channel: string, input?: unknown): Promise<Envelope<unknown>>
  /** A second window with no session, for the refusal cases. */
  anonymousWindow: number
}

export function createRouterHarness(harness: TestHarness, windowId = 7): RouterHarness {
  const sessions = new SessionManager()
  const deps = {
    db: harness.database.db,
    host: harness.host,
    sessions,
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

  const callRaw = (channel: string, input: unknown = {}): Promise<Envelope<unknown>> => router.handle(windowId, channel, input)

  return {
    router,
    sessions,
    callRaw,
    handle: (targetWindow: number, channel: string, input: unknown = {}) => router.handle(targetWindow, channel, input),
    async call<T>(channel: string, input: unknown = {}): Promise<T> {
      const envelope = await callRaw(channel, input)
      if (!envelope.ok) {
        const detail = envelope.error.detail ? ` ${JSON.stringify(envelope.error.detail)}` : ''
        throw new Error(`${channel} → ${envelope.error.code}: ${envelope.error.message}${detail}`)
      }
      return envelope.data as T
    },
    anonymousWindow: 9999
  }
}
