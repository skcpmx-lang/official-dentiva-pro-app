import { describe, expect, it } from 'vitest'
import { createHarness } from './helpers'
import { globalSearch } from '@main/search/service'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveDentist, type DentistInput } from '@main/modules/dentists/service'
import { saveTreatment, type TreatmentInput } from '@main/modules/clinical/treatments'
import { saveItem, type InventoryItemInput } from '@main/modules/inventory/items'
import { saveStaff, type StaffInput } from '@main/modules/staff/service'
import { saveInvoice, type InvoiceInput } from '@main/modules/billing/invoices'
import { saveAppointment, type AppointmentInput } from '@main/modules/scheduling/appointments'
import { fromLocalDate, toLocalDate } from '@shared/datetime'

/**
 * Global search.
 *
 * One query has to fan out across the clinic and still answer as the operator: groups the actor may not
 * open are not searched at all, results carry the route that opens them, and Bengali text is matched the
 * same way the module screens match it.
 */

function patientInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    fullName: 'Zarina Sultana',
    fullNameBn: 'জরিনা সুলতানা',
    dob: null,
    ageYears: 41,
    gender: 'female',
    bloodGroup: null,
    phone: '01911223344',
    altPhone: null,
    emergencyPhone: null,
    address: 'Station Road, Tangail',
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

function treatmentInput(overrides: Partial<TreatmentInput> = {}): TreatmentInput {
  return {
    id: null,
    code: null,
    name: 'Zirconia crown',
    nameBn: null,
    category: 'prosthodontic',
    description: null,
    defaultPriceMicro: 1_200_000,
    durationMin: 45,
    isActive: true,
    notes: null,
    ...overrides
  } as TreatmentInput
}

function itemInput(overrides: Partial<InventoryItemInput> = {}): InventoryItemInput {
  return {
    id: null,
    code: null,
    name: 'Zirconia blanks',
    category: 'prosthodontic',
    unit: 'piece',
    supplierId: null,
    purchasePriceMicro: 800_000,
    sellingPriceMicro: 1_000_000,
    reorderLevel: 2,
    expiryTracking: false,
    location: null,
    notes: null,
    isActive: true,
    ...overrides
  } as InventoryItemInput
}

function staffInput(overrides: Partial<StaffInput> = {}): StaffInput {
  return {
    id: null,
    fullName: 'Zarina Akter',
    fullNameBn: 'জরিনা আক্তার',
    dob: null,
    gender: 'female',
    address: null,
    phone: '01777889900',
    emergencyContact: null,
    bloodGroup: null,
    nationalId: null,
    designation: 'Receptionist',
    department: 'Front desk',
    salaryMicro: null,
    joiningDate: null,
    employmentStatus: 'active',
    notes: null,
    ...overrides
  } as StaffInput
}

describe('global search', () => {
  it('finds records in every module that matches the query and returns the route to open them', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const patient = savePatient(ctx, patientInput())
      const dentist = saveDentist(ctx, dentistInput())
      const treatment = saveTreatment(ctx, treatmentInput())
      const item = saveItem(ctx, itemInput())
      saveStaff(ctx, staffInput())

      const appointment = saveAppointment(ctx, {
        id: null,
        patientId: patient.id,
        dentistId: dentist.id,
        scheduledAt: fromLocalDate(toLocalDate(Date.now())) + 11 * 3_600_000,
        durationMin: 30,
        reason: 'Zirconia fitting',
        notes: null,
        status: 'scheduled'
      } as AppointmentInput)

      const invoice = saveInvoice(ctx, {
        id: null,
        patientId: patient.id,
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
            description: 'Zirconia crown',
            toothCodes: ['24'],
            quantity: 1,
            unitPriceMicro: 1_200_000,
            discountMicro: 0,
            notes: null
          }
        ]
      } as InvoiceInput)

      const byProduct = globalSearch(ctx, { query: 'Zirconia', limitPerGroup: 5 })
      const keys = byProduct.groups.map((group) => group.key)
      expect(keys).toContain('treatments')
      expect(keys).toContain('inventory')
      expect(byProduct.total).toBeGreaterThanOrEqual(2)

      const inventoryGroup = byProduct.groups.find((group) => group.key === 'inventory')!
      const inventoryHit = inventoryGroup.items.find((entry) => entry.id === item.id)!
      expect(inventoryHit.route).toBe(`/inventory/${item.id}`)
      expect(inventoryHit.title).toBe('Zirconia blanks')

      /* The seeded catalogue may hold other zirconia treatments, so the new one is looked up by id. */
      const treatmentGroup = byProduct.groups.find((group) => group.key === 'treatments')!
      const treatmentHit = treatmentGroup.items.find((entry) => entry.id === treatment.id)!
      expect(treatmentHit.route).toContain('/treatments?search=')
      expect(treatmentHit.meta).toContain('৳')

      const appointmentGroup = globalSearch(ctx, { query: 'Zirconia fitting', limitPerGroup: 5 }).groups.find((group) => group.key === 'appointments')
      expect(appointmentGroup?.items[0]?.route).toBe(`/appointments?date=${toLocalDate(appointment.scheduledAt)}`)

      /* The invoice is reachable through its patient and its line description. */
      const byPatient = globalSearch(ctx, { query: 'Zarina', limitPerGroup: 5 })
      const invoiceGroup = byPatient.groups.find((group) => group.key === 'invoices')
      expect(invoiceGroup?.items.some((entry) => entry.id === invoice.id)).toBe(true)
      expect(byPatient.groups.find((group) => group.key === 'staff')?.items[0]?.title).toContain('Zarina Akter')

      /* Phone lookup works because the patient panel matches the same folded column. */
      expect(globalSearch(ctx, { query: '01911223344', limitPerGroup: 5 }).groups.some((group) => group.key === 'patients')).toBe(true)

      /* A query that matches nothing answers with no groups rather than an error. */
      expect(globalSearch(ctx, { query: 'qqzzxx-no-such-record', limitPerGroup: 5 }).groups).toEqual([])
    } finally {
      harness.cleanup()
    }
  })

  it('matches Bengali names and addresses without corrupting them', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const patient = savePatient(ctx, patientInput())
      saveStaff(ctx, staffInput({ fullName: 'Jorina Begum', fullNameBn: 'জরিনা বেগম' }))

      const byBengaliName = globalSearch(ctx, { query: 'জরিনা সুলতানা', limitPerGroup: 5 })
      const patients = byBengaliName.groups.find((group) => group.key === 'patients')
      expect(patients?.items[0]?.id).toBe(patient.id)
      expect(patients?.items[0]?.title).toContain('জরিনা সুলতানা')

      const staffGroup = globalSearch(ctx, { query: 'জরিনা বেগম', limitPerGroup: 5 }).groups.find((group) => group.key === 'staff')
      expect(staffGroup?.items[0]?.title).toContain('জরিনা বেগম')

      /* A partial Bengali word also finds the record. */
      expect(globalSearch(ctx, { query: 'সুলতানা', limitPerGroup: 5 }).groups.some((group) => group.key === 'patients')).toBe(true)
    } finally {
      harness.cleanup()
    }
  })

  it('searches only the groups the signed-in operator may open', () => {
    const harness = createHarness()
    try {
      const owner = harness.ctx()
      const patient = savePatient(owner, patientInput())
      saveItem(owner, itemInput())
      saveTreatment(owner, treatmentInput())

      const receptionist = harness.ctx(['patients.view'])
      const page = globalSearch(receptionist, { query: 'Zarina', limitPerGroup: 5 })
      expect(page.groups.map((group) => group.key)).toEqual(['patients'])
      expect(page.groups[0]!.items[0]!.id).toBe(patient.id)
      expect(page.groups[0]!.items[0]!.route).toBe(`/patients/${patient.id}`)

      /* The stock and treatment groups are not merely hidden — they were never queried. */
      const everything = globalSearch(owner, { query: 'Zirconia', limitPerGroup: 5 })
      expect(everything.groups.some((group) => group.key === 'inventory')).toBe(true)
      expect(globalSearch(receptionist, { query: 'Zirconia', limitPerGroup: 5 }).groups).toEqual([])

      /* An actor with no clinical permissions at all gets an empty answer, not an error. */
      const none = globalSearch(harness.ctx([]), { query: 'Zirconia', limitPerGroup: 5 })
      expect(none.groups).toEqual([])
      expect(none.total).toBe(0)

      /* Billing-only keeps invoices and payments and drops everything clinical. */
      const cashier = globalSearch(harness.ctx(['billing.view', 'payments.view']), { query: 'Zarina', limitPerGroup: 5 })
      expect(cashier.groups.every((group) => group.key === 'invoices' || group.key === 'payments')).toBe(true)
    } finally {
      harness.cleanup()
    }
  })
})
