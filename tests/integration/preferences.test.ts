import { describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import {
  getPreferences,
  getRecentlyViewed,
  listRecentlyViewed,
  recordRecentlyViewed,
  setPreferences
} from '@main/modules/preferences/service'
import { DASHBOARD_PANEL_IDS } from '@shared/preferences'
import { NOTIFICATION_TYPES } from '@shared/notifications'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveInvoice, type InvoiceInput } from '@main/modules/billing/invoices'
import { saveItem, type InventoryItemInput } from '@main/modules/inventory/items'
import { recordMovement } from '@main/modules/inventory/movements'
import { listNotifications, syncNotifications } from '@main/modules/notifications/service'
import { listRoles } from '@main/modules/roles/service'
import { saveUser } from '@main/modules/users/service'
import type { ServiceContext } from '@main/context'

/**
 * Per-user preferences.
 *
 * Preferences are presentation-only, but they still have to be real: a value that is stored and ignored
 * is worse than no control at all. These tests cover the validation (an unknown key or an impossible
 * value is refused), the isolation between accounts, the recently viewed list — including what happens
 * when the operator loses the permission for a record — and the alert mutes, which must never silence a
 * critical alert.
 */

function patientInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    fullName: 'Zarina Sultana',
    fullNameBn: 'জরিনা সুলতানা',
    dob: null,
    ageYears: 29,
    gender: 'female',
    bloodGroup: null,
    phone: '01812345678',
    altPhone: null,
    emergencyPhone: null,
    address: null,
    addressBn: null,
    city: 'Tangail',
    occupation: null,
    maritalStatus: null,
    chiefComplaint: null,
    pastHistory: null,
    allergies: null,
    medicalHistory: null,
    dentalHistory: null,
    currentMedications: null,
    notes: null,
    tags: [],
    status: 'active',
    ...overrides
  } as PatientInput
}

function itemInput(overrides: Partial<InventoryItemInput> = {}): InventoryItemInput {
  return {
    id: null,
    code: null,
    name: 'Composite resin',
    category: 'restorative',
    unit: 'syringe',
    supplierId: null,
    purchasePriceMicro: 120_000,
    sellingPriceMicro: 180_000,
    reorderLevel: 5,
    expiryTracking: true,
    location: null,
    notes: null,
    isActive: true,
    ...overrides
  } as InventoryItemInput
}

function invoiceInput(patientId: number): InvoiceInput {
  return {
    id: null,
    patientId,
    visitId: null,
    appointmentId: null,
    issueAt: Date.now(),
    dueDate: null,
    discountBp: 0,
    notes: null,
    lines: [
      {
        id: null,
        treatmentId: null,
        visitTreatmentId: null,
        description: 'Scaling and polishing',
        toothCodes: [],
        quantity: 1,
        unitPriceMicro: 250_000,
        discountMicro: 0,
        notes: null
      }
    ]
  } as InvoiceInput
}

/** Preferences hang off a real account, so the tests sign in as one instead of inventing an id. */
function createUser(harness: TestHarness, username: string): number {
  const admin = harness.ctx()
  const roleId = listRoles(admin, true).find((role) => role.code === 'receptionist')!.id
  return saveUser(admin, {
    id: null,
    username,
    fullName: 'Rahima Begum',
    phone: null,
    roleId,
    staffId: null,
    dentistId: null,
    isActive: true,
    password: 'Chamber2026!',
    requirePasswordChange: false
  } as never).id
}

/** Writes the alert mute list the way the preferences screen does. */
function mute(ctx: ServiceContext, types: string[]): void {
  setPreferences(ctx, { 'notifications.muted': JSON.stringify(types) })
}

describe('per-user preferences', () => {
  it('stores a typo-free preference set and refuses anything it cannot honour', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx(undefined, { userId: createUser(harness, 'reception1'), username: 'reception1' })

      setPreferences(ctx, {
        'dashboard.range': 'last7',
        'dashboard.panels': JSON.stringify(['kpis', 'dues', 'nope', 'kpis']),
        'notifications.muted': JSON.stringify([NOTIFICATION_TYPES.lowStock, 'not.a.type'])
      })

      const stored = getPreferences(ctx)
      expect(stored['dashboard.range']).toBe('last7')
      /* Unknown and repeated panel ids are dropped rather than rendered as empty cards. */
      expect(JSON.parse(stored['dashboard.panels']!)).toEqual(['kpis', 'dues'])
      expect(JSON.parse(stored['notifications.muted']!)).toEqual([NOTIFICATION_TYPES.lowStock])

      expect(() => setPreferences(ctx, { 'dashboard.ranges': 'today' })).toThrowError(/not a preference/i)
      expect(() => setPreferences(ctx, { 'dashboard.range': 'lastYear' })).toThrowError(/period/i)
      expect(() => setPreferences(ctx, { 'dashboard.panels': '[]' })).toThrowError(/at least one/i)
      expect(() => setPreferences(ctx, { 'dashboard.panels': 'not json' })).toThrowError(/list/i)
      /* A preference nothing honours is refused like any other typo. */
      expect(() => setPreferences(ctx, { 'ui.density': 'compact' })).toThrowError(/not a preference/i)

      /* The refused writes changed nothing. */
      expect(getPreferences(ctx)['dashboard.range']).toBe('last7')
    } finally {
      harness.cleanup()
    }
  })

  it('keeps each operator’s preferences to themselves', () => {
    const harness = createHarness()
    try {
      const receptionId = createUser(harness, 'reception2')
      const ownerId = createUser(harness, 'owner2')

      const operator = harness.ctx(undefined, { userId: receptionId, username: 'reception2' })
      const owner = harness.ctx(undefined, { userId: ownerId, username: 'owner2' })

      setPreferences(operator, { 'dashboard.range': 'today' })
      setPreferences(owner, { 'dashboard.range': 'thisMonth' })

      expect(getPreferences(operator)['dashboard.range']).toBe('today')
      expect(getPreferences(owner)['dashboard.range']).toBe('thisMonth')

      /* The scheduler and other system actors own no preferences and write none. */
      const system = harness.ctx([], { userId: 0, username: 'system' })
      setPreferences(system, { 'dashboard.range': 'today' })
      expect(getPreferences(system)).toEqual({})
    } finally {
      harness.cleanup()
    }
  })

  it('records recently viewed records and hides the ones the operator may no longer open', () => {
    const harness = createHarness()
    try {
      const userId = createUser(harness, 'reception3')
      const ctx = harness.ctx(undefined, { userId, username: 'reception3' })
      const patientId = savePatient(ctx, patientInput()).id
      const invoiceId = saveInvoice(ctx, invoiceInput(patientId)).id

      /* The detail screens record what they opened through their own services. */
      recordRecentlyViewed(ctx, 'patient', patientId)
      recordRecentlyViewed(ctx, 'invoice', invoiceId)
      recordRecentlyViewed(ctx, 'patient', patientId)

      expect(getRecentlyViewed(ctx, 'patient')).toEqual([patientId])

      const entries = listRecentlyViewed(ctx, 8)
      expect(entries.map((entry) => entry.kind)).toEqual(['patient', 'invoice'])
      expect(entries[0]).toMatchObject({ kind: 'patient', route: `/patients/${patientId}`, title: 'Zarina Sultana' })
      expect(entries[1]).toMatchObject({ kind: 'invoice', route: `/invoices/${invoiceId}` })

      /* A billing-only operator never sees the patient entry they cannot open. */
      const billing = harness.ctx(['billing.view'], { userId, username: 'reception3' })
      const forBilling = listRecentlyViewed(billing, 8)
      expect(forBilling.every((entry) => entry.kind === 'invoice')).toBe(true)

      /* A record that has been deleted drops out instead of becoming a dead link. */
      ctx.db.prepare('UPDATE patients SET is_deleted = 1 WHERE id = ?').run(patientId)
      expect(listRecentlyViewed(ctx, 8).some((entry) => entry.kind === 'patient')).toBe(false)
    } finally {
      harness.cleanup()
    }
  })

  it('honours alert mutes for routine alerts but never for a critical one', () => {
    const harness = createHarness()
    try {
      const userId = createUser(harness, 'reception4')
      const ctx = harness.ctx(undefined, { userId, username: 'reception4' })
      const item = saveItem(ctx, itemInput())

      /* Below the reorder level (a warning) and an expired batch (critical). */
      recordMovement(ctx, {
        itemId: item.id,
        batchId: null,
        batch: { batchNo: 'EXP-OLD', expiryDate: '2026-01-01', unitCostMicro: 120_000, supplierId: null, note: null },
        movementType: 'opening',
        quantity: 2,
        unitCostMicro: 120_000,
        reason: 'Stock found during the audit',
        reference: null,
        supplierId: null,
        at: null
      } as never)
      syncNotifications(ctx)

      const before = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })
      expect(before.items.some((entry) => entry.type === NOTIFICATION_TYPES.lowStock)).toBe(true)
      expect(before.items.some((entry) => entry.type === NOTIFICATION_TYPES.expiredStock)).toBe(true)

      /* Muting warns the operator about the noise, not the work: expired stock still arrives. */
      mute(ctx, [NOTIFICATION_TYPES.lowStock])
      const after = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })
      expect(after.items.some((entry) => entry.type === NOTIFICATION_TYPES.lowStock)).toBe(false)
      expect(after.items.some((entry) => entry.type === NOTIFICATION_TYPES.expiredStock)).toBe(true)
      expect(after.total).toBe(before.total - 1)

      /* Unmuting brings it straight back — the row was never deleted. */
      mute(ctx, [])
      const restored = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })
      expect(restored.items.some((entry) => entry.type === NOTIFICATION_TYPES.lowStock)).toBe(true)
      expect(restored.total).toBe(before.total)

      /* A mute belongs to the operator who set it: another account still sees everything. */
      const otherId = createUser(harness, 'reception5')
      const other = harness.ctx(undefined, { userId: otherId, username: 'reception5' })
      mute(other, [NOTIFICATION_TYPES.lowStock])
      expect(listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 }).items.some((entry) => entry.type === NOTIFICATION_TYPES.lowStock)).toBe(true)

      /* The panel catalogue the preferences screen offers is the one the dashboard renders. */
      expect(DASHBOARD_PANEL_IDS).toContain('kpis')
      expect(DASHBOARD_PANEL_IDS).toContain('recent')
    } finally {
      harness.cleanup()
    }
  })
})
