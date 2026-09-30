import { describe, expect, it } from 'vitest'
import { createHarness } from './helpers'
import { savePatient } from '@main/modules/patients/service'
import { saveDentist } from '@main/modules/dentists/service'
import { addVisitTreatment, saveVisit } from '@main/modules/clinical/visits'
import { savePrescription } from '@main/modules/clinical/prescriptions'
import { saveInvoice } from '@main/modules/billing/invoices'
import { addPayment } from '@main/modules/billing/payments'
import { saveItem } from '@main/modules/inventory/items'
import { recordMovement } from '@main/modules/inventory/movements'

/**
 * Database relationship review (checkpoint 18, spec §11/§12/§93).
 *
 * `tests/integration/database.test.ts` proves the schema builds, migrates, enforces foreign keys and
 * keeps the audit log append-only on an empty database. This file reviews the same schema *after real
 * workflows have written through the services*: relationships still hold, every table has a natural
 * key, the tables that archive rows keep their soft-delete column, and the constraints that stop
 * duplicate or nonsensical rows are really part of the schema rather than a promise in a document.
 */

const harness = createHarness()
const db = harness.database.db
const actor = harness.ctx()

interface TableInfo {
  name: string
  sql: string
}

const tables = (): TableInfo[] =>
  db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as TableInfo[]

const columns = (table: string): string[] =>
  (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((column) => column.name)

/** Writes one row of every kind the clinic produces, through the services. */
function seedClinic(): { dentistId: number } {
  const dentist = saveDentist(actor, {
    fullName: 'Dr. Relation Review',
    fullNameBn: null,
    phone: null,
    email: null,
    registrationNo: null,
    signatureLabel: null,
    color: null,
    isActive: true,
    sortOrder: 1,
    designations: [],
    qualifications: [],
    schedules: []
  } as never)

  const patient = savePatient(actor, {
    fullName: 'Relationship Test',
    fullNameBn: 'সম্পর্ক পরীক্ষা',
    dob: null,
    ageYears: 40,
    gender: 'female',
    bloodGroup: null,
    phone: '01799999999',
    altPhone: null,
    emergencyPhone: null,
    address: 'Tangail',
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
    tags: ['review'],
    status: 'active'
  } as never)

  const visit = saveVisit(actor, {
    patientId: patient.id,
    dentistId: dentist.id,
    appointmentId: null,
    visitAt: Date.now(),
    chiefComplaint: 'Review',
    examination: 'Review',
    diagnosis: 'Review',
    advice: null,
    treatmentPlan: null,
    status: 'final'
  } as never)

  addVisitTreatment(actor, {
    visitId: visit.id,
    treatmentId: null,
    treatmentName: 'Scaling',
    toothCodes: ['16', '26'],
    quantity: 1,
    unitPriceMicro: 150_000,
    discountMicro: 0,
    status: 'completed'
  } as never)

  savePrescription(actor, {
    patientId: patient.id,
    dentistId: dentist.id,
    visitId: visit.id,
    prescriptionAt: Date.now(),
    diagnosis: 'Review',
    ccText: null,
    oeText: null,
    advice: null,
    medicines: [
      {
        sortOrder: 1,
        medicineName: 'Paracetamol 500 mg',
        form: 'tablet',
        strength: '500 mg',
        unit: null,
        doseMorning: '1',
        doseAfternoon: null,
        doseNight: '1',
        timing: 'after_meal',
        frequency: '1+0+1',
        durationDays: 3,
        durationText: null,
        quantity: '6',
        isPrn: false,
        instructions: null
      }
    ]
  } as never)

  const invoice = saveInvoice(actor, {
    patientId: patient.id,
    visitId: visit.id,
    appointmentId: null,
    issueAt: Date.now(),
    dueDate: null,
    discountBp: 0,
    notes: null,
    lines: [
      {
        treatmentId: null,
        visitTreatmentId: null,
        description: 'Scaling',
        toothCodes: ['16'],
        quantity: 1,
        unitPriceMicro: 150_000,
        discountMicro: 0
      }
    ]
  } as never)

  addPayment(actor, {
    patientId: patient.id,
    invoiceId: invoice.id,
    kind: 'payment',
    amountMicro: 50_000,
    method: 'cash',
    reference: null,
    paidAt: Date.now(),
    notes: null
  } as never)

  const item = saveItem(actor, {
    id: null,
    code: null,
    name: 'Review gloves',
    category: 'consumable',
    unit: 'box',
    supplierId: null,
    purchasePriceMicro: 30_000,
    sellingPriceMicro: 0,
    reorderLevel: 2,
    expiryTracking: false,
    location: null,
    notes: null,
    isActive: true
  } as never)

  recordMovement(actor, {
    itemId: item.id,
    movementType: 'opening',
    quantity: 5,
    unitCostMicro: 30_000,
    reason: 'Opening stock recorded during the relationship review',
    batchNo: null,
    expiryDate: null,
    supplierId: null,
    reference: null,
    note: null
  } as never)

  return { dentistId: dentist.id }
}

const seeded = seedClinic()

describe('database relationship review', () => {
  it('holds every relationship after real workflows have written data', () => {
    const violations = db.pragma('foreign_key_check') as Array<Record<string, unknown>>
    expect(violations).toEqual([])
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    expect(integrity.map((row) => row.integrity_check)).toEqual(['ok'])

    const rows = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM patients) AS patients, (SELECT COUNT(*) FROM visits) AS visits,
                (SELECT COUNT(*) FROM invoices) AS invoices, (SELECT COUNT(*) FROM payments) AS payments,
                (SELECT COUNT(*) FROM prescription_medicines) AS medicines,
                (SELECT COUNT(*) FROM inventory_movements) AS movements`
      )
      .get() as Record<string, number>
    for (const [table, count] of Object.entries(rows)) {
      expect(count, `${table} should have been written by the seed`).toBeGreaterThan(0)
    }
  })

  it('gives every table a primary key', () => {
    const missing: string[] = []
    for (const table of tables()) {
      const info = db.pragma(`table_info(${table.name})`) as Array<{ name: string, pk: number }>
      if (!info.some((column) => column.pk > 0)) missing.push(table.name)
    }
    expect(missing).toEqual([])
  })

  it('enforces relationships instead of only declaring them', () => {
    // A child row that points nowhere must be refused by SQLite, not by a service-level check.
    expect(() => db.prepare('INSERT INTO visits (patient_id, dentist_id, visit_at, status) VALUES (999999, 1, 1, \'final\')').run()).toThrow()
    expect(() => db.prepare("INSERT INTO prescription_medicines (prescription_id, sort_order, medicine_name) VALUES (999999, 1, 'Nope')").run()).toThrow()
    expect(() => db.prepare("INSERT INTO inventory_movements (item_id, movement_type, quantity, reason) VALUES (999999, 'opening', 1, 'orphan')").run()).toThrow()
  })

  it('keeps the soft-delete column exactly on the tables that archive rows', () => {
    /* Spec §93: a record the clinic stops using is archived, never deleted. The tables below are the
       complete list that carries `is_deleted`; everything else is append-only history (`payments`,
       `accounting_entries`, `inventory_movements`, `audit_log`, `print_history`, `login_attempts`,
       `day_closes`, `purchases`) or catalogue state (`roles`, `clinical_findings`, `settings`) and is
       deliberately never removed row by row. */
    const expected = [
      'appointments',
      'dentists',
      'inventory_items',
      'invoices',
      'patient_attachments',
      'patients',
      'prescriptions',
      'print_profiles',
      'referrals',
      'staff',
      'suppliers',
      'treatments',
      'users',
      'visits'
    ].sort()
    const actual = tables()
      .filter((table) => {
        const cols = columns(table.name)
        return cols.includes('is_deleted') || cols.includes('deleted_at')
      })
      .map((table) => table.name)
      .sort()
    expect(actual).toEqual(expected)
  })

  it('declares the uniqueness and validity rules the database itself must carry', () => {
    // Uniqueness is the database's job: business codes, folded names and join tables. Inline UNIQUE
    // columns create automatic indexes, so count the index list rather than the CREATE statements.
    let uniqueIndexes = 0
    for (const table of tables()) {
      const list = db.pragma(`index_list(${table.name})`) as Array<{ unique: number }>
      uniqueIndexes += list.filter((entry) => entry.unique === 1).length
    }
    expect(uniqueIndexes).toBeGreaterThanOrEqual(20)

    // A duplicate stock code is refused by the database, whatever the service layer does.
    const insertItem = (code: string, name: string): void => {
      db.prepare(
        "INSERT INTO inventory_items (code, name, name_fold, category, unit, is_active, is_deleted, created_at, updated_at) VALUES (?, ?, ?, 'consumable', 'box', 1, 0, 1, 1)"
      ).run(code, name, name.toLowerCase())
    }
    insertItem('ITM-DUP', 'Dup')
    expect(() => insertItem('ITM-DUP', 'Dup again')).toThrow()

    // Singleton tables can only ever hold one row.
    expect(() => db.prepare('INSERT INTO clinic (id) VALUES (2)').run()).toThrow()
    expect(() => db.prepare('INSERT INTO license_state (id) VALUES (2)').run()).toThrow()

    // A weekly schedule outside the calendar week is refused.
    expect(() =>
      db
        .prepare(
          "INSERT INTO dentist_schedules (dentist_id, weekday, start_time, end_time, slot_minutes, is_active) VALUES (?, 9, '09:00', '10:00', 30, 1)"
        )
        .run(seeded.dentistId)
    ).toThrow()
  })
})
