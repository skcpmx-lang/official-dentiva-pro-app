import { assertPermission } from '../../context'
import { writeCsv, exportStamp, type CsvColumn } from '../../files/csv'
import { formatAmountPlain } from '@shared/money'
import {
  accountingSummary,
  archiveCategory,
  closeDay,
  dayCloseView,
  dayCloses,
  getEntry,
  listCategories,
  listEntries,
  reopenDay,
  saveCategory,
  saveEntry,
  voidEntry,
  type EntryRecord
} from '../../modules/accounting/entries'
import { reportCatalog, runReport } from '../../modules/accounting/reports'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Handlers for accounting and reports.
 *
 * The CSV exports write the raw rows a report produced, formatted only at the very edge, so what leaves
 * the clinic in a spreadsheet is exactly what the screen showed.
 */
export function createAccountingHandlers(deps: HandlerDeps): PartialHandlerMap {
  const entryColumns: Array<CsvColumn<EntryRecord>> = [
    { key: 'entryNo', header: 'Entry no', value: (row) => row.entryNo },
    { key: 'date', header: 'Date', value: (row) => row.entryDate },
    { key: 'kind', header: 'Kind', value: (row) => row.kind },
    { key: 'category', header: 'Category', value: (row) => row.categoryName },
    { key: 'amount', header: 'Amount (BDT)', value: (row) => formatAmountPlain(row.amountMicro, false) },
    { key: 'method', header: 'Method', value: (row) => row.method },
    { key: 'party', header: 'Party', value: (row) => row.party ?? '' },
    { key: 'reference', header: 'Reference', value: (row) => row.reference ?? '' },
    { key: 'description', header: 'Description', value: (row) => row.description },
    { key: 'status', header: 'Status', value: (row) => row.status },
    { key: 'recordedBy', header: 'Recorded by', value: (row) => row.createdByName ?? '' }
  ]

  return {
    /* --------------------------------------------------------------- categories */

    'accounting.categories': (ctx, input) => listCategories(ctx, input.includeInactive),
    'accounting.categories.save': (ctx, input) => saveCategory(ctx, input),
    'accounting.categories.archive': (ctx, input) => archiveCategory(ctx, input),

    /* ------------------------------------------------------------------ entries */

    'accounting.entries': (ctx, input) => listEntries(ctx, input),
    'accounting.entry.get': (ctx, input) => getEntry(ctx, input.id),
    'accounting.entry.save': (ctx, input) => saveEntry(ctx, input),
    'accounting.entry.void': (ctx, input) => voidEntry(ctx, input),
    'accounting.entries.export': async (ctx, input) => {
      assertPermission(ctx, 'accounting.export')
      const page = listEntries(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export accounting entries',
        defaultPath: `${deps.host.paths.exportsDir}/accounting-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.items, entryColumns)
      ctx.audit.write({ module: 'accounting', action: 'export', summary: `Exported ${rowCount} accounting entry(ies) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    },

    /* ------------------------------------------------------------------ summary */

    'accounting.summary': (ctx, input) => accountingSummary(ctx, input.from, input.to),

    /* ---------------------------------------------------------------- day close */

    'accounting.dayClose': (ctx, input) => dayCloseView(ctx, input.date),
    'accounting.closeDay': (ctx, input) => closeDay(ctx, input),
    'accounting.reopenDay': (ctx, input) => reopenDay(ctx, input),
    'accounting.days': (ctx, input) => dayCloses(ctx, input),

    /* ------------------------------------------------------------------ reports */

    'reports.catalog': (ctx) => reportCatalog(ctx),
    'reports.run': (ctx, input) => runReport(ctx, input),
    'reports.export': async (ctx, input) => {
      assertPermission(ctx, 'accounting.export')
      const report = runReport(ctx, { ...input, limit: 5000 })
      const target = await deps.host.dialogs.saveFile({
        title: `Export ${report.title}`,
        defaultPath: `${deps.host.paths.exportsDir}/${input.key}-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const columns: Array<CsvColumn<Record<string, string | number | null>>> = report.columns.map((column) => ({
        key: column.key,
        header: column.header,
        value: (row) => {
          const cell = row[column.key]
          if (cell === null || cell === undefined) return ''
          if (column.format === 'money') return formatAmountPlain(Number(cell), false)
          if (column.format === 'date') return String(cell)
          return String(cell)
        }
      }))
      const rowCount = writeCsv(target, report.rows, columns)
      ctx.audit.write({ module: 'accounting', action: 'report.export', summary: `Exported report ${report.title} (${rowCount} row(s))`, detail: { file: target, key: report.key } })
      return { path: target, rowCount }
    },
  }
}
