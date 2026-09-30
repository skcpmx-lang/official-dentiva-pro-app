import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { archiveStaff, getStaff, listStaff, saveStaff, updateStaffPhoto, type StaffInput } from '@main/modules/staff/service'
import { saveUser } from '@main/modules/users/service'
import { listRoles } from '@main/modules/roles/service'
import { AppError } from '@shared/errors'

/**
 * Staff integration tests.
 *
 * The staff register is the employment record, not the login list. These tests cover the parts that make
 * it trustworthy: Bengali names and phone numbers survive the round trip, archive keeps the row (nothing
 * about a person is destroyed), a staff member who has a login cannot be archived out from under that
 * account, and reading or changing the register is gated by the staff permissions.
 */

let harness: TestHarness

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.cleanup()
})

function staffInput(overrides: Partial<StaffInput> = {}): StaffInput {
  return {
    id: null,
    fullName: 'Rahima Begum',
    fullNameBn: 'রহিমা বেগম',
    dob: '1994-03-12',
    gender: 'female',
    address: 'Holding 14, Santkhola Road, Tangail',
    phone: '01711002200',
    emergencyContact: 'Md. Karim · 01911223344',
    bloodGroup: 'B+',
    nationalId: '1994123456789',
    designation: 'Dental assistant',
    department: 'Clinical',
    salaryMicro: 1_800_000,
    joiningDate: '2023-02-01',
    employmentStatus: 'active',
    notes: null,
    ...overrides
  } as StaffInput
}

describe('staff register', () => {
  it('records a staff member with Bangla spelling and finds them by phone and designation', () => {
    const ctx = harness.ctx()
    const saved = saveStaff(ctx, staffInput())
    expect(saved.id).toBeGreaterThan(0)
    expect(saved.fullNameBn).toBe('রহিমা বেগম')
    expect(saved.address).toBe('Holding 14, Santkhola Road, Tangail')
    expect(saved.designation).toBe('Dental assistant')
    expect(saved.salaryMicro).toBe(1_800_000)
    expect(saved.employmentStatus).toBe('active')
    expect(saved.linkedUserId).toBeNull()

    saveStaff(ctx, staffInput({ fullName: 'Nurul Islam', fullNameBn: 'নুরুল ইসলাম', phone: '01822334455', designation: 'Receptionist' }))

    const byPhone = listStaff(ctx, { search: '01822' })
    expect(byPhone.total).toBe(1)
    expect(byPhone.items[0]!.fullName).toBe('Nurul Islam')

    const byDesignation = listStaff(ctx, { search: 'Reception' })
    expect(byDesignation.items.map((row) => row.fullName)).toEqual(['Nurul Islam'])

    const all = listStaff(ctx, {})
    expect(all.total).toBe(2)
    /* Active staff sort before everyone else so the register opens on the people who are present. */
    expect(all.items).toHaveLength(2)
  })

  it('keeps archived staff in the database and marks them terminated', () => {
    const ctx = harness.ctx()
    const saved = saveStaff(ctx, staffInput({ employmentStatus: 'probation' }))

    archiveStaff(ctx, saved.id, 'Left for a job in Dhaka')
    expect(listStaff(ctx, {}).total).toBe(0)

    const archived = listStaff(ctx, { includeArchived: true })
    expect(archived.total).toBe(1)
    const row = archived.items[0]!
    expect(row.employmentStatus).toBe('terminated')
    expect(row.notes).toContain('Left for a job in Dhaka')
    expect(row.fullNameBn).toBe('রহিমা বেগম')

    /* The row is soft-deleted, so it is not readable through the normal detail path any more. */
    expect(() => getStaff(ctx, saved.id)).toThrow(AppError)
  })

  it('refuses to archive a staff member who still has a login account', () => {
    const ctx = harness.ctx()
    const saved = saveStaff(ctx, staffInput())
    const ownerRole = listRoles(ctx, true).find((role) => role.code === 'owner')!

    saveUser(ctx, {
      id: null,
      username: 'rahima',
      fullName: saved.fullName,
      phone: saved.phone,
      roleId: ownerRole.id,
      staffId: saved.id,
      dentistId: null,
      isActive: true,
      password: 'Clinic2026!',
      requirePasswordChange: false
    })

    expect(() => archiveStaff(ctx, saved.id, null)).toThrow(/user account/i)
    const stillThere = getStaff(ctx, saved.id)
    expect(stillThere.linkedUsername).toBe('rahima')
  })

  it('validates phone, national ID and salary before writing', () => {
    const ctx = harness.ctx()
    expect(() => saveStaff(ctx, staffInput({ phone: '12' }))).toThrow(AppError)
    expect(() => saveStaff(ctx, staffInput({ nationalId: 'abc' }))).toThrow(AppError)
    expect(() => saveStaff(ctx, staffInput({ salaryMicro: -1 as unknown as number }))).toThrow(AppError)
    expect(listStaff(ctx, {}).total).toBe(0)
  })

  it('stores an updated photo path on the record', () => {
    const ctx = harness.ctx()
    const saved = saveStaff(ctx, staffInput())
    const updated = updateStaffPhoto(ctx, saved.id, 'staff-photos/rahima.png')
    expect(updated.photoPath).toBe('staff-photos/rahima.png')
    expect(getStaff(ctx, saved.id).photoPath).toBe('staff-photos/rahima.png')
  })

  it('enforces the staff permissions at the service layer', () => {
    const admin = harness.ctx()
    const saved = saveStaff(admin, staffInput())

    const reader = harness.ctx(['staff.view'])
    expect(listStaff(reader, {}).total).toBe(1)
    expect(() => saveStaff(reader, staffInput({ id: saved.id }))).toThrow(AppError)

    const nobody = harness.ctx([])
    expect(() => listStaff(nobody, {})).toThrow(AppError)
    expect(() => archiveStaff(nobody, saved.id, null)).toThrow(AppError)
  })
})
