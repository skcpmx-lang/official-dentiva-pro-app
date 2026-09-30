import type { Db } from './connection'
import { formatIdentifier, batchNumber, dayScope, periodScope } from '@shared/identifiers'

/**
 * Sequence allocation for human-readable document numbers (`DP-2609-0001`, `INV-2609-0042`, …).
 *
 * The counter row is incremented in the caller's transaction, so two rapid registrations in the same
 * millisecond can never receive the same code, and a rolled back transaction returns the number to
 * the pool instead of leaving a permanent gap in the label only (not in the data).
 */

export type CounterName = 'patient' | 'visit' | 'prescription' | 'invoice' | 'receipt' | 'purchase' | 'accounting' | 'batch' | 'item'

export function nextSequence(db: Db, name: CounterName, scope: string): number {
  const row = db
    .prepare(
      `INSERT INTO counters (name, scope, value) VALUES (?, ?, 1)
       ON CONFLICT(name, scope) DO UPDATE SET value = value + 1
       RETURNING value`
    )
    .get(name, scope) as { value: number } | undefined
  if (!row) throw new Error(`Counter allocation failed for ${name}/${scope}`)
  return row.value
}

/** Allocate the next code of the given kind; must be called inside the writing transaction. */
export function nextCode(db: Db, name: CounterName, at: number, documentPrefix = 'INV'): string {
  const date = new Date(at)
  switch (name) {
    case 'patient':
      return formatIdentifier({ prefix: 'DP', date, sequence: nextSequence(db, name, periodScope(date)) })
    case 'visit':
      return formatIdentifier({ prefix: 'V', date, sequence: nextSequence(db, name, periodScope(date)) })
    case 'prescription':
      return formatIdentifier({ prefix: 'Rx', date, sequence: nextSequence(db, name, periodScope(date)) })
    case 'invoice':
      return formatIdentifier({ prefix: documentPrefix, date, sequence: nextSequence(db, name, periodScope(date)) })
    case 'receipt':
      return formatIdentifier({ prefix: 'RCP', date, sequence: nextSequence(db, name, periodScope(date)) })
    case 'purchase':
      return formatIdentifier({ prefix: 'PO', date, sequence: nextSequence(db, name, periodScope(date)) })
    case 'accounting':
      return formatIdentifier({ prefix: 'ACC', date, sequence: nextSequence(db, name, periodScope(date)) })
    case 'batch':
      return batchNumber(date, nextSequence(db, name, dayScope(date)))
    case 'item':
      return formatIdentifier({ prefix: 'ITM', date, sequence: nextSequence(db, name, periodScope(date)) })
    default: {
      const exhaustive: never = name
      throw new Error(`Unsupported counter: ${String(exhaustive)}`)
    }
  }
}
