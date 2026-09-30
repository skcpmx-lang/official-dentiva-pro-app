import { fromLocalDate, toLocalDate } from '@shared/datetime'

/**
 * Query helpers shared by every module: date-range resolution, folded LIKE search and pagination
 * clamping. Keeping them here means each module filters and searches identically, so behaviour an
 * operator learns in one screen holds everywhere else.
 */

export interface DateRangeInput {
  preset?: string
  from?: string | null
  to?: string | null
}

export interface ResolvedRange {
  /** Inclusive local start date, or null for "no lower bound". */
  from: string | null
  /** Inclusive local end date, or null for "no upper bound". */
  to: string | null
}

export function resolveRange(range: DateRangeInput | undefined, now = Date.now()): ResolvedRange {
  const preset = range?.preset ?? 'all'
  if (preset === 'custom') return { from: range?.from ?? null, to: range?.to ?? null }
  if (preset === 'all') return { from: null, to: null }

  const today = toLocalDate(now)
  const shiftDays = (days: number): string => toLocalDate(fromLocalDate(today) - days * 86_400_000)

  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday':
      return { from: shiftDays(1), to: shiftDays(1) }
    case 'last7':
      return { from: shiftDays(6), to: today }
    case 'last30':
      return { from: shiftDays(29), to: today }
    case 'last90':
      return { from: shiftDays(89), to: today }
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'lastYear':
      return { from: shiftDays(364), to: today }
    default:
      return { from: null, to: null }
  }
}

/**
 * Append a half-open local-date condition on `column` (a `YYYY-MM-DD` text column).
 * Returns the SQL fragment (with a leading ` AND `) and its bound parameters.
 */
export function rangeCondition(column: string, range: ResolvedRange): { sql: string, params: string[] } {
  const clauses: string[] = []
  const params: string[] = []
  if (range.from) {
    clauses.push(`${column} >= ?`)
    params.push(range.from)
  }
  if (range.to) {
    clauses.push(`${column} <= ?`)
    params.push(range.to)
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params }
}

/** Same as `rangeCondition` but on an epoch-millisecond column. */
export function rangeConditionEpoch(column: string, range: ResolvedRange): { sql: string, params: number[] } {
  const clauses: string[] = []
  const params: number[] = []
  if (range.from) {
    clauses.push(`${column} >= ?`)
    params.push(fromLocalDate(range.from))
  }
  if (range.to) {
    clauses.push(`${column} < ?`)
    params.push(fromLocalDate(range.to) + 86_400_000)
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '', params }
}

/** Escape LIKE wildcards so a patient searching for `50%` does not match everything. */
export function foldLike(term: string): string {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
}

export interface PageRequest {
  limit: number
  offset: number
}

export function clampPage(page: PageRequest | undefined, defaultLimit = 50, maxLimit = 500): { limit: number, offset: number } {
  const limit = Math.min(Math.max(Math.trunc(page?.limit ?? defaultLimit), 1), maxLimit)
  const offset = Math.max(Math.trunc(page?.offset ?? 0), 0)
  return { limit, offset }
}

