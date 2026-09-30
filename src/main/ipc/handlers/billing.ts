import { assertPermission } from '../../context'
import { writeCsv, exportStamp, type CsvColumn } from '../../files/csv'
import { formatAmountPlain } from '@shared/money'
import {
  billableLines,
  deleteInvoice,
  getInvoice,
  invoicesForVisit,
  listInvoices,
  saveInvoice,
  voidInvoice,
  type InvoiceRecord
} from '../../modules/billing/invoices'
import { addPayment, dailyCollections, listPayments, voidPayment, type PaymentRecord } from '../../modules/billing/payments'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Handlers for billing: invoices, payments and refunds.
 *
 * The two CSV exports are the only handlers that touch the file system. Everything else delegates to the
 * services, where permissions, invoice arithmetic and audit entries live.
 */
export function createBillingHandlers(deps: HandlerDeps): PartialHandlerMap {
  const invoiceColumns: Array<CsvColumn<InvoiceRecord>> = [
    { key: 'invoiceNo', header: 'Invoice no', value: (row) => row.invoiceNo },
    { key: 'date', header: 'Issued', value: (row) => row.issueDate },
    { key: 'patientCode', header: 'Patient ID', value: (row) => row.patientCode },
    { key: 'patientName', header: 'Patient', value: (row) => row.patientName },
    { key: 'status', header: 'Status', value: (row) => row.status },
    { key: 'subtotal', header: 'Subtotal (BDT)', value: (row) => formatAmountPlain(row.subtotalMicro, false) },
    { key: 'discount', header: 'Discount (BDT)', value: (row) => formatAmountPlain(row.discountMicro, false) },
    { key: 'total', header: 'Total (BDT)', value: (row) => formatAmountPlain(row.totalMicro, false) },
    { key: 'paid', header: 'Paid (BDT)', value: (row) => formatAmountPlain(row.paidMicro, false) },
    { key: 'due', header: 'Due (BDT)', value: (row) => formatAmountPlain(row.dueMicro, false) },
    { key: 'refunded', header: 'Refunded (BDT)', value: (row) => formatAmountPlain(row.refundedMicro, false) },
    { key: 'lines', header: 'Lines', value: (row) => row.lines.map((line) => line.description).join('; ') }
  ]

  const paymentColumns: Array<CsvColumn<PaymentRecord>> = [
    { key: 'receiptNo', header: 'Receipt no', value: (row) => row.receiptNo },
    { key: 'date', header: 'Date', value: (row) => row.paidDate },
    { key: 'patientCode', header: 'Patient ID', value: (row) => row.patientCode },
    { key: 'patientName', header: 'Patient', value: (row) => row.patientName },
    { key: 'invoiceNo', header: 'Invoice', value: (row) => row.invoiceNo ?? '' },
    { key: 'kind', header: 'Kind', value: (row) => row.kind },
    { key: 'method', header: 'Method', value: (row) => row.method },
    { key: 'amount', header: 'Amount (BDT)', value: (row) => formatAmountPlain(row.amountMicro, false) },
    { key: 'reference', header: 'Reference', value: (row) => row.reference ?? '' },
    { key: 'status', header: 'Status', value: (row) => row.status },
    { key: 'receivedBy', header: 'Received by', value: (row) => row.receivedByName ?? '' }
  ]

  return {
    /* ----------------------------------------------------------------- invoices */

    'invoices.list': (ctx, input) => listInvoices(ctx, input),
    'invoices.get': (ctx, input) => getInvoice(ctx, input.id),
    'invoices.save': (ctx, input) => saveInvoice(ctx, input),
    'invoices.void': (ctx, input) => voidInvoice(ctx, input),
    'invoices.delete': (ctx, input) => deleteInvoice(ctx, input),
    'invoices.billable': (ctx, input) => billableLines(ctx, input.visitId),
    'invoices.forVisit': (ctx, input) => invoicesForVisit(ctx, input.visitId),
    'invoices.export': async (ctx, input) => {
      assertPermission(ctx, 'billing.export')
      const page = listInvoices(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export invoices',
        defaultPath: `${deps.host.paths.exportsDir}/invoices-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.items, invoiceColumns)
      ctx.audit.write({ module: 'billing', action: 'export', summary: `Exported ${rowCount} invoice(s) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    },

    /* ----------------------------------------------------------------- payments */

    'payments.list': (ctx, input) => listPayments(ctx, input),
    'payments.add': (ctx, input) => addPayment(ctx, input),
    'payments.void': (ctx, input) => voidPayment(ctx, input),
    'payments.export': async (ctx, input) => {
      assertPermission(ctx, 'payments.export')
      const page = listPayments(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export payments',
        defaultPath: `${deps.host.paths.exportsDir}/payments-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.items, paymentColumns)
      ctx.audit.write({ module: 'billing', action: 'export', summary: `Exported ${rowCount} payment(s) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    },

    /* Reports read this through the accounting screens; exposed here so the financial maths stays in one place. */
    'reports.dailyCollections': (ctx, input) => dailyCollections(ctx, input.from, input.to)
  }
}
