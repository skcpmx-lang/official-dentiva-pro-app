import { expect, test } from '@playwright/test'
import {
  closeClinic,
  invoke,
  invokeExpectingFailure,
  launchClinic,
  openRoute,
  prepareClinic,
  signInThroughUi,
  type Clinic
} from './support/harness'
import { taka } from './support/scenario'

/**
 * E2E-08 · A user whose role excludes the financial permission is denied, in the interface *and* on the
 * channel (`docs/TEST_PLAN.md` §2.8, specification §55).
 *
 * The point of this workflow is the second half: hiding a button is not security. The restricted user
 * signs in for real, the invoice area is missing from the navigation, the route refuses to render, and
 * the IPC channel itself answers `E_PERMISSION` when called directly.
 */

const FRONT_DESK = { username: 'frontdesk.rita', password: 'Desk#2026', fullName: 'Rita Das' }

test.describe.configure({ mode: 'serial' })

let clinic: Clinic

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'permissions' })
  const { page } = clinic
  await prepareClinic(page)

  /* A reception role that can register patients and manage the queue, but cannot see money. */
  const role = await invoke<{ id: number, code: string }>(page, 'roles.save', {
    name: 'Front desk (no billing)',
    code: 'front_desk_no_billing',
    description: 'Reception duties without financial access',
    isActive: true,
    maxDiscountBasisPoints: 0,
    permissions: [
      'patients.view',
      'patients.create',
      'patients.edit',
      'appointments.view',
      'appointments.create',
      'queue.view',
      'queue.manage'
    ]
  })
  await invoke(page, 'users.save', {
    username: FRONT_DESK.username,
    fullName: FRONT_DESK.fullName,
    phone: null,
    roleId: role.id,
    staffId: null,
    dentistId: null,
    isActive: true,
    password: FRONT_DESK.password,
    requirePasswordChange: false
  })
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-08 a restricted role cannot reach billing through the UI or the channel', async () => {
  const { page } = clinic

  /* 1 · sign out of the administrator session. Signing out is deliberately two steps: the account
     menu, then the confirmation, so a stray click cannot end a shift mid-record. */
  await page.getByRole('button', { name: 'User menu' }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  const confirm = page.getByRole('dialog', { name: 'Sign out of Dentiva Pro?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 })

  /* 2 · sign in as the restricted user. */
  await signInThroughUi(page, FRONT_DESK)
  await expect(page.getByRole('heading', { name: 'Good day, welcome back' })).toBeVisible()

  /* 3 · the navigation does not offer billing, but does offer the work this role may do. */
  await expect(page.getByRole('link', { name: 'Invoices' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Patients' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Queue' })).toBeVisible()

  /* 4 · entering the route by hand is refused by the screen. */
  await openRoute(page, '/invoices')
  await expect(page.getByText('You do not have access to this area')).toBeVisible({ timeout: 30_000 })

  /* 5 · and the channel refuses the data itself, which is what protects the clinic. */
  const code = await invokeExpectingFailure(page, 'invoices.list', { limit: 10, offset: 0 })
  expect(code).toBe('E_PERMISSION')

  /* 6 · recording a payment is refused as well — the restriction is not only about reading. */
  const paymentCode = await invokeExpectingFailure(page, 'payments.add', { patientId: 1, amountMicro: taka(10), method: 'cash', kind: 'payment', paidAt: Date.now() })
  expect(paymentCode).toBe('E_PERMISSION')

  /* 7 · the audit log is another area this role may not read, and it says so the same way: denial is
   *     decided by the permission list, not by which screen happens to be open. */
  expect(await invokeExpectingFailure(page, 'audit.list', { limit: 10, offset: 0 })).toBe('E_PERMISSION')

  /* 8 · what the role *may* do still works, so the restriction is scoped and not a broken account. */
  const patient = await invoke<{ id: number, code: string }>(page, 'patients.save', {
    fullName: 'Queue Test Patient',
    fullNameBn: null,
    dob: null,
    ageYears: 30,
    gender: 'male',
    bloodGroup: null,
    phone: null,
    altPhone: null,
    emergencyPhone: null,
    address: null,
    addressBn: null,
    city: null,
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
  })
  expect(patient.code).toMatch(/^DP-/)
})
