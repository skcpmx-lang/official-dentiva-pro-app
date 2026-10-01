import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  /* A workflow starts an Electron build, migrates a fresh database and signs in; two minutes was the
     figure used while the suite was written, and the slowest workflow (backup → restore → relaunch)
     needs the headroom. */
  timeout: 240000,
  globalSetup: './tests/e2e/support/global-setup.ts',
  expect: { timeout: 15000 },
  /* The workflows share the machine and the application writes a real database: one at a time. */
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  /* On a runner, failures are also written as check-run annotations so a failing workflow can be read
     without downloading the HTML report (the annotations come back through the GitHub API). */
  reporter: process.env.GITHUB_ACTIONS
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
