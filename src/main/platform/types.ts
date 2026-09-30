/**
 * Host abstraction.
 *
 * Business modules never import Electron directly. Everything environment-specific (paths, printing,
 * dialogs, shell integration, machine identity) reaches them through `HostServices`, which has two
 * implementations:
 *   · `electronHost` — the real desktop integration used by the shipped application
 *   · `nodeHost`     — a filesystem-only implementation used by integration tests and CI tooling
 * This keeps the domain layer testable in plain Node and prevents accidental coupling to the UI shell.
 */

export interface AppPaths {
  /** Root of all writable application data (`%APPDATA%\Dentiva Pro` or `DENTIVA_DATA_DIR`). */
  dataDir: string
  databaseFile: string
  attachmentsDir: string
  logsDir: string
  tmpDir: string
  exportsDir: string
  /** Suggested backup folder (`Documents\Dentiva Pro Backups`); the clinic may choose another. */
  defaultBackupDir: string
  /** Application root (install directory in production, repository root in development). */
  appRoot: string
  /** Bundled font directory used by the printing subsystem. */
  fontsDir: string
}

export interface BuildInfo {
  version: string
  buildNumber: string
  gitSha: string
  builtAt: string
  electron: string
  chromium: string
  node: string
}

export interface MachineInfo {
  hostname: string
  platform: string
  osVersion: string
  arch: string
  /** Stable per-installation identifier (Windows machine GUID or generated UUID). */
  machineId: string
  totalMemoryBytes: number
  cpuCount: number
  locale: string
  timezone: string
  displays: Array<{ width: number; height: number; scaleFactor: number }>
  printersAvailable: boolean
}

export interface PrinterInfo {
  name: string
  displayName: string
  description: string
  status: number
  isDefault: boolean
  options?: Record<string, string>
}

export interface PrintPageSizeMicrons {
  width: number
  height: number
}

export interface PrintJob {
  html: string
  printerName?: string
  pageSizeMicrons?: PrintPageSizeMicrons
  marginsMicrons?: { top: number, right: number, bottom: number, left: number }
  /** Thermal printers print from the roll, so no fixed page height is imposed. */
  landscape?: boolean
  copies?: number
  scaleBp?: number
}

export interface PrintResult {
  success: boolean
  failureReason?: string
  printerName: string | null
}

export interface PdfJob {
  html: string
  pageSizeMicrons: PrintPageSizeMicrons
  marginsMicrons: { top: number, right: number, bottom: number, left: number }
  landscape?: boolean
}

export interface PdfResult {
  data: Uint8Array
}

export interface PrintHost {
  /** Enumerate Windows printers. Returns an empty list when enumeration is unavailable. */
  listPrinters(): Promise<PrinterInfo[]>
  getDefaultPrinter(): Promise<string | null>
  print(job: PrintJob): Promise<PrintResult>
  renderPdf(job: PdfJob): Promise<PdfResult>
}

export interface DialogFilter {
  name: string
  extensions: string[]
}

export interface DialogHost {
  openFile(options: { title: string, filters?: DialogFilter[], multi?: boolean }): Promise<string[]>
  openDirectory(options: { title: string, defaultPath?: string }): Promise<string | null>
  saveFile(options: { title: string, defaultPath?: string, filters?: DialogFilter[] }): Promise<string | null>
  confirm(options: { title: string, message: string, detail?: string, confirmLabel?: string, danger?: boolean }): Promise<boolean>
  message(options: { title: string, message: string, detail?: string, kind?: 'info' | 'warning' | 'error' }): Promise<void>
}

export interface ShellHost {
  /** Open a file or folder with the OS default handler. Returns an error message when it fails. */
  openPath(target: string): Promise<string>
  showItemInFolder(target: string): Promise<void>
  openExternal(url: string): Promise<void>
  beep(): void
}

export interface Logger {
  debug(message: string, detail?: Record<string, unknown>): void
  info(message: string, detail?: Record<string, unknown>): void
  warn(message: string, detail?: Record<string, unknown>): void
  error(message: string, error?: unknown, detail?: Record<string, unknown>): void
  /** Flush pending writes (called during shutdown). */
  close(): void
  logDirectory(): string
}

export interface HostServices {
  paths: AppPaths
  build: BuildInfo
  machine: MachineInfo
  logger: Logger
  printing: PrintHost
  dialogs: DialogHost
  shell: ShellHost
  now(): number
  /** True when running from source (`npm run dev`) rather than a packaged installation. */
  isDevelopment(): boolean
}

export const MICRON_PER_MM = 1000

export const PAPER_SIZES_MM = {
  a4: { width: 210, height: 297 },
  a5: { width: 148, height: 210 },
  letter: { width: 216, height: 279 },
  mini: { width: 110, height: 150 },
  thermal58: { width: 58, height: 297 },
  thermal80: { width: 80, height: 297 }
} as const

export type PaperClass = 'a4' | 'a5' | 'thermal' | 'mini' | 'custom'

export function paperMicrons(paperClass: PaperClass, custom?: { widthMm: number, heightMm?: number }, thermalWidthMm = 80): PrintPageSizeMicrons {
  switch (paperClass) {
    case 'a4':
      return { width: 210 * MICRON_PER_MM, height: 297 * MICRON_PER_MM }
    case 'a5':
      return { width: 148 * MICRON_PER_MM, height: 210 * MICRON_PER_MM }
    case 'mini':
      return { width: 110 * MICRON_PER_MM, height: 150 * MICRON_PER_MM }
    case 'thermal':
      return { width: thermalWidthMm * MICRON_PER_MM, height: 297 * MICRON_PER_MM }
    case 'custom': {
      const width = Math.max(40, Math.min(custom?.widthMm ?? 80, 297))
      const height = Math.max(40, Math.min(custom?.heightMm ?? 297, 431))
      return { width: width * MICRON_PER_MM, height: height * MICRON_PER_MM }
    }
    default: {
      const exhaustive: never = paperClass
      throw new Error(`Unsupported paper class: ${String(exhaustive)}`)
    }
  }
}

export function marginMicrons(margins: { top: number, right: number, bottom: number, left: number }): {
  top: number
  right: number
  bottom: number
  left: number
} {
  return {
    top: Math.round(margins.top * MICRON_PER_MM),
    right: Math.round(margins.right * MICRON_PER_MM),
    bottom: Math.round(margins.bottom * MICRON_PER_MM),
    left: Math.round(margins.left * MICRON_PER_MM)
  }
}
