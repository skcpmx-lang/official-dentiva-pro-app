#!/usr/bin/env tsx
/**
 * Performance measurement against a stress dataset.
 *
 * `scripts/stress-seed.ts` builds the clinic's worst case — tens of thousands of patients, hundreds of
 * thousands of visits and invoices — and this script measures the operations a dentist waits for, in
 * exactly the form the interface asks for them: every call goes through the production `IpcRouter`, so
 * the payload validation, the authorisation check and the output contract are part of the number. A
 * measurement that bypassed the router would report something the clinic never experiences.
 *
 * Budgets come from `docs/TEST_PLAN.md` §8. The script prints one row per operation with the median of
 * three runs against the target; it exits non-zero only when a budgeted operation is over its target,
 * so it can be wired into a release check.
 *
 * Usage:
 *   DENTIVA_DATA_DIR=/tmp/dentiva-stress npm run perf:measure
 *   DENTIVA_DATA_DIR=/tmp/dentiva-stress npm run perf:measure -- --runs=5
 *
 * The figures are only meaningful next to their machine. Run this on a quiet runner, and record the
 * environment line it prints along with the results.
 */

import { cpus, totalmem } from 'node:os'
import { createNodeHost } from '@main/platform/nodeHost'
import { openDatabase } from '@main/db/connection'
import { IpcRouter } from '@main/ipc/router'
import { createSystemHandlers, type HandlerDeps } from '@main/ipc/handlers/system'
import { createPracticeHandlers } from '@main/ipc/handlers/practice'
import { createPatientHandlers } from '@main/ipc/handlers/patients'
import { createClinicalHandlers } from '@main/ipc/handlers/clinical'
import { createSchedulingHandlers } from '@main/ipc/handlers/scheduling'
import { createBillingHandlers } from '@main/ipc/handlers/billing'
import { createInventoryHandlers } from '@main/ipc/handlers/inventory'
import { createAccountingHandlers } from '@main/ipc/handlers/accounting'
import { createPrintingHandlers } from '@main/ipc/handlers/printing'
import { createBackupHandlers } from '@main/ipc/handlers/backup'
import { createNotificationHandlers } from '@main/ipc/handlers/notifications'
import { createDashboardHandlers } from '@main/ipc/handlers/dashboard'
import { SessionManager } from '@main/session/sessionManager'
import { deriveActor } from '@main/modules/auth/actor'
import { toLocalDate } from '@shared/datetime'

function argument(name: string, fallback: string | null = null): string | null {
  const prefix = `--${name}=`
  const entry = process.argv.find((value) => value.startsWith(prefix))
  if (entry) return entry.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? (process.argv[index + 1] ?? '') : fallback
}

const RUNS = Math.max(1, Number(argument('runs', '3')))
const WINDOW = 1

const dataDir = process.env.DENTIVA_DATA_DIR ?? '.dentiva-stress'
const host = createNodeHost({ dataDir, loggerEnabled: false })

if (!host.paths.databaseFile) throw new Error('perf:measure — the data directory does not look like a Dentiva Pro installation.')

/* ------------------------------------------------------------------ open */

const openStart = process.hrtime.bigint()
const database = openDatabase({ filePath: host.paths.databaseFile })
const openMs = Number(process.hrtime.bigint() - openStart) / 1e6

const db = database.db

const sessions = new SessionManager()
const deps = {
  db,
  host,
  sessions,
  invalidateActor: () => undefined,
  broadcast: () => undefined,
  refreshAutoLock: () => undefined,
  isMaintenanceMode: () => false,
  setMaintenanceMode: () => undefined,
  relaunch: () => undefined,
  currentDb: () => db,
  closeDatabase: () => undefined,
  reopenDatabase: () => true,
  inspectDatabase: () => ({ ok: true, problems: [], counts: {} })
} as unknown as HandlerDeps

const router = new IpcRouter(deps as never)
for (const map of [
  createSystemHandlers(deps),
  createPracticeHandlers(deps),
  createPatientHandlers(deps),
  createClinicalHandlers(deps),
  createSchedulingHandlers(deps),
  createBillingHandlers(deps),
  createInventoryHandlers(deps),
  createAccountingHandlers(deps),
  createPrintingHandlers(deps),
  createBackupHandlers(deps),
  createNotificationHandlers(deps),
  createDashboardHandlers()
]) {
  router.register(map)
}

/* ------------------------------------------------------------------ session */

async function call<T>(channel: string, payload: unknown): Promise<T> {
  const envelope = await router.handle(WINDOW, channel, payload)
  if (!envelope.ok) throw new Error(`perf:measure — ${channel} failed: ${envelope.error.code}: ${envelope.error.message}`)
  return envelope.data as T
}

const CLINIC_NAME = process.env.DENTIVA_MEASURE_CLINIC ?? 'Tangail Dental Care'
const ADMIN_USERNAME = process.env.DENTIVA_MEASURE_USERNAME ?? 'perf.operator'
const ADMIN_PASSWORD = process.env.DENTIVA_MEASURE_PASSWORD ?? 'Measure#2026'

/**
 * A dataset straight from `stress:seed` holds records but is not yet a clinic: nothing has been activated
 * and no administrator exists. Measuring against it therefore means completing activation and the setup
 * wizard the same way the screens do — through the router, with the same channels — and then signing in
 * through the sign-in screen. When the dataset is already a clinic this reads the operator account
 * directly instead, because the password is the clinic's own and this tool has no business knowing it.
 *
 * The activation code comes from `DENTIVA_ACTIVATION_CODE` and is never part of this repository: the
 * packaged application derives its verifier from the table in its own bundle (docs/SECURITY_MODEL.md).
 */
interface SetupFlags {
  hasClinic: boolean
  dentistCount: number
  hasAdministrator: boolean
}

async function ensureSession(): Promise<string> {
  const bootstrap = await call<{ stage: string, setup: SetupFlags }>('app.bootstrap', {})

  if (bootstrap.stage === 'activation' || bootstrap.stage === 'setup') {
    if (bootstrap.stage === 'activation') {
      const code = process.env.DENTIVA_ACTIVATION_CODE
      if (!code) {
        throw new Error(
          'perf:measure — this dataset has not been activated. Run with DENTIVA_ACTIVATION_CODE set to the ' +
            'licence code (it is deliberately not stored in the repository). A clinic that has already been ' +
            'through the wizard needs no code.'
        )
      }
      await call('activation.submit', { code })
    }

    /* Each step runs only when it is still missing, so an interrupted preparation can be retried. */
    if (!bootstrap.setup.hasClinic) {
      await call('setup.clinic', {
        name: CLINIC_NAME,
        nameBn: null,
        logoPath: null,
        address: null,
        addressBn: null,
        phone: null,
        altPhone: null,
        email: null,
        website: null,
        openingTime: '09:00',
        closingTime: '20:00',
        weeklyClosedDays: [5],
        footerMessage: null,
        invoiceFooter: null,
        prescriptionFooter: null,
        emergencyInstruction: null
      })
    }
    /* The seeder creates the clinic's dentists, so the dentist step is only needed on an empty dataset. */
    if (bootstrap.setup.dentistCount === 0) {
      await call('setup.dentists', {
        dentists: [
          {
            fullName: 'Dr. Ayesha Rahman',
            fullNameBn: 'ডা. আয়েশা রহমান',
            phone: null,
            email: null,
            registrationNo: null,
            signatureLabel: null,
            color: null,
            isActive: true,
            sortOrder: 1,
            designations: ['BDS'],
            qualifications: [],
            schedules: []
          }
        ]
      })
    }
    if (!bootstrap.setup.hasAdministrator) {
      await call('setup.administrator', {
        fullName: 'Measurement Operator',
        username: ADMIN_USERNAME,
        password: ADMIN_PASSWORD,
        confirmPassword: ADMIN_PASSWORD,
        dentistId: null
      })
    }
    await call('setup.preferences', { values: {} })
    await call('setup.complete', { confirmation: CLINIC_NAME })
    await call('auth.login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD })
    return `signed in as ${ADMIN_USERNAME} after completing the setup wizard`
  }

  const operator = db.prepare('SELECT id FROM users WHERE is_deleted = 0 ORDER BY id LIMIT 1').get() as { id: number } | undefined
  if (!operator) throw new Error('perf:measure — this dataset has no operator account; run stress:seed first.')
  sessions.create(WINDOW, deriveActor(db, operator.id), { autoLockMs: 0, now: Date.now() })
  return 'existing clinic account (this dataset was already set up)'
}

/* ------------------------------------------------------------------ data under test */

function count(table: string): number {
  try {
    return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
  } catch {
    return 0
  }
}

const samplePatient = db.prepare('SELECT id FROM patients WHERE is_deleted = 0 ORDER BY id LIMIT 1').get() as { id: number } | undefined
const sampleDentist = db.prepare('SELECT id FROM dentists WHERE is_deleted = 0 ORDER BY id LIMIT 1').get() as { id: number } | undefined
const busiestPatient = db
  .prepare('SELECT patient_id AS id, COUNT(*) AS entries FROM dental_chart_entries GROUP BY patient_id ORDER BY entries DESC LIMIT 1')
  .get() as { id: number, entries: number } | undefined
const today = toLocalDate(Date.now())
/* The day book and the queue are read for a day that has bookings: measuring them on today's empty
   calendar would report a 0.1 ms query and prove nothing. */
const busiestDay = (
  db
    .prepare(
      `SELECT date(scheduled_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS count
         FROM appointments WHERE is_deleted = 0 GROUP BY day ORDER BY count DESC LIMIT 1`
    )
    .get() as { day: string, count: number } | undefined
) ?? { day: today, count: 0 }

/* ------------------------------------------------------------------ measurement */

interface Result {
  label: string
  budgetMs: number | null
  medianMs: number | null
  note: string
}

const results: Result[] = []

async function measure(label: string, budgetMs: number | null, channel: string, payload: unknown, describe?: (data: unknown) => string): Promise<void> {
  const timings: number[] = []
  let note = ''
  for (let run = 0; run < RUNS; run++) {
    const started = process.hrtime.bigint()
    const envelope = await router.handle(WINDOW, channel, payload)
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6
    if (!envelope.ok) {
      results.push({ label, budgetMs, medianMs: null, note: `${envelope.error.code}: ${envelope.error.message}` })
      return
    }
    timings.push(elapsed)
    if (run === 0 && describe) note = describe(envelope.data)
  }
  timings.sort((a, b) => a - b)
  const median = timings[Math.floor(timings.length / 2)] ?? 0
  results.push({ label, budgetMs, medianMs: median, note })
}


/* tsx compiles this script to CommonJS, where top-level await is not available. */
results.push({ label: 'Cold open (database + migrations)', budgetMs: 5000, medianMs: openMs, note: `${(openMs / 1000).toFixed(2)} s` })

/* tsx compiles this script to CommonJS, where top-level await is not available. */
async function run(): Promise<void> {
  const sessionNote = await ensureSession()

  console.log('')
  console.log('Dentiva Pro — performance measurement')
  console.log(`  environment    Node ${process.version.replace(/^v/, '')} · ${cpus().length} CPU · ${(totalmem() / 1024 ** 3).toFixed(1)} GB RAM · ${process.platform}`)
  console.log(`  data directory ${dataDir}`)
  console.log(`  dataset        ${count('patients')} patients · ${count('visits')} visits · ${count('invoices')} invoices · ${count('payments')} payments · ${count('prescriptions')} prescriptions · ${count('dental_chart_entries')} chart entries`)
  console.log(`  session        ${sessionNote}`)
  console.log(`  runs           ${RUNS} (median reported)`)
  console.log('')

  await measure('Patient list page (50 rows)', 300, 'patients.list', { status: 'active', limit: 50, offset: 0 }, (data) => `${(data as { total: number }).total} active patient(s)`)
  await measure('Patient list, deep page (offset 5 000)', null, 'patients.list', { status: 'active', limit: 50, offset: 5000 })
  await measure('Patient search “Rakib”', 400, 'patients.list', { search: 'Rakib', limit: 50, offset: 0 }, (data) => `${(data as { total: number }).total} match(es)`)
  await measure('Clinic-wide search', 400, 'search.global', { query: 'Rakib', limitPerGroup: 5 })
  await measure('Dashboard aggregate', 900, 'dashboard.summary', {})
  await measure(`Day book (appointments, ${busiestDay.count} booked)`, null, 'appointments.day', { date: busiestDay.day })
  await measure('Queue board (busiest day)', null, 'queue.board', { date: busiestDay.day })
  await measure('Notification refresh', null, 'notifications.summary', {})
  await measure('Invoice register (50 rows)', null, 'invoices.list', { limit: 50, offset: 0 })
  await measure(
    'Revenue report (daily, whole history)',
    1500,
    'reports.run',
    { key: 'revenue_daily', range: { preset: 'all' }, limit: 500 }
  )
  await measure('Receivables report', null, 'reports.run', { key: 'receivables', limit: 500 })
  if (busiestPatient) {
    await measure(`Dental chart (busiest patient, ${busiestPatient.entries} entries)`, null, 'chart.get', { patientId: busiestPatient.id })
  }

  await measure(
  'Backup (full, whole clinic)',
  60_000,
  'backups.create',
  { kind: 'full', includeAttachments: true, note: 'Performance measurement' },
  (data) => `${((data as { sizeBytes: number }).sizeBytes / 1024 ** 2).toFixed(1)} MB`
)

if (samplePatient && sampleDentist) {
    await measure(
      'Save clinical record (visit + treatment)',
      250,
      'visits.save',
      {
        patientId: samplePatient.id,
        dentistId: sampleDentist.id,
        appointmentId: null,
        visitAt: Date.now(),
        chiefComplaint: 'Performance measurement visit',
        examination: null,
        diagnosis: 'Measurement',
        advice: null,
        treatmentPlan: null,
        status: 'final'
      }
    )
    await measure(
      'Invoice save + total recompute',
      300,
      'invoices.save',
      {
        patientId: samplePatient.id,
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
            description: 'Performance measurement line',
            toothCodes: [],
            quantity: 1,
            unitPriceMicro: 500_000,
            discountMicro: 0
          }
        ]
      }
    )
  }

  /* ------------------------------------------------------------------ report */

  let failures = 0
  console.log(`${'operation'.padEnd(44)} ${'median'.padStart(10)} ${'target'.padStart(10)}  verdict`)
  console.log('-'.repeat(88))
  for (const result of results) {
    const median = result.medianMs === null ? result.note || 'refused' : `${result.medianMs.toFixed(1)} ms`
    const target = result.budgetMs ? `< ${result.budgetMs} ms` : '—'
    let verdict = 'measured'
    if (result.medianMs === null) verdict = 'NOT MEASURED'
    else if (result.budgetMs !== null) {
      verdict = result.medianMs <= result.budgetMs ? 'within budget' : 'OVER BUDGET'
      if (verdict === 'OVER BUDGET') failures++
    }
    console.log(`${result.label.padEnd(44)} ${median.padStart(10)} ${target.padStart(10)}  ${verdict}${result.note && result.medianMs !== null ? `  (${result.note})` : ''}`)
  }
  console.log('')

  database.close()

  if (failures > 0) {
    console.error(`perf:measure — ${failures} budgeted operation(s) over target.`)
    process.exit(1)
  }
  console.log('perf:measure — every budgeted operation is within its target on this machine.')
}

void run()
