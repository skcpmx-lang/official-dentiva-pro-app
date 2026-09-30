import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Shared harness for the end-to-end workflows.
 *
 * Every workflow starts a real Electron build of Dentiva Pro against its own scratch data directory,
 * so no test can see another test's patients, invoices or session. Actions are performed the way an
 * operator performs them — typing into the real fields, clicking the real buttons — and data that is
 * only a precondition of the workflow (a patient that has to exist before an invoice can be raised) is
 * created through the same IPC channels the screens use, which keeps the tests about the workflow
 * instead of about form filling.
 *
 * Launch contract: `npm run build` must have produced `out/` (the Windows workflow builds before it
 * runs the suite). The application is started from the repository root, so what runs here is the same
 * bundle the installer packages.
 *
 * Activation: the workflows type `E2E_ACTIVATION_CODE`. The production verifier does not contain that
 * value — `src/main/activation/service.ts` accepts `DENTIVA_ACTIVATION_CODE` only while
 * `host.isDevelopment()` is true, which is `!app.isPackaged`, so a packaged installer ignores the
 * variable entirely. The activation *flow* exercised here (screen, throttling, state row, bootstrap
 * transition) is the production one.
 */

export const E2E_ACTIVATION_CODE = '0000-0000-0000-0001'

export const CLINIC = {
  name: 'Tangail Dental Care',
  nameBn: 'টাঙ্গাইল ডেন্টাল কেয়ার',
  address: 'Victoria Road, Tangail',
  phone: '01711000000',
  openingTime: '09:00',
  closingTime: '20:00'
} as const

export const ADMIN = {
  fullName: 'Shohan Khan',
  username: 'admin.dentiva',
  password: 'Dentiva#2026'
} as const

export const DENTIST = {
  fullName: 'Dr. Ayesha Rahman',
  fullNameBn: 'ডা. আয়েশা রহমান',
  registrationNo: 'BMDC-12345',
  signatureLabel: 'Consultant Dental Surgeon'
} as const

export interface Clinic {
  app: ElectronApplication
  page: Page
  dataDir: string
}

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: { code?: string, message?: string }
}

/** Today in the clinic's local calendar, in the `YYYY-MM-DD` the contracts use. */
export function todayLocalDate(offsetDays = 0): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** A local clock time today as an epoch in milliseconds — used to book today's appointment. */
export function todayAt(hour: number, minute = 0): number {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0).getTime()
}

export function createDataDirectory(label: string): string {
  return mkdtempSync(join(tmpdir(), `dentiva-e2e-${label}-`))
}

/** Starts the built application against `dataDir` (a fresh temporary directory by default). */
export async function launchClinic(options: { dataDir?: string, label?: string } = {}): Promise<Clinic> {
  const dataDir = options.dataDir ?? createDataDirectory(options.label ?? 'run')
  const appRoot = resolve(__dirname, '..', '..', '..')

  const app = await electron.launch({
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      DENTIVA_DATA_DIR: dataDir,
      DENTIVA_ACTIVATION_CODE: E2E_ACTIVATION_CODE,
      ELECTRON_ENABLE_LOGGING: '1'
    }
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, dataDir }
}

/** Closes the application. The data directory survives so a workflow can restart against it. */
export async function closeClinic(clinic: Clinic): Promise<void> {
  await clinic.app.close()
}

export async function removeDataDirectory(dataDir: string): Promise<void> {
  rmSync(dataDir, { recursive: true, force: true })
}

/**
 * Restarts against the same data directory: the workflow verifies that what was written is still
 * there after a real application restart, not after a page reload.
 */
export async function restartClinic(clinic: Clinic): Promise<Clinic> {
  await closeClinic(clinic)
  return launchClinic({ dataDir: clinic.dataDir })
}

/** Runs an IPC channel through the renderer bridge and unwraps the response envelope. */
export async function invoke<T = unknown>(page: Page, channel: string, payload: unknown = {}): Promise<T> {
  const envelope = (await page.evaluate(
    async ([channelId, body]) => {
      const bridge = (globalThis as unknown as { dentiva: { invoke(id: string, input?: unknown): Promise<unknown> } }).dentiva
      return (await bridge.invoke(channelId as string, body)) as unknown
    },
    [channel, payload] as const
  )) as Envelope<T>

  if (!envelope.ok) {
    const error = new Error(`${channel} failed: ${envelope.error?.code ?? 'E_UNKNOWN'} ${envelope.error?.message ?? ''}`)
    Object.assign(error, { code: envelope.error?.code })
    throw error
  }
  return envelope.data as T
}

/** Runs a channel that is expected to be refused, and returns the application error code. */
export async function invokeExpectingFailure(page: Page, channel: string, payload: unknown = {}): Promise<string> {
  try {
    await invoke(page, channel, payload)
  } catch (error) {
    return String((error as { code?: string }).code ?? 'E_UNKNOWN')
  }
  throw new Error(`${channel} was expected to be refused but succeeded`)
}

/* ------------------------------------------------------------------ bootstrap */

export async function bootstrapStage(page: Page): Promise<string> {
  const payload = await invoke<{ stage: string }>(page, 'app.bootstrap')
  return payload.stage
}

/** Activates the installation through the activation screen, exactly as a first-time operator does. */
export async function activateThroughUi(page: Page, code: string = E2E_ACTIVATION_CODE): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Activate Dentiva Pro' })).toBeVisible()
  await page.fill('#activation-code', code)
  await page.getByRole('button', { name: 'Activate this computer' }).click()
  await expect(page.getByRole('heading', { name: 'Set up Dentiva Pro' })).toBeVisible({ timeout: 60_000 })
}

/** Walks the five-step setup wizard exactly as it is presented, then lands on the login screen. */
export async function completeSetupThroughUi(page: Page): Promise<void> {
  /* 1 · clinic profile */
  await page.fill('#clinicName', CLINIC.name)
  await page.fill('#clinicNameBn', CLINIC.nameBn)
  await page.fill('#clinicAddress', CLINIC.address)
  await page.fill('#clinicPhone', CLINIC.phone)
  await page.getByRole('button', { name: 'Save and continue' }).click()

  /* 2 · dentists */
  await page.fill('#newDentistName', DENTIST.fullName)
  await page.fill('#newDentistNameBn', DENTIST.fullNameBn)
  await page.fill('#newDentistRegistration', DENTIST.registrationNo)
  await page.getByRole('button', { name: 'Add dentist' }).click()
  /* The step only lets the wizard continue once at least one dentist exists. */
  const continueButton = page.getByRole('button', { name: 'Continue', exact: true })
  await expect(continueButton).toBeEnabled({ timeout: 30_000 })
  await continueButton.click()

  /* 3 · administrator */
  await page.fill('#adminFullName', ADMIN.fullName)
  await page.fill('#adminUsername', ADMIN.username)
  await page.fill('#adminPassword', ADMIN.password)
  await page.fill('#adminConfirm', ADMIN.password)
  await page.getByRole('button', { name: 'Create administrator' }).click()

  /* 4 · practice preferences (defaults are correct for a Bangladeshi clinic) */
  await page.getByRole('button', { name: 'Save and review' }).click()

  /* 5 · review and finish */
  await page.getByRole('button', { name: 'Finish setup' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Finish setup and open Dentiva Pro?' })
  await expect(confirmation).toBeVisible()
  await confirmation.getByRole('button', { name: 'Finish setup' }).click()

  await expect(page.locator('#username')).toBeVisible({ timeout: 60_000 })
}

export async function signInThroughUi(page: Page, credentials: { username: string, password: string } = ADMIN): Promise<void> {
  await page.fill('#username', credentials.username)
  await page.fill('#password', credentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Good day, welcome back' })).toBeVisible({ timeout: 60_000 })
}

/**
 * Brings a scratch installation to a signed-in dashboard. The activation and setup steps are driven
 * through the interface only when the calling workflow is the one that tests them; every other
 * workflow performs them over IPC and reloads, which is the same code path with less typing.
 */
export async function prepareClinic(page: Page, options: { throughUi?: boolean } = {}): Promise<void> {
  if (options.throughUi) {
    if ((await bootstrapStage(page)) === 'activation') await activateThroughUi(page)
    await completeSetupThroughUi(page)
    await signInThroughUi(page)
    return
  }

  if ((await bootstrapStage(page)) === 'activation') {
    await invoke(page, 'activation.submit', { code: E2E_ACTIVATION_CODE })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  }
  if ((await bootstrapStage(page)) === 'setup') {
    await invoke(page, 'setup.clinic', {
      name: CLINIC.name,
      nameBn: CLINIC.nameBn,
      logoPath: null,
      address: CLINIC.address,
      addressBn: null,
      phone: CLINIC.phone,
      altPhone: null,
      email: null,
      website: null,
      openingTime: CLINIC.openingTime,
      closingTime: CLINIC.closingTime,
      weeklyClosedDays: [5],
      footerMessage: null,
      invoiceFooter: null,
      prescriptionFooter: null,
      emergencyInstruction: null
    })
    await invoke(page, 'setup.dentists', {
      dentists: [
        {
          fullName: DENTIST.fullName,
          fullNameBn: DENTIST.fullNameBn,
          phone: null,
          email: null,
          registrationNo: DENTIST.registrationNo,
          signatureLabel: DENTIST.signatureLabel,
          color: null,
          isActive: true,
          sortOrder: 1,
          designations: ['BDS', 'MDS (Orthodontics)'],
          qualifications: [],
          schedules: []
        }
      ]
    })
    await invoke(page, 'setup.administrator', {
      fullName: ADMIN.fullName,
      username: ADMIN.username,
      password: ADMIN.password,
      confirmPassword: ADMIN.password,
      dentistId: null
    })
    await invoke(page, 'setup.preferences', { values: {} })
    await invoke(page, 'setup.complete', { confirmation: 'COMPLETE SETUP' })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
  }
  if ((await bootstrapStage(page)) === 'login') await signInThroughUi(page)
}

/* ------------------------------------------------------------------ navigation */

/**
 * Opens a screen by route. The renderer uses a hash router, so this is the same navigation the
 * command palette and the notification links perform.
 */
export async function openRoute(page: Page, route: string): Promise<void> {
  await page.evaluate((target) => {
    ;(globalThis as unknown as { location: { hash: string } }).location.hash = target.startsWith('#') ? target : `#${target}`
  }, route)
}

/* ------------------------------------------------------------------ seed data (through the real IPC surface) */

export interface SeededPatient {
  id: number
  fullName: string
  code: string
}

export async function firstDentistId(page: Page): Promise<number> {
  const dentists = await invoke<Array<{ id: number }>>(page, 'dentists.list', { includeInactive: false })
  const dentist = dentists[0]
  if (!dentist) throw new Error('The setup wizard did not create a dentist; the workflow needs one')
  return dentist.id
}

export async function seedPatient(page: Page, overrides: Record<string, unknown> = {}): Promise<SeededPatient> {
  const patient = await invoke<{ id: number, fullName: string, code: string }>(page, 'patients.save', {
    fullName: 'Rakib Hasan',
    fullNameBn: 'রাকিব হাসান',
    dob: null,
    ageYears: 34,
    gender: 'male',
    bloodGroup: null,
    phone: '01712345678',
    altPhone: null,
    emergencyPhone: null,
    address: 'House 12, Victoria Road',
    addressBn: 'বাড়ি ১২, ভিক্টোরিয়া রোড',
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
  })
  return { id: patient.id, fullName: patient.fullName, code: patient.code }
}

export async function seedVisit(page: Page, patientId: number, dentistId: number, treatmentName = 'Root canal treatment'): Promise<number> {
  const visit = await invoke<{ id: number }>(page, 'visits.save', {
    patientId,
    dentistId,
    appointmentId: null,
    visitAt: Date.now(),
    chiefComplaint: 'Pain in the lower right molar',
    examination: 'Deep caries on 46, tender on percussion',
    diagnosis: 'Irreversible pulpitis',
    advice: 'Warm saline rinse',
    treatmentPlan: 'Root canal treatment',
    status: 'final'
  })
  await invoke(page, 'visits.treatments.add', {
    visitId: visit.id,
    treatmentId: null,
    treatmentName,
    toothCodes: ['46'],
    quantity: 1,
    unitPriceMicro: 900_000,
    discountMicro: 0,
    status: 'completed'
  })
  return visit.id
}

export async function seedPrescription(page: Page, patientId: number, dentistId: number, visitId: number | null = null): Promise<number> {
  const prescription = await invoke<{ id: number }>(page, 'prescriptions.save', {
    patientId,
    dentistId,
    visitId,
    prescriptionAt: Date.now(),
    diagnosis: 'Acute pulpitis',
    ccText: 'Pain on chewing for three days',
    oeText: 'Tender on percussion, deep caries 46',
    advice: 'Avoid cold drinks for a week',
    medicines: [
      {
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
        instructions: null
      }
    ]
  })
  return prescription.id
}

export async function seedInvoice(page: Page, patientId: number, unitPriceMicro = 900_000): Promise<{ id: number, invoiceNo: string, totalMicro: number }> {
  const invoice = await invoke<{ id: number, invoiceNo: string, totalMicro: number }>(page, 'invoices.save', {
    patientId,
    visitId: null,
    appointmentId: null,
    issueAt: Date.now(),
    dueDate: null,
    discountBp: 0,
    notes: null,
    lines: [
      {
        treatmentId: null,
        visitTreatmentId: null,
        description: 'Root canal treatment',
        toothCodes: ['46'],
        quantity: 1,
        unitPriceMicro,
        discountMicro: 0
      }
    ]
  })
  return { id: invoice.id, invoiceNo: invoice.invoiceNo, totalMicro: invoice.totalMicro }
}

export async function seedPayment(page: Page, patientId: number, invoiceId: number, amountMicro: number, method = 'cash'): Promise<void> {
  await invoke(page, 'payments.add', {
    patientId,
    invoiceId,
    kind: 'payment',
    amountMicro,
    method,
    reference: null,
    paidAt: Date.now(),
    notes: null
  })
}

export async function seedAppointment(page: Page, patientId: number, dentistId: number, scheduledAt: number): Promise<number> {
  const appointment = await invoke<{ id: number }>(page, 'appointments.save', {
    patientId,
    dentistId,
    scheduledAt,
    durationMin: 30,
    reason: 'Toothache',
    notes: null,
    status: 'scheduled'
  })
  return appointment.id
}

export async function seedInventoryItem(page: Page, overrides: Record<string, unknown> = {}): Promise<number> {
  const item = await invoke<{ id: number }>(page, 'inventory.save', {
    code: null,
    name: 'Composite filling material',
    category: 'restorative',
    unit: 'box',
    supplierId: null,
    purchasePriceMicro: 250_000,
    sellingPriceMicro: 400_000,
    reorderLevel: 10,
    expiryTracking: false,
    location: null,
    notes: null,
    isActive: true,
    ...overrides
  })
  return item.id
}

/** Number of rows in a table inside the scratch data directory, read from the live database file. */
export function dataDirFile(dataDir: string, ...parts: string[]): string {
  return join(dataDir, ...parts)
}
