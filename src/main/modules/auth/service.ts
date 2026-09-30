import type { Db } from '../../db/connection'
import type { HostServices } from '../../platform/types'
import type { AuditWriter } from '../../context'
import { AppError } from '@shared/errors'
import { expandRolePermissions, type Actor } from '@shared/permissions'
import { DEFAULT_POLICY, hashPassword, validatePasswordStrength, verifyPassword } from '../../auth/password'
import { deriveActor } from './actor'

export interface AuthUserRow {
  id: number
  username: string
  password_hash: string
  role_id: number
  full_name: string
  is_active: number
  is_deleted: number
  failed_attempts: number
  locked_until: number | null
  must_change_password: number
  password_updated_at: number
  staff_id: number | null
  dentist_id: number | null
  last_login_at: number | null
}

export interface LoginResult {
  actor: Actor
  mustChangePassword: boolean
  passwordExpired: boolean
}

export interface LoginDependencies {
  db: Db
  host: HostServices
  audit: AuditWriter
  now(): number
  /** Clinic security settings; injected so auth stays free of the settings service import cycle. */
  policy: {
    minPasswordLength: number
    passwordExpiryDays: number
    maxFailedAttempts: number
    lockoutMinutes: number
  }
}

function readUser(db: Db, username: string): AuthUserRow | undefined {
  return db
    .prepare(
      `SELECT id, username, password_hash, role_id, full_name, is_active, is_deleted, failed_attempts,
              locked_until, must_change_password, password_updated_at, staff_id, dentist_id, last_login_at
         FROM users WHERE username = ? COLLATE NOCASE`
    )
    .get(username) as AuthUserRow | undefined
}

/**
 * Authenticate a user. Written to be intentionally unhelpful to attackers: unknown usernames and wrong
 * passwords produce the same message and both cost a scrypt verification, failed attempts are counted
 * and lead to a temporary lockout, and every attempt is written to `login_attempts` + the audit trail.
 */
export function login(deps: LoginDependencies, username: string, password: string): LoginResult {
  const { db, host, audit, now, policy } = deps
  const at = now()
  const trimmedUsername = username.trim()

  const fail = (reason: string, message = 'The username or password is incorrect.'): never => {
    db.prepare('INSERT INTO login_attempts (username, at, success, reason, machine) VALUES (?, ?, 0, ?, ?)').run(
      trimmedUsername,
      at,
      reason,
      host.machine.machineId
    )
    audit.write({ module: 'auth', action: 'login.failure', summary: `Failed sign-in for "${trimmedUsername}"`, result: 'failure', detail: { reason, username: trimmedUsername } })
    throw new AppError('E_UNAUTHENTICATED', message)
  }

  if (!trimmedUsername || !password) throw new AppError('E_VALIDATION', 'Enter your username and password.')

  const user = readUser(db, trimmedUsername)
  if (!user || user.is_deleted === 1) {
    // Perform a dummy verification so response timing does not reveal whether the user exists.
    verifyPassword(password, `${'scrypt$65536$8$1$'}${'0'.repeat(32)}$${'0'.repeat(128)}`)
    fail('unknown-user')
  }
  const record = user!

  if (record.locked_until && record.locked_until > at) {
    const minutes = Math.ceil((record.locked_until - at) / 60000)
    audit.write({ module: 'auth', action: 'login.blocked', summary: `Sign-in blocked for "${trimmedUsername}" (temporarily locked)`, result: 'failure' })
    throw new AppError('E_RATE_LIMIT', `This account is temporarily locked after repeated failed attempts. Try again in ${minutes} minute(s).`)
  }

  if (record.is_active !== 1) {
    audit.write({ module: 'auth', action: 'login.disabled', summary: `Sign-in attempt on a disabled account "${trimmedUsername}"`, result: 'failure' })
    throw new AppError('E_UNAUTHENTICATED', 'This account has been disabled. Contact your administrator.')
  }

  const verification = verifyPassword(password, record.password_hash)
  if (!verification.ok) {
    const attempts = record.failed_attempts + 1
    const shouldLock = attempts >= policy.maxFailedAttempts
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(
      shouldLock ? 0 : attempts,
      shouldLock ? at + policy.lockoutMinutes * 60000 : null,
      record.id
    )
    fail(
      'bad-password',
      shouldLock
        ? `Too many failed attempts. This account is locked for ${policy.lockoutMinutes} minute(s).`
        : 'The username or password is incorrect.'
    )
  }

  // Successful sign-in: reset counters, optionally upgrade the hash, record the login.
  const updates: string[] = ['failed_attempts = 0', 'locked_until = NULL', 'last_login_at = ?']
  const params: unknown[] = [at]
  if (verification.needsRehash) {
    updates.push('password_hash = ?')
    params.push(hashPassword(password))
  }
  params.push(record.id)
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params)

  db.prepare('INSERT INTO login_attempts (username, at, success, reason, machine) VALUES (?, ?, 1, NULL, ?)').run(
    trimmedUsername,
    at,
    host.machine.machineId
  )

  const actor = deriveActor(db, record.id)
  const passwordExpired =
    policy.passwordExpiryDays > 0 && at - record.password_updated_at > policy.passwordExpiryDays * 86_400_000

  audit.write({
    module: 'auth',
    action: 'login.success',
    entityType: 'user',
    entityId: record.id,
    summary: `Signed in as ${actor.username} (${actor.roleCode})`
  })

  return { actor, mustChangePassword: record.must_change_password === 1 || passwordExpired, passwordExpired }
}

export interface PasswordPolicyInput {
  minPasswordLength: number
}

export function changeOwnPassword(
  deps: LoginDependencies,
  actor: Actor,
  input: { currentPassword: string, newPassword: string, confirmPassword: string }
): void {
  const { db, audit, now, policy } = deps
  if (input.newPassword !== input.confirmPassword) {
    throw new AppError('E_VALIDATION', 'The new password and confirmation do not match.', { fieldErrors: { confirmPassword: 'Passwords do not match.' } })
  }
  const row = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(actor.userId) as { id: number, password_hash: string } | undefined
  if (!row) throw new AppError('E_NOT_FOUND', 'Your user account could not be found.')
  if (!verifyPassword(input.currentPassword, row.password_hash).ok) {
    audit.write({ module: 'auth', action: 'password.change.failure', entityType: 'user', entityId: actor.userId, summary: 'Password change rejected — current password incorrect', result: 'failure' })
    throw new AppError('E_VALIDATION', 'Your current password is incorrect.', { fieldErrors: { currentPassword: 'Incorrect password.' } })
  }
  const problems = validatePasswordStrength(input.newPassword, { ...DEFAULT_POLICY, minLength: policy.minPasswordLength })
  if (problems.length > 0) {
    throw new AppError('E_VALIDATION', 'The new password does not meet the clinic security policy.', { fieldErrors: { newPassword: problems.join(' ') } })
  }
  if (verifyPassword(input.newPassword, row.password_hash).ok) {
    throw new AppError('E_VALIDATION', 'Choose a password different from your current one.', { fieldErrors: { newPassword: 'Password was reused.' } })
  }
  const at = now()
  db.prepare('UPDATE users SET password_hash = ?, password_updated_at = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(
    hashPassword(input.newPassword),
    at,
    at,
    actor.userId
  )
  audit.write({ module: 'auth', action: 'password.change', entityType: 'user', entityId: actor.userId, summary: `${actor.username} changed their password` })
}

export function listLoginAttempts(db: Db, limit = 100): Array<{ id: number, username: string, at: number, success: number, reason: string | null }> {
  return db
    .prepare('SELECT id, username, at, success, reason FROM login_attempts ORDER BY at DESC LIMIT ?')
    .all(limit) as Array<{ id: number, username: string, at: number, success: number, reason: string | null }>
}

/** Used by the setup wizard and by user administration to enforce the clinic password policy. */
export function validateNewPassword(password: string, minLength: number): void {
  const problems = validatePasswordStrength(password, { ...DEFAULT_POLICY, minLength })
  if (problems.length > 0) {
    throw new AppError('E_VALIDATION', 'The password does not meet the clinic security policy.', { fieldErrors: { password: problems.join(' ') } })
  }
}

export function rolePermissionCodes(db: Db, roleId: number): string[] {
  const rows = db.prepare('SELECT permission_code FROM role_permissions WHERE role_id = ?').all(roleId) as Array<{ permission_code: string }>
  if (rows.length === 0) {
    const role = db.prepare('SELECT code FROM roles WHERE id = ?').get(roleId) as { code: string } | undefined
    if (role) {
      // Defensive fallback: an owner-style role must never end up with no permissions because of an
      // interrupted seed; the catalog is the authority.
      const ownerLike = ['owner', 'administrator'].includes(role.code)
      if (ownerLike) return expandRolePermissions({ permissions: '*' })
    }
  }
  return rows.map((row) => row.permission_code)
}
