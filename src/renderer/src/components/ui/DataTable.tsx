import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Inbox } from 'lucide-react'

/**
 * Data table used by every list screen.
 *
 * Renders one row per record with sortable headers (sorted on the values the server already returned),
 * keyboard-accessible row activation, sticky header, optional row actions and a defined empty state.
 * Sorting is client-side over the current page because every list is paged by the database; the header
 * shows the sort direction so the operator always knows the ordering in effect.
 */

export interface Column<T> {
  key: string
  header: ReactNode
  width?: number | string
  align?: 'left' | 'right' | 'center'
  sortable?: boolean
  sortValue?(row: T): string | number | null
  render(row: T): ReactNode
  /** Hidden on narrow viewports, where the primary columns matter most. */
  secondary?: boolean
  className?: string
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>
  rows: T[]
  getRowId(row: T): string | number
  loading?: boolean
  error?: ReactNode
  emptyTitle?: string
  emptyMessage?: ReactNode
  emptyAction?: ReactNode
  onRowClick?(row: T): void
  selectedId?: string | number | null
  rowActions?(row: T): ReactNode
  footer?: ReactNode
  caption?: string
  /** Renders a compact variant for side panels. */
  dense?: boolean
  initialSortKey?: string
  initialSortDirection?: 'asc' | 'desc'
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  loading = false,
  error,
  emptyTitle = 'Nothing to show yet',
  emptyMessage,
  emptyAction,
  onRowClick,
  selectedId,
  rowActions,
  footer,
  caption,
  dense,
  initialSortKey,
  initialSortDirection = 'desc'
}: DataTableProps<T>): ReactNode {
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(initialSortDirection)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const column = columns.find((entry) => entry.key === sortKey)
    if (!column?.sortValue) return rows
    const factor = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a)
      const right = column.sortValue!(b)
      if (left === null && right === null) return 0
      if (left === null) return 1
      if (right === null) return -1
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
      return String(left).localeCompare(String(right), 'en', { numeric: true }) * factor
    })
  }, [rows, columns, sortKey, sortDir])

  const toggleSort = (column: Column<T>): void => {
    if (!column.sortable) return
    if (sortKey === column.key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(column.key)
      setSortDir('asc')
    }
  }

  if (error) {
    return <div className="state state--error">{error}</div>
  }

  if (loading && rows.length === 0) {
    return (
      <div className="table-wrap" aria-busy="true">
        <table className="table" data-dense={dense ? 'true' : undefined}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={{ width: column.width }} className={column.align === 'right' ? 'num' : undefined}>
                  {column.header}
                </th>
              ))}
              {rowActions ? <th aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }).map((_, index) => (
              <tr key={index}>
                {columns.map((column) => (
                  <td key={column.key}>
                    <span className="skeleton skeleton-row" />
                  </td>
                ))}
                {rowActions ? <td /> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="state">
        <span className="state__icon">
          <Inbox size={22} />
        </span>
        <span className="state__title">{emptyTitle}</span>
        {emptyMessage ? <span className="state__message">{emptyMessage}</span> : null}
        {emptyAction ? <div style={{ marginTop: 8 }}>{emptyAction}</div> : null}
      </div>
    )
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table" data-dense={dense ? 'true' : undefined}>
          {caption ? <caption className="visually-hidden">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sortKey === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={{ width: column.width }}
                    className={[column.align === 'right' ? 'num' : '', column.secondary ? 'col-secondary' : '', column.className].filter(Boolean).join(' ')}
                    aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : column.sortable ? 'none' : undefined}
                  >
                    {column.sortable ? (
                      <button type="button" className="th-sort" onClick={() => toggleSort(column)}>
                        <span>{column.header}</span>
                        {active ? (sortDir === 'asc' ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ChevronsUpDown size={13} className="th-sort__idle" />}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
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
              const selected = selectedId !== undefined && selectedId !== null && String(selectedId) === String(id)
              return (
                <tr
                  key={id}
                  aria-selected={selected || undefined}
                  className={onRowClick ? 'row--clickable' : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
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
                    <td key={column.key} className={[column.align === 'right' ? 'num' : '', column.secondary ? 'col-secondary' : ''].filter(Boolean).join(' ')}>
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
