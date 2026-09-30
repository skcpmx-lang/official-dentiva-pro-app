import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type DatabaseContext } from '@main/db/connection'
import { createNodeHost } from '@main/platform/nodeHost'
import { createServiceContext, SYSTEM_ACTOR, createTestContext, type ServiceContext } from '@main/context'
import { activate } from '@main/activation/service'
import { PERMISSION_CODES } from '@shared/permissions'
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
      // Omitting the permission list means "this actor holds every permission", which keeps tests
      // focused on behaviour; passing a list (including an empty one) exercises authorisation.
      return createTestContext({
        db: database.db,
        host,
        permissions: permissions ?? [...PERMISSION_CODES],
        actor: actorOverride
      })
    },
    systemCtx() {
      return createServiceContext({ db: database.db, host, actor: SYSTEM_ACTOR, sessionId: 'test-system' })
    }
  }
}

/**
 * Activates the test instance through the real activation service.
 *
 * The development-only environment verifier (`activation/service.ts`) accepts the code configured in
 * `DENTIVA_ACTIVATION_CODE`, and only while `host.isDevelopment()` is true (`!app.isPackaged`), so a
 * packaged build ignores the environment path entirely. The production verifier table is never
 * duplicated in test sources.
 */
export function activateForTest(harness: TestHarness, code?: string): void {
  const value = code ?? process.env.DENTIVA_ACTIVATION_CODE ?? '0000000000000000'
  process.env.DENTIVA_ACTIVATION_CODE = value
  try {
    activate(harness.systemCtx(), value)
  } finally {
    delete process.env.DENTIVA_ACTIVATION_CODE
  }
}
