import { z } from 'zod'
import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, conflictError, notFoundError, validationError } from '@shared/errors'
import { hashPassword, validatePasswordStrength, DEFAULT_POLICY } from '../../auth/password'
import { getNumberSetting } from '../settings/service'
import type { zUserInput } from '@shared/contracts'

export type UserInput = z.infer<typeof zUserInput>

export interface UserRecord {
  id: number
  username: string
  fullName: string
  phone: string | null
  roleId: number
  roleName: string
  roleCode: string
  staffId: number | null
  staffName: string | null
  dentistId: number | null
  isActive: boolean
  isLocked: boolean
  mustChangePassword: boolean
  lastLoginAt: number | null
  createdAt: number
  failedAttempts: number
}

interface UserRow {
  id: number
  username: string
  full_name: string
  phone: string | null
  role_id: number
  role_name: string
  role_code: string
  staff_id: number | null
  staff_name: string | null
  dentist_id: number | null
  is_active: number
  locked_until: number | null
  must_change_password: number
  last_login_at: number | null
  created_at: number
  failed_attempts: number
}

const USER_SELECT = `
  SELECT u.id, u.username, u.full_name, u.phone, u.role_id, r.name AS role_name, r.code AS role_code,
         u.staff_id, s.full_name AS staff_name, u.dentist_id, u.is_active, u.locked_until,
         u.must_change_password, u.last_login_at, u.created_at, u.failed_attempts
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN staff s ON s.id = u.staff_id
   WHERE u.is_deleted = 0`

function mapUser(row: UserRow, now: number): UserRecord {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    phone: row.phone,
    roleId: row.role_id,
    roleName: row.role_name,
    roleCode: row.role_code,
    staffId: row.staff_id,
    staffName: row.staff_name,
    dentistId: row.dentist_id,
    isActive: row.is_active === 1,
    isLocked: Boolean(row.locked_until && row.locked_until > now),
    mustChangePassword: row.must_change_password === 1,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    failedAttempts: row.failed_attempts
  }
}

export function listUsers(ctx: ServiceContext, filter: { search?: string, includeInactive?: boolean } = {}): UserRecord[] {
  assertPermission(ctx, 'users.view')
  const conditions = ['1 = 1']
  const params: Record<string, unknown> = {}
  if (filter.search) {
    conditions.push("(u.username LIKE @search OR u.full_name LIKE @search)")
    params.search = `%${filter.search.replace(/[%_]/g, '')}%`
  }
  if (filter.includeInactive === false) conditions.push('u.is_active = 1')
  const rows = ctx.db
    .prepare(`${USER_SELECT} AND ${conditions.join(' AND ')} ORDER BY u.is_active DESC, u.full_name`)
    .all(params) as UserRow[]
  const now = ctx.now()
  return rows.map((row) => mapUser(row, now))
}

export function getUser(ctx: ServiceContext, id: number): UserRecord {
  assertPermission(ctx, 'users.view')
  const row = ctx.db.prepare(`${USER_SELECT} AND u.id = ?`).get(id) as UserRow | undefined
  if (!row) throw notFoundError('user', id)
  return mapUser(row, ctx.now())
}

function assertNotLastOwner(ctx: ServiceContext, userId: number, action: string): void {
  const target = ctx.db
    .prepare("SELECT u.id, r.code FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ? AND u.is_deleted = 0")
    .get(userId) as { id: number, code: string } | undefined
  if (!target) throw notFoundError('user', userId)
  if (target.code !== 'owner') return
  const owners = ctx.db
    .prepare("SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id WHERE r.code = 'owner' AND u.is_active = 1 AND u.is_deleted = 0")
    .get() as { count: number }
  if (owners.count <= 1) throw conflictError(`The last active owner account cannot be ${action}. Create or activate another owner first.`)
}

export function saveUser(ctx: ServiceContext, input: UserInput): UserRecord {
  assertPermission(ctx, 'users.manage')
  const now = ctx.now()
  const errors: Record<string, string> = {}
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(input.username)) errors.username = 'Use 3–32 characters: letters, numbers, dot, dash or underscore.'
  const role = ctx.db.prepare('SELECT id, is_active FROM roles WHERE id = ?').get(input.roleId) as { id: number, is_active: number } | undefined
  if (!role) errors.roleId = 'Choose a role for this user.'
  else if (role.is_active !== 1) errors.roleId = 'That role is inactive. Activate it first.'
  const duplicate = ctx.db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE AND id <> ? AND is_deleted = 0')
    .get(input.username, input.id ?? 0) as { id: number } | undefined
  if (duplicate) errors.username = 'That username is already in use.'
  if (input.dentistId) {
    const dentist = ctx.db.prepare('SELECT id FROM dentists WHERE id = ? AND is_deleted = 0').get(input.dentistId) as { id: number } | undefined
    if (!dentist) errors.dentistId = 'The selected dentist no longer exists.'
  }
  if (!input.id && !input.password) errors.password = 'Set an initial password for the new user.'
  if (input.password) {
    const problems = validatePasswordStrength(input.password, { ...DEFAULT_POLICY, minLength: getNumberSetting(ctx, 'security.passwordMinLength') })
    if (problems.length > 0) errors.password = problems.join(' ')
  }
  if (Object.keys(errors).length > 0) throw new AppError('E_VALIDATION', 'Please correct the highlighted user details.', { fieldErrors: errors })

  const run = ctx.db.transaction(() => {
    let userId = input.id ?? 0
    if (userId) {
      ctx.db
        .prepare(
          `UPDATE users SET username = @username, full_name = @fullName, phone = @phone, role_id = @roleId,
             staff_id = @staffId, dentist_id = @dentistId, is_active = @isActive, updated_at = @now,
             must_change_password = @mustChange
           WHERE id = @id`
        )
        .run({
          id: userId,
          username: input.username,
          fullName: input.fullName,
          phone: input.phone ?? null,
          roleId: input.roleId,
          staffId: input.staffId ?? null,
          dentistId: input.dentistId ?? null,
          isActive: input.isActive ? 1 : 0,
          mustChange: input.requirePasswordChange ? 1 : 0,
          now
        })
      if (input.password) {
        ctx.db
          .prepare('UPDATE users SET password_hash = ?, password_updated_at = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
          .run(hashPassword(input.password), now, now, userId)
      }
    } else {
      const result = ctx.db
        .prepare(
          `INSERT INTO users (username, password_hash, password_algo, password_updated_at, must_change_password,
             staff_id, dentist_id, role_id, full_name, phone, is_active, created_at, updated_at)
           VALUES (@username, @hash, 'scrypt', @now, @mustChange, @staffId, @dentistId, @roleId, @fullName, @phone, @isActive, @now, @now)`
        )
        .run({
          username: input.username,
          hash: hashPassword(input.password!),
          now,
          mustChange: input.requirePasswordChange ? 1 : 0,
          staffId: input.staffId ?? null,
          dentistId: input.dentistId ?? null,
          roleId: input.roleId,
          fullName: input.fullName,
          phone: input.phone ?? null,
          isActive: input.isActive ? 1 : 0
        })
      userId = Number(result.lastInsertRowid)
    }
    return userId
  })

  const userId = run()
  ctx.audit.write({
    module: 'users',
    action: input.id ? 'user.update' : 'user.create',
    entityType: 'user',
    entityId: userId,
    summary: `${input.id ? 'Updated' : 'Created'} user ${input.username}`,
    detail: { roleId: input.roleId, isActive: input.isActive }
  })
  return getUser(ctx, userId)
}

export function setUserActive(ctx: ServiceContext, id: number, isActive: boolean): UserRecord {
  assertPermission(ctx, 'users.manage')
  if (!isActive) assertNotLastOwner(ctx, id, 'deactivated')
  if (id === ctx.actor.userId && !isActive) throw validationError('You cannot deactivate the account you are signed in with.')
  ctx.db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, ctx.now(), id)
  ctx.audit.write({
    module: 'users',
    action: isActive ? 'user.activate' : 'user.deactivate',
    entityType: 'user',
    entityId: id,
    summary: `User ${isActive ? 'activated' : 'deactivated'}`
  })
  return getUser(ctx, id)
}

export function resetUserPassword(ctx: ServiceContext, id: number, newPassword: string, requireChange: boolean): void {
  assertPermission(ctx, 'users.manage')
  const problems = validatePasswordStrength(newPassword, { ...DEFAULT_POLICY, minLength: getNumberSetting(ctx, 'security.passwordMinLength') })
  if (problems.length > 0) throw new AppError('E_VALIDATION', 'The password does not meet the clinic security policy.', { fieldErrors: { newPassword: problems.join(' ') } })
  getUser(ctx, id)
  const now = ctx.now()
  ctx.db
    .prepare('UPDATE users SET password_hash = ?, password_updated_at = ?, must_change_password = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .run(hashPassword(newPassword), now, requireChange ? 1 : 0, now, id)
  ctx.audit.write({ module: 'users', action: 'user.password_reset', entityType: 'user', entityId: id, summary: `Password reset for user #${id}` })
}

export function unlockUser(ctx: ServiceContext, id: number): UserRecord {
  assertPermission(ctx, 'users.manage')
  ctx.db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(ctx.now(), id)
  ctx.audit.write({ module: 'users', action: 'user.unlock', entityType: 'user', entityId: id, summary: `Temporary lock cleared for user #${id}` })
  return getUser(ctx, id)
}

export function deleteUser(ctx: ServiceContext, id: number, confirmation: string): void {
  assertPermission(ctx, 'users.manage')
  if (id === ctx.actor.userId) throw validationError('You cannot delete the account you are signed in with.')
  assertNotLastOwner(ctx, id, 'deleted')
  const user = getUser(ctx, id)
  if (confirmation.trim() !== user.username) {
    throw validationError('Type the username exactly to confirm deletion.', { confirmation: `Type “${user.username}” to confirm.` })
  }
  ctx.db.prepare('UPDATE users SET is_deleted = 1, is_active = 0, updated_at = ? WHERE id = ?').run(ctx.now(), id)
  ctx.audit.write({ module: 'users', action: 'user.delete', entityType: 'user', entityId: id, summary: `Deleted user ${user.username}`, detail: { confirmation: true } })
}

export function loginHistory(ctx: ServiceContext, userId: number | undefined, limit: number): Array<{ id: number, username: string, at: number, success: boolean, reason: string | null }> {
  assertPermission(ctx, 'users.view')
  const rows = userId
    ? (ctx.db
        .prepare(
          `SELECT la.id, la.username, la.at, la.success, la.reason FROM login_attempts la
             JOIN users u ON u.username = la.username COLLATE NOCASE WHERE u.id = ? ORDER BY la.at DESC LIMIT ?`
        )
        .all(userId, limit) as Array<{ id: number, username: string, at: number, success: number, reason: string | null }>)
    : (ctx.db.prepare('SELECT id, username, at, success, reason FROM login_attempts ORDER BY at DESC LIMIT ?').all(limit) as Array<{
        id: number
        username: string
        at: number
        success: number
        reason: string | null
      }>)
  return rows.map((row) => ({ id: row.id, username: row.username, at: row.at, success: row.success === 1, reason: row.reason }))
}
