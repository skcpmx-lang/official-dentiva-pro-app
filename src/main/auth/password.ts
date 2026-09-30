import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing (scrypt).
 *
 * Stored format: `scrypt$N$r$p$saltHex$hashHex` — self-describing so the work factors can be raised in
 * a later build while existing hashes keep verifying. Plaintext passwords are never stored, logged,
 * returned over IPC or written to backups in any other form than this string.
 */

const SCHEMA = 'scrypt'
const DEFAULT_PARAMS = { N: 32768, r: 8, p: 1, keyLength: 64 }

export interface ScryptParams {
  N: number
  r: number
  p: number
  keyLength: number
}

export function hashPassword(password: string, params: ScryptParams = DEFAULT_PARAMS): string {
  validatePasswordInput(password)
  const salt = randomBytes(16)
  const derived = scryptSync(password, salt, params.keyLength, { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 })
  return `${SCHEMA}$${params.N}$${params.r}$${params.p}$${salt.toString('hex')}$${derived.toString('hex')}`
}

export interface VerifyResult {
  ok: boolean
  /** True when the stored hash uses weaker parameters and should be re-hashed on successful login. */
  needsRehash: boolean
}

export function verifyPassword(password: string, stored: string): VerifyResult {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== SCHEMA) return { ok: false, needsRehash: false }
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  const salt = Buffer.from(parts[4] ?? '', 'hex')
  const expected = Buffer.from(parts[5] ?? '', 'hex')
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || salt.length === 0 || expected.length === 0) {
    return { ok: false, needsRehash: false }
  }
  let derived: Buffer
  try {
    derived = scryptSync(password, salt, expected.length, { N, r, p, maxmem: 256 * 1024 * 1024 })
  } catch {
    return { ok: false, needsRehash: false }
  }
  const ok = derived.length === expected.length && timingSafeEqual(derived, expected)
  const needsRehash = ok && (N < DEFAULT_PARAMS.N || expected.length < DEFAULT_PARAMS.keyLength)
  return { ok, needsRehash }
}

export interface PasswordPolicy {
  minLength: number
  requireLetter?: boolean
  requireNumber?: boolean
  maxLength?: number
}

export const DEFAULT_POLICY: PasswordPolicy = { minLength: 8, requireLetter: true, requireNumber: true, maxLength: 128 }

/**
 * Validates a candidate password against the clinic policy. Returns a list of human-readable
 * problems (empty when the password is acceptable) so forms can show every issue at once.
 */
export function validatePasswordStrength(password: string, policy: PasswordPolicy = DEFAULT_POLICY): string[] {
  const problems: string[] = []
  if (password.length < policy.minLength) problems.push(`Use at least ${policy.minLength} characters.`)
  if (policy.maxLength && password.length > policy.maxLength) problems.push(`Use no more than ${policy.maxLength} characters.`)
  if (policy.requireLetter && !/[A-Za-z]/.test(password)) problems.push('Include at least one letter.')
  if (policy.requireNumber && !/\d/.test(password)) problems.push('Include at least one number.')
  if (/^\s|\s$/.test(password)) problems.push('Remove leading or trailing spaces.')
  if (/^(password|dentiva|admin|12345678)/i.test(password)) problems.push('Avoid common or product-related words.')
  return problems
}

function validatePasswordInput(password: string): void {
  if (typeof password !== 'string' || password.length === 0) throw new Error('Password is required')
  if (password.length > 256) throw new Error('Password is too long')
}
