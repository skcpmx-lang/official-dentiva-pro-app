import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ROLES,
  PERMISSIONS,
  PERMISSION_CODES,
  can,
  discountLimitFor,
  expandRolePermissions,
  isKnownPermission
} from '@shared/permissions'

/**
 * Permission catalog and default roles.
 *
 * This catalog is the contract behind every `assertPermission` (68 codes across 19 modules) and the
 * permission matrix on the roles screen. A typo here is invisible at compile time — the check simply
 * never passes — so the catalog polices itself: every default role must name codes that exist, and the
 * module list must not contain a module that no permission belongs to.
 */

describe('catalog', () => {
  it('is unique, module-prefixed and complete', () => {
    expect(PERMISSIONS.length).toBeGreaterThanOrEqual(60)
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length)
    expect(PERMISSION_CODES.length).toBe(PERMISSIONS.length)

    for (const permission of PERMISSIONS) {
      expect(permission.code).toMatch(/^[a-z_]+\.[a-z_]+$/)
      expect(permission.code.startsWith(`${permission.module}.`)).toBe(true)
      expect(permission.label.length).toBeGreaterThan(2)
      expect(permission.description.length).toBeGreaterThan(5)
    }
  })

  it('marks every declared module as used', () => {
    const modules = new Set(PERMISSIONS.map((permission) => permission.module))
    // The three the specification calls out explicitly must be there…
    for (const required of ['patients', 'billing', 'backups', 'data']) {
      expect(modules.has(required as never), `${required} should be a permission module`).toBe(true)
    }
    // …and no module may exist that nothing belongs to.
    expect(modules.size).toBeGreaterThanOrEqual(15)
  })

  it('answers whether a code is known, which is what role editing relies on', () => {
    expect(isKnownPermission('patients.view')).toBe(true)
    expect(isKnownPermission('patients.destroy')).toBe(false)
    expect(isKnownPermission('')).toBe(false)
  })
})

describe('default roles', () => {
  it('gives the clinic seven system roles with unique codes', () => {
    expect(DEFAULT_ROLES.length).toBe(7)
    expect(new Set(DEFAULT_ROLES.map((role) => role.code)).size).toBe(7)
    for (const role of DEFAULT_ROLES) {
      expect(role.isSystem).toBe(true)
      expect(role.name.length).toBeGreaterThan(2)
    }
  })

  it('only ever names permissions that exist', () => {
    const unknown: string[] = []
    for (const role of DEFAULT_ROLES) {
      if (role.permissions === '*') continue
      for (const code of role.permissions) {
        if (!isKnownPermission(code)) unknown.push(`${role.code}: ${code}`)
      }
    }
    expect(unknown).toEqual([])
  })

  it('keeps clinical work out of the accountant role and money out of the assistant role', () => {
    const byCode = (code: string) => DEFAULT_ROLES.find((role) => role.code === code)!
    const accountant = expandRolePermissions(byCode('accountant'))
    expect(accountant).toContain('accounting.view')
    expect(accountant).toContain('reports.financial')
    expect(accountant).not.toContain('clinical.create')
    expect(accountant).not.toContain('patients.create')

    const assistant = expandRolePermissions(byCode('dental_assistant'))
    expect(assistant).toContain('clinical.view')
    expect(assistant).not.toContain('payments.create')
    expect(assistant).not.toContain('billing.create')

    const dentist = expandRolePermissions(byCode('dentist'))
    expect(dentist).toContain('prescriptions.create')
    expect(dentist).not.toContain('users.manage')
    expect(dentist).not.toContain('accounting.view')
  })
})

describe('resolution', () => {
  it('expands the wildcard role to the whole catalog and filters unknown codes', () => {
    const owner = DEFAULT_ROLES.find((role) => role.code === 'owner')!
    expect(expandRolePermissions(owner)).toEqual([...PERMISSION_CODES])
    expect(expandRolePermissions({ permissions: ['patients.view', 'not.a.permission'] })).toEqual(['patients.view'])
    expect(expandRolePermissions({ permissions: [] })).toEqual([])
  })

  it('answers authorisation questions from the resolved set', () => {
    const actor = { permissions: new Set(['patients.view', 'billing.create']) }
    expect(can(actor, 'patients.view')).toBe(true)
    expect(can(actor, 'patients.edit')).toBe(false)
    expect(can({ permissions: new Set<string>() }, 'patients.view')).toBe(false)
  })

  it('caps discounts unless the role may override them', () => {
    expect(discountLimitFor({ permissions: new Set(['billing.create']), maxDiscountBasisPoints: 500 })).toBe(500)
    expect(discountLimitFor({ permissions: new Set(['billing.create']), maxDiscountBasisPoints: null })).toBe(0)
    expect(discountLimitFor({ permissions: new Set(['billing.discount_override']), maxDiscountBasisPoints: 500 })).toBeNull()
    expect(discountLimitFor({ permissions: new Set(['billing.discount_override']), maxDiscountBasisPoints: null })).toBeNull()
  })
})
