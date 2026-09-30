import { describe, expect, it } from 'vitest'
import { createHarness } from './helpers'
import {
  archivePatient,
  checkDuplicates,
  getPatient,
  getPatientFinancials,
  getPatientSummary,
  getPatientTimeline,
  listPatientTags,
  listPatients,
  restorePatient,
  savePatient
} from '@main/modules/patients/service'
import { AppError } from '@shared/errors'
import { toLocalDate } from '@shared/datetime'
import type { PatientInput } from '@main/modules/patients/service'

/**
 * Patient module behaviour: registration, Bengali-aware search, duplicate protection, soft delete,
 * financial position and the cross-module timeline. Tests use the real database and the real service
 * layer, so permission checks and SQL are exercised exactly as in the packaged application.
 */

function samplePatient(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    fullName: 'Rahima Akter',
    fullNameBn: 'রহিমা আক্তার',
    dob: '1994-05-12',
    ageYears: null,
    gender: 'female',
    bloodGroup: 'B+',
    phone: '01712345678',
    altPhone: null,
    emergencyPhone: null,
    address: 'House 12, Road 4, Mirpur, Dhaka',
    addressBn: 'বাসা ১২, রোড ৪, মিরপুর, ঢাকা',
    city: 'Dhaka',
    occupation: 'Teacher',
    maritalStatus: 'married',
    chiefComplaint: 'Upper right molar pain',
    pastHistory: null,
    allergies: 'Penicillin',
    medicalHistory: 'Hypertension (controlled)',
    dentalHistory: null,
    currentMedications: 'Amlodipine 5 mg',
    notes: null,
    tags: ['regular'],
    status: 'active',
    ...overrides
  } as PatientInput
}

describe('patients module', () => {
  it('registers a patient with a monthly code and stores Bengali without corruption', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const patient = savePatient(ctx, samplePatient())

      expect(patient.code).toMatch(/^DP-\d{4}-\d{4}$/)
      expect(patient.fullNameBn).toBe('রহিমা আক্তার')
      expect(patient.addressBn).toBe('বাসা ১২, রোড ৪, মিরপুর, ঢাকা')
      expect(patient.ageLabel).toBeTruthy()
      expect(patient.registrationDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(patient.dueMicro).toBe(0)

      const stored = getPatient(ctx, patient.id)
      expect(stored.allergies).toBe('Penicillin')
      expect(stored.medicalHistory).toBe('Hypertension (controlled)')

      // Codes allocate inside the insert transaction, so a second registration continues the series.
      const second = savePatient(ctx, samplePatient({ fullName: 'Karim Hossain', fullNameBn: null, phone: '01812345678' }))
      expect(second.code).not.toBe(patient.code)
      expect(Number(second.code.slice(-4))).toBe(Number(patient.code.slice(-4)) + 1)
    } finally {
      harness.cleanup()
    }
  })

  it('finds patients by Bengali name and by phone digits', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      savePatient(ctx, samplePatient())
      savePatient(ctx, samplePatient({ fullName: 'Nusrat Jahan', fullNameBn: 'নুসরাত জাহান', phone: '01999888777' }))

      const byBengali = listPatients(ctx, { status: 'active', sortBy: 'recent', limit: 50, offset: 0, search: 'নুসরাত' })
      expect(byBengali.total).toBe(1)
      expect(byBengali.items[0]?.fullName).toBe('Nusrat Jahan')

      const byPhone = listPatients(ctx, { status: 'active', sortBy: 'recent', limit: 50, offset: 0, search: '01712345678' })
      expect(byPhone.total).toBe(1)
      expect(byPhone.items[0]?.fullName).toBe('Rahima Akter')

      const noMatch = listPatients(ctx, { status: 'active', sortBy: 'recent', limit: 50, offset: 0, search: 'Completely absent' })
      expect(noMatch.total).toBe(0)
    } finally {
      harness.cleanup()
    }
  })

  it('refuses a duplicate registration that would create two files for the same person', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const first = savePatient(ctx, samplePatient())

      expect(checkDuplicates(ctx, { fullName: 'Rahima Akter', phone: '01712345678' })).toHaveLength(1)

      let error: unknown = null
      try {
        savePatient(ctx, samplePatient())
      } catch (caught) {
        error = caught
      }
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('E_CONFLICT')

      // Editing the existing patient (same identity) must not be blocked by its own record.
      const updated = savePatient(ctx, samplePatient({ id: first.id, occupation: 'Head teacher' }))
      expect(updated.occupation).toBe('Head teacher')
      expect(updated.id).toBe(first.id)
    } finally {
      harness.cleanup()
    }
  })

  it('archives and restores a patient without losing history', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const patient = savePatient(ctx, samplePatient())

      archivePatient(ctx, { id: patient.id, reason: 'Patient moved abroad' })
      expect(() => getPatient(ctx, patient.id)).toThrow(AppError)
      expect(listPatients(ctx, { status: 'active', sortBy: 'recent', limit: 50, offset: 0 }).total).toBe(0)

      // The row still exists for audit purposes and can be restored with its original identifiers.
      const archivedCount = (harness.database.db.prepare('SELECT COUNT(*) AS count FROM patients WHERE is_deleted = 1').get() as { count: number }).count
      expect(archivedCount).toBe(1)

      const restored = restorePatient(ctx, patient.id)
      expect(restored.code).toBe(patient.code)
      expect(restored.status).toBe('active')
      expect(listPatients(ctx, { status: 'active', sortBy: 'recent', limit: 50, offset: 0 }).total).toBe(1)
    } finally {
      harness.cleanup()
    }
  })

  it('enforces permissions in the business layer, not only in the interface', () => {
    const harness = createHarness()
    try {
      const viewer = harness.ctx(['patients.view'])
      const patient = savePatient(harness.ctx(), samplePatient())

      expect(getPatient(viewer, patient.id).fullName).toBe('Rahima Akter')
      expect(() => savePatient(viewer, samplePatient({ fullName: 'Someone Else' }))).toThrow(AppError)
      expect(() => archivePatient(viewer, { id: patient.id, reason: null })).toThrow(AppError)

      const unprivileged = harness.ctx([])
      expect(() => listPatients(unprivileged, { status: 'active', sortBy: 'recent', limit: 25, offset: 0 })).toThrow(AppError)
    } finally {
      harness.cleanup()
    }
  })

  it('reports financial position and a merged timeline across modules', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const patient = savePatient(ctx, samplePatient())
      const now = ctx.now()

      // A dentist, then a visit, an invoice and a payment written directly at the storage layer, so
      // the timeline integration is verified without depending on modules implemented later.
      harness.database.db
        .prepare(
          `INSERT INTO dentists (full_name, is_active, created_at, updated_at) VALUES ('Dr. Test Dentist', 1, ?, ?)`
        )
        .run(now, now)
      harness.database.db
        .prepare(
          `INSERT INTO visits (visit_no, patient_id, dentist_id, visit_at, visit_date, diagnosis, status, created_at, updated_at)
           VALUES ('V-2601-0001', ?, 1, ?, ?, 'Irreversible pulpitis 16', 'completed', ?, ?)`
        )
        .run(patient.id, now, toLocalDate(now), now, now)

      const today = toLocalDate(now)
      const longAgo = toLocalDate(now - 120 * 86_400_000)

      harness.database.db
        .prepare(
          `INSERT INTO invoices (invoice_no, patient_id, issue_at, issue_date, status, subtotal_micro, total_micro, paid_micro, due_micro, created_at, updated_at)
           VALUES ('INV-2601-0001', ?, ?, ?, 'partial', 50000000, 50000000, 20000000, 30000000, ?, ?)`
        )
        .run(patient.id, now, today, now, now)

      harness.database.db
        .prepare(
          `INSERT INTO invoices (invoice_no, patient_id, issue_at, issue_date, status, subtotal_micro, total_micro, paid_micro, due_micro, created_at, updated_at)
           VALUES ('INV-2601-0002', ?, ?, ?, 'unpaid', 10000000, 10000000, 0, 10000000, ?, ?)`
        )
        .run(patient.id, now - 120 * 86_400_000, longAgo, now, now)

      harness.database.db
        .prepare(
          `INSERT INTO payments (receipt_no, patient_id, invoice_id, kind, amount_micro, method, paid_at, paid_date, status, created_at, updated_at)
           VALUES ('RCP-2601-0001', ?, 1, 'payment', 20000000, 'cash', ?, ?, 'active', ?, ?)`
        )
        .run(patient.id, now, today, now, now)

      const financials = getPatientFinancials(ctx, patient.id)
      expect(financials.invoicedMicro).toBe(60_000_000)
      expect(financials.paidMicro).toBe(20_000_000)
      expect(financials.dueMicro).toBe(40_000_000)
      expect(financials.invoiceCount).toBe(2)
      expect(financials.aging.current).toBe(30_000_000)
      expect(financials.aging.older).toBe(10_000_000)

      const timeline = getPatientTimeline(ctx, { patientId: patient.id, limit: 100, offset: 0 })
      const kinds = new Set(timeline.items.map((entry) => entry.kind))
      expect(kinds.has('registration')).toBe(true)
      expect(kinds.has('visit')).toBe(true)
      expect(kinds.has('invoice')).toBe(true)
      expect(kinds.has('payment')).toBe(true)

      const summary = getPatientSummary(ctx, patient.id)
      expect(summary.lastVisit?.diagnosis).toBe('Irreversible pulpitis 16')
      expect(summary.allergies).toBe('Penicillin')
    } finally {
      harness.cleanup()
    }
  })

  it('collects tag facets for filtering', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      savePatient(ctx, samplePatient({ tags: ['regular', 'diabetic'] }))
      savePatient(ctx, samplePatient({ fullName: 'Karim Hossain', phone: '01611111111', tags: ['regular'] }))

      const tags = listPatientTags(ctx)
      expect(tags.find((entry) => entry.tag === 'regular')?.count).toBe(2)
      expect(tags.find((entry) => entry.tag === 'diabetic')?.count).toBe(1)
    } finally {
      harness.cleanup()
    }
  })
})
