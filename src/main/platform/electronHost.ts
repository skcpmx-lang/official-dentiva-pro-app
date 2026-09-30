import { app, BrowserWindow, dialog, screen, shell } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { cpus, hostname } from 'node:os'
import type { AppPaths, BuildInfo, DialogHost, DialogFilter, HostServices, MachineInfo, ShellHost } from './types'
import { createLogger } from '../logging/logger'
import { electronPrintHost } from './electronPrint'

/**
 * Build the Electron-backed host services. Called once during bootstrap, before any window exists, so
 * that logging and the database are available even when the UI fails to start.
 */

let cachedMachineId: string | null = null

function readTotalMemoryBytes(): number {
  try {
    const info = process.getSystemMemoryInfo()
    return typeof info?.total === 'number' ? info.total * 1024 : 0
  } catch {
    return 0
  }
}

function resolveMachineId(dataDir: string): string {
  if (cachedMachineId) return cachedMachineId
  const file = join(dataDir, 'machine.id')
  try {
    if (existsSync(file)) {
      const value = readFileSync(file, 'utf8').trim()
      if (value.length >= 8) {
        cachedMachineId = value
        return value
      }
    }
    const generated = randomUUID()
    writeFileSync(file, generated, 'utf8')
    cachedMachineId = generated
    return generated
  } catch {
    cachedMachineId = randomUUID()
    return cachedMachineId
  }
}

export function resolveDataDirectory(): string {
  const override = process.env.DENTIVA_DATA_DIR
  if (override && override.trim().length > 0) return override
  const base = app.getPath('userData')
  return app.isPackaged ? base : `${base} (dev)`
}

export function buildAppPaths(): AppPaths {
  const dataDir = resolveDataDirectory()
  const paths: AppPaths = {
    dataDir,
    databaseFile: join(dataDir, 'data', 'dentiva.db'),
    attachmentsDir: join(dataDir, 'attachments'),
    logsDir: join(dataDir, 'logs'),
    tmpDir: join(dataDir, 'tmp'),
    exportsDir: join(dataDir, 'exports'),
    defaultBackupDir: process.env.DENTIVA_BACKUP_DIR ?? join(app.getPath('documents'), 'Dentiva Pro Backups'),
    appRoot: app.getAppPath(),
    fontsDir: app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'node_modules', '@fontsource')
  }
  for (const dir of [dataDir, join(dataDir, 'data'), paths.attachmentsDir, paths.logsDir, paths.tmpDir, paths.exportsDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  return paths
}

function readBuildInfo(paths: AppPaths): BuildInfo {
  const fallback: BuildInfo = {
    version: app.getVersion(),
    buildNumber: 'dev',
    gitSha: process.env.DENTIVA_GIT_SHA ?? 'unknown',
    builtAt: new Date().toISOString(),
    electron: process.versions.electron ?? 'unknown',
    chromium: process.versions.chrome ?? 'unknown',
    node: process.versions.node ?? 'unknown'
  }
  const candidates = [join(paths.appRoot, 'build-info.json'), join(app.isPackaged ? process.resourcesPath : paths.appRoot, 'build-info.json')]
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) continue
      const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<BuildInfo>
      return { ...fallback, ...parsed, electron: fallback.electron, chromium: fallback.chromium, node: fallback.node }
    } catch {
      /* a corrupt build info file must not stop the application */
    }
  }
  return fallback
}

function buildMachineInfo(paths: AppPaths): MachineInfo {
  let displays: Array<{ width: number, height: number, scaleFactor: number }> = []
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
    osVersion: process.getSystemVersion?.() ?? '',
    arch: process.arch,
    machineId: resolveMachineId(paths.dataDir),
    totalMemoryBytes: readTotalMemoryBytes(),
    cpuCount: Math.max(1, cpus().length),
    locale: app.getLocale(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    displays,
    printersAvailable: false
  }
}

function createDialogs(getWindow: () => BrowserWindow | null): DialogHost {
  return {
    async openFile(options: { title: string, filters?: DialogFilter[], multi?: boolean }): Promise<string[]> {
      const window = getWindow()
      const result = window
        ? await dialog.showOpenDialog(window, { title: options.title, filters: options.filters, properties: options.multi ? ['openFile', 'multiSelections'] : ['openFile'] })
        : await dialog.showOpenDialog({ title: options.title, filters: options.filters, properties: options.multi ? ['openFile', 'multiSelections'] : ['openFile'] })
      return result.canceled ? [] : result.filePaths
    },
    async openDirectory(options: { title: string, defaultPath?: string }): Promise<string | null> {
      const window = getWindow()
      const settings = { title: options.title, properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>, defaultPath: options.defaultPath }
      const result = window ? await dialog.showOpenDialog(window, settings) : await dialog.showOpenDialog(settings)
      return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0] ?? null
    },
    async saveFile(options: { title: string, defaultPath?: string, filters?: DialogFilter[] }): Promise<string | null> {
      const window = getWindow()
      const settings = { title: options.title, defaultPath: options.defaultPath, filters: options.filters }
      const result = window ? await dialog.showSaveDialog(window, settings) : await dialog.showSaveDialog(settings)
      return result.canceled || !result.filePath ? null : result.filePath
    },
    async confirm(options): Promise<boolean> {
      const window = getWindow()
      const settings = {
        type: options.danger ? ('warning' as const) : ('question' as const),
        buttons: [options.confirmLabel ?? 'Continue', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        title: options.title,
        message: options.message,
        detail: options.detail
      }
      const result = window ? await dialog.showMessageBox(window, settings) : await dialog.showMessageBox(settings)
      return result.response === 0
    },
    async message(options): Promise<void> {
      const window = getWindow()
      const settings = { type: options.kind ?? 'info', title: options.title, message: options.message, detail: options.detail, buttons: ['Close'] }
      if (window) await dialog.showMessageBox(window, settings)
      else await dialog.showMessageBox(settings)
    }
  }
}

function createShell(): ShellHost {
  return {
    async openPath(target: string): Promise<string> {
      return shell.openPath(target)
    },
    async showItemInFolder(target: string): Promise<void> {
      shell.showItemInFolder(target)
    },
    async openExternal(url: string): Promise<void> {
      await shell.openExternal(url)
    },
    beep(): void {
      shell.beep()
    }
  }
}

export interface CreateHostOptions {
  getWindow: () => BrowserWindow | null
}

export function createElectronHost(options: CreateHostOptions): HostServices {
  const paths = buildAppPaths()
  const logger = createLogger({
    directory: paths.logsDir,
    minLevel: app.isPackaged ? 'info' : 'debug',
    mirrorToConsole: !app.isPackaged
  })
  const build = readBuildInfo(paths)
  const machine = buildMachineInfo(paths)
  const host: HostServices = {
    paths,
    build,
    machine,
    logger,
    printing: electronPrintHost({ logger }),
    dialogs: createDialogs(options.getWindow),
    shell: createShell(),
    now: () => Date.now(),
    isDevelopment: () => !app.isPackaged
  }
  return host
}
