import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppError } from '@shared/errors'
import { SCHEMA_V1_POST_SQL, SCHEMA_V1_SQL } from './schema'
import { MIGRATIONS, ensureSchemaTable, readSchemaVersion } from './migrate'
import { seedDatabase } from './seed'

export type Db = Database.Database

export interface OpenOptions {
  /** Absolute path of the database file. Parent directories are created automatically. */
  filePath: string
  /** Injectable clock for deterministic tests. */
  now?: () => number
  /** Skip seeding (used by integrity tooling that only inspects structure). */
  skipSeed?: boolean
  /**
   * When set, an existing database that is about to be migrated is snapshotted here first
   * (`pre-migration-v<n>-<stamp>.db`) and registered in `backups`, so a migration can always be undone.
   */
  backupDir?: string
  /** Recorded on the pre-migration snapshot; supplied by the host build info. */
  appVersion?: string
}

export interface DatabaseContext {
  readonly db: Db
  readonly filePath: string
  /** True when a clinic setup has been completed (clinic name present). */
  isClinicInitialised(): boolean
  integrityCheck(): { ok: boolean; messages: string[] }
  foreignKeyCheck(): { ok: boolean; violations: string[] }
  optimize(): void
  vacuum(): void
  sizeBytes(): number
  close(): void
}

export function applyPragmas(db: Db): void {
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('temp_store = MEMORY')
  db.pragma('trusted_schema = OFF')
}

/**
 * Open (creating when necessary) the application database, apply pragmas, run migrations and seed
 * reference data. Throws `AppError('E_DB')` with a recovery-oriented message when the file cannot be
 * opened or fails its integrity check, which the app turns into Recovery Mode.
 */
export function openDatabase(options: OpenOptions): DatabaseContext {
  const { filePath, now = () => Date.now(), skipSeed = false } = options
  const directory = dirname(filePath)
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

  let db: Db
  try {
    db = new Database(filePath)
  } catch (error) {
    throw new AppError('E_DB', 'The clinic database could not be opened. It may be in use by another window or damaged.', {
      detail: { filePath, reason: error instanceof Error ? error.message : String(error) }
    })
  }

  try {
    applyPragmas(db)
    const check = db.pragma('quick_check', { simple: true }) as string
    if (check !== 'ok') {
      db.close()
      throw new AppError('E_DB', 'The clinic database failed its integrity check and was not opened to protect your data.', {
        detail: { filePath, check }
      })
    }
    ensureSchemaTable(db)
    const version = readSchemaVersion(db)
    if (version === 0) {
      db.exec(SCHEMA_V1_SQL)
      db.exec(SCHEMA_V1_POST_SQL)
    }
    const pending = MIGRATIONS.filter((migration) => migration.version > readSchemaVersion(db))
    if (version > 0 && pending.length > 0 && options.backupDir) {
      takePreMigrationSnapshot(db, options.backupDir, pending[pending.length - 1]!.version, now(), options.appVersion ?? '')
    }
    for (const migration of MIGRATIONS) {
      if (migration.version <= readSchemaVersion(db)) continue
      const run = db.transaction(() => {
        migration.up(db)
        db.prepare('INSERT INTO schema_migrations (version, description, applied_at) VALUES (?, ?, ?)').run(
          migration.version,
          migration.description,
          now()
        )
        db.pragma(`user_version = ${migration.version}`)
      })
      run()
    }
    if (!skipSeed) seedDatabase(db, now())
  } catch (error) {
    try {
      db.close()
    } catch {
      /* the database may already be closed */
    }
    if (error instanceof AppError) throw error
    throw new AppError('E_DB', 'The clinic database could not be prepared for use. Please restore a backup or contact support.', {
      detail: { reason: error instanceof Error ? error.message : String(error) }
    })
  }

  return {
    db,
    filePath,
    isClinicInitialised(): boolean {
      const row = db.prepare('SELECT name FROM clinic WHERE id = 1').get() as { name: string } | undefined
      return Boolean(row && row.name.trim().length > 0)
    },
    integrityCheck(): { ok: boolean; messages: string[] } {
      const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
      const messages = rows.map((row) => row.integrity_check)
      return { ok: messages.length === 1 && messages[0] === 'ok', messages }
    },
    foreignKeyCheck(): { ok: boolean; violations: string[] } {
      const rows = db.pragma('foreign_key_check') as Array<Record<string, unknown>>
      return {
        ok: rows.length === 0,
        violations: rows.map((row) => `${String(row.table)} → ${String(row.parent)} (rowid ${String(row.rowid)})`)
      }
    },
    optimize(): void {
      db.pragma('optimize')
    },
    vacuum(): void {
      db.exec('VACUUM')
    },
    sizeBytes(): number {
      try {
        return statSync(filePath).size
      } catch {
        return 0
      }
    },
    close(): void {
      db.close()
    }
  }
}

/** Location of the SQLite file inside a data directory. */
export function databasePath(dataDir: string): string {
  return join(dataDir, 'data', 'dentiva.db')
}

/**
 * Copies the database aside before a migration runs. The snapshot is a plain SQLite file taken with
 * `VACUUM INTO`, so it can be restored even if this build is later replaced; it is registered in the
 * `backups` table when that table exists so the printing screen can show it like any other backup.
 */
function takePreMigrationSnapshot(db: Db, backupDir: string, targetVersion: number, at: number, appVersion: string): void {
  try {
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
    const date = new Date(at)
    const pad = (value: number): string => String(value).padStart(2, '0')
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    const target = join(backupDir, `pre-migration-v${targetVersion}-${stamp}.db`)
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    if (!existsSync(target)) return
    try {
      db.prepare(
        `INSERT INTO backups (file_name, file_path, kind, size_bytes, checksum, schema_version, app_version, created_at, verified, includes_attachments, note)
         VALUES (?, ?, 'pre_migration', ?, NULL, ?, ?, ?, 1, 0, 'Automatic snapshot taken before a schema migration')`
      ).run(
        target.split(/[\\/]/).pop() ?? target,
        target,
        statSync(target).size,
        targetVersion - 1 >= 0 ? targetVersion - 1 : 0,
        appVersion,
        at
      )
    } catch {
      /* the backups table may not exist on very old databases; the file itself is the protection */
    }
  } catch {
    /* a snapshot failure must never block the application from starting */
  }
}
