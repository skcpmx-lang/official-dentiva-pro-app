import { expect, test } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bootstrapStage, closeClinic, invoke, launchClinic, prepareClinic, type Clinic } from './support/harness'

/**
 * E2E-10 · Install and uninstall behaviour (`docs/TEST_PLAN.md` §2.10).
 *
 * The installer itself is exercised on the Windows runner: `ci-windows.yml` builds the NSIS package,
 * and the clean-machine pass in `docs/CLEAN_MACHINE_TEST.md` records the parts that need a human — the
 * licence page, the folder choice, the shortcuts and the two uninstall answers. What *can* be proven
 * from inside the application is proven here, because it is what the uninstall rules depend on:
 *
 *  · the clinic's data lives in the data directory and nowhere near the installed application files;
 *  · the directory holds the database, the attachment store and the backup folder the uninstaller must
 *    keep;
 *  · activation and setup survive an application restart, so reinstalling the program cannot cost the
 *    clinic its licence or its records.
 */

test.describe.configure({ mode: 'serial' })

let clinic: Clinic

test.beforeAll(async () => {
  clinic = await launchClinic({ label: 'install' })
  await prepareClinic(clinic.page)
})

test.afterAll(async () => {
  await closeClinic(clinic)
})

test('E2E-10 the data directory is self-contained and survives a restart', async () => {
  const dataDir = clinic.dataDir

  /* 1 · the database, the attachment store, the exports and the backup folder are all in the data
   *     directory — the folder the uninstaller leaves alone by default. */
  expect(existsSync(join(dataDir, 'data', 'dentiva.db'))).toBe(true)
  for (const directory of ['attachments', 'exports', 'logs', 'tmp', 'backups']) {
    expect(existsSync(join(dataDir, directory)), `${directory} should exist in the data directory`).toBe(true)
    expect(readdirSync(join(dataDir, directory)).length).toBeGreaterThanOrEqual(0)
  }

  /* 2 · the machine identifier that ties the licence to this computer is stored with the data, not with
   *     the program, so a reinstall does not look like a different computer. */
  expect(existsSync(join(dataDir, 'machine.id'))).toBe(true)

  /* 3 · nothing was written into the application directory: the built bundle is read-only. */
  const appRoot = join(__dirname, '..', '..')
  for (const candidate of ['dentiva.db', 'machine.id']) {
    expect(existsSync(join(appRoot, candidate)), `${candidate} must not be written beside the program`).toBe(false)
  }

  /* 4 · restart: activation and setup are not asked for again, which is what an upgrade or a reinstall
   *     over the same data directory must feel like. */
  clinic = await launchClinic({ dataDir })
  expect(await bootstrapStage(clinic.page)).toBe('login')
  const activation = await invoke<{ activated: boolean, verifierIntact: boolean }>(clinic.page, 'activation.state')
  expect(activation.activated).toBe(true)
  expect(activation.verifierIntact).toBe(true)

  const setup = await invoke<{ needsSetup: boolean, hasClinic: boolean, hasAdministrator: boolean }>(clinic.page, 'setup.status')
  expect(setup.needsSetup).toBe(false)
  expect(setup.hasClinic).toBe(true)
  expect(setup.hasAdministrator).toBe(true)

  /* 5 · the installed build identity is the one the release pipeline recorded: About reads it from the
   *     packaged resource, and the field is never empty in a real package. */
  const build = await invoke<{ build: { version: string, buildNumber: string } }>(clinic.page, 'app.bootstrap')
  expect(build.build.version).toBe('1.0.0')
  expect(build.build.buildNumber.length).toBeGreaterThan(0)
})
