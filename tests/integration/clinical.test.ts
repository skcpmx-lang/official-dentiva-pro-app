import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { archivePatient, savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveDentist, type DentistInput } from '@main/modules/dentists/service'
import { addVisitTreatment, getVisitSummary, listVisits, removeVisitTreatment, saveVisit, setVisitFindings, setVisitStatus, type VisitInput, type VisitTreatmentInput } from '@main/modules/clinical/visits'
import { archiveTreatment, listTreatments, saveTreatment, type TreatmentInput } from '@main/modules/clinical/treatments'
import { getChart, removeChartEntry, setChartEntry } from '@main/modules/clinical/chart'
import {
  adviceLibrary,
  applyTemplate,
  deletePrescription,
  duplicatePrescription,
  getPrescription,
  listPrescriptions,
  listTemplates,
  medicineHistory,
  savePrescription,
  saveTemplate,
  type MedicineInput,
  type PrescriptionInput
} from '@main/modules/clinical/prescriptions'
import { fromLocalDate } from '@shared/datetime'

/**
 * Clinical core integration tests.
 *
 * These run against a real SQLite database with migrations and seeds applied and exercise the same
 * service layer the IPC handlers call. They cover the rules that make clinical history trustworthy:
 * per-category treatment codes, price capture at the time of treatment, invoiced lines that cannot be
 * removed, archived patients that cannot receive new clinical work, chart upserts, and prescriptions
 * that keep the header of the dentist who signed them.
 */

let harness: TestHarness
let patientId: number
let dentistId: number

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
    tags: ['regular'],
    status: 'active',
    ...overrides
  } as PatientInput
}

function treatmentInput(overrides: Partial<TreatmentInput> = {}): TreatmentInput {
  return {
    id: null,
    code: null,
    name: 'Composite filling',
    nameBn: null,
    category: 'restorative',
    description: null,
    defaultPriceMicro: 150_000,
    durationMin: 30,
    isActive: true,
    notes: null,
    ...overrides
  } as TreatmentInput
}

function visitInput(overrides: Partial<VisitInput> = {}): VisitInput {
  return {
    id: null,
    patientId,
    dentistId,
    appointmentId: null,
    visitAt: Date.now(),
    chiefComplaint: null,
    history: null,
    examination: null,
    diagnosis: null,
    findingsSummary: null,
    advice: null,
    treatmentPlan: null,
    nextAppointmentAt: null,
    notes: null,
    status: 'final',
    ...overrides
  } as VisitInput
}

function treatmentLine(overrides: Partial<VisitTreatmentInput> = {}): VisitTreatmentInput {
  return {
    visitId: 0,
    treatmentId: null,
    treatmentName: 'Scaling and polishing',
    toothCodes: [],
    quantity: 1,
    unitPriceMicro: 120_000,
    discountMicro: 0,
    status: 'completed',
    notes: null,
    ...overrides
  } as VisitTreatmentInput
}

function chartEntry(overrides: Partial<Parameters<typeof setChartEntry>[1]> = {}): Parameters<typeof setChartEntry>[1] {
  return {
    patientId,
    visitId: null,
    toothCode: '36',
    dentition: 'adult',
    conditionCode: 'caries',
    treatmentCode: null,
    status: 'active',
    note: null,
    ...overrides
  } as Parameters<typeof setChartEntry>[1]
}

function medicineInput(overrides: Partial<MedicineInput> = {}): MedicineInput {
  return {
    sortOrder: 1,
    medicineName: 'Amoxicillin 500 mg',
    form: 'capsule',
    strength: '500 mg',
    unit: null,
    doseMorning: '1',
    doseAfternoon: null,
    doseNight: '1',
    timing: 'after_meal',
    frequency: '1+0+1',
    durationDays: 5,
    durationText: null,
    quantity: '10',
    isPrn: false,
    instructions: null,
    ...overrides
  } as MedicineInput
}

function prescriptionInput(overrides: Partial<PrescriptionInput> = {}): PrescriptionInput {
  return {
    id: null,
    patientId,
    dentistId,
    visitId: null,
    prescriptionAt: Date.now(),
    diagnosis: null,
    ccText: null,
    oeText: null,
    reText: null,
    advice: null,
    followUpDate: null,
    notes: null,
    medicines: [medicineInput()],
    ...overrides
  } as PrescriptionInput
}

beforeEach(() => {
  harness = createHarness()
  const ctx = harness.ctx()
  const dentist: DentistInput = {
    fullName: 'Dr. Ayesha Rahman',
    fullNameBn: 'ডা. আয়েশা রহমান',
    phone: null,
    email: null,
    registrationNo: 'BMDC-12345',
    signatureLabel: 'Consultant Dental Surgeon',
    color: null,
    isActive: true,
    sortOrder: 0,
    designations: ['BDS', 'MDS (Orthodontics)'],
    qualifications: [],
    schedules: []
  }
  dentistId = saveDentist(ctx, dentist).id
  patientId = savePatient(ctx, patientInput()).id
})

afterEach(() => {
  harness.cleanup()
})

describe('treatment catalogue', () => {
  it('generates a per-category code and keeps the price captured on the treatment line', () => {
    const ctx = harness.ctx()
    const filling = saveTreatment(ctx, treatmentInput())
    expect(filling.code).toMatch(/^REST-\d{4}$/)

    const cleaning = saveTreatment(ctx, treatmentInput({ name: 'Scaling and polishing', category: 'preventive', defaultPriceMicro: 120_000 }))
    expect(cleaning.code).toMatch(/^PREV-\d{4}$/)

    const visit = saveVisit(ctx, visitInput())
    const withLine = addVisitTreatment(
      ctx,
      treatmentLine({ visitId: visit.id, treatmentId: filling.id, treatmentName: filling.name, toothCodes: ['16', '17'], unitPriceMicro: filling.defaultPriceMicro })
    )
    expect(withLine.treatments[0]?.unitPriceMicro).toBe(150_000)

    // The clinic raises the price later: the completed treatment keeps the agreed amount.
    saveTreatment(ctx, treatmentInput({ id: filling.id, code: filling.code, defaultPriceMicro: 200_000 }))
    expect(getVisitSummary(ctx, visit.id).treatments[0]?.unitPriceMicro).toBe(150_000)
    // The seeded catalogue is always present; the two created items are found by name.
    expect(listTreatments(ctx, { search: 'Composite filling' }).map((row) => row.id)).toContain(filling.id)
    expect(listTreatments(ctx, { search: 'Scaling and polishing' }).map((row) => row.id)).toContain(cleaning.id)
  })

  it('rejects a duplicate name and archives instead of deleting', () => {
    const ctx = harness.ctx()
    saveTreatment(ctx, treatmentInput({ name: 'Root canal treatment', category: 'endodontic', defaultPriceMicro: 500_000 }))
    expect(() => saveTreatment(ctx, treatmentInput({ name: 'root canal treatment', category: 'endodontic' }))).toThrow(/already exists/i)

    const created = saveTreatment(ctx, treatmentInput({ name: 'Surgical extraction (test item)', category: 'oral_surgery', defaultPriceMicro: 100_000 }))
    archiveTreatment(ctx, { id: created.id, reason: 'No longer offered' })
    // Archiving removes it from the active catalogue; the row itself stays for historical prices.
    expect(listTreatments(ctx, { search: 'Surgical extraction (test item)' })).toHaveLength(0)
    const inactive = listTreatments(ctx, { search: 'Surgical extraction (test item)', includeInactive: true })
    expect(inactive).toHaveLength(1)
    expect(inactive[0]?.code).toBe(created.code)
  })
})

describe('visits', () => {
  it('allocates a document number and refuses to record clinical work for an archived patient', () => {
    const ctx = harness.ctx()
    const visit = saveVisit(ctx, visitInput({ chiefComplaint: 'Toothache in the lower left' }))
    expect(visit.visitNo).toMatch(/^V-\d{4}-\d{4}$/)

    archivePatient(ctx, { id: patientId, reason: 'Moved abroad' })
    expect(() => saveVisit(ctx, visitInput())).toThrow(/archived/i)
  })

  it('requires a reason to cancel a visit and refuses treatments on cancelled visits', () => {
    const ctx = harness.ctx()
    const visit = saveVisit(ctx, visitInput())
    expect(() => setVisitStatus(ctx, { id: visit.id, status: 'cancelled' })).toThrow(/reason is required/i)

    const cancelled = setVisitStatus(ctx, { id: visit.id, status: 'cancelled', reason: 'Patient left before treatment' })
    expect(cancelled.status).toBe('cancelled')
    expect(() => addVisitTreatment(ctx, treatmentLine({ visitId: visit.id }))).toThrow(/cancelled/i)
  })

  it('lists visits by patient, by Bangla name and by clinical text', () => {
    const ctx = harness.ctx()
    saveVisit(ctx, visitInput({ diagnosis: 'Chronic pulpitis 36' }))
    expect(listVisits(ctx, { patientId }).total).toBe(1)
    expect(listVisits(ctx, { search: 'রাকিব' }).total).toBe(1)
    expect(listVisits(ctx, { search: 'pulpitis' }).total).toBe(1)
    expect(listVisits(ctx, { search: 'nothing matches this' }).total).toBe(0)
  })

  it('blocks removing a treatment line that has already been invoiced', () => {
    const ctx = harness.ctx()
    const visit = saveVisit(ctx, visitInput())
    const withLine = addVisitTreatment(ctx, treatmentLine({ visitId: visit.id, toothCodes: ['36'], treatmentName: 'Composite filling' }))
    const lineId = withLine.treatments[0]?.id as number

    const now = Date.now()
    const invoiceId = harness.database.db
      .prepare(
        `INSERT INTO invoices (invoice_no, patient_id, visit_id, issue_at, issue_date, status, subtotal_micro, discount_micro, total_micro, paid_micro, due_micro, created_at, updated_at)
         VALUES ('INV-TEST-0001', ?, ?, ?, '2026-03-04', 'unpaid', 120000, 0, 120000, 0, 120000, ?, ?)`
      )
      .run(patientId, visit.id, now, now, now).lastInsertRowid as number
    harness.database.db
      .prepare(
        `INSERT INTO invoice_lines (invoice_id, sort_order, visit_treatment_id, description, quantity, unit_price_micro, discount_micro, line_total_micro)
         VALUES (?, 1, ?, 'Composite filling', 1, 120000, 0, 120000)`
      )
      .run(invoiceId, lineId)

    expect(() => removeVisitTreatment(ctx, lineId)).toThrow(/invoiced/i)
  })
})

describe('dental chart', () => {
  it('upserts per tooth and condition and keeps resolved history', () => {
    const ctx = harness.ctx()
    const visit = saveVisit(ctx, visitInput())

    const recorded = setChartEntry(ctx, chartEntry({ visitId: visit.id, toothCode: '36', conditionCode: 'caries', status: 'active' }))
    expect(recorded.byTooth['36']?.conditionCode).toBe('caries')
    expect(recorded.counts.find((entry) => entry.conditionCode === 'caries')?.count).toBe(1)

    const resolved = setChartEntry(ctx, chartEntry({ visitId: visit.id, toothCode: '36', conditionCode: 'caries', status: 'resolved' }))
    expect(resolved.byTooth['36']?.status).toBe('resolved')
    expect(resolved.entries).toHaveLength(1)

    setChartEntry(ctx, chartEntry({ visitId: visit.id, toothCode: '36', conditionCode: 'restoration', status: 'active' }))
    const after = getChart(ctx, patientId)
    expect(after.entries).toHaveLength(2)
    // An active finding outranks a resolved one for the same tooth.
    expect(after.byTooth['36']?.conditionCode).toBe('restoration')
    expect(after.summaryText).toMatch(/Restoration/i)

    const entryId = after.entries.find((entry) => entry.conditionCode === 'restoration')?.id as number
    expect(removeChartEntry(ctx, { id: entryId, patientId }).entries).toHaveLength(1)
  })

  it('rejects an invalid FDI tooth code and unknown conditions', () => {
    const ctx = harness.ctx()
    expect(() => setChartEntry(ctx, chartEntry({ toothCode: '99', conditionCode: 'caries', status: 'active' }))).toThrow(/FDI/i)
    expect(() => setChartEntry(ctx, chartEntry({ toothCode: '36', conditionCode: 'not_a_condition', status: 'active' }))).toThrow(
      /could not be found/i
    )
  })
})

describe('prescriptions', () => {
  it('allocates a prescription number and prints the header of the dentist who signed it', () => {
    const ctx = harness.ctx()
    const visit = saveVisit(ctx, visitInput())
    const prescription = savePrescription(
      ctx,
      prescriptionInput({ visitId: visit.id, diagnosis: 'Acute periapical abscess 36', advice: 'Warm saline rinse twice daily' })
    )

    expect(prescription.rxNo).toMatch(/^Rx-\d{4}-\d{4}$/)
    expect(prescription.dentistName).toBe('Dr. Ayesha Rahman')
    expect(prescription.dentistNameBn).toBe('ডা. আয়েশা রহমান')
    expect(prescription.dentistRegistrationNo).toBe('BMDC-12345')
    expect(prescription.dentistDesignations).toContain('BDS')
    expect(prescription.medicines).toHaveLength(1)

    expect(listPrescriptions(ctx, { patientId }).total).toBe(1)
    expect(listPrescriptions(ctx, { search: 'amoxicillin' }).total).toBe(1)
    expect(medicineHistory(ctx, { search: 'amox' })[0]?.useCount).toBe(1)
    expect(adviceLibrary(ctx)).toContain('Warm saline rinse twice daily')
  })

  it('requires a dose or PRN flag and a duration before saving', () => {
    const ctx = harness.ctx()
    expect(() =>
      savePrescription(
        ctx,
        prescriptionInput({
          medicines: [medicineInput({ doseMorning: null, doseNight: null, durationDays: null, durationText: null })]
        })
      )
    ).toThrow(/complete the prescription/i)
  })

  it('does not delete a printed prescription and duplicates it as a new document', () => {
    const ctx = harness.ctx()
    const prescription = savePrescription(ctx, prescriptionInput())
    harness.database.db.prepare('UPDATE prescriptions SET printed_count = 1, last_printed_at = ? WHERE id = ?').run(Date.now(), prescription.id)

    expect(() => deletePrescription(ctx, { id: prescription.id, reason: 'Mistake' })).toThrow(/printed/i)

    const copy = duplicatePrescription(ctx, prescription.id)
    expect(copy.id).not.toBe(prescription.id)
    expect(copy.rxNo).not.toBe(prescription.rxNo)
    expect(copy.medicines).toHaveLength(1)
  })

  it('applies a template and records which template was used', () => {
    const ctx = harness.ctx()
    const template = saveTemplate(ctx, { id: null, name: 'Post-extraction kit', dentistId: null, isActive: true, medicines: [medicineInput()] })
    expect(listTemplates(ctx)).toHaveLength(1)

    const applied = applyTemplate(ctx, { templateId: template.id, patientId, dentistId })
    expect(applied.medicines[0]?.medicineName).toBe('Amoxicillin 500 mg')
    expect(applied.notes).toContain(`[template:${template.id}]`)
  })

  it('refuses to write a prescription for an archived patient', () => {
    const ctx = harness.ctx()
    archivePatient(ctx, { id: patientId, reason: 'Deceased' })
    expect(() => savePrescription(ctx, prescriptionInput())).toThrow(/archived/i)
  })

  it('keeps Bangla medicine instructions intact through save and reload', () => {
    const ctx = harness.ctx()
    const created = savePrescription(ctx, prescriptionInput({ medicines: [medicineInput({ instructions: 'খাবারের পরে পানি দিয়ে খাবেন' })] }))
    expect(getPrescription(ctx, created.id).medicines[0]?.instructions).toBe('খাবারের পরে পানি দিয়ে খাবেন')
  })
})

describe('visit and prescription integration', () => {
  it('shows the clinical timeline with treatments, findings, chart entries and prescriptions', () => {
    const ctx = harness.ctx()
    const visit = saveVisit(ctx, visitInput({ visitAt: fromLocalDate('2026-03-04') + 10 * 3_600_000 }))
    addVisitTreatment(ctx, treatmentLine({ visitId: visit.id }))
    setVisitFindings(ctx, { visitId: visit.id, findings: [{ findingCode: 'caries', toothCode: '36', severity: 'moderate' }] })
    setChartEntry(ctx, chartEntry({ visitId: visit.id, toothCode: '36', conditionCode: 'caries', status: 'active' }))
    savePrescription(
      ctx,
      prescriptionInput({
        visitId: visit.id,
        medicines: [medicineInput({ medicineName: 'Paracetamol 500 mg', form: 'tablet', strength: '500 mg', durationDays: 3 })]
      })
    )

    const summary = getVisitSummary(ctx, visit.id)
    expect(summary.treatments).toHaveLength(1)
    expect(summary.findings).toHaveLength(1)
    expect(summary.chart).toHaveLength(1)
    expect(summary.prescriptions).toHaveLength(1)
    expect(summary.totals.totalMicro).toBe(120_000)
    expect(summary.patientNameBn).toBe('রাকিব হাসান')
  })
})
