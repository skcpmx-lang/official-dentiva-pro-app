import { app, BrowserWindow, dialog, shell, screen } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { hostname, release, totalmem, cpus, arch } from 'node:os'
import { join, dirname } from 'node:path'
import type { AppPaths, BuildInfo, HostServices, MachineInfo } from './types'
import { createLogger } from '../logging/logger'
import { electronPrintHost } from './electronPrint'
import { readBuildIdentity } from './buildIdentity'

/**
 * Electron implementation of `HostServices`.
 *
 * This is the only place in the main process that talks to Electron itself. It resolves the per-user
 * data directory (`%APPDATA%\Dentiva Pro`, overridable with `DENTIVA_DATA_DIR` for portable installs
 * and automated tests), the build identity produced by the release pipeline, the stable per-machine
 * identifier used by activation and the audit trail, native dialogs and shell integration.
 */

export interface ElectronHostOptions {
  /** Returns the window that owns modal dialogs, when one is open. */
  getWindow?: () => BrowserWindow | null
  /** Overrides the data directory (portable runs, tests). */
  dataDir?: string
}

export function resolveDataDirectory(explicit?: string): string {
  if (explicit) return explicit
  const fromEnvironment = process.env['DENTIVA_DATA_DIR']
  if (fromEnvironment && fromEnvironment.trim()) return fromEnvironment.trim()
  return app.getPath('userData')
}

export function resolvePaths(dataDir: string, appRoot: string, resourcesPath: string): AppPaths {
  return {
    dataDir,
    databaseFile: join(dataDir, 'data', 'dentiva.db'),
    attachmentsDir: join(dataDir, 'attachments'),
    logsDir: join(dataDir, 'logs'),
    tmpDir: join(dataDir, 'tmp'),
    exportsDir: join(dataDir, 'exports'),
    defaultBackupDir: join(dataDir, 'backups'),
    appRoot,
    fontsDir: join(resourcesPath, 'fonts')
  }
}

/**
 * Stable installation identifier. Stored as a file inside the clinic data directory so it survives
 * application updates, and derived from machine characteristics as a fallback when the directory is
 * temporarily read-only (for example during a restore).
 */
function readMachineId(dataDir: string): string {
  const file = join(dataDir, 'machine.id')
  try {
    if (existsSync(file)) {
      const existing = readFileSync(file, 'utf8').trim()
      if (/^[0-9a-f-]{16,64}$/i.test(existing)) return existing
    }
    mkdirSync(dirname(file), { recursive: true })
    const generated = randomUUID()
    writeFileSync(file, generated, 'utf8')
    return generated
  } catch {
    return createHash('sha256').update(`${hostname()}|${release()}|${app.getPath('userData')}`).digest('hex').slice(0, 32)
  }
}

export function createElectronHost(options: ElectronHostOptions = {}): HostServices {
  const isPackaged = app.isPackaged
  const appRoot = isPackaged ? app.getAppPath() : join(__dirname, '..', '..')
  const resourcesPath = isPackaged ? process.resourcesPath : join(appRoot, 'resources')
  const dataDir = resolveDataDirectory(options.dataDir)
  const paths = resolvePaths(dataDir, appRoot, resourcesPath)

  /* Every directory the application writes into is created up front, including the default backup folder:
     the operator opens it from the backup screen before a first backup has been taken, and a missing
     folder must never be the reason a safety feature looks broken. */
  for (const directory of [paths.dataDir, dirname(paths.databaseFile), paths.logsDir, paths.tmpDir, paths.exportsDir, paths.attachmentsDir, paths.defaultBackupDir]) {
    try {
      mkdirSync(directory, { recursive: true })
    } catch {
      // Reported through the logger; opening the database produces the operator-facing message.
    }
  }

  const logger = createLogger({ directory: paths.logsDir, mirrorToConsole: !isPackaged })
  const build: BuildInfo = readBuildIdentity({ appRoot, isPackaged, resourcesPath })

  const machine = (): MachineInfo => {
    let displays: Array<{ width: number; height: number, scaleFactor: number }> = []
    try {
      displays = screen.getAllDisplays().map((display) => ({
        width: display.size.width,
        height: display.size.height,
        scaleFactor: display.scaleFactor
      }))
    } catch {
      displays = []
    }
    return {
      hostname: hostname(),
      platform: process.platform,
      osVersion: `${process.platform} ${release()}`,
      arch: arch(),
      machineId: readMachineId(paths.dataDir),
      totalMemoryBytes: totalmem(),
      cpuCount: cpus().length,
      locale: app.getLocale(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'unknown',
      displays,
      printersAvailable: displays.length > 0 || process.platform === 'win32'
    }
  }

  return {
    paths,
    build,
    machine: machine(),
    logger,
    printing: electronPrintHost({ logger }),
    dialogs: {
      async openFile(request): Promise<string[]> {
        const parent = options.getWindow?.()
        const properties: Array<'openFile' | 'multiSelections'> = ['openFile']
        if (request.multi) properties.push('multiSelections')
        const dialogOptions = { title: request.title, filters: request.filters, properties }
        const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
        return result.canceled ? [] : result.filePaths
      },
      async openDirectory(request): Promise<string | null> {
        const parent = options.getWindow?.()
        const dialogOptions = { title: request.title, defaultPath: request.defaultPath, properties: ['openDirectory' as const, 'createDirectory' as const] }
        const result = parent ? await dialog.showOpenDialog(parent, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
        return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]!
      },
      async saveFile(request): Promise<string | null> {
        const parent = options.getWindow?.()
        const dialogOptions = { title: request.title, defaultPath: request.defaultPath, filters: request.filters }
        const result = parent ? await dialog.showSaveDialog(parent, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
        return result.canceled || !result.filePath ? null : result.filePath
      },
      async confirm(request): Promise<boolean> {
        const parent = options.getWindow?.()
        const dialogOptions = {
          type: request.danger ? ('warning' as const) : ('question' as const),
          title: request.title,
          message: request.message,
          detail: request.detail,
          buttons: [request.confirmLabel ?? 'Continue', 'Cancel'],
          defaultId: 0,
          cancelId: 1,
          noLink: true
        }
        const result = parent ? await dialog.showMessageBox(parent, dialogOptions) : await dialog.showMessageBox(dialogOptions)
        return result.response === 0
      },
      async message(request): Promise<void> {
        const parent = options.getWindow?.()
        const dialogOptions = {
          type: request.kind ?? ('info' as const),
          title: request.title,
          message: request.message,
          detail: request.detail,
          buttons: ['OK']
        }
        if (parent) await dialog.showMessageBox(parent, dialogOptions)
        else await dialog.showMessageBox(dialogOptions)
      }
    },
    shell: {
      async openPath(target: string): Promise<string> {
        return (await shell.openPath(target)) ?? ''
      },
      async showItemInFolder(target: string): Promise<void> {
        shell.showItemInFolder(target)
      },
      async openExternal(url: string): Promise<void> {
        // Reachable only from the About screen (author links); everything else navigates in-app.
        if (/^(https?:\/\/|mailto:)/i.test(url)) await shell.openExternal(url)
      },
      beep(): void {
        shell.beep()
      }
    },
    now: () => Date.now(),
    isDevelopment: () => !app.isPackaged
  }
}
