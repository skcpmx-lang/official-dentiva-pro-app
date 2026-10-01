import { z } from 'zod'
import { channel, zOptionalText, zTrimmed } from '../ipc'
import { zActionResult } from './system'

/**
 * Backup and restore.
 *
 * Packages are `.dentivabackup` files (zip + manifest + SHA-256, see `src/main/backup/package.ts`). The
 * renderer never reads or writes them: it names a file, and the main process validates, hashes, snapshots
 * and only then replaces the live database — with a mandatory pre-restore backup and an automatic
 * rollback when anything fails verification.
 */

export const BACKUP_KINDS = ['manual', 'full', 'quick', 'auto', 'pre_restore', 'pre_migration'] as const
export const zBackupKind = z.enum(BACKUP_KINDS)

export const zBackupRecord = z.object({
  id: z.number(),
  fileName: z.string(),
  filePath: z.string(),
  kind: zBackupKind,
  sizeBytes: z.number(),
  checksum: z.string().nullable(),
  schemaVersion: z.number(),
  appVersion: z.string(),
  createdAt: z.number(),
  createdByName: z.string().nullable(),
  verified: z.boolean(),
  includesAttachments: z.boolean(),
  patientCount: z.number().nullable(),
  note: z.string().nullable(),
  /** False when the package was moved or deleted outside the application. */
  fileExists: z.boolean()
})

export const zBackupStatus = z.object({
  folder: z.string(),
  frequencyDays: z.number(),
  retention: z.number(),
  includeAttachments: z.boolean(),
  lastRunAt: z.number().nullable(),
  nextRunAt: z.number().nullable(),
  due: z.boolean(),
  automaticCount: z.number(),
  totalCount: z.number(),
  schemaVersion: z.number(),
  appVersion: z.string()
})

export const zBackupSettingsInput = z.object({
  folder: z.string().max(500).nullable(),
  frequencyDays: z.number().int().min(0).max(30),
  retention: z.number().int().min(1).max(100),
  includeAttachments: z.boolean()
})

export const zBackupValidation = z.object({
  ok: z.boolean(),
  problems: z.array(z.string()),
  fileName: z.string().nullable(),
  appVersion: z.string().nullable(),
  createdAt: z.number().nullable(),
  schemaVersion: z.number().nullable(),
  includesAttachments: z.boolean().nullable(),
  patientCount: z.number().nullable(),
  counts: z.record(z.string(), z.number()).nullable()
})

export const zScannedBackup = z.object({
  filePath: z.string(),
  fileName: z.string(),
  sizeBytes: z.number(),
  registered: z.boolean()
})

export const zRestoreEntry = z.object({
  id: z.number(),
  fileName: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  result: z.string(),
  message: z.string().nullable(),
  preRestoreBackupId: z.number().nullable()
})

const zEmptyInput = z.object({}).default({})

export const backupChannels = {
  'backups.list': channel(zEmptyInput, z.object({ items: z.array(zBackupRecord) })),
  'backups.status': channel(zEmptyInput, zBackupStatus),

  'backups.create': channel(
    z.object({
      kind: z.enum(['full', 'quick']),
      includeAttachments: z.boolean().optional(),
      note: zOptionalText(240)
    }),
    z.object({
      record: zBackupRecord,
      filePath: z.string(),
      sizeBytes: z.number(),
      includesAttachments: z.boolean()
    })
  ),
  'backups.saveSettings': channel(zBackupSettingsInput, zBackupStatus),
  'backups.chooseFolder': channel(zEmptyInput, z.object({ folder: z.string().nullable() })),

  'backups.validate': channel(
    z.object({ filePath: zTrimmed(1, 1000, 'Backup file') }),
    zBackupValidation
  ),
  'backups.restore': channel(
    z.object({
      filePath: zTrimmed(1, 1000, 'Backup file'),
      /** The operator types RESTORE to confirm that the current data will be replaced. */
      confirmation: zTrimmed(2, 40, 'Confirmation')
    }),
    z.object({
      ok: z.literal(true),
      message: z.string(),
      preRestoreBackupId: z.number(),
      counts: z.record(z.string(), z.number()),
      /** The application restarts shortly after this response so every cache re-reads the restored data. */
      relaunching: z.boolean()
    })
  ),

  'backups.delete': channel(
    z.object({ id: z.number().int().positive(), removeFile: z.boolean().default(true) }),
    zActionResult
  ),
  'backups.scan': channel(zEmptyInput, z.object({ items: z.array(zScannedBackup) })),
  'backups.adopt': channel(z.object({ filePath: zTrimmed(1, 1000, 'Backup file') }), z.object({ record: zBackupRecord })),
  'backups.restores': channel(z.object({ limit: z.number().int().min(1).max(200).default(50) }), z.object({ items: z.array(zRestoreEntry) })),
  'backups.reveal': channel(z.object({ id: z.number().int().positive() }), zActionResult),
  'backups.openFolder': channel(zEmptyInput, zActionResult)
} as const
