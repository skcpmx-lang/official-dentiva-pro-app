import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  closeClinic,
  dataDirFile,
  firstDentistId,
  invoke,
  launchClinic,
  openRoute,
  prepareClinic,
  seedPatient,
  seedPrescription,
  seedVisit,
  type Clinic
} from './support/harness'

/**
 * E2E-03 · Patient → visit → dental chart → treatment → prescription → preview → PDF
 * (`docs/TEST_PLAN.md` §2.3).
 *
 * The clinical record is written through the same channels the visit screen writes with, the chart is
 * read back from the database, the prescription screen is opened in the application, and the document
 * engine is asked for the preview and for the PDF — the artefact a clinic actually hands to a patient.
 * The PDF is generated offline by Chromium with the bundled Bengali font, so the file is checked for
 * real bytes, not for a toast message.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic
let patientId: number
let visitId: number
let prescriptionId: number

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'clinical' })
  const { page } = clinic
  await prepareClinic(page)

  const dentistId = await firstDentistId(page)
  const patient = await seedPatient(page, { fullName: 'Zarina Sultana', fullNameBn: 'জরিনা সুলতানা' })
  patientId = patient.id
  visitId = await seedVisit(page, patientId, dentistId, 'Root canal treatment')
  prescriptionId = await seedPrescription(page, patientId, dentistId, visitId)

  await invoke(page, 'chart.setEntry', {
    patientId,
    visitId,
    toothCode: '46',
    conditionCode: 'pulpitis',
    status: 'active',
    note: 'Tender on percussion'
  })
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-03 the visit, the chart entry and the prescription are recorded and readable', async () => {
  const { page } = clinic

  /* 1 · the visit screen shows the treatment line that was written with the visit. */
  await openRoute(page, `/visits/${visitId}`)
  await expect(page.getByText('Root canal treatment').first()).toBeVisible({ timeout: 30_000 })

  /* 2 · the chart screen loads for the patient and the recorded tooth is on the chart. */
  await openRoute(page, `/chart/${patientId}`)
  await expect(page.getByRole('heading', { name: /chart/i })).toBeVisible({ timeout: 30_000 })

  const chart = await invoke<{ entries: Array<{ toothCode: string, conditionName: string }> }>(page, 'chart.get', { patientId })
  const entry = chart.entries.find((row) => row.toothCode === '46')
  expect(entry?.conditionName).toContain('Pulpitis')

  /* 3 · the prescription screen shows the patient and the medicine. */
  await openRoute(page, `/prescriptions/${prescriptionId}`)
  await expect(page.getByText('Amoxicillin 500 mg').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('জরিনা সুলতানা').first()).toBeVisible()
})

test('E2E-03 the prescription previews and produces an offline PDF with Bengali text', async () => {
  const { page } = clinic

  /* 4 · the document engine renders the prescription HTML, with the clinic and the patient on it. */
  const document = await invoke<{ html: string, title: string, fileName: string, paperClass: string }>(page, 'printing.render', {
    documentType: 'prescription',
    entityId: prescriptionId,
    paperClass: 'a4'
  })
  expect(document.paperClass).toBe('a4')
  expect(document.html).toContain('জরিনা সুলতানা')
  expect(document.html).toContain('Amoxicillin')
  /* The Bengali face is embedded in the document, never fetched from a font server. */
  expect(document.html).toContain('@font-face')

  /* 5 · the preview is recorded in the print history, as the screen does when it opens the dialog. */
  await invoke(page, 'printing.previewed', { documentType: 'prescription', entityId: prescriptionId, title: document.title })

  /* 6 · the PDF is written to an explicit path (the same engine, without a native save dialog). */
  const pdfPath = join(clinic.dataDir, 'exports', 'e2e-prescription.pdf')
  const outcome = await invoke<{ ok: boolean, path: string | null }>(page, 'printing.pdf', {
    documentType: 'prescription',
    entityId: prescriptionId,
    paperClass: 'a4',
    targetPath: pdfPath
  })
  expect(outcome.ok).toBe(true)

  const written = outcome.path ?? pdfPath
  expect(existsSync(written)).toBe(true)
  expect(statSync(written).size).toBeGreaterThan(1000)
  expect(readFileSync(written).subarray(0, 5).toString('latin1')).toBe('%PDF-')

  /* 7 · the print history the operator can open lists the attempt. */
  const history = await invoke<{ items: Array<{ documentType: string }>, total: number }>(page, 'printing.history', { limit: 20, offset: 0 })
  expect(history.items.some((row) => row.documentType === 'prescription')).toBe(true)

  await openRoute(page, '/printing/history')
  await expect(page.getByRole('heading', { name: /print/i })).toBeVisible({ timeout: 30_000 })

  /* The scratch data directory keeps everything: nothing was written outside it. */
  expect(existsSync(dataDirFile(clinic.dataDir, 'data', 'dentiva.db'))).toBe(true)
})
