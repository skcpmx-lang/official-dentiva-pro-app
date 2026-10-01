import { describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness, type TestHarness } from './helpers'
import { createTestContext } from '@main/context'
import { openDatabase, type DatabaseContext } from '@main/db/connection'
import { PERMISSION_CODES } from '@shared/permissions'
import { savePatient } from '@main/modules/patients/service'
import {
  BACKUP_EXTENSION,
  backupFileName,
  createBackupPackage,
  readBackupManifest,
  type BackupManifest
} from '@main/backup/package'
import {
  adoptBackupFile,
  backupStatus,
  createBackup,
  listBackups,
  listRestores,
  liveRowCounts,
  performRestore,
  saveBackupSettings,
  scanBackupFolder,
  stageRestore,
  validateBackupFile,
  type RestoreRuntime
} from '@main/backup/service'

/**
 * Backup and restore, exercised against a real SQLite database and real package files.
 *
 * The restore tests use a runtime that genuinely closes and reopens the database, so the pipeline runs
 * exactly as it does in the application: safety copy → replace → reopen → verify, with a rollback when
 * verification fails. The harness database object is swapped for the reopened one, mirroring how the
 * Electron entry point tracks the live handle.
 */

interface LiveState {
  database: DatabaseContext | null
}

function liveRuntime(harness: TestHarness, state: LiveState): RestoreRuntime {
  return {
    databaseFile: harness.host.paths.databaseFile,
    attachmentsDir: harness.host.paths.attachmentsDir,
    tmpDir: harness.host.paths.tmpDir,
    liveDb: () => state.database?.db ?? null,
    closeDatabase: () => {
      try {
        state.database?.close()
      } catch {
        /* already closed */
      }
      state.database = null
    },
    reopenDatabase: () => {
      try {
        state.database = openDatabase({ filePath: harness.host.paths.databaseFile, now: () => harness.host.now() })
        return true
      } catch {
        state.database = null
        return false
      }
    },
    inspectOpenDatabase: () => {
      if (!state.database) return { ok: false, problems: ['The clinic database is not open.'], counts: {} }
      const integrity = state.database.integrityCheck()
      const foreignKeys = state.database.foreignKeyCheck()
      const problems = [...(integrity.ok ? [] : integrity.messages), ...(foreignKeys.ok ? [] : foreignKeys.violations)]
      return { ok: problems.length === 0, problems, counts: liveRowCounts(state.database.db) }
    }
  }
}

function patientCount(state: LiveState): number {
  return (state.database!.db.prepare('SELECT COUNT(*) AS count FROM patients WHERE is_deleted = 0').get() as { count: number }).count
}

function addPatient(harness: TestHarness, name: string): void {
  savePatient(harness.ctx(), {
    fullName: name,
    fullNameBn: null,
    dob: null,
    ageYears: 30,
    gender: 'female',
    bloodGroup: null,
    phone: null,
    altPhone: null,
    emergencyPhone: null,
    address: null,
    addressBn: null,
    city: null,
    occupation: null,
    maritalStatus: null,
    chiefComplaint: null,
    pastHistory: null,
    allergies: null,
    medicalHistory: null,
    dentalHistory: null,
    currentMedications: null,
    notes: null,
    tags: [],
    status: 'active'
  } as Parameters<typeof savePatient>[1])
}

/** Code of the AppError a synchronous call throws, or `none` when it does not throw. */
function thrownCode(fn: () => unknown): string {
  try {
    fn()
    return 'none'
  } catch (error) {
    return (error as { code?: string }).code ?? 'none'
  }
}

/** Takes a `VACUUM INTO` snapshot the way the application does. */
function snapshot(harness: TestHarness, name: string): string {
  const target = join(harness.host.paths.tmpDir, name)
  harness.database.db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  return target
}

describe('backup package', () => {
  it('writes a hashed package whose manifest matches the database', async () => {
    const harness = createHarness()
    try {
      addPatient(harness, 'Rahima Akter')
      const created = await createBackup(harness.ctx(), { kind: 'full' })

      expect(existsSync(created.record.filePath)).toBe(true)
      expect(created.record.filePath.endsWith(BACKUP_EXTENSION)).toBe(true)
      expect(created.record.sizeBytes).toBe(statSync(created.record.filePath).size)
      expect(created.record.includesAttachments).toBe(true)
      expect(created.record.checksum).not.toBeNull()

      const manifest = await readBackupManifest(created.record.filePath)
      expect(manifest.format).toBe('dentiva-backup')
      expect(manifest.counts.patients).toBe(1)
      expect(manifest.database.sha256).toHaveLength(64)
      expect(manifest.database.path).toBe('database/dentiva.db')

      const status = backupStatus(harness.ctx())
      expect(status.totalCount).toBeGreaterThanOrEqual(1)
      expect(status.folder).toBe(harness.host.paths.defaultBackupDir)

      /* The audit trail records who ran it and where the file went. */
      const audit = harness.database.db
        .prepare("SELECT summary FROM audit_log WHERE action = 'backup.create' ORDER BY id DESC LIMIT 1")
        .get() as { summary: string } | undefined
      expect(audit?.summary).toContain('backup')
    } finally {
      harness.cleanup()
    }
  })

  it('includes attachments when they are present', async () => {
    const harness = createHarness()
    try {
      const folder = join(harness.host.paths.attachmentsDir, '1')
      mkdirSync(folder, { recursive: true })
      writeFileSync(join(folder, 'xray.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01]))
      const created = await createBackup(harness.ctx(), { kind: 'full' })
      const manifest = await readBackupManifest(created.record.filePath)
      expect(manifest.attachments.files).toBe(1)
      expect(manifest.attachments.entries[0]!.path).toBe('attachments/1/xray.jpg')
      expect(manifest.attachments.sha256).toHaveLength(64)
    } finally {
      harness.cleanup()
    }
  })

  it('validates a package and rejects a truncated copy', async () => {
    const harness = createHarness()
    try {
      addPatient(harness, 'Nusrat Jahan')
      const created = await createBackup(harness.ctx(), { kind: 'quick' })

      const good = await validateBackupFile(harness.ctx(), created.record.filePath)
      expect(good.ok).toBe(true)
      expect(good.problems).toEqual([])
      expect(good.counts?.patients).toBe(1)

      const broken = join(harness.host.paths.tmpDir, 'broken.dentivabackup')
      copyFileSync(created.record.filePath, broken)
      truncateSync(broken, Math.floor(statSync(broken).size / 2))

      const bad = await validateBackupFile(harness.ctx(), broken)
      expect(bad.ok).toBe(false)
      expect(bad.problems.length).toBeGreaterThan(0)
      /* The live clinic data was never touched by validation. */
      expect(patientCount({ database: harness.database })).toBe(1)
    } finally {
      harness.cleanup()
    }
  })
})

describe('restore pipeline', () => {
  it('restores a package, registers the safety copy and records history', async () => {
    const harness = createHarness()
    const state: LiveState = { database: harness.database }
    try {
      addPatient(harness, 'Rahima Akter')
      const created = await createBackup(harness.ctx(), { kind: 'full' })

      /* Data that exists only after the backup was taken. */
      addPatient(harness, 'Karim Uddin')
      expect(patientCount(state)).toBe(2)

      const staged = await stageRestore(harness.ctx(), created.record.filePath)
      const progress: string[] = []
      const result = await performRestore(harness.ctx(), liveRuntime(harness, state), staged, {
        onProgress: (update) => progress.push(update.phase)
      })

      expect(patientCount(state)).toBe(1)
      expect(result.counts.patients).toBe(1)
      expect(progress).toEqual(['snapshot', 'replacing', 'verifying', 'finalizing'])

      const ctx = createTestContext({ db: state.database!.db, host: harness.host, permissions: [...PERMISSION_CODES] })
      const backups = listBackups(ctx)
      const preRestore = backups.find((backup) => backup.kind === 'pre_restore')
      expect(preRestore).toBeDefined()
      expect(preRestore!.fileExists).toBe(true)

      const restores = listRestores(ctx)
      expect(restores[0]!.result).toBe('success')
      expect(restores[0]!.preRestoreBackupId).toBe(preRestore!.id)
      expect(restores[0]!.finishedAt).not.toBeNull()

      const audit = state.database!.db
        .prepare("SELECT summary FROM audit_log WHERE action = 'backup.restore' ORDER BY id DESC LIMIT 1")
        .get() as { summary: string } | undefined
      expect(audit?.summary).toContain('Restored')
    } finally {
      try {
        state.database?.close()
      } catch {
        /* already closed */
      }
      harness.cleanup()
    }
  })

  it('rolls back to the previous database when verification fails', async () => {
    const harness = createHarness()
    const state: LiveState = { database: harness.database }
    try {
      addPatient(harness, 'Rahima Akter')
      const snapshotFile = snapshot(harness, 'lying-snapshot.db')

      /* A package whose manifest claims a row count the snapshot does not have. */
      const targetPath = join(harness.host.paths.tmpDir, 'lying.dentivabackup')
      await createBackupPackage({
        snapshotFile,
        attachmentsDir: null,
        targetPath,
        manifest: {
          format: 'dentiva-backup',
          formatVersion: 1,
          appVersion: harness.host.build.version,
          schemaVersion: 2,
          kind: 'full',
          createdAt: Date.now(),
          createdBy: null,
          includesAttachments: false,
          counts: { patients: 999 }
        }
      })
      addPatient(harness, 'Karim Uddin')
      expect(patientCount(state)).toBe(2)

      const staged = await stageRestore(harness.ctx(), targetPath)
      await expect(performRestore(harness.ctx(), liveRuntime(harness, state), staged)).rejects.toMatchObject({
        code: 'E_VALIDATION'
      })

      /* The previous data is exactly as it was. */
      expect(patientCount(state)).toBe(2)
      const ctx = createTestContext({ db: state.database!.db, host: harness.host, permissions: [...PERMISSION_CODES] })
      const restores = listRestores(ctx)
      expect(restores[0]!.result).toBe('failed')
      expect(restores[0]!.message).toContain('patients')
    } finally {
      try {
        state.database?.close()
      } catch {
        /* already closed */
      }
      harness.cleanup()
    }
  })

  it('restores a bare database snapshot (pre-migration format)', async () => {
    const harness = createHarness()
    const state: LiveState = { database: harness.database }
    try {
      addPatient(harness, 'Rahima Akter')
      const snapshotFile = snapshot(harness, 'pre-migration-v2-20260101-000000.db')
      addPatient(harness, 'Karim Uddin')

      const staged = await stageRestore(harness.ctx(), snapshotFile)
      expect(staged.manifest).toBeNull()
      await performRestore(harness.ctx(), liveRuntime(harness, state), staged)
      expect(patientCount(state)).toBe(1)
    } finally {
      try {
        state.database?.close()
      } catch {
        /* already closed */
      }
      harness.cleanup()
    }
  })

  it('keeps only the configured number of automatic backups', async () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      saveBackupSettings(ctx, { folder: null, frequencyDays: 7, retention: 2, includeAttachments: false })
      const first = await createBackup(ctx, { kind: 'auto' })
      const second = await createBackup(ctx, { kind: 'auto' })
      const third = await createBackup(ctx, { kind: 'auto' })

      const automatic = listBackups(ctx).filter((backup) => backup.kind === 'auto')
      expect(automatic).toHaveLength(2)
      expect(automatic.map((backup) => backup.id)).toEqual([third.record.id, second.record.id])
      expect(existsSync(first.record.filePath)).toBe(false)

      const status = backupStatus(ctx)
      expect(status.lastRunAt).not.toBeNull()
      expect(status.due).toBe(false)
    } finally {
      harness.cleanup()
    }
  })
})

describe('backup access and discovery', () => {
  it('refuses backup and restore work without the matching permission', async () => {
    const harness = createHarness()
    try {
      const restoreOnly = harness.ctx(['backups.restore'])
      await expect(createBackup(restoreOnly, { kind: 'quick' })).rejects.toMatchObject({ code: 'E_PERMISSION' })
      expect(thrownCode(() => backupStatus(restoreOnly))).toBe('E_PERMISSION')

      const createOnly = harness.ctx(['backups.create'])
      expect(thrownCode(() => saveBackupSettings(createOnly, { folder: null, frequencyDays: 7, retention: 3, includeAttachments: false }))).toBe('E_PERMISSION')
      expect(() => listBackups(createOnly)).not.toThrow()

      const created = await createBackup(createOnly, { kind: 'quick' })
      const staged = await stageRestore(harness.ctx(), created.record.filePath)
      /* A restorer must also be able to take the mandatory pre-restore safety copy. */
      await expect(performRestore(createOnly, liveRuntime(harness, { database: harness.database }), staged)).rejects.toMatchObject({
        code: 'E_PERMISSION'
      })
    } finally {
      harness.cleanup()
    }
  })

  it('scans the folder and adopts a package that arrived from another machine', async () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      addPatient(harness, 'Rahima Akter')
      const created = await createBackup(ctx, { kind: 'full' })

      /* Simulate a copy that was placed in the folder by hand, with its record removed. */
      const handCopied = join(harness.host.paths.defaultBackupDir, backupFileName('full', Date.now() - 60_000))
      copyFileSync(created.record.filePath, handCopied)
      harness.database.db.prepare('DELETE FROM backups WHERE id = ?').run(created.record.id)
      rmSync(created.record.filePath, { force: true })

      const scanned = scanBackupFolder(ctx)
      const entry = scanned.find((item) => item.filePath === handCopied)
      expect(entry?.registered).toBe(false)

      const adopted = await adoptBackupFile(ctx, handCopied)
      expect(adopted.filePath).toBe(handCopied)
      expect(adopted.note).toContain('Adopted')

      /* Adopting twice is idempotent. */
      const again = await adoptBackupFile(ctx, handCopied)
      expect(again.id).toBe(adopted.id)

      const manifest: BackupManifest = await readBackupManifest(handCopied)
      expect(manifest.counts.patients).toBe(1)
      expect(readFileSync(handCopied).length).toBeGreaterThan(0)
    } finally {
      harness.cleanup()
    }
  })
})
