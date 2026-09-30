import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { closeClinic, invoke, launchClinic, prepareClinic, seedPatient, signInThroughUi, type Clinic } from './support/harness'

/**
 * E2E-09 · Backup → modify data → restore → the original state is back (`docs/TEST_PLAN.md` §2.9).
 *
 * This is the workflow that proves the clinic can recover. A quick backup is taken, the patient's name
 * is changed, the backup is validated and restored through the real restore pipeline — which replaces
 * the database and relaunches the application — and the first thing checked afterwards is that the
 * patient carries the name that was in the backup. The restore also has to leave its own safety copy
 * behind, so the restore that went wrong is itself recoverable.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic
let patientId = 0
const ORIGINAL_NAME = 'Shirin Begum'
const CHANGED_NAME = 'Shirin Begum (changed)'

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'backup' })
  const { page } = clinic
  await prepareClinic(page)
  patientId = (await seedPatient(page, { fullName: ORIGINAL_NAME })).id
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-09 a backup restores the data that was changed after it was taken', async () => {
  const { page } = clinic

  /* 1 · take a quick (database only) backup through the backup service. */
  const created = await invoke<{ filePath: string, sizeBytes: number, includesAttachments: boolean }>(page, 'backups.create', {
    kind: 'quick',
    note: 'End-to-end restore workflow'
  })
  expect(existsSync(created.filePath)).toBe(true)
  expect(created.sizeBytes).toBeGreaterThan(1000)
  expect(created.includesAttachments).toBe(false)

  /* 2 · change the patient's name after the backup. */
  const before = await invoke<Record<string, unknown>>(page, 'patients.get', { id: patientId })
  await invoke(page, 'patients.save', { ...before, id: patientId, fullName: CHANGED_NAME })
  const changed = await invoke<{ fullName: string }>(page, 'patients.get', { id: patientId })
  expect(changed.fullName).toBe(CHANGED_NAME)

  /* 3 · validate the package before trusting it. */
  const validation = await invoke<{ ok: boolean }>(page, 'backups.validate', { filePath: created.filePath })
  expect(validation.ok).toBe(true)

  /* 4 · restore. The application replaces the database and relaunches itself, so this process must end. */
  const closed = clinic.app.waitForEvent('close')
  const result = await invoke<{ ok: boolean, message: string, preRestoreBackupId: number }>(page, 'backups.restore', {
    filePath: created.filePath,
    confirmation: 'RESTORE'
  }).catch((error: Error) => {
    /* The window is torn down while the response is in flight on some machines; that is the restore
     * working, not a failure — the relaunched application is what proves the outcome. */
    if (/Target closed|closed|disconnected/i.test(error.message)) return { ok: true, message: 'relaunching', preRestoreBackupId: 0 }
    throw error
  })
  expect(result.ok).toBe(true)
  await closed

  /* 5 · the application comes back on the same data directory with the pre-change data. */
  clinic = await launchClinic({ dataDir: clinic.dataDir })
  const relaunched = clinic.page
  await signInThroughUi(relaunched)
  const restored = await invoke<{ fullName: string }>(relaunched, 'patients.get', { id: patientId })
  expect(restored.fullName).toBe(ORIGINAL_NAME)

  /* 6 · the safety copy taken before the restore is still listed, so the restore itself is reversible. */
  const backups = await invoke<{ items: Array<{ kind: string, fileName: string }> }>(relaunched, 'backups.list')
  expect(backups.items.some((row) => row.kind === 'pre_restore')).toBe(true)
})
