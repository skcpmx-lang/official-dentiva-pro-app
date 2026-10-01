import { expect, test } from '@playwright/test'
import { closeClinic, launchClinic, openRoute, prepareClinic, restartClinic, type Clinic } from './support/harness'

/**
 * E2E-02 · Create patient → search → profile → restart the application → patient persists
 * (`docs/TEST_PLAN.md` §2.2).
 *
 * The patient is registered through the real form with a Bengali name and address, found through the
 * list search, opened on its profile, and then looked for again after the application has been closed
 * and started from the same data directory — the difference between "it is in memory" and "it is in the
 * clinic's database".
 */

const PATIENT = {
  name: 'Nabila Akter',
  nameBn: 'নাবিলা আক্তার',
  phone: '01898765432',
  city: 'Tangail',
  address: 'House 8, Akur Takur Para'
} as const

test.describe.configure({ mode: 'serial' })

let clinic: Clinic

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'patient-persistence' })
  await prepareClinic(clinic.page)
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-02 a patient is registered, found by search and still there after a restart', async () => {
  const { page } = clinic

  /* 1 · register the patient through the form. */
  await openRoute(page, '/patients/new')
  await expect(page.getByRole('heading', { name: 'Register a patient' })).toBeVisible()
  await page.fill('#fullName', PATIENT.name)
  await page.fill('#fullNameBn', PATIENT.nameBn)
  await page.fill('#phone', PATIENT.phone)
  await page.fill('#city', PATIENT.city)
  await page.fill('#address', PATIENT.address)
  await page.getByRole('button', { name: 'Register patient' }).click()

  /* 2 · the profile opens for the new record and shows the Bengali name unchanged. */
  await expect(page.getByText(PATIENT.nameBn).first()).toBeVisible({ timeout: 30_000 })

  /* 3 · the patient is found from the list search by name and by phone. */
  await openRoute(page, '/patients')
  await page.getByLabel('Search patients').fill(PATIENT.name)
  await expect(page.getByRole('cell', { name: PATIENT.name, exact: false }).first()).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Search patients').fill(PATIENT.phone)
  await expect(page.getByRole('cell', { name: PATIENT.name, exact: false }).first()).toBeVisible({ timeout: 30_000 })

  /* 4 · restart the application and search again. */
  clinic = await restartClinic(clinic)
  await prepareClinic(clinic.page)
  await openRoute(clinic.page, '/patients')
  await clinic.page.getByLabel('Search patients').fill(PATIENT.nameBn)
  await expect(clinic.page.getByRole('cell', { name: PATIENT.name, exact: false }).first()).toBeVisible({ timeout: 30_000 })

  /* 5 · the Bengali name survived the round trip through SQLite unchanged: the row found by the Bengali
   *     search really carries the Bengali string (not `????`, not mojibake). */
  const row = clinic.page.getByRole('row', { name: new RegExp(PATIENT.name) }).first()
  await expect(row).toContainText(PATIENT.nameBn)
})
