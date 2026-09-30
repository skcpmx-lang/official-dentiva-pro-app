import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState } from './primitives'
import type { ApiError } from '../../lib/api'

/**
 * Data table.
 *
 * One implementation for every list in Dentiva Pro: sticky header, sortable columns, selection,
 * row actions that never get pushed off-screen, complete loading/empty/error states and keyboard
 * navigation. Sorting is performed on the loaded page; server-side ordering is applied by the query
 * that produced the page in the first place.
 */

export interface Column<T> {
  key: string
  header: ReactNode
  render(row: T): ReactNode
  /** Value used for client-side sorting; when omitted the column is not sortable. */
  sortValue?(row: T): string | number
  align?: 'left' | 'right' | 'center'
  width?: number | string
  /** Hide on narrow viewports (secondary information). */
  secondary?: boolean
  numeric?: boolean
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>
  rows: T[]
  getRowId(row: T): string | number
  loading?: boolean
  error?: ApiError | null
  onRetry?(): void
  emptyTitle?: string
  emptyMessage?: string
  emptyAction?: ReactNode
  onRowClick?(row: T): void
  selectedId?: string | number | null
  rowActions?(row: T): ReactNode
  caption?: string
  footer?: ReactNode
  initialSortKey?: string
  initialSortDirection?: 'asc' | 'desc'
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading,
  error,
  onRetry,
  emptyTitle = 'Nothing to show yet',
  emptyMessage,
  emptyAction,
  onRowClick,
  selectedId,
  rowActions,
  caption,
  footer,
  initialSortKey,
  initialSortDirection = 'desc'
}: DataTableProps<T>): ReactNode {
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(initialSortDirection)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const column = columns.find((entry) => entry.key === sortKey)
    if (!column?.sortValue) return rows
    const factor = sortDirection === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a)
      const right = column.sortValue!(b)
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
      return String(left).localeCompare(String(right), 'en', { numeric: true }) * factor
    })
  }, [rows, sortKey, sortDirection, columns])

  const toggleSort = (key: string): void => {
    if (sortKey === key) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('asc')
    }
  }

  if (error) {
    return <ErrorState title="This list could not be loaded" message={error.message} action={onRetry ? <button className="btn btn--secondary" onClick={onRetry}>Try again</button> : undefined} />
  }

  if (loading && rows.length === 0) {
    return <LoadingState label="Loading records" rows={6} />
  }

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} />
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          {caption ? <caption>{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={[column.numeric || column.align === 'right' ? 'num' : '', column.secondary ? 'col-secondary' : ''].filter(Boolean).join(' ')}
                  style={{ width: column.width }}
                  aria-sort={sortKey === column.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortValue ? (
                    <button type="button" className="table__sort" onClick={() => toggleSort(column.key)}>
                      {column.header}
                      {sortKey === column.key ? (
                        sortDirection === 'asc' ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        )
                      ) : (
                        <ChevronsUpDown size={13} opacity={0.45} />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
              {rowActions ? (
                <th scope="col" className="col-actions">
                  <span className="visually-hidden">Row actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const id = getRowId(row)
              return (
                <tr
                  key={id}
                  aria-selected={selectedId !== undefined && selectedId !== null ? selectedId === id : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault()
                            onRowClick(row)
                          }
                        }
                      : undefined
                  }
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={[column.numeric || column.align === 'right' ? 'num' : '', column.secondary ? 'col-secondary' : ''].filter(Boolean).join(' ')}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                  {rowActions ? (
                    <td className="col-actions" onClick={(event) => event.stopPropagation()}>
                      {rowActions(row)}
                    </td>
                  ) : null}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </>
  )
}
