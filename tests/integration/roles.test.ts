import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { assertRoleUsable, deleteRole, getRole, listRoles, permissionCatalog, saveRole, type RoleInput } from '@main/modules/roles/service'
import { saveUser } from '@main/modules/users/service'
import { AppError } from '@shared/errors'
import { PERMISSION_CODES } from '@shared/permissions'

/**
 * Role and permission-matrix integration tests.
 *
 * The permission matrix is the contract behind every guard in the application, so these tests pin both
 * halves: the catalog that the editor renders (every code, module, label and description) and the rules
 * that stop the matrix from being hollowed out — unknown codes are refused, built-in roles keep their
 * identifier, and a role that still has users cannot be deleted.
 */

let harness: TestHarness

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.cleanup()
})

function roleInput(overrides: Partial<RoleInput> = {}): RoleInput {
  return {
    id: null,
    name: 'Senior assistant',
    code: 'senior_assistant',
    description: 'Assists with procedures and manages stock counts',
    isActive: true,
    maxDiscountBasisPoints: 500,
    permissions: ['patients.view', 'clinical.view', 'inventory.view'],
    ...overrides
  } as RoleInput
}

describe('roles', () => {
  it('seeds the built-in roles with permissions and exposes the whole catalog', () => {
    const ctx = harness.ctx()
    const roles = listRoles(ctx, true)
    const codes = roles.map((role) => role.code)
    expect(codes).toEqual(expect.arrayContaining(['owner', 'administrator', 'dentist', 'receptionist']))
    expect(roles.every((role) => role.isSystem)).toBe(true)

    const owner = roles.find((role) => role.code === 'owner')!
    expect(owner.permissions).toContain('users.manage')
    /* The owner keeps the irreversible data-wipe permission; nobody else gets it by default. */
    expect(owner.permissions).toContain('data.wipe')

    const receptionist = roles.find((role) => role.code === 'receptionist')!
    expect(receptionist.permissions).toContain('patients.create')
    expect(receptionist.permissions).not.toContain('users.manage')

    const catalog = permissionCatalog()
    expect(catalog).toHaveLength(PERMISSION_CODES.length)
    expect(catalog.map((entry) => entry.code).sort()).toEqual([...PERMISSION_CODES].sort())
    for (const entry of catalog) {
      expect(entry.module.length).toBeGreaterThan(0)
      expect(entry.label.length).toBeGreaterThan(0)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('creates a custom role, grants exactly the chosen permissions and updates it', () => {
    const ctx = harness.ctx()
    const created = saveRole(ctx, roleInput())
    expect(created.id).toBeGreaterThan(0)
    expect(created.isSystem).toBe(false)
    expect(created.permissions.sort()).toEqual(['clinical.view', 'inventory.view', 'patients.view'])
    expect(created.maxDiscountBasisPoints).toBe(500)

    const updated = saveRole(ctx, { ...roleInput(), id: created.id, name: 'Assistant', permissions: ['patients.view', 'patients.create', 'billing.create'] })
    expect(updated.name).toBe('Assistant')
    expect(updated.permissions.sort()).toEqual(['billing.create', 'patients.create', 'patients.view'])
    expect(getRole(ctx, created.id).permissions).toHaveLength(3)
  })

  it('refuses unknown permission codes and duplicate names or codes', () => {
    const ctx = harness.ctx()
    expect(() => saveRole(ctx, roleInput({ permissions: ['patients.view', 'patients.destroy'] }))).toThrow(/unknown permission/i)

    saveRole(ctx, roleInput())
    expect(() => saveRole(ctx, roleInput({ id: null, name: 'SENIOR ASSISTANT' }))).toThrow(/already exists/i)
    expect(() => saveRole(ctx, roleInput({ id: null, name: 'Something else', code: 'senior_assistant' }))).toThrow(/already exists/i)
    expect(listRoles(ctx, true).filter((role) => !role.isSystem)).toHaveLength(1)
  })

  it('keeps built-in role identifiers stable and refuses to delete them', () => {
    const ctx = harness.ctx()
    const dentist = listRoles(ctx, true).find((role) => role.code === 'dentist')!

    expect(() => saveRole(ctx, { ...roleInput(), id: dentist.id, name: 'Dentist', code: 'renamed_dentist' })).toThrow(/identifier/i)

    const renamed = saveRole(ctx, { ...roleInput(), id: dentist.id, name: 'Consultant dentist', code: 'dentist' })
    expect(renamed.code).toBe('dentist')
    expect(renamed.name).toBe('Consultant dentist')

    expect(() => deleteRole(ctx, dentist.id, renamed.name)).toThrow(/built-in roles cannot be deleted/i)
  })

  it('will not delete a role that still has users, and asks for its exact name', () => {
    const ctx = harness.ctx()
    const role = saveRole(ctx, roleInput())

    saveUser(ctx, {
      id: null,
      username: 'assistant.one',
      fullName: 'Rahima Begum',
      phone: null,
      roleId: role.id,
      staffId: null,
      dentistId: null,
      isActive: true,
      password: 'Chamber2026!',
      requirePasswordChange: false
    })
    expect(() => deleteRole(ctx, role.id, role.name)).toThrow(/assigned to 1 user/i)

    const free = saveRole(ctx, roleInput({ id: null, name: 'Trainee', code: 'trainee', permissions: ['patients.view'] }))
    expect(() => deleteRole(ctx, free.id, 'trainee role')).toThrow(/type the role name/i)
    deleteRole(ctx, free.id, 'Trainee')
    expect(listRoles(ctx, true).some((entry) => entry.code === 'trainee')).toBe(false)
  })

  it('marks a role inactive, refuses to hand it to new users and blocks its use', () => {
    const ctx = harness.ctx()
    const role = saveRole(ctx, roleInput())
    saveRole(ctx, { ...roleInput(), id: role.id, isActive: false })

    expect(() => assertRoleUsable(ctx, role.id)).toThrow(/inactive/i)
    expect(() => saveUser(ctx, {
      id: null,
      username: 'blocked',
      fullName: 'Blocked Person',
      phone: null,
      roleId: role.id,
      staffId: null,
      dentistId: null,
      isActive: true,
      password: 'Chamber2026!',
      requirePasswordChange: false
    })).toThrow(AppError)
    expect(listRoles(ctx, false).some((entry) => entry.id === role.id)).toBe(false)
  })

  it('enforces roles.view for reading and roles.manage for writing', () => {
    const reader = harness.ctx(['roles.view'])
    expect(listRoles(reader, true).length).toBeGreaterThan(0)
    expect(() => saveRole(reader, roleInput())).toThrow(AppError)

    const writer = harness.ctx(['roles.manage', 'roles.view'])
    expect(saveRole(writer, roleInput()).id).toBeGreaterThan(0)

    const nobody = harness.ctx([])
    expect(() => listRoles(nobody, true)).toThrow(AppError)
    expect(() => saveRole(nobody, roleInput({ id: null, name: 'Nope', code: 'nope' }))).toThrow(AppError)
  })
})
