/**
 * Human-readable identifier formats.
 *
 * | Entity       | Format              | Example            | Notes                                        |
 * |--------------|---------------------|--------------------|----------------------------------------------|
 * | Patient      | `DP-<YY><MM>-<####>`| `DP-2609-0007`     | per-month sequence, DB-unique, sorts by time |
 * | Visit        | `V-<YY><MM>-<####>` | `V-2609-0012`      | per-month sequence                           |
 * | Prescription | `Rx-<YY><MM>-<####>`| `Rx-2609-0031`     | per-month sequence                           |
 * | Invoice      | `<PREFIX>-<YY><MM>-<####>` | `INV-2609-0044` | prefix configurable in Settings              |
 * | Receipt      | `RCP-<YY><MM>-<####>` | `RCP-2609-0039`  | payments and refunds                         |
 * | Purchase     | `PO-<YY><MM>-<####>`| `PO-2609-0003`     | stock purchases                              |
 * | Accounting   | `ACC-<YY><MM>-<####>`| `ACC-2609-0011`   | income/expense entries                       |
 * | Batch        | `B-<YYMMDD>-<##>`   | `B-260930-01`      | inventory batch labels                       |
 *
 * Sequences are allocated inside the same transaction as the record insert (`counters` table), so a
 * code can never be duplicated even when two windows operate in quick succession.
 */

export type CounterScope = string

export interface IdentifierParts {
  prefix: string
  date: Date
  sequence: number
  padLength?: number
}

function twoDigit(value: number): string {
  return String(value).padStart(2, '0')
}

export function periodScope(date: Date): CounterScope {
  return `${date.getFullYear()}${twoDigit(date.getMonth() + 1)}`
}

export function dayScope(date: Date): CounterScope {
  return `${date.getFullYear()}${twoDigit(date.getMonth() + 1)}${twoDigit(date.getDate())}`
}

export function formatIdentifier({ prefix, date, sequence, padLength = 4 }: IdentifierParts): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Identifier sequence must be a positive integer')
  return `${prefix}-${periodScope(date)}-${String(sequence).padStart(padLength, '0')}`
}

export function patientCode(date: Date, sequence: number): string {
  return formatIdentifier({ prefix: 'DP', date, sequence })
}

export function visitNumber(date: Date, sequence: number): string {
  return formatIdentifier({ prefix: 'V', date, sequence })
}

export function prescriptionNumber(date: Date, sequence: number): string {
  return formatIdentifier({ prefix: 'Rx', date, sequence })
}

export function invoiceNumber(date: Date, sequence: number, prefix = 'INV'): string {
  return formatIdentifier({ prefix: sanitizePrefix(prefix, 'INV'), date, sequence })
}

export function receiptNumber(date: Date, sequence: number): string {
  return formatIdentifier({ prefix: 'RCP', date, sequence })
}

export function purchaseNumber(date: Date, sequence: number): string {
  return formatIdentifier({ prefix: 'PO', date, sequence })
}

export function accountingNumber(date: Date, sequence: number): string {
  return formatIdentifier({ prefix: 'ACC', date, sequence })
}

export function batchNumber(date: Date, sequence: number): string {
  return `B-${dayScope(date)}-${String(sequence).padStart(2, '0')}`
}

/** Identifier prefixes must be short, uppercase and file/print friendly. */
export function sanitizePrefix(prefix: string, fallback: string): string {
  const cleaned = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return cleaned.length >= 2 ? cleaned : fallback
}

const PATIENT_CODE_PATTERN = /^DP-\d{4}-\d{4,}$/

export function isValidPatientCode(code: string): boolean {
  return PATIENT_CODE_PATTERN.test(code)
}

/** Backwards-compatible parse used by search and CSV import. */
export function parseIdentifier(code: string): { prefix: string; period: string; sequence: number } | null {
  const match = /^([A-Za-z]{1,3})-(\d{4})-(\d{3,6})$/.exec(code.trim())
  if (!match) return null
  return { prefix: match[1]!, period: match[2]!, sequence: Number(match[3]) }
}
