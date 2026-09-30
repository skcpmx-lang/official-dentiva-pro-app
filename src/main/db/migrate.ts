import type { Db } from './connection'
import {SCHEMA_V1_POST_SQL, SCHEMA_V1_SQL, SCHEMA_V2_SQL } from './schema'

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
  },
  {
    version: 2,
    description: 'Printing subsystem: profile notes/author, print action and payload path',
    up(db: Db): void {
      addColumnIfMissing(db, 'print_profiles', 'notes', 'TEXT')
      addColumnIfMissing(db, 'print_profiles', 'created_by', 'INTEGER')
      addColumnIfMissing(db, 'print_history', 'title', 'TEXT')
      addColumnIfMissing(db, 'print_history', 'profile_id', 'INTEGER')
      addColumnIfMissing(db, 'print_history', 'action', "TEXT NOT NULL DEFAULT 'print'")
      addColumnIfMissing(db, 'print_history', 'payload_path', 'TEXT')
      addColumnIfMissing(db, 'print_history', 'file_path', 'TEXT')
      db.exec(SCHEMA_V2_SQL)
    }
  }
]

/**
 * SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`; this guard keeps a re-run of a migration
 * (or a database that already received the column from a development build) harmless.
 */
function addColumnIfMissing(db: Db, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (columns.some((entry) => entry.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

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

export function ensureSchemaTable(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`)
}
