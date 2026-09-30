import { basename } from 'node:path'
import { assertPermission } from '../../context'
import { AppError, stateError, validationError } from '@shared/errors'
import {
  adoptBackupFile,
  backupFolder,
  backupStatus,
  createBackup,
  deleteBackup,
  getBackup,
  listBackups,
  listRestores,
  performRestore,
  saveBackupSettings,
  scanBackupFolder,
  stageRestore,
  validateBackupFile,
  type RestoreRuntime
} from '../../backup/service'
import { discardStaging } from '../../backup/package'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Backup and restore handlers.
 *
 * The restore channel is the only operation in the application that replaces the database while the app
 * is running, so it is handled with care: the package is validated and staged first, maintenance mode
 * blocks every other window from writing, a pre-restore backup is mandatory, and a failed verification
 * rolls the previous database back before the renderer is told what happened.
 */
export function createBackupHandlers(deps: HandlerDeps): PartialHandlerMap {
  /* The paths are read lazily so constructing the handler map never touches the host (tests build it with a stub). */
  const runtime: RestoreRuntime = {
    get databaseFile() {
      return deps.host.paths.databaseFile
    },
    get attachmentsDir() {
      return deps.host.paths.attachmentsDir
    },
    get tmpDir() {
      return deps.host.paths.tmpDir
    },
    liveDb: () => deps.currentDb(),
    closeDatabase: () => deps.closeDatabase(),
    reopenDatabase: () => deps.reopenDatabase(),
    inspectOpenDatabase: () => deps.inspectDatabase()
  }

  return {
    'backups.list': (ctx) => ({ items: listBackups(ctx) }),

    'backups.status': (ctx) => backupStatus(ctx),

    'backups.create': async (ctx, input) => {
      const created = await createBackup(ctx, {
        kind: input.kind,
        includeAttachments: input.includeAttachments,
        note: input.note ?? null
      })
      return {
        record: created.record,
        filePath: created.record.filePath,
        sizeBytes: created.record.sizeBytes,
        includesAttachments: created.record.includesAttachments
      }
    },

    'backups.saveSettings': (ctx, input) =>
      saveBackupSettings(ctx, {
        folder: input.folder,
        frequencyDays: input.frequencyDays,
        retention: input.retention,
        includeAttachments: input.includeAttachments
      }),

    'backups.chooseFolder': async (ctx) => {
      assertPermission(ctx, 'backups.configure')
      const folder = await ctx.host.dialogs.openDirectory({ title: 'Choose the backup folder', defaultPath: backupFolder(ctx) })
      return { folder }
    },

    'backups.validate': async (ctx, input) => {
      const result = await validateBackupFile(ctx, input.filePath)
      return {
        ok: result.ok,
        problems: result.problems,
        fileName: result.manifest ? basename(input.filePath) : null,
        appVersion: result.manifest?.appVersion ?? null,
        createdAt: result.manifest?.createdAt ?? null,
        schemaVersion: result.schemaVersion,
        includesAttachments: result.manifest?.includesAttachments ?? null,
        patientCount: result.counts?.patients ?? null,
        counts: result.counts
      }
    },

    'backups.restore': async (ctx, input) => {
      if (input.confirmation.trim().toLowerCase() !== 'restore') {
        throw validationError('Type RESTORE to confirm that the current clinic data will be replaced.')
      }

      const staged = await stageRestore(ctx, input.filePath)
      const progress = (phase: string, percent: number, message?: string): void =>
        deps.broadcast('backup:progress', { operation: 'restore', phase, percent, message })

      deps.setMaintenanceMode(true)
      progress('preparing', 5, 'The backup was validated. Preparing the restore…')
      try {
        const result = await performRestore(ctx, runtime, staged, {
          onProgress: (update) => progress(update.phase, update.percent, update.message)
        })
        progress('done', 100, result.message)
        /* Every in-memory cache predates the restored data, so the application restarts cleanly. */
        setTimeout(() => deps.relaunch(), 1200)
        return {
          ok: true as const,
          message: result.message,
          preRestoreBackupId: result.preRestoreBackupId,
          counts: result.counts,
          relaunching: true
        }
      } catch (error) {
        deps.setMaintenanceMode(false)
        progress('failed', 100, error instanceof Error ? error.message : 'The restore failed.')
        throw error
      } finally {
        discardStaging(staged.stagingRoot)
      }
    },

    'backups.delete': (ctx, input) => {
      deleteBackup(ctx, input.id, { removeFile: input.removeFile })
      return { ok: true as const }
    },

    'backups.scan': (ctx) => ({ items: scanBackupFolder(ctx) }),

    'backups.adopt': async (ctx, input) => ({ record: await adoptBackupFile(ctx, input.filePath) }),

    'backups.restores': (ctx, input) => ({ items: listRestores(ctx, input.limit) }),

    'backups.reveal': (ctx, input) => {
      const record = getBackup(ctx, input.id)
      if (!record.fileExists) throw stateError('That backup file is no longer on disk.')
      void ctx.host.shell.showItemInFolder(record.filePath)
      return { ok: true as const }
    },

    'backups.openFolder': async (ctx) => {
      assertPermission(ctx, 'backups.create')
      const folder = backupFolder(ctx)
      const error = await ctx.host.shell.openPath(folder)
      if (error) throw new AppError('E_STATE', 'The backup folder could not be opened.', { detail: { folder, error } })
      return { ok: true as const }
    }
  }
}
