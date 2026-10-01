import { describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { PERMISSION_CODES } from '@shared/permissions'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveDentist, type DentistInput } from '@main/modules/dentists/service'
import { saveItem, type InventoryItemInput } from '@main/modules/inventory/items'
import { recordMovement } from '@main/modules/inventory/movements'
import { saveInvoice, type InvoiceInput } from '@main/modules/billing/invoices'
import { saveAppointment, type AppointmentInput } from '@main/modules/scheduling/appointments'
import { setInternalSetting } from '@main/modules/settings/service'
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationCounts,
  NOTIFICATION_TYPES,
  raiseNotification,
  setNotificationDismissed,
  syncNotifications
} from '@main/modules/notifications/service'

/**
 * Notification centre.
 *
 * The generator is driven by live clinic data, so these tests create the real conditions — an item below
 * its reorder level, an expiring batch, an invoice past its due date, an appointment that was never
 * actioned and a backup that has come due — and then check that the centre reports exactly those, that
 * repeats do not pile up, that reading and dismissing stick, and that a condition which stops being true
 * retires itself.
 */

function patientInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    fullName: 'Rakib Hasan',
    fullNameBn: 'রাকিব হাসান',
    dob: null,
    ageYears: 32,
    gender: 'male',
    bloodGroup: null,
    phone: '01712345678',
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

function dentistInput(): DentistInput {
  return {
    id: null,
    fullName: 'Dr Ayesha Rahman',
    fullNameBn: null,
    phone: null,
    email: null,
    registrationNo: 'BMDC-12345',
    signatureLabel: null,
    color: null,
    designations: [],
    qualifications: [],
    schedules: [],
    isActive: true,
    sortOrder: 1
  } as DentistInput
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

/** Creates the five conditions the centre is expected to notice. */
function seedConditions(harness: TestHarness): { itemId: number, invoiceId: number, appointmentId: number } {
  const ctx = harness.ctx()
  const patientId = savePatient(ctx, patientInput()).id
  const dentistId = saveDentist(ctx, dentistInput()).id

  const item = saveItem(ctx, itemInput())

  /* An expired batch and a batch about to expire. */
  recordMovement(ctx, {
    itemId: item.id,
    batchId: null,
    batch: { batchNo: 'EXP-OLD', expiryDate: '2026-01-01', unitCostMicro: 120_000, supplierId: null, note: null },
    movementType: 'opening',
    quantity: 4,
    unitCostMicro: 120_000,
    reason: 'Stock found during the audit',
    reference: null,
    supplierId: null,
    at: null
  } as never)

  const invoice = saveInvoice(ctx, {
    id: null,
    patientId,
    visitId: null,
    appointmentId: null,
    issueAt: Date.now(),
    dueDate: toLocalDate(Date.now() - 30 * 86_400_000),
    discountBp: 0,
    notes: null,
    lines: [
      {
        id: null,
        treatmentId: null,
        visitTreatmentId: null,
        description: 'Root canal treatment',
        toothCodes: ['46'],
        quantity: 1,
        unitPriceMicro: 900_000,
        discountMicro: 0,
        notes: null
      }
    ]
  } as InvoiceInput)

  const pastAt = fromLocalDate(toLocalDate(Date.now() - 3 * 86_400_000)) + 10 * 3_600_000
  const appointment = saveAppointment(ctx, {
    id: null,
    patientId,
    dentistId,
    scheduledAt: pastAt,
    durationMin: 30,
    reason: 'Follow-up',
    notes: null,
    status: 'scheduled'
  } as AppointmentInput)

  /* A schedule exists and nothing has been recorded yet, so a backup is due. */
  setInternalSetting(ctx, 'backup.frequencyDays', '7')
  setInternalSetting(ctx, 'backup.lastRunAt', '')

  return { itemId: item.id, invoiceId: invoice.id, appointmentId: appointment.id }
}

describe('notification centre', () => {
  it('raises one deduplicated notification per live condition', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const seeded = seedConditions(harness)

      const counts = syncNotifications(ctx)
      const { items, total } = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })

      const types = items.map((item) => item.type)
      expect(types).toContain(NOTIFICATION_TYPES.lowStock)
      expect(types).toContain(NOTIFICATION_TYPES.expiredStock)
      expect(types).toContain(NOTIFICATION_TYPES.overdueInvoice)
      expect(types).toContain(NOTIFICATION_TYPES.missedAppointment)
      expect(types).toContain(NOTIFICATION_TYPES.backupDue)
      expect(total).toBeGreaterThanOrEqual(5)
      expect(counts.unread).toBe(total)
      expect(counts.critical).toBeGreaterThanOrEqual(2)

      const lowStock = items.find((item) => item.type === NOTIFICATION_TYPES.lowStock)!
      /* Stock is below the reorder level but not yet exhausted, so this is a warning, not a stop. */
      expect(lowStock.severity).toBe('warning')
      expect(lowStock.entityId).toBe(seeded.itemId)
      expect(lowStock.actionRoute).toBe(`/inventory/${seeded.itemId}`)
      expect(lowStock.requiresPermission).toBe('inventory.view')

      const overdue = items.find((item) => item.type === NOTIFICATION_TYPES.overdueInvoice)!
      expect(overdue.actionRoute).toBe(`/invoices/${seeded.invoiceId}`)
      expect(overdue.message).toContain('৳')

      const missed = items.find((item) => item.type === NOTIFICATION_TYPES.missedAppointment)!
      expect(missed.entityId).toBe(seeded.appointmentId)
      expect(missed.actionRoute).toMatch(/^\/appointments\?date=\d{4}-\d{2}-\d{2}$/)

      /* Running the generator again refreshes the same rows instead of duplicating them. */
      const second = syncNotifications(ctx)
      expect(second.total).toBe(counts.total)
      expect(listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 }).total).toBe(total)
    } finally {
      harness.cleanup()
    }
  })

  it('remembers what was read and dismissed, and retires a condition that is gone', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const seeded = seedConditions(harness)
      syncNotifications(ctx)

      const before = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })
      const lowStock = before.items.find((item) => item.type === NOTIFICATION_TYPES.lowStock)!

      markNotificationRead(ctx, lowStock.id)
      expect(notificationCounts(ctx).unread).toBe(before.total - 1)

      setNotificationDismissed(ctx, lowStock.id, true)
      const afterDismiss = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })
      expect(afterDismiss.items.some((item) => item.id === lowStock.id)).toBe(false)
      const dismissed = listNotifications(ctx, { filter: 'dismissed', limit: 50, offset: 0 })
      expect(dismissed.items.some((item) => item.id === lowStock.id)).toBe(true)

      /* Re-running the generator must not resurrect a dismissed notification. */
      syncNotifications(ctx)
      expect(listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 }).items.some((item) => item.id === lowStock.id)).toBe(false)

      /* Restoring is available too, so a mis-click is recoverable. */
      setNotificationDismissed(ctx, lowStock.id, false)
      expect(listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 }).items.some((item) => item.id === lowStock.id)).toBe(true)

      /* Stocking the item retires both the low-stock and the expired-batch notifications. */
      recordMovement(ctx, {
        itemId: seeded.itemId,
        batchId: null,
        batch: { batchNo: 'NEW-STOCK', expiryDate: '2030-01-01', unitCostMicro: 120_000, supplierId: null, note: null },
        movementType: 'opening',
        quantity: 20,
        unitCostMicro: 120_000,
        reason: 'Restocked from the supplier',
        reference: null,
        supplierId: null,
        at: null
      } as never)
      harness.database.db.prepare('DELETE FROM inventory_batches WHERE item_id = ?').run(seeded.itemId)

      syncNotifications(ctx)
      const live = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })
      expect(live.items.some((item) => item.type === NOTIFICATION_TYPES.lowStock)).toBe(false)
      expect(live.items.some((item) => item.type === NOTIFICATION_TYPES.expiredStock)).toBe(false)
      expect(live.items.some((item) => item.type === NOTIFICATION_TYPES.overdueInvoice)).toBe(true)
    } finally {
      harness.cleanup()
    }
  })

  it('never shows a notification the signed-in operator may not open', () => {
    const harness = createHarness()
    try {
      seedConditions(harness)
      syncNotifications(harness.ctx())

      const receptionist = harness.ctx(['patients.view', 'appointments.view', 'queue.view'])
      const page = listNotifications(receptionist, { filter: 'all', limit: 50, offset: 0 })

      expect(page.items.length).toBeGreaterThan(0)
      expect(page.items.every((item) => item.requiresPermission === null || item.requiresPermission === 'appointments.view')).toBe(true)
      expect(page.items.some((item) => item.type === NOTIFICATION_TYPES.lowStock)).toBe(false)
      expect(page.items.some((item) => item.type === NOTIFICATION_TYPES.overdueInvoice)).toBe(false)
      expect(notificationCounts(receptionist).unread).toBe(page.total)

      /* An id outside the operator's scope answers "not found" rather than leaking it. */
      const owner = listNotifications(harness.ctx(), { filter: 'all', limit: 50, offset: 0 })
      const overdue = owner.items.find((item) => item.type === NOTIFICATION_TYPES.overdueInvoice)!
      expect(() => markNotificationRead(receptionist, overdue.id)).toThrow(/could not be found/i)

      /* Marking everything read only touches what this operator can see. */
      const marked = markAllNotificationsRead(receptionist)
      expect(marked).toBe(page.total)
      expect(notificationCounts(harness.ctx()).unread).toBeGreaterThan(0)
    } finally {
      harness.cleanup()
    }
  })

  it('keeps a manual, info-level notification and refuses to duplicate its dedupe key', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const first = raiseNotification(ctx.db, {
        dedupeKey: 'welcome:2026',
        type: 'app.welcome',
        severity: 'info',
        title: 'Welcome to Dentiva Pro',
        message: 'Your clinic data stays on this computer.',
        actionRoute: '/about',
        requiresPermission: null
      }, Date.now())
      const second = raiseNotification(ctx.db, {
        dedupeKey: 'welcome:2026',
        type: 'app.welcome',
        severity: 'info',
        title: 'Welcome to Dentiva Pro',
        message: 'Updated wording.',
        actionRoute: '/about',
        requiresPermission: null
      }, Date.now())

      expect(second).toBe(first)
      const rows = harness.database.db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE dedupe_key = 'welcome:2026'").get() as { count: number }
      expect(rows.count).toBe(1)

      /* A manual notification is not owned by the generator, so syncing must leave it alone. */
      syncNotifications(ctx)
      const page = listNotifications(ctx, { filter: 'all', limit: 50, offset: 0 })
      const welcome = page.items.find((item) => item.type === 'app.welcome')
      expect(welcome?.isDismissed).toBe(false)
      /* Raising it again refreshes the wording of the same row instead of adding a second one. */
      expect(welcome?.message).toBe('Updated wording.')
    } finally {
      harness.cleanup()
    }
  })

  it('counts only what the actor may see, for every role', () => {
    const harness = createHarness()
    try {
      seedConditions(harness)
      syncNotifications(harness.ctx())

      const owner = notificationCounts(harness.ctx())
      const limited = notificationCounts(harness.ctx(['patients.view']))

      expect(owner.unread).toBeGreaterThan(0)
      /* patients.view reveals none of the seeded conditions. */
      expect(limited.unread).toBe(0)
      expect(limited.total).toBe(0)

      /* Everyone with the full catalogue still sees everything. */
      expect(notificationCounts(harness.ctx([...PERMISSION_CODES])).unread).toBe(owner.unread)
    } finally {
      harness.cleanup()
    }
  })
})
