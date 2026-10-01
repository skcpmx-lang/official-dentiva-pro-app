import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname, cpus, totalmem } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AppError } from '@shared/errors'
import { createLogger, nullLogger } from '../logging/logger'
import type { AppPaths, BuildInfo, DialogHost, HostServices, MachineInfo, PrintHost, PrinterInfo, ShellHost } from './types'

/**
 * Node-only host used by integration tests, CI tooling and headless utilities.
 *
 * Printing, dialogs and shell integration are not available (the tests assert on document generation
 * instead of paper output), and every write goes to the supplied data directory so a test run can never
 * touch real clinic data.
 */

export interface NodeHostOptions {
  dataDir: string
  appRoot?: string
  loggerEnabled?: boolean
  version?: string
}

export function createNodeHost(options: NodeHostOptions): HostServices {
  const dataDir = options.dataDir
  const appRoot = options.appRoot ?? process.cwd()
  const paths: AppPaths = {
    dataDir,
    databaseFile: join(dataDir, 'data', 'dentiva.db'),
    attachmentsDir: join(dataDir, 'attachments'),
    logsDir: join(dataDir, 'logs'),
    tmpDir: join(dataDir, 'tmp'),
    exportsDir: join(dataDir, 'exports'),
    defaultBackupDir: join(dataDir, 'backups'),
    appRoot,
    fontsDir: join(appRoot, 'node_modules', '@fontsource')
  }
  for (const dir of [dataDir, join(dataDir, 'data'), paths.attachmentsDir, paths.logsDir, paths.tmpDir, paths.exportsDir, paths.defaultBackupDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  const machineIdFile = join(dataDir, 'machine.id')
  if (!existsSync(machineIdFile)) writeFileSync(machineIdFile, randomUUID(), 'utf8')

  const build: BuildInfo = {
    version: options.version ?? '1.0.0',
    buildNumber: 'test',
    gitSha: process.env.DENTIVA_GIT_SHA ?? 'test',
    builtAt: '1970-01-01T00:00:00.000Z',
    electron: 'n/a',
    chromium: 'n/a',
    node: process.versions.node
  }

  const machine: MachineInfo = {
    hostname: hostname(),
    platform: process.platform,
    osVersion: '',
    arch: process.arch,
    machineId: readFileSync(machineIdFile, 'utf8').trim(),
    totalMemoryBytes: totalmem(),
    cpuCount: cpus().length,
    locale: 'en-GB',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    displays: [{ width: 1920, height: 1080, scaleFactor: 1 }],
    printersAvailable: false
  }

  const printing: PrintHost = {
    async listPrinters(): Promise<PrinterInfo[]> {
      return []
    },
    async getDefaultPrinter(): Promise<string | null> {
      return null
    },
    async print(): Promise<never> {
      throw new AppError('E_PRINT', 'Printing is not available in this environment.')
    },
    async renderPdf(): Promise<never> {
      throw new AppError('E_PRINT', 'PDF rendering is not available in this environment.')
    }
  }

  const dialogs: DialogHost = {
    async openFile(): Promise<string[]> {
      return []
    },
    async openDirectory(): Promise<null> {
      return null
    },
    async saveFile(): Promise<null> {
      return null
    },
    async confirm(): Promise<boolean> {
      return false
    },
    async message(): Promise<void> {
      /* no interactive dialogs in headless mode */
    }
  }

  const shell: ShellHost = {
    async openPath(): Promise<string> {
      return 'Opening files is not available in this environment.'
    },
    async showItemInFolder(): Promise<void> {
      /* no-op */
    },
    async openExternal(): Promise<void> {
      /* no-op */
    },
    beep(): void {
      /* no-op */
    }
  }

  return {
    paths,
    build,
    machine,
    logger: options.loggerEnabled === false ? nullLogger : createLogger({ directory: paths.logsDir, minLevel: 'warn' }),
    printing,
    dialogs,
    shell,
    now: () => Date.now(),
    isDevelopment: () => true
  }
}
