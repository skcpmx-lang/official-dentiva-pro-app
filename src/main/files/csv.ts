import { writeFileSync } from 'node:fs'
import { AppError, ioError } from '@shared/errors'

/**
 * CSV export.
 *
 * Files start with a UTF-8 BOM so Microsoft Excel (the tool most Bangladeshi clinics use) renders
 * Bengali names, addresses and notes correctly instead of showing mojibake. Values are quoted
 * according to RFC 4180, and a spreadsheet-injection guard prefixes cells that begin with
 * `= + - @` so a patient name can never become a formula on someone else's machine.
 */

export interface CsvColumn<Row> {
  key: string
  header: string
  value(row: Row): string | number | null | undefined
}

function escapeCell(input: string | number | null | undefined): string {
  if (input === null || input === undefined) return ''
  let text = String(input)
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv<Row>(rows: Row[], columns: Array<CsvColumn<Row>>): string {
  const lines = [columns.map((column) => escapeCell(column.header)).join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))).join(','))
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export function writeCsv<Row>(absolutePath: string, rows: Row[], columns: Array<CsvColumn<Row>>): number {
  const content = toCsv(rows, columns)
  try {
    writeFileSync(absolutePath, content, 'utf8')
  } catch {
    throw ioError(`The file could not be written to ${absolutePath}. Choose another location and try again.`)
  }
  return Buffer.byteLength(content, 'utf8')
}

/** Timestamp fragment used in generated export file names: `2026-09-30_14-05`. */
export function exportStamp(at = Date.now()): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`
}

export function requireExtension(path: string, extension: string): string {
  if (!path.toLowerCase().endsWith(extension)) throw new AppError('E_VALIDATION', `The file name must end with ${extension}.`)
  return path
}
