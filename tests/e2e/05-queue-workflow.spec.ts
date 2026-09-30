import { expect, test } from '@playwright/test'
import {
  closeClinic,
  firstDentistId,
  invoke,
  launchClinic,
  openRoute,
  prepareClinic,
  seedAppointment,
  seedPatient,
  todayAt,
  todayLocalDate,
  type Clinic
} from './support/harness'

/**
 * E2E-05 · Appointment → arrival → queue → consultation → completed (`docs/TEST_PLAN.md` §2.5).
 *
 * The appointment is booked for today, the patient is added to the queue from the queue screen (which
 * links the appointment and marks it arrived), and the token is walked through the real status buttons:
 * call, start, complete. Each transition is checked against the board the screen itself reads.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic
let patientId: number
let patientName: string

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'queue' })
  const { page } = clinic
  await prepareClinic(page)

  const dentistId = await firstDentistId(page)
  const patient = await seedPatient(page, { fullName: 'Imran Chowdhury', phone: '01715556666' })
  patientId = patient.id
  patientName = patient.fullName
  /* Today at 11:00 local — inside the opening hours configured during setup. */
  const at = todayAt(11)
  await seedAppointment(page, patientId, dentistId, at)
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

async function boardStatuses(page: Clinic['page']): Promise<Map<number, string>> {
  const board = await invoke<{ items: Array<{ id: number, patientId: number, status: string }> }>(page, 'queue.board', { date: null })
  return new Map(board.items.map((item) => [item.patientId, item.status]))
}

test('E2E-05 a patient is queued and walked from arrival to completed consultation', async () => {
  const { page } = clinic

  /* 1 · add the patient to today's queue through the dialog. */
  await openRoute(page, '/queue')
  await expect(page.getByRole('heading', { name: 'Waiting queue' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Add to queue' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.selectOption('#queuePatient', String(patientId))
  await dialog.getByRole('button', { name: 'Add to queue' }).click()

  await expect(page.getByText(patientName).first()).toBeVisible({ timeout: 30_000 })
  expect((await boardStatuses(page)).get(patientId)).toBe('waiting')

  /* 2 · the token is called. */
  await page.getByRole('button', { name: 'Call' }).first().click()
  await expect.poll(async () => (await boardStatuses(page)).get(patientId)).toBe('called')

  /* 3 · the consultation starts. */
  await page.getByRole('button', { name: 'Start' }).first().click()
  await expect.poll(async () => (await boardStatuses(page)).get(patientId)).toBe('in_progress')

  /* 4 · and finishes. */
  await page.getByRole('button', { name: 'Complete' }).first().click()
  await expect.poll(async () => (await boardStatuses(page)).get(patientId)).toBe('completed')

  /* 5 · the board reports the day's counters, so the front desk can see the queue is clearing. */
  const board = await invoke<{ counters: { completedToday: number } }>(page, 'queue.board', { date: null })
  expect(board.counters.completedToday).toBeGreaterThanOrEqual(1)

  /* 6 · the appointment that was linked to the token is no longer merely "scheduled". */
  const appointments = await invoke<{ items: Array<{ patientId: number, status: string }> }>(page, 'appointments.day', { date: todayLocalDate() })
  const row = appointments.items.find((item) => item.patientId === patientId)
  expect(row?.status).not.toBe('scheduled')
})
