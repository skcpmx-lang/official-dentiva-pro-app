import Database from 'better-sqlite3'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppError } from '@shared/errors'
import { SCHEMA_V1_POST_SQL, SCHEMA_V1_SQL } from './schema'
import { MIGRATIONS, ensureSchemaTable, readSchemaVersion } from './migrate'
import { seedDatabase } from './seed'

export type Db = Database.Database

/**
 * How many distinct SQL statements one connection keeps prepared.
 *
 * better-sqlite3 (like every SQLite binding) gives a prepared statement native memory that is released
 * only when the statement is garbage collected, and it is released lazily. Preparing the same SQL again
 * for every call therefore made the process grow without bound: measured on the stress dataset, roughly
 * 77 KB of native memory per write, so a clinic that recorded a year of work in one shift would have
 * seen the application slow down and eventually run out of memory. Keeping statements prepared is also
 * what SQLite is built for — it skips parsing and planning on every call.
 *
 * 500 is far above the number of distinct statements the application has (a few hundred, including the
 * filtered list queries whose text varies with the filters in force), so in practice nothing is evicted
 * twice; the bound only exists so a pathological caller cannot grow the cache for ever.
 */
const STATEMENT_CACHE_LIMIT = 500

/**
 * Wrap a connection so that `prepare` reuses statements, keyed by their SQL text.
 *
 * The cache lives exactly as long as the connection. Statements must not be reconfigured through
 * `.raw()`, `.pluck()` or `.expand()` — those change the shape of the rows the statement returns, and a
 * reconfigured statement handed to another caller would read wrongly. No module does this (the
 * codebase prepares plain statements and maps rows in TypeScript), and `database.test.ts` guards it.
 */
function cacheStatements(db: Db): { db: Db, cacheSize: () => number, clear: () => void } {
  const statements = new Map<string, ReturnType<Db['prepare']>>()
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql: string) => {
          const cached = statements.get(sql)
          if (cached) {
            /* Re-insert so the map's insertion order keeps the most recently used statement last. */
            statements.delete(sql)
            statements.set(sql, cached)
            return cached
          }
          const statement = target.prepare(sql)
          if (statements.size >= STATEMENT_CACHE_LIMIT) {
            const oldest = statements.keys().next().value as string | undefined
            if (oldest !== undefined) statements.delete(oldest)
          }
          statements.set(sql, statement)
          return statement
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  })
  return { db: proxy, cacheSize: () => statements.size, clear: () => statements.clear() }
}

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
  /** Distinct SQL statements currently kept prepared. Diagnostics for the performance run and health panel. */
  statementCacheSize(): number
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

  /* From here on every caller uses the caching connection. Setup, migrations and seeding above work on
     the raw handle, which is why the cache is created only once the database is ready. */
  const connection = cacheStatements(db)
  const cachedDb = connection.db

  return {
    db: cachedDb,
    filePath,
    statementCacheSize(): number {
      return connection.cacheSize()
    },
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
      /* Drop the statements first: their native memory is freed as the statements are collected, and
         tests open and close many databases in one process. */
      connection.clear()
      db.close()
    }
  }
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
