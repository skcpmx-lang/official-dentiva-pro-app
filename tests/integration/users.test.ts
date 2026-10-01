import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import {
  deleteUser,
  getUser,
  listUsers,
  loginHistory,
  resetUserPassword,
  saveUser,
  setUserActive,
  unlockUser,
  type UserInput
} from '@main/modules/users/service'
import { listRoles, saveRole } from '@main/modules/roles/service'
import { saveStaff } from '@main/modules/staff/service'
import { verifyPassword } from '@main/auth/password'
import { AppError } from '@shared/errors'

/**
 * User account integration tests.
 *
 * Accounts are the clinic's front door, so these tests cover the guards that keep it locked when it should
 * be: passwords are stored only as scrypt hashes, weak passwords are refused, the last active owner can
 * never be removed or switched off, nobody can delete or deactivate the account they are signed in with,
 * and the whole surface is gated by users.view / users.manage.
 */

let harness: TestHarness

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.cleanup()
})

/** Runs a service call that is expected to fail and returns its field errors. */
function fieldErrors(run: () => unknown): Record<string, string> {
  try {
    run()
  } catch (error) {
    return (error as AppError).fieldErrors ?? {}
  }
  return {}
}

/** An actor that is not any of the users created by the test, so self-guards stay out of the way. */
function adminCtx(permissions?: string[]) {
  return harness.ctx(permissions, { userId: 9_001, username: 'tester' })
}

function ownerRoleId(): number {
  return listRoles(harness.ctx(), true).find((role) => role.code === 'owner')!.id
}

function receptionRoleId(): number {
  return listRoles(harness.ctx(), true).find((role) => role.code === 'receptionist')!.id
}

function userInput(overrides: Partial<UserInput> = {}): UserInput {
  return {
    id: null,
    username: 'rahima',
    fullName: 'Rahima Begum',
    phone: '01711002200',
    roleId: receptionRoleId(),
    staffId: null,
    dentistId: null,
    isActive: true,
    password: 'Chamber2026!',
    requirePasswordChange: false,
    ...overrides
  } as UserInput
}

describe('user accounts', () => {
  it('stores an scrypt hash instead of the password and requires one for a new account', () => {
    const ctx = adminCtx()
    const created = saveUser(ctx, userInput())
    expect(created.username).toBe('rahima')
    expect(created.isActive).toBe(true)
    expect(created.roleCode).toBe('receptionist')
    expect(created.failedAttempts).toBe(0)

    const row = harness.database.db.prepare('SELECT password_hash, password_algo, must_change_password FROM users WHERE id = ?').get(created.id) as {
      password_hash: string
      password_algo: string
      must_change_password: number
    }
    expect(row.password_hash.startsWith('scrypt$')).toBe(true)
    expect(row.password_hash).not.toContain('Chamber2026!')
    expect(row.password_algo).toBe('scrypt')
    expect(verifyPassword('Chamber2026!', row.password_hash).ok).toBe(true)
    expect(verifyPassword('wrong-password', row.password_hash).ok).toBe(false)

    expect(() => saveUser(ctx, userInput({ username: 'nopassword', password: undefined }))).toThrow(AppError)
  })

  it('rejects duplicate usernames case-insensitively and unknown or inactive roles', () => {
    const ctx = adminCtx()
    saveUser(ctx, userInput())

    expect(fieldErrors(() => saveUser(ctx, userInput({ username: 'RAHIMA', fullName: 'Another person' }))).username).toMatch(/already in use/i)
    expect(fieldErrors(() => saveUser(ctx, userInput({ username: 'other', roleId: 999 }))).roleId).toBeTruthy()

    /* A role that has been switched off cannot be handed to anybody. */
    const reception = listRoles(ctx, true).find((role) => role.code === 'receptionist')!
    saveRole(adminCtx(['roles.manage', 'roles.view']), {
      id: reception.id,
      name: reception.name,
      code: reception.code,
      description: reception.description,
      isActive: false,
      maxDiscountBasisPoints: reception.maxDiscountBasisPoints,
      permissions: reception.permissions
    })
    expect(fieldErrors(() => saveUser(ctx, userInput({ username: 'newcomer' }))).roleId).toMatch(/inactive/i)
    expect(listUsers(ctx, {}).length).toBe(1)
  })

  it('enforces the clinic password policy with field errors', () => {
    const ctx = adminCtx()
    const passwordProblem = fieldErrors(() => saveUser(ctx, userInput({ password: 'password' }))).password ?? ''
    expect(passwordProblem).toMatch(/at least|number/i)
    expect(listUsers(ctx, {}).length).toBe(0)
  })

  it('never lets the last active owner be deactivated or deleted', () => {
    const ctx = adminCtx()
    const owner = saveUser(ctx, userInput({ username: 'shohan', roleId: ownerRoleId() }))

    expect(() => setUserActive(ctx, owner.id, false)).toThrow(/last active owner/i)
    expect(() => deleteUser(ctx, owner.id, owner.username)).toThrow(/last active owner/i)

    const second = saveUser(ctx, userInput({ username: 'second.owner', roleId: ownerRoleId() }))
    const deactivated = setUserActive(ctx, owner.id, false)
    expect(deactivated.isActive).toBe(false)

    /* With one active owner left, the guard applies to that one. */
    expect(() => setUserActive(ctx, second.id, false)).toThrow(/last active owner/i)
  })

  it('refuses to deactivate or delete the account in use', () => {
    const ctx = adminCtx()
    const created = saveUser(ctx, userInput())
    const self = harness.ctx(undefined, { userId: created.id, username: created.username })
    expect(() => setUserActive(self, created.id, false)).toThrow(/signed in/i)
    expect(() => deleteUser(self, created.id, created.username)).toThrow(/signed in/i)
  })

  it('resets passwords, clears locks and keeps a login trail', () => {
    const ctx = adminCtx()
    const created = saveUser(ctx, userInput())
    harness.database.db
      .prepare('UPDATE users SET failed_attempts = 4, locked_until = ? WHERE id = ?')
      .run(Date.now() + 60_000, created.id)

    expect(getUser(ctx, created.id).isLocked).toBe(true)
    unlockUser(ctx, created.id)
    expect(getUser(ctx, created.id).isLocked).toBe(false)

    resetUserPassword(ctx, created.id, 'NewChamber2026!', true)
    const row = harness.database.db.prepare('SELECT password_hash, must_change_password FROM users WHERE id = ?').get(created.id) as {
      password_hash: string
      must_change_password: number
    }
    expect(row.must_change_password).toBe(1)
    expect(verifyPassword('NewChamber2026!', row.password_hash).ok).toBe(true)
    expect(() => resetUserPassword(ctx, created.id, 'short1', true)).toThrow(AppError)

    const insert = harness.database.db.prepare('INSERT INTO login_attempts (username, at, success, reason) VALUES (?, ?, ?, ?)')
    insert.run('rahima', 1_700_000_000_000, 0, 'Wrong password')
    insert.run('rahima', 1_700_000_100_000, 1, null)

    const history = loginHistory(ctx, created.id, 10)
    expect(history).toHaveLength(2)
    expect(history[0]!.success).toBe(true)
    expect(history[0]!.reason).toBeNull()
    expect(history[1]!.success).toBe(false)
    expect(history[1]!.reason).toBe('Wrong password')
  })

  it('blocks deletion until the username is typed exactly and keeps the row afterwards', () => {
    const ctx = adminCtx()
    const created = saveUser(ctx, userInput())

    expect(() => deleteUser(ctx, created.id, 'something-else')).toThrow(/type the username/i)
    expect(() => deleteUser(ctx, created.id, created.username.toUpperCase())).toThrow(/type the username/i)

    deleteUser(ctx, created.id, created.username)
    expect(listUsers(ctx, { includeInactive: true })).toHaveLength(0)
    const row = harness.database.db.prepare('SELECT is_deleted, is_active FROM users WHERE id = ?').get(created.id) as { is_deleted: number, is_active: number }
    expect(row.is_deleted).toBe(1)
    expect(row.is_active).toBe(0)
  })

  it('links an account to a staff record and keeps the username searchable', () => {
    const ctx = adminCtx()
    const staff = saveStaff(ctx, {
      id: null,
      fullName: 'Rahima Begum',
      fullNameBn: 'রহিমা বেগম',
      dob: null,
      gender: 'female',
      address: null,
      phone: '01711002200',
      emergencyContact: null,
      bloodGroup: null,
      nationalId: null,
      designation: 'Receptionist',
      department: 'Front desk',
      salaryMicro: null,
      joiningDate: null,
      employmentStatus: 'active',
      notes: null
    } as never)

    const created = saveUser(ctx, userInput({ staffId: staff.id }))
    expect(created.staffId).toBe(staff.id)
    expect(created.staffName).toBe('Rahima Begum')
    expect(listUsers(ctx, { search: 'rahi' })).toHaveLength(1)
    expect(listUsers(ctx, { search: 'nobody' })).toHaveLength(0)

    const inactive = setUserActive(ctx, created.id, false)
    expect(inactive.isActive).toBe(false)
    expect(listUsers(ctx, { includeInactive: false })).toHaveLength(0)
    expect(listUsers(ctx, { includeInactive: true })).toHaveLength(1)
  })

  it('enforces users.view and users.manage at the service layer', () => {
    const ctx = adminCtx()
    const created = saveUser(ctx, userInput())

    const reader = harness.ctx(['users.view'])
    expect(listUsers(reader, {})).toHaveLength(1)
    expect(() => saveUser(reader, userInput({ id: created.id, username: created.username }))).toThrow(AppError)

    const nobody = harness.ctx([])
    expect(() => listUsers(nobody, {})).toThrow(AppError)
    expect(() => setUserActive(nobody, created.id, false)).toThrow(AppError)
  })
})
