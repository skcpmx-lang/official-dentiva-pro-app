import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveDentist, type DentistInput } from '@main/modules/dentists/service'
import { saveTreatment, type TreatmentInput } from '@main/modules/clinical/treatments'
import { addVisitTreatment, saveVisit, type VisitInput } from '@main/modules/clinical/visits'
import { saveInvoice } from '@main/modules/billing/invoices'
import { addPayment } from '@main/modules/billing/payments'
import { saveItem, type InventoryItemInput } from '@main/modules/inventory/items'
import { recordMovement } from '@main/modules/inventory/movements'
import {
  accountingSummary,
  archiveCategory,
  closeDay,
  dayCloseView,
  dayCloses,
  getEntry,
  listCategories,
  listEntries,
  reopenDay,
  saveCategory,
  saveEntry,
  voidEntry,
  type EntryInput
} from '@main/modules/accounting/entries'
import { reportCatalog, runReport } from '@main/modules/accounting/reports'
import { toLocalDate } from '@shared/datetime'

/**
 * Accounting, day close and reports.
 *
 * The books have to agree with the counter: these tests take real payments and expenses through the
 * services, then check that the totals, the cash close and every report derive from those same rows —
 * including the awkward cases (a voided entry, a closed day that refuses edits, an unknown report key).
 */

let harness: TestHarness
const TODAY = toLocalDate(Date.now())

function patientInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    ...({
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
    status: 'active'
    } as PatientInput),
    ...overrides
  }
}

function entryInput(overrides: Partial<EntryInput> = {}): EntryInput {
  return {
    id: null,
    kind: 'expense',
    categoryId: null,
    categoryName: 'Clinic rent',
    entryDate: TODAY,
    amountMicro: 3_000_000,
    method: 'cash',
    reference: null,
    party: 'Landlord',
    description: 'Monthly rent for the chamber',
    notes: null,
    ...overrides
  } as EntryInput
}

beforeEach(() => {
  harness = createHarness()
})

afterEach(() => {
  harness.cleanup()
})

describe('accounting entries', () => {
  it('records income and expenses with numbers, and summarises them by category, method and day', () => {
    const expense = saveEntry(harness.ctx(), entryInput())
    const income = saveEntry(harness.ctx(), entryInput({ kind: 'income', categoryName: 'Lab service income', description: 'Dental lab work charged to patients', method: 'bkash', amountMicro: 1_500_000 }))

    expect(expense.entryNo).toMatch(/^ACC-\d{4}-\d{4}$/)
    expect(income.kind).toBe('income')
    expect(income.status).toBe('active')

    const page = listEntries(harness.ctx(), { limit: 50, offset: 0 } as never)
    expect(page.total).toBe(2)
    expect(page.totals).toEqual({ incomeMicro: 1_500_000, expenseMicro: 3_000_000, netMicro: -1_500_000 })

    const summary = accountingSummary(harness.ctx(), TODAY, TODAY)
    expect(summary.incomeMicro).toBe(1_500_000)
    expect(summary.expenseMicro).toBe(3_000_000)
    expect(summary.netMicro).toBe(-1_500_000)
    expect(summary.byCategory).toEqual(
      expect.arrayContaining([
        { kind: 'income', category: 'Lab service income', amountMicro: 1_500_000, entries: 1 },
        { kind: 'expense', category: 'Clinic rent', amountMicro: 3_000_000, entries: 1 }
      ])
    )
    expect(summary.byMethod).toEqual(
      expect.arrayContaining([
        { method: 'cash', incomeMicro: 0, expenseMicro: 3_000_000 },
        { method: 'bkash', incomeMicro: 1_500_000, expenseMicro: 0 }
      ])
    )
    expect(summary.daily).toEqual([{ date: TODAY, incomeMicro: 1_500_000, expenseMicro: 3_000_000 }])

    /* Editing an active entry is allowed and audited. */
    const edited = saveEntry(harness.ctx(), { ...entryInput({ id: expense.id }), amountMicro: 3_200_000 })
    expect(edited.amountMicro).toBe(3_200_000)
    expect(edited.entryNo).toBe(expense.entryNo)
  })

  it('voids an entry instead of deleting it, so the books keep their history', () => {
    const entry = saveEntry(harness.ctx(), entryInput())
    const voided = voidEntry(harness.ctx(), { id: entry.id, reason: 'Recorded twice by mistake' })

    expect(voided.status).toBe('void')
    expect(voided.voidReason).toBe('Recorded twice by mistake')
    expect(voided.amountMicro).toBe(entry.amountMicro)

    const active = listEntries(harness.ctx(), { limit: 50, offset: 0 } as never)
    expect(active.total).toBe(0)
    expect(active.totals.expenseMicro).toBe(0)

    const withVoid = listEntries(harness.ctx(), { includeVoid: true, limit: 50, offset: 0 } as never)
    expect(withVoid.total).toBe(1)
    expect(withVoid.items[0]?.status).toBe('void')
    expect(accountingSummary(harness.ctx(), TODAY, TODAY).expenseMicro).toBe(0)

    expect(() => saveEntry(harness.ctx(), { ...entryInput({ id: entry.id }), amountMicro: 1 })).toThrow(/void/i)
  })

  it('keeps categories useful: rename, deactivate, but never lose a built-in or a used one', () => {
    const seeded = listCategories(harness.ctx(), false)
    expect(seeded.length).toBeGreaterThan(8)
    expect(seeded.some((category) => category.kind === 'income')).toBe(true)

    const custom = saveCategory(harness.ctx(), { id: null, name: 'Sterilisation fluid', kind: 'expense', isActive: true })
    expect(custom.isSystem).toBe(false)
    expect(() => saveCategory(harness.ctx(), { id: null, name: 'sterilisation FLUID', kind: 'expense', isActive: true })).toThrow(/already exists/i)

    const renamed = saveCategory(harness.ctx(), { id: custom.id, name: 'Sterilisation supplies', kind: 'expense', isActive: false })
    expect(renamed.isActive).toBe(false)
    expect(listCategories(harness.ctx(), false).some((category) => category.id === custom.id)).toBe(false)

    const system = seeded.find((category) => category.isSystem)!
    expect(() => archiveCategory(harness.ctx(), { id: system.id, reason: 'Tidy up' })).toThrow(/built-in/i)

    const used = saveCategory(harness.ctx(), { id: null, name: 'Lab courier', kind: 'expense', isActive: true })
    saveEntry(harness.ctx(), entryInput({ categoryId: used.id, categoryName: used.name, description: 'Courier to the dental lab' }))
    expect(() => archiveCategory(harness.ctx(), { id: used.id, reason: 'Not needed' })).toThrow(/used by/i)

    const unused = saveCategory(harness.ctx(), { id: null, name: 'Parking', kind: 'expense', isActive: true })
    expect(archiveCategory(harness.ctx(), { id: unused.id, reason: 'Never used' })).toEqual({ ok: true })
    expect(listCategories(harness.ctx(), true).find((category) => category.id === unused.id)?.isActive).toBe(false)
  })
})

describe('day close', () => {
  function seedPatientAndPayment(method: string, amountMicro: number, index: number): void {
    const patientId = savePatient(harness.ctx(), patientInput({ fullName: `Rakib Hasan ${index}`, fullNameBn: null, phone: `0171234567${index}` } as Partial<PatientInput>)).id
    const invoice = saveInvoice(harness.ctx(), {
      id: null,
      patientId,
      visitId: null,
      appointmentId: null,
      issueAt: Date.now(),
      dueDate: null,
      discountBp: 0,
      notes: null,
      lines: [{ id: null, treatmentId: null, visitTreatmentId: null, description: 'Consultation', toothCodes: [], quantity: 1, unitPriceMicro: amountMicro, discountMicro: 0, notes: null }]
    } as never)
    addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro,
      method,
      reference: null,
      paidAt: Date.now(),
      notes: null
    } as never)
  }

  it('compares the counted drawer with the ledger, stores the variance and locks the day', () => {
    seedPatientAndPayment('cash', 2_000_000, 1)
    seedPatientAndPayment('bkash', 500_000, 2)
    saveEntry(harness.ctx(), entryInput({ categoryName: 'Clinical consumables', description: 'Gloves and gauze from the shop', amountMicro: 400_000 }))

    const before = dayCloseView(harness.ctx(), TODAY)
    expect(before.isClosed).toBe(false)
    /* ৳ 200 cash collected minus ৳ 40 cash expenses. */
    expect(before.cashCollectedMicro).toBe(2_000_000)
    expect(before.cashExpensesMicro).toBe(400_000)
    expect(before.expectedCashMicro).toBe(1_600_000)
    expect(before.byMethod).toEqual(expect.arrayContaining([{ method: 'cash', amountMicro: 2_000_000 }, { method: 'bkash', amountMicro: 500_000 }]))

    const closed = closeDay(harness.ctx(), { date: TODAY, countedCashMicro: 1_550_000, note: 'Counter short by 50 taka' })
    expect(closed.isClosed).toBe(true)
    expect(closed.varianceMicro).toBe(-50_000)
    expect(closed.closedAt).not.toBeNull()

    /* A closed day refuses new entries, edits and voids until it is reopened. */
    expect(() => saveEntry(harness.ctx(), entryInput({ description: 'Late electricity bill' }))).toThrow(/is closed/i)
    const existing = listEntries(harness.ctx(), { limit: 5, offset: 0 } as never).items[0]!
    expect(() => voidEntry(harness.ctx(), { id: existing.id, reason: 'Wrong amount' })).toThrow(/is closed/i)

    expect(() => closeDay(harness.ctx(), { date: TODAY, countedCashMicro: 1_600_000 })).toThrow(/already closed/i)

    const reopened = reopenDay(harness.ctx(), { date: TODAY, reason: 'A receipt was missing from the drawer' })
    expect(reopened.isClosed).toBe(false)
    expect(saveEntry(harness.ctx(), entryInput({ description: 'Late electricity bill' })).id).toBeGreaterThan(0)

    const history = dayCloses(harness.ctx(), { from: TODAY, to: TODAY, limit: 10, offset: 0 })
    expect(history.total).toBe(1)
    expect(history.items[0]?.isClosed).toBe(false)

    /* Closing again overwrites the same day row rather than piling up duplicates. */
    const expectedAfterLateBill = dayCloseView(harness.ctx(), TODAY).expectedCashMicro
    const reclosed = closeDay(harness.ctx(), { date: TODAY, countedCashMicro: expectedAfterLateBill, note: 'Recounted after adding the receipt' })
    expect(reclosed.varianceMicro).toBe(0)
    expect(dayCloses(harness.ctx(), { from: TODAY, to: TODAY, limit: 10, offset: 0 }).total).toBe(1)
    expect(getEntry(harness.ctx(), existing.id).status).toBe('active')
  })
})

describe('reports', () => {
  it('runs every catalogued report on real data and exports the same numbers it shows', () => {
    const patientId = savePatient(harness.ctx(), patientInput()).id
    const dentistId = saveDentist(harness.ctx(), {
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
    } as DentistInput).id
    const treatment = saveTreatment(harness.ctx(), {
      id: null,
      code: null,
      name: 'Composite filling',
      nameBn: null,
      category: 'restorative',
      description: null,
      defaultPriceMicro: 4_500_000,
      durationMin: 30,
      isActive: true,
      notes: null
    } as TreatmentInput)
    const visitId = saveVisit(harness.ctx(), {
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
      status: 'final'
    } as VisitInput).id
    addVisitTreatment(harness.ctx(), {
      visitId,
      treatmentId: treatment.id,
      treatmentName: treatment.name,
      toothCodes: ['36'],
      quantity: 1,
      unitPriceMicro: treatment.defaultPriceMicro,
      discountMicro: 0,
      status: 'completed',
      notes: null
    } as never)

    const invoice = saveInvoice(harness.ctx(), {
      id: null,
      patientId,
      visitId,
      appointmentId: null,
      issueAt: Date.now(),
      dueDate: null,
      discountBp: 0,
      notes: null,
      lines: [{ id: null, treatmentId: null, visitTreatmentId: null, description: 'Composite filling', toothCodes: [], quantity: 1, unitPriceMicro: 4_500_000, discountMicro: 0, notes: null }]
    } as never)
    addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 2_000_000,
      method: 'bkash',
      reference: null,
      paidAt: Date.now(),
      notes: null
    } as never)

    const item = saveItem(harness.ctx(), {
      id: null,
      code: null,
      name: 'Composite resin A2',
      category: 'restorative',
      unit: 'syringe',
      supplierId: null,
      purchasePriceMicro: 120_000,
      sellingPriceMicro: 0,
      reorderLevel: 5,
      expiryTracking: false,
      location: 'Cabinet A',
      notes: null,
      isActive: true
    } as InventoryItemInput)
    recordMovement(harness.ctx(), {
      itemId: item.id,
      batchId: null,
      movementType: 'opening',
      quantity: 10,
      unitCostMicro: 120_000,
      reason: 'Opening stock at go-live',
      reference: null,
      supplierId: null,
      at: null
    } as never)

    saveEntry(harness.ctx(), entryInput({ categoryName: 'Clinical consumables', description: 'Gauze and gloves', amountMicro: 700_000 }))

    const catalog = reportCatalog(harness.ctx())
    expect(catalog).toHaveLength(10)
    for (const definition of catalog) {
      const report = runReport(harness.ctx(), { key: definition.key, limit: 200 })
      expect(report.key).toBe(definition.key)
      expect(report.columns.length).toBeGreaterThan(0)
      expect(report.generatedAt).toBeGreaterThan(0)
      /* Every row only uses declared columns, so the table and the CSV can never disagree. */
      for (const row of report.rows) {
        for (const key of Object.keys(row)) expect(report.columns.some((column) => column.key === key)).toBe(true)
      }
    }

    const revenue = runReport(harness.ctx(), { key: 'revenue_daily', limit: 200 })
    expect(revenue.rows[0]).toMatchObject({ date: TODAY, received: 2_000_000, net: 2_000_000 })
    expect(revenue.totals.find((total) => total.label === 'Net')?.value).toBe(2_000_000)

    const methods = runReport(harness.ctx(), { key: 'collections_method', limit: 200 })
    expect(methods.rows[0]).toMatchObject({ method: 'bkash', received: 2_000_000 })

    const receivables = runReport(harness.ctx(), { key: 'receivables', limit: 200 })
    expect(receivables.rows[0]).toMatchObject({ invoice: invoice.invoiceNo, patient: 'Rakib Hasan', due: 2_500_000, ageDays: 0 })
    expect(receivables.totals.find((total) => total.label === '0–30 days')?.value).toBe(2_500_000)

    const treatments = runReport(harness.ctx(), { key: 'top_treatments', limit: 200 })
    expect(treatments.rows[0]).toMatchObject({ treatment: 'Composite filling', times: 1, revenue: 4_500_000 })

    const workload = runReport(harness.ctx(), { key: 'dentist_workload', limit: 200 })
    expect(workload.rows[0]).toMatchObject({ dentist: 'Dr Ayesha Rahman', visits: 1, appointments: 0, revenue: 4_500_000 })

    const expenses = runReport(harness.ctx(), { key: 'expenses_category', limit: 200 })
    expect(expenses.rows[0]).toMatchObject({ category: 'Clinical consumables', entries: 1, amount: 700_000 })

    const profit = runReport(harness.ctx(), { key: 'profit_loss', limit: 200 })
    expect(profit.rows.find((row) => row.line === 'Net')?.amount).toBe(1_300_000)
    expect(profit.note).toMatch(/working capital/i)

    const stock = runReport(harness.ctx(), { key: 'stock_value', limit: 200 })
    expect(stock.rows[0]).toMatchObject({ category: 'restorative', items: 1, value: 1_200_000 })

    const growth = runReport(harness.ctx(), { key: 'patient_growth', limit: 200 })
    expect(growth.rows[0]).toMatchObject({ month: TODAY.slice(0, 7), patients: 1 })

    const appointments = runReport(harness.ctx(), { key: 'appointment_stats', limit: 200 })
    expect(appointments.rows).toHaveLength(0)
    expect(appointments.note).toMatch(/no appointments/i)

    expect(() => runReport(harness.ctx(), { key: 'not_a_report', limit: 10 })).toThrow(/could not be found/i)
  })
})

describe('accounting permissions', () => {
  it('separates reading the books from changing them, and reports from accounting', () => {
    saveEntry(harness.ctx(), entryInput())
    const reader = harness.ctx(['accounting.view'])

    expect(listEntries(reader, { limit: 10, offset: 0 } as never).total).toBe(1)
    expect(accountingSummary(reader, TODAY, TODAY).expenseMicro).toBe(3_000_000)
    expect(dayCloseView(reader, TODAY).date).toBe(TODAY)

    expect(() => saveEntry(reader, entryInput({ description: 'Not allowed' }))).toThrow(/permission/i)
    expect(() => voidEntry(reader, { id: 1, reason: 'Not allowed' })).toThrow(/permission/i)
    expect(() => saveCategory(reader, { id: null, name: 'Something', kind: 'expense', isActive: true })).toThrow(/permission/i)
    expect(() => closeDay(reader, { date: TODAY, countedCashMicro: 0 })).toThrow(/permission/i)
    expect(() => reportCatalog(reader)).toThrow(/permission/i)

    const accountant = harness.ctx(['accounting.view', 'accounting.reports'])
    expect(reportCatalog(accountant)).toHaveLength(10)
  })
})
