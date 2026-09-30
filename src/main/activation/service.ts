import { scryptSync, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/connection'
import type { ServiceContext } from '../context'
import { AppError } from '@shared/errors'
import { checkActivationCode, verifierFingerprint, verifierTableIsIntact, deriveCodeKey, normalizeActivationInput } from './verifier'

/**
 * Activation state + verification with attempt throttling and tamper detection.
 *
 * `is_valid = 1` is only ever written by a successful verification, and every start re-checks that the
 * stored fingerprint still matches the verifier derived from the bundle. Editing `license_state` by
 * hand therefore returns the application to the activation screen instead of unlocking it.
 */

const MAX_ATTEMPTS_BEFORE_DELAY = 3
const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5
const COOLDOWN_MS = 15 * 60 * 1000
const DELAY_STEP_MS = 1500

export interface ActivationState {
  activated: boolean
  activatedAt: number | null
  attempts: number
  lastAttemptAt: number | null
  /** Milliseconds the user must wait before another attempt (0 when attempts are allowed now). */
  cooldownRemainingMs: number
  /** Diagnostic flag surfaced in About: the embedded verifier table decoded successfully. */
  verifierIntact: boolean
}

interface LicenseRow {
  activated_at: number | null
  verifier_fingerprint: string | null
  machine_id: string | null
  activated_by: string | null
  attempts: number
  last_attempt_at: number | null
  is_valid: number
}

function readRow(db: Db): LicenseRow {
  const row = db
    .prepare('SELECT activated_at, verifier_fingerprint, machine_id, activated_by, attempts, last_attempt_at, is_valid FROM license_state WHERE id = 1')
    .get() as LicenseRow | undefined
  if (!row) {
    db.prepare('INSERT INTO license_state (id, attempts, is_valid) VALUES (1, 0, 0)').run()
    return { activated_at: null, verifier_fingerprint: null, machine_id: null, activated_by: null, attempts: 0, last_attempt_at: null, is_valid: 0 }
  }
  return row
}

/**
 * When the application runs from source (`npm run dev`, Playwright E2E) the accepted code may be
 * supplied through `DENTIVA_ACTIVATION_CODE` so that automated acceptance runs and developers never
 * need the production verifier embedded anywhere else. Packaged builds ignore this path entirely.
 */
function environmentVerifier(ctx: ServiceContext): Buffer | null {
  if (!ctx.host.isDevelopment()) return null
  const code = process.env.DENTIVA_ACTIVATION_CODE
  if (!code) return null
  try {
    return deriveCodeKey(normalizeActivationInput(code))
  } catch {
    return null
  }
}

export function getActivationState(ctx: ServiceContext): ActivationState {
  const row = readRow(ctx.db)
  const now = ctx.now()
  const fingerprintOk = row.verifier_fingerprint === verifierFingerprint()
  const attempts = row.attempts
  let cooldownRemainingMs = 0
  if (row.last_attempt_at && attempts >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
    cooldownRemainingMs = Math.max(0, row.last_attempt_at + COOLDOWN_MS - now)
  }
  return {
    activated: row.is_valid === 1 && fingerprintOk && row.activated_at !== null,
    activatedAt: row.activated_at,
    attempts,
    lastAttemptAt: row.last_attempt_at,
    cooldownRemainingMs,
    verifierIntact: verifierTableIsIntact()
  }
}

export function isActivated(db: Db): boolean {
  const row = readRow(db)
  return row.is_valid === 1 && row.verifier_fingerprint === verifierFingerprint() && row.activated_at !== null
}

export interface ActivateResult {
  activated: true
  activatedAt: number
  /** Delay applied before answering, to slow automated guessing. */
  delayMs: number
}

/**
 * Verify and persist activation. Throws `E_LICENSE` for an incorrect code (never revealing how close
 * the attempt was) and `E_RATE_LIMIT` while the cooldown after repeated failures is active.
 */
export function activate(ctx: ServiceContext, rawCode: string): ActivateResult {
  const db = ctx.db
  const now = ctx.now()
  const row = readRow(db)

  if (row.last_attempt_at && row.attempts >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
    const remaining = row.last_attempt_at + COOLDOWN_MS - now
    if (remaining > 0) {
      throw new AppError('E_RATE_LIMIT', `Too many activation attempts. Please try again in ${Math.ceil(remaining / 60000)} minute(s).`)
    }
  }

  const code = normalizeActivationInput(rawCode)
  if (code.length === 0) throw new AppError('E_VALIDATION', 'Please enter the activation code printed on your licence card.')

  const envVerifier = environmentVerifier(ctx)
  let ok: boolean
  let fingerprint: string
  if (envVerifier) {
    const derived = deriveCodeKey(code)
    ok = timingSafeEqual(derived, envVerifier)
    fingerprint = verifierFingerprint()
  } else {
    const result = checkActivationCode(code)
    ok = result.ok
    fingerprint = result.fingerprint
  }

  const delayMs = row.attempts >= MAX_ATTEMPTS_BEFORE_DELAY ? Math.min(row.attempts * DELAY_STEP_MS, 6000) : 0

  if (!ok) {
    db.prepare('UPDATE license_state SET attempts = attempts + 1, last_attempt_at = ?, is_valid = 0 WHERE id = 1').run(now)
    ctx.audit.write({
      module: 'activation',
      action: 'activate.failure',
      summary: 'Activation rejected — invalid code',
      result: 'failure',
      detail: { attempts: row.attempts + 1, machine: ctx.host.machine.machineId }
    })
    throw new AppError('E_LICENSE', 'That activation code is not valid. Please check the code and try again.')
  }

  db.prepare(
    `UPDATE license_state
        SET activated_at = ?, verifier_fingerprint = ?, machine_id = ?, activated_by = ?, attempts = 0, last_attempt_at = ?, is_valid = 1
      WHERE id = 1`
  ).run(now, fingerprint, ctx.host.machine.machineId, 'clinic-administrator', now)

  ctx.audit.write({
    module: 'activation',
    action: 'activate.success',
    summary: 'Product activated on this computer',
    detail: { machine: ctx.host.machine.machineId }
  })

  return { activated: true, activatedAt: now, delayMs }
}

/**
 * Startup integrity check: if the persisted fingerprint no longer matches the verifier derived from the
 * running bundle, the licence is invalidated (a patched or partially updated installation must not
 * silently keep working).
 */
export function verifyActivationIntegrity(db: Db): { ok: boolean, invalidated: boolean } {
  if (!verifierTableIsIntact()) return { ok: false, invalidated: false }
  const row = readRow(db)
  if (row.is_valid !== 1) return { ok: false, invalidated: false }
  if (row.verifier_fingerprint !== verifierFingerprint()) {
    db.prepare('UPDATE license_state SET is_valid = 0, activated_at = NULL WHERE id = 1').run()
    return { ok: false, invalidated: true }
  }
  return { ok: true, invalidated: false }
}

/** Support utility: seconds the installed build accepts as the minimum code length (no secret leaked). */
export const ACTIVATION_CODE_LENGTH_HINT = { min: 8, max: 64 }
