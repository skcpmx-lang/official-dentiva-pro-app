import { expect, test } from '@playwright/test'
import {
  ADMIN,
  E2E_ACTIVATION_CODE,
  activateThroughUi,
  bootstrapStage,
  closeClinic,
  completeSetupThroughUi,
  launchClinic,
  openRoute,
  signInThroughUi,
  type Clinic
} from './support/harness'

/**
 * E2E-01 · Fresh install → activation → setup → login → dashboard (`docs/TEST_PLAN.md` §2.1).
 *
 * This is the only workflow that drives first-run entirely through the interface: a wrong code is
 * refused, the test code is accepted once, the five wizard steps run in order, the administrator signs
 * in and the dashboard opens. Everything that follows in the other workflows assumes this path works.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'fresh-install' })
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-01 a brand new installation is activated, set up and signed into', async () => {
  const { page } = clinic

  /* 1 · the application asks for activation before anything else. */
  expect(await bootstrapStage(page)).toBe('activation')
  await expect(page.getByRole('heading', { name: 'Activate Dentiva Pro' })).toBeVisible()

  /* 2 · a wrong code is refused with a message and the screen stays put. */
  await page.fill('#activation-code', '1111-1111-1111-1111')
  await page.getByRole('button', { name: 'Activate this computer' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Activate Dentiva Pro' })).toBeVisible()

  /* 3 · the correct code activates the computer once and moves on to setup. */
  await activateThroughUi(page, E2E_ACTIVATION_CODE)
  expect(await bootstrapStage(page)).toBe('setup')

  /* 4 · the five wizard steps, exactly as presented. */
  await completeSetupThroughUi(page)

  /* 5 · the administrator signs in and the dashboard opens. */
  await signInThroughUi(page, ADMIN)
  expect(await bootstrapStage(page)).toBe('ready')

  /* 6 · the build identity the release pipeline recorded is on the About screen. */
  await openRoute(page, '/about')
  await expect(page.getByRole('heading', { name: 'About Dentiva Pro' })).toBeVisible()
  await expect(page.getByText('1.0.0').first()).toBeVisible()
  await expect(page.getByText('Shohan Khan').first()).toBeVisible()

  /* 7 · the whole first run happened without a network connection: the application blocks requests and
   *     this workflow never enabled one. The audit that proves the code cannot ask for one is
   *     `npm run audit:offline`, which runs in CI alongside this suite. */
})
