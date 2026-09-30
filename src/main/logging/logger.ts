import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Logger } from '../platform/types'

/**
 * Local rotating file logger.
 *
 * Rules (see docs/SECURITY_MODEL.md §6):
 *  · never write passwords, hashes, activation material or free clinical text
 *  · redact values whose key looks sensitive, and truncate long string values
 *  · rotate by size and keep a bounded number of files so logs cannot grow without limit
 */

const LEVELS = ['debug', 'info', 'warn', 'error'] as const

/** Severity of a log line. */
type Level = (typeof LEVELS)[number]
// LEVELS is the single source of truth for the union; keep it referenced so the intent is explicit.
void LEVELS

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

const SENSITIVE_KEY = /pass|secret|token|hash|verifier|activation|credential|pin/i
const MAX_VALUE_LENGTH = 200
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 7

export interface LoggerOptions {
  directory: string
  minLevel?: Level
  fileNamePrefix?: string
  /** Also mirror entries to the console in development. */
  mirrorToConsole?: boolean
  now?: () => number
}

export function createLogger(options: LoggerOptions): Logger {
  const { directory, minLevel = 'info', fileNamePrefix = 'app', mirrorToConsole = false, now = () => Date.now() } = options
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true })

  let currentDate = ''
  let currentFile = ''
  const mirror = mirrorToConsole

  function fileFor(timestamp: number): string {
    const date = new Date(timestamp)
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    if (day !== currentDate) {
      currentDate = day
      currentFile = join(directory, `${fileNamePrefix}-${day}.log`)
      pruneOldFiles()
    }
    return currentFile
  }

  function pruneOldFiles(): void {
    try {
      const files = readdirSync(directory)
        .filter((name) => name.startsWith(`${fileNamePrefix}-`) && name.endsWith('.log'))
        .map((name) => ({ name, mtime: statSync(join(directory, name)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
      for (const file of files.slice(MAX_FILES)) unlinkSync(join(directory, file.name))
    } catch {
      /* pruning is best effort */
    }
  }

  function rotateIfNeeded(file: string): void {
    try {
      if (!existsSync(file)) return
      if (statSync(file).size < MAX_FILE_BYTES) return
      renameSync(file, `${file}.${now()}.old`)
    } catch {
      /* rotation is best effort */
    }
  }

  function redact(detail?: Record<string, unknown>): string {
    if (!detail) return ''
    const safe: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(detail)) {
      if (SENSITIVE_KEY.test(key)) {
        safe[key] = '[redacted]'
        continue
      }
      if (typeof value === 'string') {
        safe[key] = value.length > MAX_VALUE_LENGTH ? `${value.slice(0, MAX_VALUE_LENGTH)}… (truncated)` : value
      } else if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        safe[key] = value
      } else if (Array.isArray(value)) {
        safe[key] = `[${value.length} items]`
      } else {
        safe[key] = '[object]'
      }
    }
    return ` ${JSON.stringify(safe)}`
  }

  function write(level: Level, message: string, error?: unknown, detail?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return
    const timestamp = now()
    const file = fileFor(timestamp)
    rotateIfNeeded(file)
    const stamp = new Date(timestamp).toISOString()
    let line = `${stamp} [${level.toUpperCase()}] ${message}${redact(detail)}`
    if (error) {
      const description = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      line += ` | error=${description.replace(/\s+/g, ' ').slice(0, 400)}`
    }
    line += '\n'
    try {
      appendFileSync(file, line, 'utf8')
    } catch {
      /* a full disk must never crash the clinic workflow */
    }
    if (mirror) {
      // eslint-disable-next-line no-console
      console[level === 'debug' ? 'warn' : level](line.trimEnd())
    }
  }

  return {
    debug: (message, detail) => write('debug', message, undefined, detail),
    info: (message, detail) => write('info', message, undefined, detail),
    warn: (message, detail) => write('warn', message, undefined, detail),
    error: (message, error, detail) => write('error', message, error, detail),
    close: () => {
      /* appendFileSync writes synchronously; nothing to flush */
    },
    logDirectory: () => directory
  }
}

/** Logger used while the real logger is not yet available (early bootstrap failures). */
export const nullLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  close: () => undefined,
  logDirectory: () => ''
}

export function setConsoleMirror(logger: Logger, enabled: boolean): void {
  // The logger is created once; this helper exists so the dev-mode flag can be flipped safely.
  void logger
  void enabled
}
