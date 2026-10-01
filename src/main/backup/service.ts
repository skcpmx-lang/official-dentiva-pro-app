import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import { assertPermission, createAuditWriter, type ServiceContext } from '../context'
import type { Db } from '../db/connection'
import type { Actor } from '@shared/permissions'
import { AppError, notFoundError, validationError } from '@shared/errors'
import { SCHEMA_VERSION } from '../db/schema'
import { getNumberSetting, getSettingSafe, setInternalSetting } from '../modules/settings/service'
import { exportStamp } from '../files/csv'
import { ensureDir } from '../files/storage'
import {
  BACKUP_EXTENSION,
  backupFileName,
  createBackupPackage,
  discardStaging,
  extractBackupPackage,
  isBackupFileName,
  verifyStagedCoverage,
  type BackupKind,
  type BackupManifest
} from './package'

/**
 * Backup and restore.
 *
 * A backup never reads the live database file: SQLite's `VACUUM INTO` writes a consistent, fully
 * checkpointed snapshot while the clinic keeps working. A restore is deliberately paranoid — the package
 * is validated and hashed, the database inside it is opened and integrity-checked before anything is
 * replaced, a pre-restore backup is taken first, and the live database is only swapped once all of that
 * has passed. Anything that fails leaves the clinic on the data it had.
 */

const COUNTED_TABLES = [
  'patients',
  'visits',
  'dental_chart_entries',
  'prescriptions',
  'invoices',
  'payments',
  'appointments',
  'treatments',
  'inventory_items',
  'staff',
  'users'
] as const

export interface BackupRecord {
  id: number
  fileName: string
  filePath: string
  kind: BackupKind
  sizeBytes: number
  checksum: string | null
  schemaVersion: number
  appVersion: string
  createdAt: number
  createdByName: string | null
  /** Raw creator id (kept for re-registering a package in a restored database). */
  createdByUserId: number | null
  verified: boolean
  includesAttachments: boolean
  patientCount: number | null
  note: string | null
  /** True when the file is still on disk; a package moved or deleted outside the app is flagged. */
  fileExists: boolean
}

export interface BackupStatus {
  folder: string
  frequencyDays: number
  retention: number
  includeAttachments: boolean
  lastRunAt: number | null
  nextRunAt: number | null
  due: boolean
  automaticCount: number
  totalCount: number
  schemaVersion: number
  appVersion: string
}

export interface StagedRestore {
  filePath: string
  stagingRoot: string
  databaseFile: string
  attachmentsDir: string | null
  manifest: BackupManifest | null
  schemaVersion: number
  counts: Record<string, number>
  problems: string[]
}

/* -------------------------------------------------------------------------- */
/* Listing and settings                                                       */
/* -------------------------------------------------------------------------- */

interface BackupRow {
  id: number
  file_name: string
  file_path: string
  kind: string
  size_bytes: number
  checksum: string | null
  schema_version: number
  app_version: string
  created_at: number
  created_by: number | null
  verified: number
  includes_attachments: number
  patient_count: number | null
  note: string | null
  username: string | null
}

const BACKUP_SELECT = `
  SELECT b.id, b.file_name, b.file_path, b.kind, b.size_bytes, b.checksum, b.schema_version, b.app_version,
         b.created_at, b.created_by, b.verified, b.includes_attachments, b.patient_count, b.note,
         u.username
    FROM backups b
    LEFT JOIN users u ON u.id = b.created_by`

function mapBackup(row: BackupRow): BackupRecord {
  return {
    id: row.id,
    fileName: row.file_name,
    filePath: row.file_path,
    kind: (row.kind as BackupKind) ?? 'manual',
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    schemaVersion: row.schema_version,
    appVersion: row.app_version,
    createdAt: row.created_at,
    createdByName: row.username,
    createdByUserId: row.created_by,
    verified: row.verified === 1,
    includesAttachments: row.includes_attachments === 1,
    patientCount: row.patient_count,
    note: row.note,
    fileExists: existsSync(row.file_path)
  }
}

export function backupFolder(ctx: ServiceContext): string {
  const configured = getSettingSafe(ctx, 'backup.folder', '')
  return configured.trim() === '' ? ctx.host.paths.defaultBackupDir : configured.trim()
}

export function listBackups(ctx: ServiceContext, limit = 200): BackupRecord[] {
  assertPermission(ctx, 'backups.create')
  const rows = ctx.db.prepare(`${BACKUP_SELECT} ORDER BY b.created_at DESC, b.id DESC LIMIT ?`).all(limit) as BackupRow[]
  return rows.map(mapBackup)
}

export function getBackup(ctx: ServiceContext, id: number): BackupRecord {
  const row = ctx.db.prepare(`${BACKUP_SELECT} WHERE b.id = ?`).get(id) as BackupRow | undefined
  if (!row) throw notFoundError('backup', id)
  return mapBackup(row)
}

export function backupStatus(ctx: ServiceContext): BackupStatus {
  assertPermission(ctx, 'backups.create')
  const frequencyDays = Number(getSettingSafe(ctx, 'backup.frequencyDays', '7')) || 0
  const retention = getNumberSetting(ctx, 'backup.retention')
  const lastRunAtRaw = getSettingSafe(ctx, 'backup.lastRunAt', '')
  const lastRunAt = lastRunAtRaw === '' ? null : Number(lastRunAtRaw)
  const automaticCount = (ctx.db.prepare("SELECT COUNT(*) AS count FROM backups WHERE kind = 'auto'").get() as { count: number }).count
  const totalCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM backups').get() as { count: number }).count
  const nextRunAt = frequencyDays > 0 && lastRunAt !== null ? lastRunAt + frequencyDays * 86_400_000 : null
  return {
    folder: backupFolder(ctx),
    frequencyDays,
    retention,
    includeAttachments: getSettingSafe(ctx, 'backup.includeAttachments', 'true') === 'true',
    lastRunAt,
    nextRunAt,
    due: frequencyDays > 0 && (lastRunAt === null || Date.now() >= lastRunAt + frequencyDays * 86_400_000),
    automaticCount,
    totalCount,
    schemaVersion: SCHEMA_VERSION,
    appVersion: ctx.host.build.version
  }
}

export interface BackupSettingsInput {
  folder: string | null
  frequencyDays: number
  retention: number
  includeAttachments: boolean
}

export function saveBackupSettings(ctx: ServiceContext, input: BackupSettingsInput): BackupStatus {
  assertPermission(ctx, 'backups.configure')
  const errors: Record<string, string> = {}
  if (![0, 7, 15, 30].includes(input.frequencyDays)) errors.frequencyDays = 'Choose 7, 15 or 30 days, or turn automatic backups off.'
  if (input.retention < 1 || input.retention > 100) errors.retention = 'Keep between 1 and 100 automatic backups.'
  if (input.folder !== null && input.folder.trim() !== '') {
    const folder = input.folder.trim()
    try {
      mkdirSync(folder, { recursive: true })
      if (!statSync(folder).isDirectory()) errors.folder = 'That path is not a folder.'
    } catch {
      errors.folder = 'The backup folder could not be created. Check the path and permissions.'
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new AppError('E_VALIDATION', 'The backup settings could not be saved.', { fieldErrors: errors })
  }
  setInternalSetting(ctx, 'backup.folder', input.folder?.trim() ?? '')
  setInternalSetting(ctx, 'backup.frequencyDays', String(input.frequencyDays))
  setInternalSetting(ctx, 'backup.retention', String(input.retention))
  setInternalSetting(ctx, 'backup.includeAttachments', input.includeAttachments ? 'true' : 'false')
  ctx.audit.write({
    module: 'backups',
    action: 'backup.configure',
    entityType: 'settings',
    entityId: 0,
    summary: 'Updated the backup folder, schedule and retention',
    detail: { folder: input.folder?.trim() ?? '', frequencyDays: input.frequencyDays, retention: input.retention, includeAttachments: input.includeAttachments }
  })
  return backupStatus(ctx)
}

/* -------------------------------------------------------------------------- */
/* Creating                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateBackupOptions {
  kind: BackupKind
  includeAttachments?: boolean
  targetPath?: string | null
  note?: string | null
}

export interface CreatedBackup {
  record: BackupRecord
  manifest: BackupManifest
}

export async function createBackup(ctx: ServiceContext, options: CreateBackupOptions): Promise<CreatedBackup> {
  assertPermission(ctx, 'backups.create')
  /* Quick backups are database-only; full backups always carry the attachment archive. Scheduled
     backups follow the clinic's setting. An explicit choice from the operator wins either way. */
  const includeAttachments =
    options.includeAttachments ??
    (options.kind === 'pre_restore' || options.kind === 'full'
      ? true
      : options.kind === 'quick'
        ? false
        : getSettingSafe(ctx, 'backup.includeAttachments', 'true') === 'true')
  const folder = backupFolder(ctx)
  ensureDir(folder)
  const at = Date.now()
  const requested = options.targetPath?.trim()
  const targetPath = requested !== undefined && requested !== '' ? requested : uniqueBackupPath(folder, options.kind, at)
  if (existsSync(targetPath)) throw validationError('A file with that name already exists. Choose another name.')

  const snapshotFile = join(ctx.host.paths.tmpDir, `snapshot-${exportStamp(at)}-${Math.random().toString(36).slice(2, 8)}.db`)
  ensureDir(ctx.host.paths.tmpDir)
  try {
    /* A single VACUUM INTO statement gives a consistent copy without stopping the clinic. */
    ctx.db.exec(`VACUUM INTO '${snapshotFile.replace(/'/g, "''")}'`)
    const counts = countRows(ctx)
    const manifest = await createBackupPackage({
      snapshotFile,
      attachmentsDir: ctx.host.paths.attachmentsDir,
      targetPath,
      manifest: {
        format: 'dentiva-backup',
        formatVersion: 1,
        appVersion: ctx.host.build.version,
        schemaVersion: SCHEMA_VERSION,
        kind: options.kind,
        createdAt: at,
        createdBy: ctx.actor.username ?? null,
        includesAttachments: includeAttachments,
        counts
      }
    })
    const sizeBytes = statSync(targetPath).size
    const id = insertBackupRow(ctx.db, {
      fileName: basename(targetPath),
      filePath: targetPath,
      kind: options.kind,
      sizeBytes,
      checksum: manifest.database.sha256,
      schemaVersion: SCHEMA_VERSION,
      appVersion: manifest.appVersion,
      createdAt: at,
      createdBy: ctx.actor.userId,
      includesAttachments: includeAttachments,
      patientCount: counts.patients ?? null,
      note: options.note ?? null
    })
    ctx.audit.write({
      module: 'backups',
      action: 'backup.create',
      entityType: 'backup',
      entityId: id,
      summary: `Created a ${options.kind === 'auto' ? 'scheduled' : options.kind} backup (${Math.round(sizeBytes / 1024)} KB)`,
      detail: { filePath: targetPath, includeAttachments, counts }
    })
    if (options.kind === 'auto') {
      pruneBackups(ctx)
      setInternalSetting(ctx, 'backup.lastRunAt', String(at))
    }
    return { record: getBackup(ctx, id), manifest }
  } finally {
    rmSync(snapshotFile, { force: true })
  }
}

/** Two backups started in the same second get `-2`, `-3`, … rather than overwriting each other. */
function uniqueBackupPath(folder: string, kind: BackupKind, at: number): string {
  const base = backupFileName(kind, at)
  let candidate = join(folder, base)
  let counter = 2
  while (existsSync(candidate)) {
    if (counter > 50) throw validationError('Too many backups were started in the same second. Please try again.')
    candidate = join(folder, base.replace(BACKUP_EXTENSION, `-${counter}${BACKUP_EXTENSION}`))
    counter += 1
  }
  return candidate
}

function countRows(ctx: ServiceContext): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const table of COUNTED_TABLES) {
    try {
      counts[table] = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    } catch {
      counts[table] = 0
    }
  }
  return counts
}

/** Keeps the newest `backup.retention` automatic backups; manual and pre-restore packages are never pruned. */
export function pruneBackups(ctx: ServiceContext): { removed: number; kept: number } {
  const keep = getNumberSetting(ctx, 'backup.retention')
  const rows = ctx.db
    .prepare("SELECT id, file_path FROM backups WHERE kind = 'auto' ORDER BY created_at DESC, id DESC")
    .all() as Array<{ id: number, file_path: string }>
  const stale = rows.slice(keep)
  for (const row of stale) {
    try {
      rmSync(row.file_path, { force: true })
    } catch {
      /* a locked file is removed on the next run */
    }
    ctx.db.prepare('DELETE FROM backups WHERE id = ?').run(row.id)
  }
  if (stale.length > 0) {
    ctx.audit.write({
      module: 'backups',
      action: 'backup.prune',
      entityType: 'backup',
      entityId: stale[0]!.id,
      summary: `Removed ${stale.length} old automatic backup(s), keeping ${keep}`,
      detail: { removed: stale.map((row) => row.file_path) }
    })
  }
  return { removed: stale.length, kept: Math.min(rows.length, keep) }
}

/** Runs the scheduled backup when one is due; safe to call on every start and on a timer. */
export async function runScheduledBackup(ctx: ServiceContext, options: { force?: boolean } = {}): Promise<{ ran: boolean, reason: string, filePath?: string }> {
  const status = backupStatus(ctx)
  if (status.frequencyDays === 0 && !options.force) return { ran: false, reason: 'Automatic backups are turned off.' }
  if (!options.force && !status.due) return { ran: false, reason: 'The next scheduled backup is not due yet.' }
  const created = await createBackup(ctx, { kind: 'auto', includeAttachments: status.includeAttachments, note: options.force ? 'Run on demand' : 'Scheduled backup' })
  return { ran: true, reason: 'Automatic backup created.', filePath: created.record.filePath }
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

export async function validateBackupFile(ctx: ServiceContext, filePath: string): Promise<{ ok: boolean, problems: string[], manifest: BackupManifest | null, schemaVersion: number | null, counts: Record<string, number> | null }> {
  assertPermission(ctx, 'backups.restore')
  const problems: string[] = []
  if (!existsSync(filePath)) return { ok: false, problems: ['The file does not exist.'], manifest: null, schemaVersion: null, counts: null }
  const stagingRoot = join(ctx.host.paths.tmpDir, `validate-${exportStamp()}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    const staged = await stageInto(ctx, filePath, stagingRoot)
    problems.push(...staged.problems)
    return { ok: problems.length === 0, problems, manifest: staged.manifest, schemaVersion: staged.schemaVersion, counts: staged.counts }
  } catch (error) {
    const details = error instanceof AppError ? (error.detail?.problems as string[] | undefined) : undefined
    return {
      ok: false,
      problems: details && details.length > 0 ? details : [error instanceof Error ? error.message : 'The package could not be read.'],
      manifest: null,
      schemaVersion: null,
      counts: null
    }
  } finally {
    discardStaging(stagingRoot)
  }
}

/** Validates and stages a package (or a bare `.db` snapshot) for a restore. */
export async function stageRestore(ctx: ServiceContext, filePath: string): Promise<StagedRestore> {
  assertPermission(ctx, 'backups.restore')
  if (!existsSync(filePath)) throw notFoundError('backup file', filePath)
  const stagingRoot = join(ctx.host.paths.tmpDir, `restore-${exportStamp()}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    const staged = await stageInto(ctx, filePath, stagingRoot)
    if (staged.problems.length > 0) {
      throw new AppError('E_VALIDATION', 'The backup cannot be restored.', { detail: { problems: staged.problems } })
    }
    return staged
  } catch (error) {
    discardStaging(stagingRoot)
    throw error
  }
}

async function stageInto(ctx: ServiceContext, filePath: string, stagingRoot: string): Promise<StagedRestore> {
  mkdirSync(stagingRoot, { recursive: true })

  if (isBackupFileName(filePath)) {
    let extracted
    try {
      extracted = await extractBackupPackage(filePath, stagingRoot)
    } catch (error) {
      const problems = error instanceof AppError ? (error.detail?.problems as string[] | undefined) : undefined
      throw new AppError('E_VALIDATION', error instanceof Error ? error.message : 'The package could not be read.', {
        detail: { problems: problems ?? [] }
      })
    }
    const { manifest, files } = extracted
    const problems = verifyStagedCoverage(manifest, files)
    const databaseFile = join(stagingRoot, ...manifest.database.path.split('/'))
    const attachmentsDir = manifest.attachments.entries.length > 0 ? join(stagingRoot, 'attachments') : null
    if (manifest.schemaVersion > SCHEMA_VERSION) {
      problems.push(`The backup was written with schema v${manifest.schemaVersion} but this build understands v${SCHEMA_VERSION}. Install the newer version to restore it.`)
    }
    const inspected = inspectSnapshot(databaseFile)
    problems.push(...inspected.problems)
    return {
      filePath,
      stagingRoot,
      databaseFile,
      attachmentsDir,
      manifest,
      schemaVersion: inspected.schemaVersion ?? manifest.schemaVersion,
      counts: inspected.counts,
      problems
    }
  }

  /* A bare SQLite snapshot (`pre-migration-*.db`) is restorable too — it is what a damaged install has. */
  const databaseFile = join(stagingRoot, 'snapshot.db')
  copyFileSync(filePath, databaseFile)
  const problems: string[] = []
  const inspected = inspectSnapshot(databaseFile)
  problems.push(...inspected.problems)
  if (inspected.schemaVersion !== null && inspected.schemaVersion > SCHEMA_VERSION) {
    problems.push(`The snapshot uses schema v${inspected.schemaVersion} but this build understands v${SCHEMA_VERSION}.`)
  }
  return {
    filePath,
    stagingRoot,
    databaseFile,
    attachmentsDir: null,
    manifest: null,
    schemaVersion: inspected.schemaVersion ?? 0,
    counts: inspected.counts,
    problems
  }
}

/** Opens the staged database read-only and insists it is a healthy clinic database. */
function inspectSnapshot(databaseFile: string): { problems: string[], schemaVersion: number | null, counts: Record<string, number> } {
  const problems: string[] = []
  let handle: Database.Database | null = null
  try {
    handle = new Database(databaseFile, { readonly: true, fileMustExist: true })
    const check = handle.pragma('quick_check', { simple: true }) as string
    if (check !== 'ok') problems.push('The database inside the package is damaged and failed its integrity check.')
    const foreignKeys = handle.pragma('foreign_key_check') as Array<Record<string, unknown>>
    if (foreignKeys.length > 0) problems.push(`The database inside the package has ${foreignKeys.length} broken relationship(s).`)
    const versionRow = handle.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null } | undefined
    const schemaVersion = versionRow?.version ?? null
    if (schemaVersion === null) problems.push('The database inside the package has no schema history and is not a Dentiva Pro database.')
    const counts: Record<string, number> = {}
    for (const table of COUNTED_TABLES) {
      try {
        counts[table] = (handle.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
      } catch {
        counts[table] = 0
      }
    }
    return { problems, schemaVersion, counts }
  } catch (error) {
    problems.push(error instanceof Error ? `The database inside the package could not be opened (${error.message}).` : 'The database inside the package could not be opened.')
    return { problems, schemaVersion: null, counts: {} }
  } finally {
    handle?.close()
  }
}

/* -------------------------------------------------------------------------- */
/* Restore bookkeeping                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A restore is written down before the database is touched (result `in_progress`) and completed after it
 * has been replaced. The row therefore survives a crash mid-restore and the history screen can show that
 * an attempt happened even when the process died.
 */
export function beginRestore(db: Db, entry: { fileName: string, startedAt: number, preRestoreBackupId: number | null }): number {
  const result = db
    .prepare(
      `INSERT INTO restore_history (file_name, started_at, finished_at, result, message, pre_restore_backup_id)
       VALUES (@fileName, @startedAt, NULL, 'in_progress', NULL, @preRestoreBackupId)`
    )
    .run(entry)
  return Number(result.lastInsertRowid)
}

interface BackupRowInput {
  fileName: string
  filePath: string
  kind: BackupKind
  sizeBytes: number
  checksum: string | null
  schemaVersion: number
  appVersion: string
  createdAt: number
  createdBy: number | null
  includesAttachments: boolean
  patientCount: number | null
  note: string | null
}

/** Single place that writes a `backups` row, so the columns can never drift between callers. */
function insertBackupRow(db: Db, row: BackupRowInput): number {
  const result = db
    .prepare(
      `INSERT INTO backups (file_name, file_path, kind, size_bytes, checksum, schema_version, app_version,
         created_at, created_by, verified, includes_attachments, patient_count, note)
       VALUES (@fileName, @filePath, @kind, @sizeBytes, @checksum, @schemaVersion, @appVersion, @createdAt,
         @createdBy, 1, @includesAttachments, @patientCount, @note)`
    )
    .run({ ...row, includesAttachments: row.includesAttachments ? 1 : 0 })
  return Number(result.lastInsertRowid)
}

/**
 * Makes sure the pre-restore safety copy is listed by the database that was just restored. The package
 * itself was written before the swap, so the restored (older) `backups` table does not know about it yet.
 */
export function ensurePreRestoreRow(db: Db, record: BackupRecord): number {
  const existing = db.prepare('SELECT id FROM backups WHERE file_path = ?').get(record.filePath) as { id: number } | undefined
  if (existing) return existing.id
  return insertBackupRow(db, {
    fileName: record.fileName,
    filePath: record.filePath,
    kind: 'pre_restore',
    sizeBytes: record.sizeBytes,
    checksum: record.checksum,
    schemaVersion: record.schemaVersion,
    appVersion: record.appVersion,
    createdAt: record.createdAt,
    createdBy: record.createdByName === null ? null : record.createdByUserId,
    includesAttachments: record.includesAttachments,
    patientCount: record.patientCount,
    note: 'Safety copy taken automatically before a restore'
  })
}

/** Records a completed restore in the database that was just restored. */
export function recordCompletedRestore(
  db: Db,
  entry: { fileName: string, startedAt: number, finishedAt: number, message: string, preRestoreBackupId: number | null },
  actor: Pick<Actor, 'userId' | 'username'>,
  sessionId: string
): number {
  const result = db
    .prepare(
      `INSERT INTO restore_history (file_name, started_at, finished_at, result, message, pre_restore_backup_id)
       VALUES (@fileName, @startedAt, @finishedAt, 'success', @message, @preRestoreBackupId)`
    )
    .run(entry)
  const id = Number(result.lastInsertRowid)
  createAuditWriter(
    db,
    { userId: actor.userId, username: actor.username, fullName: actor.username, roleId: 0, roleCode: 'system', permissions: new Set<string>(), maxDiscountBasisPoints: null },
    sessionId,
    () => entry.finishedAt
  ).write({
    module: 'backups',
    action: 'backup.restore',
    entityType: 'restore',
    entityId: id,
    summary: `Restored the clinic database from ${entry.fileName}`,
    detail: { preRestoreBackupId: entry.preRestoreBackupId }
  })
  return id
}

export function finishRestore(
  db: Db,
  id: number,
  entry: { result: 'success' | 'failed', message: string, finishedAt: number },
  actor: Pick<Actor, 'userId' | 'username'>,
  sessionId: string
): void {
  db.prepare('UPDATE restore_history SET finished_at = @finishedAt, result = @result, message = @message WHERE id = @id').run({
    id,
    finishedAt: entry.finishedAt,
    result: entry.result,
    message: entry.message
  })
  createAuditWriter(
    db,
    { userId: actor.userId, username: actor.username, fullName: actor.username, roleId: 0, roleCode: 'system', permissions: new Set<string>(), maxDiscountBasisPoints: null },
    sessionId,
    () => entry.finishedAt
  ).write({
    module: 'backups',
    action: entry.result === 'success' ? 'backup.restore' : 'backup.restoreFailed',
    entityType: 'restore',
    entityId: id,
    summary: entry.result === 'success' ? `Restored the clinic database from the selected backup` : `A restore failed: ${entry.message}`,
    detail: { message: entry.message }
  })
}

/** Row counts of the tables that identify a clinic database; used to verify that a restore landed. */
export function liveRowCounts(db: Db): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const table of COUNTED_TABLES) {
    try {
      counts[table] = (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
    } catch {
      counts[table] = 0
    }
  }
  return counts
}

/**
 * What `performRestore` needs from the running application. The service deliberately does not import the
 * Electron entry point (that would create a cycle and make the pipeline untestable); the handler injects
 * these operations and the integration tests inject a runtime backed by a real SQLite handle.
 */
export interface RestoreRuntime {
  databaseFile: string
  attachmentsDir: string
  tmpDir: string
  /** Live handle while the database is open, `null` while the restore has it closed. */
  liveDb(): Db | null
  /** Closes the live connection so its files can be replaced. */
  closeDatabase(): void
  /** Re-opens the database after files were replaced; false when it could not be opened. */
  reopenDatabase(): boolean
  /** Integrity check, relationship check and row counts of the database that is open right now. */
  inspectOpenDatabase(): { ok: boolean, problems: string[], counts: Record<string, number> }
}

export type RestorePhase = 'snapshot' | 'replacing' | 'verifying' | 'finalizing'

export interface RestoreProgress {
  phase: RestorePhase
  percent: number
  message?: string
}

export interface RestoreResult {
  fileName: string
  preRestoreBackupId: number
  counts: Record<string, number>
  message: string
}

const MANUAL_RECOVERY =
  'The restore failed and the clinic data could not be reopened automatically. Restart Dentiva Pro; if the data still does not open, restore the pre-restore backup that was saved before this attempt.'

function compareCounts(expected: Record<string, number> | null, actual: Record<string, number>): string[] {
  if (!expected) return []
  const problems: string[] = []
  for (const [table, count] of Object.entries(expected)) {
    if (!(table in actual)) continue
    if (actual[table] !== count) problems.push(`“${table}” holds ${actual[table]} row(s) but the backup recorded ${count}.`)
  }
  return problems
}

/**
 * The restore pipeline, strictly ordered:
 *   validate (already staged) → safety backup → pre-restore copy → replace database and attachments →
 *   reopen → verify integrity, relationships and row counts → keep, or roll back to the copy.
 *
 * The attachments folder is only replaced when the package carries attachments, so restoring a quick
 * (database-only) backup does not delete files that are already on the machine. Anything that fails
 * leaves the clinic on exactly the data it had before the attempt.
 */
export async function performRestore(
  ctx: ServiceContext,
  runtime: RestoreRuntime,
  staged: StagedRestore,
  options: { onProgress?: (progress: RestoreProgress) => void } = {}
): Promise<RestoreResult> {
  assertPermission(ctx, 'backups.restore')
  if (!ctx.actor.permissions.has('backups.create')) {
    throw new AppError('E_PERMISSION', 'Restoring a backup takes an automatic safety copy first, which needs the “Create backups” permission.', {
      detail: { permission: 'backups.create' }
    })
  }

  const report = options.onProgress ?? ((): void => undefined)
  const startedAt = Date.now()
  const fileName = basename(staged.filePath)
  const suffix = `${exportStamp(startedAt)}-${Math.random().toString(36).slice(2, 8)}`

  report({ phase: 'snapshot', percent: 10, message: 'Taking a safety backup of the current data' })
  const pre = await createBackup(ctx, {
    kind: 'pre_restore',
    includeAttachments: true,
    note: `Taken automatically before restoring ${fileName}`
  })

  const restoreId = beginRestore(ctx.db, { fileName, startedAt, preRestoreBackupId: pre.record.id })
  const rollbackDatabase = join(runtime.tmpDir, `restore-rollback-${suffix}.db`)
  const savedAttachments = join(runtime.tmpDir, `restore-attachments-${suffix}`)
  let databaseClosed = false
  let rollbackAttempted = false
  let attachmentsSaved = false
  let attachmentsInstalled = false

  const rollback = (message: string): boolean => {
    rollbackAttempted = true
    try {
      runtime.closeDatabase()
    } catch {
      /* already closed */
    }
    try {
      copyFileSync(rollbackDatabase, runtime.databaseFile)
      for (const side of ['-wal', '-shm']) rmSync(`${runtime.databaseFile}${side}`, { force: true })
    } catch {
      /* the pre-restore package is the last line of defence */
    }
    if (attachmentsInstalled) {
      try {
        rmSync(runtime.attachmentsDir, { recursive: true, force: true })
        if (attachmentsSaved) renameSync(savedAttachments, runtime.attachmentsDir)
      } catch {
        /* the saved folder is kept in tmp for manual recovery */
      }
    }
    const reopened = runtime.reopenDatabase()
    const live = runtime.liveDb()
    if (live) finishRestore(live, restoreId, { result: 'failed', message, finishedAt: Date.now() }, ctx.actor, ctx.sessionId)
    return reopened
  }

  try {
    /* A plain file copy would miss committed pages that are still in the WAL, so the rollback copy is
       another `VACUUM INTO` snapshot taken while the live handle is healthy. */
    ctx.db.exec(`VACUUM INTO '${rollbackDatabase.replace(/'/g, "''")}'`)
    if (staged.attachmentsDir && existsSync(runtime.attachmentsDir)) {
      renameSync(runtime.attachmentsDir, savedAttachments)
      attachmentsSaved = true
    }

    report({ phase: 'replacing', percent: 45, message: 'Replacing the clinic database' })
    runtime.closeDatabase()
    databaseClosed = true
    copyFileSync(staged.databaseFile, runtime.databaseFile)
    for (const side of ['-wal', '-shm']) rmSync(`${runtime.databaseFile}${side}`, { force: true })
    if (staged.attachmentsDir) {
      ensureDir(runtime.attachmentsDir)
      cpSync(staged.attachmentsDir, runtime.attachmentsDir, { recursive: true })
      attachmentsInstalled = true
    }

    report({ phase: 'verifying', percent: 70, message: 'Verifying the restored data' })
    if (!runtime.reopenDatabase()) {
      const message = 'The restored database could not be opened.'
      if (!rollback(message)) throw new AppError('E_DB', MANUAL_RECOVERY, { detail: { restoreId } })
      throw new AppError('E_DB', `${message} Your previous data was put back.`, { detail: { restoreId } })
    }

    const inspection = runtime.inspectOpenDatabase()
    const problems = [...inspection.problems, ...compareCounts(staged.manifest?.counts ?? null, inspection.counts)]
    if (problems.length > 0) {
      if (!rollback(problems[0]!)) throw new AppError('E_DB', MANUAL_RECOVERY, { detail: { restoreId } })
      throw new AppError('E_VALIDATION', `The restored data failed verification, so your previous data was put back. ${problems[0]}`, {
        detail: { problems, restoreId }
      })
    }
    const live = runtime.liveDb()
    if (!live) throw new AppError('E_DB', MANUAL_RECOVERY, { detail: { restoreId } })

    report({ phase: 'finalizing', percent: 90, message: 'Finishing up' })
    /* The restored database predates the safety copy, so register it there before recording the restore. */
    const preRestoreId = ensurePreRestoreRow(live, pre.record)
    recordCompletedRestore(
      live,
      { fileName, startedAt, finishedAt: Date.now(), message: `Restored from ${fileName}`, preRestoreBackupId: preRestoreId },
      ctx.actor,
      ctx.sessionId
    )
    rmSync(rollbackDatabase, { force: true })
    if (attachmentsSaved) rmSync(savedAttachments, { recursive: true, force: true })
    return {
      fileName,
      preRestoreBackupId: preRestoreId,
      counts: inspection.counts,
      message: `Restored ${fileName}. ${inspection.counts.patients ?? 0} patient record(s) are available.`
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The restore failed.'
    if (!databaseClosed) {
      /* Nothing was replaced yet — only the safety backup exists. */
      finishRestore(ctx.db, restoreId, { result: 'failed', message, finishedAt: Date.now() }, ctx.actor, ctx.sessionId)
      rmSync(rollbackDatabase, { force: true })
      throw error
    }
    if (!rollbackAttempted) {
      if (!rollback(message)) throw new AppError('E_DB', MANUAL_RECOVERY, { detail: { restoreId, message } })
      throw new AppError('E_DB', 'The restore failed, so your previous data was put back.', { detail: { restoreId, message } })
    }
    throw error
  }
}

export function listRestores(ctx: ServiceContext, limit = 50): Array<{ id: number, fileName: string, startedAt: number, finishedAt: number | null, result: string, message: string | null, preRestoreBackupId: number | null }> {
  assertPermission(ctx, 'backups.restore')
  const rows = ctx.db
    .prepare('SELECT id, file_name, started_at, finished_at, result, message, pre_restore_backup_id FROM restore_history ORDER BY started_at DESC LIMIT ?')
    .all(limit) as Array<{ id: number, file_name: string, started_at: number, finished_at: number | null, result: string, message: string | null, pre_restore_backup_id: number | null }>
  return rows.map((row) => ({
    id: row.id,
    fileName: row.file_name,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    result: row.result,
    message: row.message,
    preRestoreBackupId: row.pre_restore_backup_id
  }))
}

export function deleteBackup(ctx: ServiceContext, id: number, options: { removeFile?: boolean } = {}): void {
  assertPermission(ctx, 'backups.configure')
  const backup = getBackup(ctx, id)
  ctx.db.prepare('DELETE FROM backups WHERE id = ?').run(id)
  if (options.removeFile ?? true) {
    try {
      unlinkSync(backup.filePath)
    } catch {
      /* the file may already be gone; the record is what mattered */
    }
  }
  ctx.audit.write({
    module: 'backups',
    action: 'backup.delete',
    entityType: 'backup',
    entityId: id,
    summary: `Deleted the backup record for ${backup.fileName}`,
    detail: { filePath: backup.filePath, fileRemoved: options.removeFile ?? true }
  })
}

/** Files in the backup folder that are not registered yet (for example copied in from another machine). */
export function scanBackupFolder(ctx: ServiceContext): { filePath: string, fileName: string, sizeBytes: number, registered: boolean }[] {
  assertPermission(ctx, 'backups.create')
  const folder = backupFolder(ctx)
  if (!existsSync(folder)) return []
  const registered = new Set(listBackups(ctx, 1000).map((backup) => backup.filePath))
  const entries: { filePath: string, fileName: string, sizeBytes: number, registered: boolean }[] = []
  for (const name of readdirSync(folder)) {
    if (!name.toLowerCase().endsWith(BACKUP_EXTENSION) && !name.toLowerCase().endsWith('.db')) continue
    const filePath = join(folder, name)
    try {
      const stats = statSync(filePath)
      if (!stats.isFile()) continue
      entries.push({ filePath, fileName: name, sizeBytes: stats.size, registered: registered.has(filePath) })
    } catch {
      /* unreadable entry — ignore */
    }
  }
  return entries.sort((left, right) => right.fileName.localeCompare(left.fileName))
}

/** Registers a package that was copied into the backup folder by hand, after validating it. */
export async function adoptBackupFile(ctx: ServiceContext, filePath: string): Promise<BackupRecord> {
  assertPermission(ctx, 'backups.configure')
  if (!existsSync(filePath)) throw notFoundError('backup file', filePath)
  const existing = ctx.db.prepare('SELECT id FROM backups WHERE file_path = ?').get(filePath) as { id: number } | undefined
  if (existing) return getBackup(ctx, existing.id)

  const stagingRoot = join(ctx.host.paths.tmpDir, `adopt-${exportStamp()}-${Math.random().toString(36).slice(2, 8)}`)
  try {
    const staged = await stageInto(ctx, filePath, stagingRoot)
    if (staged.problems.length > 0) throw new AppError('E_VALIDATION', 'That file is not a valid backup.', { detail: { problems: staged.problems } })
    const stats = statSync(filePath)
    const id = insertBackupRow(ctx.db, {
      fileName: basename(filePath),
      filePath,
      kind: 'manual',
      sizeBytes: stats.size,
      checksum: staged.manifest?.database.sha256 ?? null,
      schemaVersion: staged.schemaVersion,
      appVersion: staged.manifest?.appVersion ?? ctx.host.build.version,
      createdAt: stats.mtimeMs,
      createdBy: ctx.actor.userId,
      includesAttachments: staged.attachmentsDir !== null,
      patientCount: staged.counts.patients ?? null,
      note: 'Adopted from the backup folder'
    })
    return getBackup(ctx, id)
  } finally {
    discardStaging(stagingRoot)
  }
}

