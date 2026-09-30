import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveDentist, type DentistInput } from '@main/modules/dentists/service'
import { addVisitTreatment, getVisitSummary, saveVisit, type VisitInput } from '@main/modules/clinical/visits'
import { saveTreatment, type TreatmentInput } from '@main/modules/clinical/treatments'
import {
  billableLines,
  deleteInvoice,
  getInvoice,
  invoicesForVisit,
  listInvoices,
  saveInvoice,
  voidInvoice,
  type InvoiceInput
} from '@main/modules/billing/invoices'
import { addPayment, dailyCollections, listPayments, voidPayment } from '@main/modules/billing/payments'
import { PERMISSION_CODES } from '@shared/permissions'
import { fromLocalDate, toLocalDate } from '@shared/datetime'

/**
 * Billing integration tests.
 *
 * Money is the part of a clinic system that must never drift, so these tests cover the full life cycle
 * against a real database: an invoice raised from visit treatments, partial payment, the discount limit
 * that depends on the role, refunds, voiding a wrong payment (which writes a linked reversal), and the
 * rule that a void invoice can never hide a balance.
 */

let harness: TestHarness
let patientId: number
let dentistId: number
let visitId: number

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

function treatmentInput(overrides: Partial<TreatmentInput> = {}): TreatmentInput {
  return {
    id: null,
    code: null,
    name: 'Composite filling',
    nameBn: null,
    category: 'restorative',
    description: null,
    defaultPriceMicro: 200_000,
    durationMin: 30,
    isActive: true,
    notes: null,
    ...overrides
  } as TreatmentInput
}

function visitInput(): VisitInput {
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
    status: 'final'
  } as VisitInput
}

function invoiceInput(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
  return {
    id: null,
    patientId,
    visitId,
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
        description: 'Composite filling',
        toothCodes: ['36'],
        quantity: 1,
        unitPriceMicro: 200_000,
        discountMicro: 0,
        notes: null
      }
    ],
    ...overrides
  } as InvoiceInput
}

beforeEach(() => {
  harness = createHarness()
  patientId = savePatient(harness.ctx(), patientInput()).id
  dentistId = saveDentist(harness.ctx(), dentistInput()).id
  const treatment = saveTreatment(harness.ctx(), treatmentInput())
  visitId = saveVisit(harness.ctx(), visitInput()).id
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
  })
})

afterEach(() => {
  harness.cleanup()
})

describe('invoices', () => {
  it('raises an invoice from a visit treatment line and keeps the arithmetic exact', () => {
    const billable = billableLines(harness.ctx(), visitId)
    expect(billable).toHaveLength(1)
    expect(billable[0]?.billed).toBe(false)

    const invoice = saveInvoice(
      harness.ctx(),
      invoiceInput({
        lines: [
          {
            id: null,
            treatmentId: billable[0]?.treatmentId ?? null,
            visitTreatmentId: billable[0]?.visitTreatmentId ?? null,
            description: billable[0]?.description ?? '',
            toothCodes: billable[0]?.toothCodes ?? [],
            quantity: 1,
            unitPriceMicro: billable[0]?.unitPriceMicro ?? 0,
            discountMicro: 20_000,
            notes: null
          }
        ]
      })
    )

    expect(invoice.invoiceNo).toMatch(/^INV-\d{4}-\d{4}$/)
    expect(invoice.subtotalMicro).toBe(200_000)
    expect(invoice.discountMicro).toBe(20_000)
    expect(invoice.totalMicro).toBe(180_000)
    expect(invoice.dueMicro).toBe(180_000)
    expect(invoice.status).toBe('unpaid')
    expect(invoice.lines[0]?.lineTotalMicro).toBe(180_000)

    /* The line is now on a live invoice, so it cannot be billed twice. */
    expect(billableLines(harness.ctx(), visitId)[0]?.billed).toBe(true)
    const line = billableLines(harness.ctx(), visitId)[0]
    expect(() =>
      saveInvoice(
        harness.ctx(),
        invoiceInput({
          lines: [
            {
              id: null,
              treatmentId: line?.treatmentId ?? null,
              visitTreatmentId: line?.visitTreatmentId ?? null,
              description: line?.description ?? '',
              toothCodes: [],
              quantity: 1,
              unitPriceMicro: 200_000,
              discountMicro: 0,
              notes: null
            }
          ]
        })
      )
    ).toThrow(/already on invoice/i)
    expect(invoicesForVisit(harness.ctx(), visitId).map((entry) => entry.id)).toEqual([invoice.id])
  })

  it('applies the role discount limit and allows an override permission to exceed it', () => {
    const limited = harness.ctx(PERMISSION_CODES.filter((code) => code !== 'billing.discount_override'))

    /* A 40 % invoice discount is well beyond an assistant's limit. */
    expect(() => saveInvoice(limited, invoiceInput({ discountBp: 4_000 }))).toThrow(/discount/i)

    const owner = harness.ctx()
    const invoice = saveInvoice(owner, invoiceInput({ discountBp: 4_000 }))
    expect(invoice.discountMicro).toBe(80_000)
    expect(invoice.dueMicro).toBe(120_000)
  })

  it('records partial payments, refuses overpayment and closes the invoice when settled', () => {
    const invoice = saveInvoice(harness.ctx(), invoiceInput())

    const afterPartial = addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 100_000,
      method: 'bkash',
      reference: 'BK-77812',
      paidAt: Date.now(),
      notes: null
    })
    expect(afterPartial.paidMicro).toBe(100_000)
    expect(afterPartial.dueMicro).toBe(100_000)
    expect(afterPartial.status).toBe('partial')
    expect(afterPartial.payments[0]?.receiptNo).toMatch(/^RCP-\d{4}-\d{4}$/)
    expect(afterPartial.payments[0]?.method).toBe('bkash')

    expect(() =>
      addPayment(harness.ctx(), {
        patientId,
        invoiceId: invoice.id,
        kind: 'payment',
        amountMicro: 500_000,
        method: 'cash',
        reference: null,
        paidAt: Date.now(),
        notes: null
      })
    ).toThrow(/more than the outstanding/i)

    const settled = addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 100_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: null
    })
    expect(settled.status).toBe('paid')
    expect(settled.dueMicro).toBe(0)
    expect(settled.payments).toHaveLength(2)
  })

  it('refunds part of a payment and reopens the balance', () => {
    const invoice = saveInvoice(harness.ctx(), invoiceInput())
    const paid = addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 200_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: null
    })
    expect(paid.status).toBe('paid')

    const refunded = addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'refund',
      amountMicro: 50_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: 'Treatment not completed'
    })
    expect(refunded.refundedMicro).toBe(50_000)
    expect(refunded.dueMicro).toBe(50_000)
    expect(refunded.status).toBe('partial')

    expect(() =>
      addPayment(harness.ctx(), {
        patientId,
        invoiceId: invoice.id,
        kind: 'refund',
        amountMicro: 500_000,
        method: 'cash',
        reference: null,
        paidAt: Date.now(),
        notes: null
      })
    ).toThrow(/cannot be larger/i)
  })

  it('voids a wrong payment by writing a linked reversal and recomputing the balance', () => {
    const invoice = saveInvoice(harness.ctx(), invoiceInput())
    const wrong = addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 200_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: 'Entered twice'
    })

    const afterVoid = voidPayment(harness.ctx(), { id: wrong.payments[0]!.id, reason: 'Duplicate entry from the same patient payment' })
    expect(afterVoid.status).toBe('unpaid')
    expect(afterVoid.dueMicro).toBe(200_000)
    expect(afterVoid.paidMicro).toBe(0)
    expect(afterVoid.refundedMicro).toBe(0)

    const history = listPayments(harness.ctx(), { invoiceId: invoice.id, limit: 50, offset: 0 } as never)
    expect(history.items).toHaveLength(2)
    const reversal = history.items.find((entry) => entry.reversesPaymentId !== null)
    /* The correction is recorded as a reverser, not as money leaving the clinic. */
    expect(reversal?.kind).toBe('payment')
    expect(reversal?.status).toBe('reversal')
    expect(reversal?.reference).toBe(wrong.payments[0]?.receiptNo)
    /* The original receipt stays in the history, marked void with its reason. */
    const original = history.items.find((entry) => entry.id === wrong.payments[0]?.id)
    expect(original?.status).toBe('void')
    expect(original?.voidReason).toContain('Duplicate')
  })

  it('refuses to void an invoice that still has payments and allows voiding a clean one', () => {
    const invoice = saveInvoice(harness.ctx(), invoiceInput())
    addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 50_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: null
    })

    expect(() => voidInvoice(harness.ctx(), { id: invoice.id, reason: 'Wrong patient selected at billing time' })).toThrow(/payments recorded/i)

    const clean = saveInvoice(
      harness.ctx(),
      invoiceInput({
        visitId: null,
        lines: [{ id: null, treatmentId: null, visitTreatmentId: null, description: 'Consultation', toothCodes: [], quantity: 1, unitPriceMicro: 50_000, discountMicro: 0, notes: null }]
      })
    )
    const voided = voidInvoice(harness.ctx(), { id: clean.id, reason: 'Duplicate invoice for the same visit' })
    expect(voided.status).toBe('void')
    expect(voided.voidReason).toBe('Duplicate invoice for the same visit')

    /* A void invoice is excluded from live billing totals but still visible in the list. */
    const listed = listInvoices(harness.ctx(), { limit: 50, offset: 0 } as never)
    expect(listed.items.map((entry) => entry.id)).toEqual(expect.arrayContaining([invoice.id, clean.id]))
    expect(listed.totals.dueMicro).toBe(150_000)
  })

  it('deletes only invoices that were never paid, and never through the wrong permission', () => {
    const invoice = saveInvoice(harness.ctx(), invoiceInput())
    expect(deleteInvoice(harness.ctx(), { id: invoice.id, reason: 'Raised against the wrong patient' })).toEqual({ ok: true })
    expect(() => getInvoice(harness.ctx(), invoice.id)).toThrow(/could not be found/i)

    const paidInvoice = saveInvoice(harness.ctx(), invoiceInput())
    addPayment(harness.ctx(), {
      patientId,
      invoiceId: paidInvoice.id,
      kind: 'payment',
      amountMicro: 50_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: null
    })
    expect(() => deleteInvoice(harness.ctx(), { id: paidInvoice.id, reason: 'Changed my mind' })).toThrow(/cannot be deleted|cannot be deleted/i)

    const reader = harness.ctx(['billing.view'])
    expect(() => deleteInvoice(reader, { id: paidInvoice.id, reason: 'Not allowed' })).toThrow(/permission/i)
    expect(() => saveInvoice(reader, invoiceInput())).toThrow(/permission/i)
    expect(() => voidInvoice(reader, { id: paidInvoice.id, reason: 'Not allowed either' })).toThrow(/permission/i)
  })

  it('reports the day’s collections per payment method and keeps patient dues in step', () => {
    const invoice = saveInvoice(harness.ctx(), invoiceInput())
    addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 120_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: null
    })
    addPayment(harness.ctx(), {
      patientId,
      invoiceId: invoice.id,
      kind: 'payment',
      amountMicro: 30_000,
      method: 'nagad',
      reference: 'NGD-9911',
      paidAt: Date.now(),
      notes: null
    })

    const day = toLocalDate(Date.now())
    const daily = dailyCollections(harness.ctx(), day, day)
    expect(daily).toHaveLength(1)
    expect(daily[0]?.receivedMicro).toBe(150_000)
    expect(daily[0]?.payments).toBe(2)

    const patientRow = harness.database.db.prepare('SELECT due_micro, paid_micro FROM patient_financials WHERE patient_id = ?').get(patientId) as {
      due_micro: number
      paid_micro: number
    }
    expect(patientRow.due_micro).toBe(50_000)
    expect(patientRow.paid_micro).toBe(150_000)

    const summary = getVisitSummary(harness.ctx(), visitId)
    expect(summary.invoices[0]?.dueMicro).toBe(50_000)
  })

  it('keeps the outstanding dues list exact', () => {
    const older = saveInvoice(harness.ctx(), invoiceInput({ issueAt: fromLocalDate('2026-09-01') + 10 * 3_600_000 }))
    const newer = saveInvoice(harness.ctx(), invoiceInput({ issueAt: fromLocalDate('2026-09-15') + 10 * 3_600_000 }))
    addPayment(harness.ctx(), {
      patientId,
      invoiceId: older.id,
      kind: 'payment',
      amountMicro: 200_000,
      method: 'cash',
      reference: null,
      paidAt: Date.now(),
      notes: null
    })

    const withDue = listInvoices(harness.ctx(), { hasDue: true, limit: 50, offset: 0 } as never)
    expect(withDue.items.map((entry) => entry.id)).toEqual([newer.id])
    expect(withDue.totals.dueMicro).toBe(200_000)

    const all = listInvoices(harness.ctx(), { limit: 50, offset: 0 } as never)
    expect(all.totals.invoicedMicro).toBe(400_000)
    expect(all.totals.paidMicro).toBe(200_000)
  })
})
