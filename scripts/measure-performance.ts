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
import { createServiceContext } from '@main/context'
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

const operator = db.prepare("SELECT id FROM users WHERE is_deleted = 0 ORDER BY id LIMIT 1").get() as { id: number } | undefined
if (!operator) throw new Error('perf:measure — this dataset has no operator account; seed a clinic first.')
sessions.create(WINDOW, deriveActor(db, operator.id), { autoLockMs: 0, now: Date.now() })

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

console.log('')
console.log('Dentiva Pro — performance measurement')
console.log(`  environment    Node ${process.version.replace(/^v/, '')} · ${cpus().length} CPU · ${(totalmem() / 1024 ** 3).toFixed(1)} GB RAM · ${process.platform}`)
console.log(`  data directory ${dataDir}`)
console.log(`  dataset        ${count('patients')} patients · ${count('visits')} visits · ${count('invoices')} invoices · ${count('payments')} payments · ${count('prescriptions')} prescriptions · ${count('dental_chart_entries')} chart entries`)
console.log(`  runs           ${RUNS} (median reported)`)
console.log('')

results.push({ label: 'Cold open (database + migrations)', budgetMs: 5000, medianMs: openMs, note: `${(openMs / 1000).toFixed(2)} s` })

await measure('Patient list page (50 rows)', 300, 'patients.list', { status: 'active', limit: 50, offset: 0 }, (data) => `${(data as { total: number }).total} active patient(s)`)
await measure('Patient list, deep page (offset 5 000)', null, 'patients.list', { status: 'active', limit: 50, offset: 5000 })
await measure('Patient search “Rakib”', 400, 'patients.list', { search: 'Rakib', limit: 50, offset: 0 }, (data) => `${(data as { total: number }).total} match(es)`)
await measure('Clinic-wide search', 400, 'search.global', { query: 'Rakib', limitPerGroup: 5 })
await measure('Dashboard aggregate', 900, 'dashboard.summary', {})
await measure('Day book (appointments)', null, 'appointments.day', { date: today })
await measure('Queue board', null, 'queue.board', { date: null })
await measure('Notification refresh', null, 'notifications.summary', {})
await measure('Invoice register (50 rows)', null, 'invoices.list', { limit: 50, offset: 0 })
await measure('Revenue report (daily, 500 rows)', 1500, 'reports.run', { key: 'revenue_daily', limit: 500 })
await measure('Receivables report', null, 'reports.run', { key: 'receivables', limit: 500 })
if (busiestPatient) {
  await measure(`Dental chart (busiest patient, ${busiestPatient.entries} entries)`, null, 'chart.get', { patientId: busiestPatient.id })
}

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
