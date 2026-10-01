#!/usr/bin/env tsx
/**
 * Stress dataset.
 *
 * Builds the dataset the performance budget in `docs/TEST_PLAN.md` is measured against: tens of
 * thousands of patients, hundreds of thousands of visits, appointments, invoices and payments, plus
 * inventory and prescriptions. Rows are created through the application's own services — the same code
 * the screens call — so every constraint, counter, fold column and audit entry behaves exactly as it
 * does in production; a dataset that bypassed the services would measure something the clinic never
 * experiences.
 *
 * The target is a scratch directory (`DENTIVA_DATA_DIR`, default `.dentiva-stress`). The script refuses
 * to touch an existing clinic database unless it is told to reset it, because "seed 10 000 patients" is
 * not a sentence anybody wants to hear about their real data.
 *
 * Usage:
 *   npm run stress:seed
 *   npm run stress:seed -- --patients=10000 --visits=100000
 *   DENTIVA_DATA_DIR=/tmp/dentiva-stress npm run stress:seed -- --reset
 */

import { mkdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createNodeHost } from '@main/platform/nodeHost'
import { openDatabase } from '@main/db/connection'
import { createServiceContext, type ServiceContext } from '@main/context'
import { PERMISSION_CODES } from '@shared/permissions'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveDentist, type DentistInput } from '@main/modules/dentists/service'
import { saveAppointment, type AppointmentInput } from '@main/modules/scheduling/appointments'
import { saveVisit, type VisitInput } from '@main/modules/clinical/visits'
import { listConditions, setChartEntry } from '@main/modules/clinical/chart'
import { savePrescription, type MedicineInput, type PrescriptionInput } from '@main/modules/clinical/prescriptions'
import { saveInvoice, type InvoiceInput } from '@main/modules/billing/invoices'
import { addPayment, type PaymentInput } from '@main/modules/billing/payments'
import { saveItem, type InventoryItemInput } from '@main/modules/inventory/items'
import { recordMovement } from '@main/modules/inventory/movements'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import { ADULT_TEETH } from '@shared/dental'

interface Targets {
  patients: number
  appointments: number
  visits: number
  prescriptions: number
  invoices: number
  payments: number
  items: number
  chart: number
}

const DEFAULTS: Targets = {
  patients: 10_000,
  appointments: 20_000,
  visits: 100_000,
  prescriptions: 50_000,
  invoices: 100_000,
  payments: 100_000,
  items: 5_000,
  chart: 40_000
}

/* The scheduler refuses a second appointment in the same slot for the same dentist, so appointment
   volume is bounded by the number of dentists × bookable slots. The generator books up to a full day of
   slots (morning and evening sessions, 30-minute steps) across 180 days and as many as 12 dentists. */
const BOOKING_DAYS = 180
const SLOTS_PER_DAY = 16
const MAX_DENTISTS = 12
const APPOINTMENT_CAPACITY = BOOKING_DAYS * SLOTS_PER_DAY * MAX_DENTISTS

function argument(name: string): string | null {
  const prefix = `--${name}=`
  const entry = process.argv.find((value) => value.startsWith(prefix))
  return entry ? entry.slice(prefix.length) : null
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function target(name: keyof Targets): number {
  const raw = argument(name)
  if (!raw) return DEFAULTS[name]
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    console.error(`stress-seed: --${name}=${raw} is not a valid count.`)
    process.exit(1)
  }
  return Math.floor(value)
}

const targets: Targets = {
  patients: target('patients'),
  appointments: target('appointments'),
  visits: target('visits'),
  prescriptions: target('prescriptions'),
  invoices: target('invoices'),
  payments: target('payments'),
  items: target('items'),
  chart: target('chart')
}

const dataDir = process.env.DENTIVA_DATA_DIR ?? join(process.cwd(), '.dentiva-stress')
const reset = flag('reset')
const batch = Number(argument('batch') ?? 500)

/**
 * True when the directory already holds a clinic database. The database lives in the `data`
 * subdirectory of the data directory (`AppPaths.databaseFile`), not at its root — checking the root
 * made both the refusal and `--reset` no-ops, so a second run reused a half-seeded dataset and failed
 * on the first duplicate patient instead of saying so.
 */
function hasData(directory: string): boolean {
  try {
    return statSync(join(directory, 'data', 'dentiva.db')).size > 0
  } catch {
    return false
  }
}

if (hasData(dataDir)) {
  if (!reset) {
    console.error(`stress-seed: ${dataDir} already contains a database. Pass --reset to replace it.`)
    process.exit(1)
  }
  rmSync(dataDir, { recursive: true, force: true })
}
mkdirSync(dataDir, { recursive: true })

const host = createNodeHost({ dataDir, loggerEnabled: false })
const database = openDatabase({ filePath: host.paths.databaseFile, now: () => host.now() })
const ctx: ServiceContext = createServiceContext({
  db: database.db,
  host,
  actor: { userId: 0, username: 'stress-seed', fullName: 'Stress seed', roleId: 0, roleCode: 'stress', permissions: new Set(PERMISSION_CODES), maxDiscountBasisPoints: 10_000 }
})

const started = Date.now()
const timings: Array<{ entity: string, count: number, ms: number }> = []

function progress(entity: string, done: number, total: number, from: number): void {
  if (done % batch === 0 || done === total) {
    const elapsed = Date.now() - from
    process.stdout.write(`\r  ${entity}: ${done}/${total} (${(elapsed / 1000).toFixed(1)}s)`)
  }
}

function timed(entity: string, count: number, run: () => void): void {
  const from = Date.now()
  run()
  process.stdout.write('\r')
  timings.push({ entity, count, ms: Date.now() - from })
  console.log(`  ${entity}: ${count} row(s) in ${((Date.now() - from) / 1000).toFixed(1)}s`)
}

/* ------------------------------------------------------------------ reference data */

const DENTIST_FIRST = ['Ayesha', 'Mostafa', 'Shamim', 'Nusrat', 'Habibur', 'Rehana', 'Tanvir', 'Sabrina', 'Jamil', 'Ferdous', 'Rima', 'Anisur']
const DENTIST_FIRST_BN = ['আয়েশা', 'মোস্তফা', 'শামীম', 'নুসরাত', 'হাবিবুর', 'রেহানা', 'তানভীর', 'সাবরিনা', 'জামিল', 'ফেরদৌস', 'রিমা', 'আনিসুর']
const DENTIST_LAST = ['Rahman', 'Hossain', 'Chowdhury', 'Islam', 'Ahmed', 'Khatun']
const DENTIST_LAST_BN = ['রহমান', 'হোসেন', 'চৌধুরী', 'ইসলাম', 'আহমেদ', 'খাতুন']

const dentists: number[] = []
for (let index = 0; index < MAX_DENTISTS; index += 1) {
  const first = DENTIST_FIRST[index % DENTIST_FIRST.length]!
  const firstBn = DENTIST_FIRST_BN[index % DENTIST_FIRST_BN.length]!
  const last = DENTIST_LAST[Math.floor(index / DENTIST_FIRST.length) % DENTIST_LAST.length]!
  const lastBn = DENTIST_LAST_BN[Math.floor(index / DENTIST_FIRST.length) % DENTIST_LAST_BN.length]!
  dentists.push(
    saveDentist(ctx, {
      id: null,
      fullName: `Dr. ${first} ${last}`,
      fullNameBn: `ডা. ${firstBn} ${lastBn}`,
      phone: null,
      email: null,
      registrationNo: `BMDC-${20_000 + index}`,
      signatureLabel: index % 2 === 0 ? 'Consultant Dental Surgeon' : 'Dental Surgeon',
      color: null,
      designations: index % 2 === 0 ? ['BDS', 'MDS'] : ['BDS'],
      qualifications: [],
      schedules: [],
      isActive: true,
      sortOrder: index + 1
    } as DentistInput).id
  )
}
function dentistFor(index: number): number {
  return dentists[index % dentists.length]!
}

const FIRST_NAMES = ['Rakib', 'Nabila', 'Zarina', 'Tanvir', 'Sadia', 'Imran', 'Farhana', 'Mehedi', 'Ayesha', 'Rafiq', 'Shirin', 'Kamal']
const MIDDLE_NAMES = [
  'Abdul', 'Mohammad', 'Akter', 'Hossain', 'Uddin', 'Jahan', 'Nahar', 'Parvin', 'Sultana', 'Binte',
  'Alam', 'Anwar', 'Arif', 'Ashraf', 'Aziz', 'Babul', 'Bakhtiar', 'Bashir', 'Bhuiyan', 'Bilal',
  'Chandra', 'Dastagir', 'Delwar', 'Emon', 'Fahima', 'Fahim', 'Faisal', 'Faruk', 'Ferdous', 'Firoz',
  'Gafur', 'Golam', 'Habib', 'Halim', 'Hamid', 'Hanif', 'Harun', 'Hasina', 'Helal', 'Hiron',
  'Ibrahim', 'Idris', 'Iftekhar', 'Iqbal', 'Ismail', 'Jabbar', 'Jahangir', 'Jamal', 'Jasim', 'Kabir',
  'Kader', 'Kamrul', 'Karim', 'Kashem', 'Khalid', 'Latif', 'Lutfur', 'Mahmud', 'Majid', 'Mamun',
  'Masud', 'Matin', 'Mizan', 'Monir', 'Morshed', 'Mostafa', 'Moyen', 'Mozammel', 'Mujibur', 'Mukul',
  'Munir', 'Mustafiz', 'Nazrul', 'Nazmul', 'Nesar', 'Nurul', 'Obaidul', 'Omar', 'Osman', 'Rafiqul',
  'Rahmat', 'Rasel', 'Rashed', 'Rasul', 'Rezaul', 'Ruhul', 'Sabur', 'Salam', 'Salim', 'Sattar',
  'Selim', 'Shafiq', 'Shahid', 'Shahjahan', 'Shamsul', 'Sharif', 'Shaukat', 'Sirajul', 'Sohel', 'Yousuf'
]
const LAST_NAMES = ['Hasan', 'Akter', 'Sultana', 'Islam', 'Chowdhury', 'Rahman', 'Begum', 'Khan', 'Molla', 'Sheikh']
const LAST_NAMES_BN = ['হাসান', 'আক্তার', 'সুলতানা', 'ইসলাম', 'চৌধুরী', 'রহমান', 'বেগম', 'খান', 'মোল্লা', 'শেখ']
const CITIES = ['Tangail', 'Dhaka', 'Mymensingh', 'Gazipur', 'Jamalpur', 'Bogura', 'Narayanganj', 'Cumilla']
const PATIENT_NAME_POOL = FIRST_NAMES.length * MIDDLE_NAMES.length * LAST_NAMES.length

/* The clinic refuses two active patients with the same name or phone, so the generator composes names
   from three pools instead of inventing duplicates: 12 × 100 × 10 = 12 000 distinct people. Beyond that
   the index is appended, which is unusual but still unique. */
function patientInput(index: number): PatientInput {
  const serial = Math.floor(index / PATIENT_NAME_POOL)
  const within = index % PATIENT_NAME_POOL
  const first = FIRST_NAMES[within % FIRST_NAMES.length]!
  const middle = MIDDLE_NAMES[Math.floor(within / FIRST_NAMES.length) % MIDDLE_NAMES.length]!
  const lastIndex = Math.floor(within / (FIRST_NAMES.length * MIDDLE_NAMES.length)) % LAST_NAMES.length
  const last = LAST_NAMES[lastIndex]!
  const suffix = serial > 0 ? ` ${serial + 1}` : ''
  const fullName = `${first} ${middle} ${last}${suffix}`
  return {
    fullName,
    fullNameBn: `${first} ${LAST_NAMES_BN[lastIndex]!}`,
    dob: null,
    ageYears: 18 + (index % 60),
    gender: index % 3 === 0 ? 'female' : 'male',
    bloodGroup: null,
    phone: `017${String(index).padStart(8, '0')}`,
    altPhone: null,
    emergencyPhone: null,
    address: `House ${index % 200}, ${CITIES[index % CITIES.length]}`,
    addressBn: null,
    city: CITIES[index % CITIES.length]!,
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
  } as PatientInput
}

if (targets.patients > PATIENT_NAME_POOL) {
  console.log(`stress-seed: note — more than ${PATIENT_NAME_POOL} patients requested; names repeat with a numbered suffix.`)
}

console.log(`stress-seed: building ${Object.entries(targets).map(([key, value]) => `${value} ${key}`).join(', ')} in ${dataDir}`)

const patientIds: number[] = []
timed('patients', targets.patients, () => {
  const from = Date.now()
  for (let index = 1; index <= targets.patients; index += 1) {
    patientIds.push(savePatient(ctx, patientInput(index)).id)
    progress('patients', index, targets.patients, from)
  }
})

function pick(index: number): number {
  return patientIds[index % patientIds.length]!
}

const DAY = 86_400_000
const today = Date.now()

const appointmentCount = Math.min(targets.appointments, APPOINTMENT_CAPACITY)
if (targets.appointments > APPOINTMENT_CAPACITY) {
  console.log(
    `stress-seed: note — appointments are capped at ${APPOINTMENT_CAPACITY} (${BOOKING_DAYS} days × ` +
      `${SLOTS_PER_DAY} slots × ${MAX_DENTISTS} dentists); one dentist cannot be in two places at once.`
  )
}

timed('appointments', appointmentCount, () => {
  const from = Date.now()
  const perDay = dentists.length * SLOTS_PER_DAY
  for (let index = 0; index < appointmentCount; index += 1) {
    const dayIndex = Math.floor(index / perDay)
    const within = index % perDay
    const slotOfDay = within % SLOTS_PER_DAY
    const dentist = dentists[Math.floor(within / SLOTS_PER_DAY) % dentists.length]!
    const hour = slotOfDay < 8 ? 9 + Math.floor(slotOfDay / 2) : 16 + Math.floor((slotOfDay - 8) / 2)
    const minute = (slotOfDay % 2) * 30
    const scheduledAt = fromLocalDate(toLocalDate(today + (dayIndex - BOOKING_DAYS / 2) * DAY)) + hour * 3_600_000 + minute * 60_000
    saveAppointment(ctx, {
      id: null,
      patientId: pick(index * 7),
      dentistId: dentist,
      scheduledAt,
      durationMin: 30,
      reason: index % 2 === 0 ? 'Toothache' : 'Follow-up',
      notes: null,
      status: scheduledAt < today ? 'completed' : 'scheduled'
    } as AppointmentInput)
    progress('appointments', index + 1, appointmentCount, from)
  }
})

const visitIds: number[] = []
timed('visits', targets.visits, () => {
  const from = Date.now()
  for (let index = 1; index <= targets.visits; index += 1) {
    const visitAt = today - (index % 365) * DAY
    const visit = saveVisit(ctx, {
      id: null,
      patientId: pick(index * 3),
      dentistId: dentistFor(index),
      appointmentId: null,
      visitAt,
      chiefComplaint: 'Pain in the lower right molar',
      history: null,
      examination: 'Deep caries, tender on percussion',
      diagnosis: 'Irreversible pulpitis',
      findingsSummary: null,
      advice: 'Warm saline rinse',
      treatmentPlan: 'Root canal treatment',
      nextAppointmentAt: null,
      notes: null,
      status: 'final',
      treatments: [
        {
          visitId: 0,
          treatmentId: null,
          treatmentName: index % 2 === 0 ? 'Root canal treatment' : 'Composite filling',
          toothCodes: [index % 2 === 0 ? '46' : '36'],
          quantity: 1,
          unitPriceMicro: index % 2 === 0 ? 900_000 : 200_000,
          discountMicro: 0,
          status: 'completed',
          notes: null
        }
      ]
    } as VisitInput)
    visitIds.push(visit.id)
    progress('visits', index, targets.visits, from)
  }
})

function medicineInput(index: number): MedicineInput {
  return {
    sortOrder: 1,
    medicineName: index % 2 === 0 ? 'Amoxicillin 500 mg' : 'Paracetamol 500 mg',
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
    instructions: null
  } as MedicineInput
}

/* Dental chart history. The chart upserts on (patient, tooth, condition), so the generator walks
   distinct triples: a repeated triple would update a row instead of adding one and the dataset would
   come up short of the requested volume. */
timed('chart entries', targets.chart, () => {
  const from = Date.now()
  const conditions = listConditions(ctx).filter((condition) => condition.isActive && condition.appliesTooth)
  if (conditions.length === 0) {
    throw new Error('stress-seed — the clinical vocabulary is empty; the database must be migrated before seeding.')
  }
  const teeth = ADULT_TEETH.map((tooth) => tooth.code)
  const statuses = ['active', 'resolved', 'historic'] as const
  const perPatient = conditions.length * teeth.length
  for (let index = 0; index < targets.chart; index += 1) {
    setChartEntry(ctx, {
      patientId: pick(Math.floor(index / perPatient)),
      visitId: null,
      toothCode: teeth[Math.floor(index / conditions.length) % teeth.length]!,
      dentition: 'adult',
      conditionCode: conditions[index % conditions.length]!.code,
      treatmentCode: null,
      status: statuses[index % statuses.length]!,
      note: null
    })
    progress('chart', index + 1, targets.chart, from)
  }
})

timed('prescriptions', targets.prescriptions, () => {
  const from = Date.now()
  for (let index = 1; index <= targets.prescriptions; index += 1) {
    savePrescription(ctx, {
      id: null,
      patientId: pick(index * 5),
      dentistId: dentistFor(index),
      visitId: null,
      prescriptionAt: today - (index % 365) * DAY,
      diagnosis: 'Acute pulpitis',
      ccText: null,
      oeText: null,
      reText: null,
      advice: 'Avoid cold drinks for a week',
      followUpDate: null,
      notes: null,
      medicines: [medicineInput(index)]
    } as PrescriptionInput)
    progress('prescriptions', index, targets.prescriptions, from)
  }
})

const invoiceIds: number[] = []
const invoicePatients: number[] = []
const invoiceTotals: number[] = []
timed('invoices', targets.invoices, () => {
  const from = Date.now()
  for (let index = 1; index <= targets.invoices; index += 1) {
    const invoice = saveInvoice(ctx, {
      id: null,
      patientId: pick(index * 11),
      visitId: null,
      appointmentId: null,
      issueAt: today - (index % 365) * DAY,
      dueDate: toLocalDate(today - (index % 365) * DAY + 30 * DAY),
      discountBp: 0,
      notes: null,
      lines: [
        {
          id: null,
          treatmentId: null,
          visitTreatmentId: null,
          description: index % 2 === 0 ? 'Root canal treatment' : 'Scaling and polishing',
          toothCodes: [],
          quantity: 1,
          unitPriceMicro: index % 2 === 0 ? 900_000 : 120_000,
          discountMicro: 0,
          notes: null
        }
      ]
    } as InvoiceInput)
    invoiceIds.push(invoice.id)
    invoicePatients.push(invoice.patientId)
    invoiceTotals.push(invoice.totalMicro)
    progress('invoices', index, targets.invoices, from)
  }
})

let settledInvoices = 0
timed('payments', targets.payments, () => {
  const from = Date.now()
  for (let index = 1; index <= targets.payments; index += 1) {
    const cursor = index % invoiceIds.length
    const invoiceId = invoiceIds[cursor]!
    const outstanding = invoiceTotals[cursor]!
    if (outstanding <= 0) continue
    /* Half the invoice, or what is left of it: overpayment is refused by the billing rules. */
    const amountMicro = Math.max(1, Math.min(outstanding, Math.floor(outstanding / 2) || outstanding))
    addPayment(ctx, {
      invoiceId,
      patientId: invoicePatients[cursor]!,
      kind: 'payment',
      amountMicro,
      method: index % 3 === 0 ? 'cash' : index % 3 === 1 ? 'bkash' : 'card',
      reference: null,
      notes: null,
      paidAt: fromLocalDate(toLocalDate(today - (index % 365) * DAY)) + 12 * 3_600_000
    } as PaymentInput)
    invoiceTotals[cursor] = outstanding - amountMicro
    if (invoiceTotals[cursor] === 0) settledInvoices += 1
    progress('payments', index, targets.payments, from)
  }
})
if (settledInvoices > 0) console.log(`  invoices paid in full during seeding: ${settledInvoices}`)

timed('inventory', targets.items, () => {
  const from = Date.now()
  for (let index = 1; index <= targets.items; index += 1) {
    const item = saveItem(ctx, {
      id: null,
      code: null,
      name: `Consumable ${index}`,
      category: index % 2 === 0 ? 'restorative' : 'endodontic',
      unit: index % 3 === 0 ? 'box' : 'piece',
      supplierId: null,
      purchasePriceMicro: 100_000 + (index % 50) * 1_000,
      sellingPriceMicro: 150_000 + (index % 50) * 1_000,
      reorderLevel: 5 + (index % 20),
      expiryTracking: index % 4 === 0,
      location: null,
      notes: null,
      isActive: true
    } as InventoryItemInput)

    recordMovement(ctx, {
      itemId: item.id,
      batchId: null,
      batch: index % 4 === 0 ? { batchNo: `B-${index}`, expiryDate: toLocalDate(today + (index % 400) * DAY), unitCostMicro: 100_000, supplierId: null, note: null } : null,
      movementType: 'opening',
      quantity: 20 + (index % 100),
      unitCostMicro: 100_000,
      reason: 'Opening stock for the stress dataset',
      reference: null,
      supplierId: null,
      at: today - 30 * DAY
    } as never)
    progress('inventory', index, targets.items, from)
  }
})

const counts = {
  patients: (database.db.prepare('SELECT COUNT(*) AS count FROM patients').get() as { count: number }).count,
  visits: (database.db.prepare('SELECT COUNT(*) AS count FROM visits').get() as { count: number }).count,
  appointments: (database.db.prepare('SELECT COUNT(*) AS count FROM appointments').get() as { count: number }).count,
  invoices: (database.db.prepare('SELECT COUNT(*) AS count FROM invoices').get() as { count: number }).count,
  payments: (database.db.prepare('SELECT COUNT(*) AS count FROM payments').get() as { count: number }).count,
  prescriptions: (database.db.prepare('SELECT COUNT(*) AS count FROM prescriptions').get() as { count: number }).count,
  inventoryItems: (database.db.prepare('SELECT COUNT(*) AS count FROM inventory_items').get() as { count: number }).count,
  chartEntries: (database.db.prepare('SELECT COUNT(*) AS count FROM dental_chart_entries').get() as { count: number }).count,
  auditEntries: (database.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get() as { count: number }).count
}

database.close()

console.log('')
console.log('stress-seed: dataset ready')
for (const timing of timings) console.log(`  ${timing.entity.padEnd(14)} ${String(timing.count).padStart(8)} rows  ${(timing.ms / 1000).toFixed(1)}s`)
console.log('')
for (const [table, count] of Object.entries(counts)) console.log(`  ${table.padEnd(14)} ${String(count).padStart(8)}`)
console.log('')
console.log(`  total elapsed  ${((Date.now() - started) / 1000).toFixed(1)}s`)
console.log(`  data directory ${dataDir}`)
console.log('')
console.log(`Measure the budgets with: DENTIVA_DATA_DIR=${dataDir} npm run perf:measure`)
console.log(`Open it in the app with:  DENTIVA_DATA_DIR=${dataDir} npm run dev   (complete the wizard once)`)
