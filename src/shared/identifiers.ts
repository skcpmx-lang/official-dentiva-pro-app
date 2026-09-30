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
  return `${twoDigit(date.getFullYear() % 100)}${twoDigit(date.getMonth() + 1)}`
}

export function dayScope(date: Date): CounterScope {
  return `${twoDigit(date.getFullYear() % 100)}${twoDigit(date.getMonth() + 1)}${twoDigit(date.getDate())}`
}

export function formatIdentifier({ prefix, date, sequence, padLength = 4 }: IdentifierParts): string {
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Identifier sequence must be a positive integer')
  return `${prefix}-${periodScope(date)}-${String(sequence).padStart(padLength, '0')}`
}

export function patientCode(date: Date, sequence: number): string {
  return formatIdentifier({ prefix: 'DP', date, sequence })
}

export function batchNumber(date: Date, sequence: number): string {
  return `B-${dayScope(date)}-${String(sequence).padStart(2, '0')}`
}

/** Identifier prefixes must be short, uppercase and file/print friendly. */
export function sanitizePrefix(prefix: string, fallback: string): string {
  const cleaned = prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)
  return cleaned.length >= 2 ? cleaned : fallback
}

