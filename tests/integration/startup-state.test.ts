import { describe, expect, it } from 'vitest'
import { createHarness } from './helpers'
import { createSystemHandlers } from '@main/ipc/handlers/system'
import type { HandlerDeps } from '@main/ipc/handlers/system'
import { markReady, markRecovery, markStarting, resetStartupState, startupState } from '@main/startup/state'

/**
 * Recovery mode.
 *
 * When the clinic database cannot be opened the application still starts and shows a window. The state
 * module is what the recovery screen reads, and `app.startupState` is answered before the router is
 * consulted — a channel that needs no database, because it exists precisely for the case where there is
 * none. This suite pins the states and the handler the renderer calls.
 */

function stubDeps(): HandlerDeps {
  return {
    db: {} as HandlerDeps['db'],
    host: {} as HandlerDeps['host'],
    sessions: {} as HandlerDeps['sessions'],
    invalidateActor: () => undefined,
    broadcast: () => undefined,
    refreshAutoLock: () => undefined,
    isMaintenanceMode: () => false,
    setMaintenanceMode: () => undefined,
    relaunch: () => undefined,
    currentDb: () => null,
    closeDatabase: () => undefined,
    reopenDatabase: () => true,
    inspectDatabase: () => ({ ok: true, problems: [], counts: {} })
  }
}

describe('startup state', () => {
  it('moves from starting to ready, and to recovery with a reason meant for the operator', () => {
    resetStartupState()
    expect(startupState()).toEqual({ mode: 'starting', reason: null })

    markReady()
    expect(startupState()).toEqual({ mode: 'ready', reason: null })

    markRecovery('The clinic database could not be opened. Your data has not been changed.')
    expect(startupState().mode).toBe('recovery')
    expect(startupState().reason).toMatch(/has not been changed/)

    /* A later successful start clears the reason rather than leaving a stale message on screen. */
    markReady()
    expect(startupState()).toEqual({ mode: 'ready', reason: null })
    markStarting()
    resetStartupState()
  })

  it('is served by the system handler the renderer calls during start-up', () => {
    resetStartupState()
    const harness = createHarness()
    try {
      const handlers = createSystemHandlers(stubDeps())
      const handler = handlers['app.startupState']!
      const ctx = harness.ctx()

      expect(handler(ctx as never, {})).toEqual({ mode: 'starting', reason: null })

      markRecovery('The clinic database could not be opened.')
      expect(handler(ctx as never, {})).toEqual({ mode: 'recovery', reason: 'The clinic database could not be opened.' })
    } finally {
      harness.cleanup()
      resetStartupState()
    }
  })
})
