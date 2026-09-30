import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type DatabaseContext } from '@main/db/connection'
import { createNodeHost } from '@main/platform/nodeHost'
import { createServiceContext, SYSTEM_ACTOR, createTestContext, type ServiceContext } from '@main/context'
import { activate } from '@main/activation/service'
import type { HostServices } from '@main/platform/types'

export interface TestHarness {
  host: HostServices
  database: DatabaseContext
  dataDir: string
  cleanup(): void
  /** Service context with the given permissions (full access by default). */
  ctx(permissions?: string[], actorOverride?: Partial<{ userId: number, username: string }>): ServiceContext
  /** Service context for pre-authentication flows (activation, setup wizard). */
  systemCtx(): ServiceContext
}

/**
 * Creates an isolated application instance: a temporary data directory, a real SQLite database with
 * migrations and seeds applied, and a Node host. Each test gets its own directory, so tests never
 * interfere with each other and never touch real clinic data.
 */
export function createHarness(options: { keepData?: boolean } = {}): TestHarness {
  const dataDir = mkdtempSync(join(tmpdir(), 'dentiva-test-'))
  const host = createNodeHost({ dataDir, loggerEnabled: false })
  const database = openDatabase({ filePath: host.paths.databaseFile })

  const cleanup = (): void => {
    try {
      database.close()
    } catch {
      /* already closed */
    }
    if (!options.keepData) rmSync(dataDir, { recursive: true, force: true })
  }

  return {
    host,
    database,
    dataDir,
    cleanup,
    ctx(permissions?: string[], actorOverride?: Partial<{ userId: number, username: string }>) {
      return createTestContext({
        db: database.db,
        host,
        permissions,
        actor: actorOverride
      })
    },
    systemCtx() {
      return createServiceContext({ db: database.db, host, actor: SYSTEM_ACTOR, sessionId: 'test-system' })
    }
  }
}

export const ALL_PERMISSIONS_HINT = 'use createTestContext without the permissions argument for full access'

/**
 * Activates the test instance through the real activation service.
 *
 * The development-only environment verifier accepts the code configured in
 * `DENTIVA_TEST_ACTIVATION_CODE` (defaulting to a test value) — the production verifier table is never
 * duplicated in test sources, and packaged builds ignore the environment path entirely.
 */
export function activateForTest(harness: TestHarness, code?: string): void {
  const value = code ?? process.env.DENTIVA_TEST_ACTIVATION_CODE ?? '0000000000000000'
  process.env.DENTIVA_ACTIVATION_CODE = value
  try {
    activate(harness.systemCtx(), value)
  } finally {
    delete process.env.DENTIVA_ACTIVATION_CODE
  }
}
