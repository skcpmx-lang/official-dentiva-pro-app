/**
 * Startup state.
 *
 * When the clinic database cannot be opened the application still starts and shows a window — the
 * recovery screen. The router cannot exist without a database, so `app.startupState` is answered before
 * the router is consulted, and the renderer uses it to tell "still starting" apart from "in recovery"
 * and to show the operator what actually went wrong in plain words.
 *
 * The reason stored here is written for the operator, not for the log: it never contains a stack trace,
 * a SQL statement or a file path from the clinic's own records.
 */

export type StartupMode = 'starting' | 'recovery' | 'ready'

export interface StartupState {
  mode: StartupMode
  reason: string | null
}

let mode: StartupMode = 'starting'
let reason: string | null = null

export function markStarting(): void {
  mode = 'starting'
  reason = null
}

export function markReady(): void {
  mode = 'ready'
  reason = null
}

export function markRecovery(message: string): void {
  mode = 'recovery'
  reason = message
}

export function startupState(): StartupState {
  return { mode, reason }
}

/** Test seam: the state is process-wide, so a suite has to be able to put it back. */
export function resetStartupState(): void {
  markStarting()
}
