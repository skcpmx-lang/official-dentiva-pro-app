import type { Db } from './connection'
import { SCHEMA_V1_POST_SQL, SCHEMA_V1_SQL, SCHEMA_VERSION } from './schema'

export interface Migration {
  version: number
  description: string
  up(db: Db): void
}

/**
 * Ordered, idempotent migrations. Version 1 creates the complete schema; later versions must be
 * additive (SQLite supports `ALTER TABLE ... ADD COLUMN` and index/table creation) and must never
 * destroy historical data. A pre-migration backup is taken by `backupService` whenever the stored
 * version is older than `SCHEMA_VERSION` (see docs/DATABASE_SCHEMA.md).
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema (patients, clinical, billing, inventory, accounting, admin)',
    up(db: Db): void {
      db.exec(SCHEMA_V1_SQL)
      db.exec(SCHEMA_V1_POST_SQL)
    }
  }
]

export function readSchemaVersion(db: Db): number {
  try {
    const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null } | undefined
    if (row?.version) return row.version
  } catch {
    // The migration table does not exist yet: this is a brand-new database file.
    return 0
  }
  const userVersion = db.pragma('user_version', { simple: true }) as number
  return Number.isFinite(userVersion) ? userVersion : 0
}

export function migrationsPending(db: Db): Migration[] {
  const current = readSchemaVersion(db)
  return MIGRATIONS.filter((migration) => migration.version > current)
}

export function schemaIsCurrent(db: Db): boolean {
  return readSchemaVersion(db) >= SCHEMA_VERSION
}

export function ensureSchemaTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`)
}
