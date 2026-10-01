import type { ServiceContext } from '../../context'
import { assertAnyPermission } from '../../context'
import { notFoundError } from '@shared/errors'
import { toLocalDate } from '@shared/datetime'
import { rangeBounds } from './entries'

/**
 * The report engine.
 *
 * Every report returns the same shape — typed columns plus raw rows — so one screen, one CSV writer and
 * (later) one print template serve all of them. Numbers are never pre-formatted here: formatting belongs
 * to the presentation layer, and a report that cannot be sorted or summed is not a report.
 *
 * Reports that need a date range receive one; a report without a range ignores it rather than inventing
 * one, so the operator is never shown a silently truncated period.
 */

export type ReportFormat = 'text' | 'number' | 'money' | 'date' | 'percent'
export type ReportCell = string | number | null

export interface ReportColumn {
  key: string
  header: string
  align: 'left' | 'right'
  format: ReportFormat
}

export interface ReportResult {
  key: string
  title: string
  description: string
  from: string | null
  to: string | null
  generatedAt: number
  columns: ReportColumn[]
  rows: Array<Record<string, ReportCell>>
  totals: Array<{ label: string, value: ReportCell, format: ReportFormat }>
  note: string | null
}

export interface ReportFilter {
  key: string
  range?: { preset: string, from?: string | null, to?: string | null }
  limit: number
}

interface ReportDefinition {
  key: string
  title: string
  description: string
  usesRange: boolean
  permission: string
}

const money = (key: string, header: string): ReportColumn => ({ key, header, align: 'right', format: 'money' })
const number = (key: string, header: string): ReportColumn => ({ key, header, align: 'right', format: 'number' })
const text = (key: string, header: string): ReportColumn => ({ key, header, align: 'left', format: 'text' })
const date = (key: string, header: string): ReportColumn => ({ key, header, align: 'left', format: 'date' })
const percent = (key: string, header: string): ReportColumn => ({ key, header, align: 'right', format: 'percent' })

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  { key: 'revenue_daily', title: 'Collections by day', description: 'Money received from patients, refunds and the net for each day.', usesRange: true, permission: 'reports.financial' },
  { key: 'collections_method', title: 'Collections by method', description: 'How patients paid: cash, card, bKash, bank and the rest.', usesRange: true, permission: 'reports.financial' },
  { key: 'expenses_category', title: 'Expenses by category', description: 'Clinic spending grouped by the category it was recorded under.', usesRange: true, permission: 'reports.financial' },
  { key: 'profit_loss', title: 'Income and expenses', description: 'Patient collections plus other income against recorded expenses for the period.', usesRange: true, permission: 'reports.financial' },
  { key: 'receivables', title: 'Outstanding dues', description: 'Every unpaid or partly paid invoice with how long it has been outstanding.', usesRange: false, permission: 'reports.financial' },
  { key: 'top_treatments', title: 'Treatments performed', description: 'Treatments carried out in the period with the revenue they brought in.', usesRange: true, permission: 'reports.financial' },
  { key: 'appointment_stats', title: 'Appointment outcomes', description: 'Appointments by status, including cancellations and no-shows.', usesRange: true, permission: 'reports.view' },
  { key: 'patient_growth', title: 'New patients', description: 'Patients registered per month in the period.', usesRange: true, permission: 'reports.view' },
  { key: 'dentist_workload', title: 'Dentist workload', description: 'Visits, treatments and revenue per dentist.', usesRange: true, permission: 'reports.financial' },
  { key: 'stock_value', title: 'Stock valuation', description: 'Stock on hand per category with its value and what needs attention.', usesRange: false, permission: 'reports.financial' }
]

/**
 * The reports a caller may open.
 *
 * Every definition carries the permission it belongs to — operational reports need `reports.view`,
 * money reports need `reports.financial` — and `accounting.reports` opens both, which is the
 * accountant's role. The catalog is filtered rather than returned whole, so the screen cannot offer a
 * report the service would refuse; running a hidden report is still refused by `runReport`.
 */
export function reportCatalog(ctx: ServiceContext): ReportDefinition[] {
  assertAnyPermission(ctx, ['reports.view', 'reports.financial', 'accounting.reports'])
  const permissions = ctx.actor.permissions
  return REPORT_DEFINITIONS.filter(
    (definition) => permissions.has(definition.permission) || permissions.has('accounting.reports')
  )
}

function resolvePeriod(ctx: ServiceContext, filter: ReportFilter): { from: string, to: string } {
  const today = toLocalDate(ctx.now())
  const bounds = filter.range ? rangeBounds(filter.range, today) : null
  if (bounds) return bounds
  /* Default window for a ranged report when the operator has not chosen one: the current month. */
  return { from: `${today.slice(0, 7)}-01`, to: today }
}

export function runReport(ctx: ServiceContext, filter: ReportFilter): ReportResult {
  const definition = REPORT_DEFINITIONS.find((entry) => entry.key === filter.key)
  if (!definition) throw notFoundError('report', filter.key)
  assertAnyPermission(ctx, [definition.permission, 'accounting.reports'])

  const period = definition.usesRange ? resolvePeriod(ctx, filter) : { from: '', to: '' }
  const generatedAt = ctx.now()
  const base = {
    key: definition.key,
    title: definition.title,
    description: definition.description,
    from: definition.usesRange ? period.from : null,
    to: definition.usesRange ? period.to : null,
    generatedAt
  }

  switch (definition.key) {
    case 'revenue_daily': {
      const rows = ctx.db
        .prepare(
          `SELECT paid_date AS date,
                  COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_micro ELSE 0 END), 0) AS received,
                  COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_micro ELSE 0 END), 0) AS refunded,
                  COUNT(*) AS receipts
             FROM payments
            WHERE status = 'active' AND paid_date >= ? AND paid_date <= ?
            GROUP BY paid_date ORDER BY paid_date DESC`
        )
        .all(period.from, period.to) as Array<{ date: string, received: number, refunded: number, receipts: number }>
      const received = rows.reduce((sum, row) => sum + row.received, 0)
      const refunded = rows.reduce((sum, row) => sum + row.refunded, 0)
      return {
        ...base,
        columns: [date('date', 'Date'), number('receipts', 'Receipts'), money('received', 'Received'), money('refunded', 'Refunded'), money('net', 'Net')],
        rows: rows.map((row) => ({ date: row.date, receipts: row.receipts, received: row.received, refunded: row.refunded, net: row.received - row.refunded })),
        totals: [
          { label: 'Received', value: received, format: 'money' },
          { label: 'Refunded', value: refunded, format: 'money' },
          { label: 'Net', value: received - refunded, format: 'money' }
        ],
        note: null
      }
    }

    case 'collections_method': {
      const rows = ctx.db
        .prepare(
          `SELECT method,
                  COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_micro ELSE 0 END), 0) AS received,
                  COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_micro ELSE 0 END), 0) AS refunded,
                  COUNT(*) AS receipts
             FROM payments
            WHERE status = 'active' AND paid_date >= ? AND paid_date <= ?
            GROUP BY method ORDER BY received DESC`
        )
        .all(period.from, period.to) as Array<{ method: string, received: number, refunded: number, receipts: number }>
      return {
        ...base,
        columns: [text('method', 'Method'), number('receipts', 'Receipts'), money('received', 'Received'), money('refunded', 'Refunded'), money('net', 'Net')],
        rows: rows.map((row) => ({ method: row.method, receipts: row.receipts, received: row.received, refunded: row.refunded, net: row.received - row.refunded })),
        totals: [
          { label: 'Received', value: rows.reduce((sum, row) => sum + row.received, 0), format: 'money' },
          { label: 'Refunded', value: rows.reduce((sum, row) => sum + row.refunded, 0), format: 'money' }
        ],
        note: null
      }
    }

    case 'expenses_category': {
      const rows = ctx.db
        .prepare(
          `SELECT category_name AS category, COUNT(*) AS entries, SUM(amount_micro) AS amount
             FROM accounting_entries
            WHERE status = 'active' AND kind = 'expense' AND entry_date >= ? AND entry_date <= ?
            GROUP BY category_name ORDER BY amount DESC LIMIT ?`
        )
        .all(period.from, period.to, filter.limit) as Array<{ category: string, entries: number, amount: number }>
      const total = (
        ctx.db
          .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS total FROM accounting_entries WHERE status = 'active' AND kind = 'expense' AND entry_date >= ? AND entry_date <= ?")
          .get(period.from, period.to) as { total: number }
      ).total
      return {
        ...base,
        columns: [text('category', 'Category'), number('entries', 'Entries'), money('amount', 'Amount')],
        rows: rows.map((row) => ({ category: row.category, entries: row.entries, amount: row.amount })),
        totals: [{ label: 'Total expenses', value: total, format: 'money' }],
        note: rows.length === 0 ? 'No expenses recorded in this period.' : null
      }
    }

    case 'profit_loss': {
      const payments = ctx.db
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount_micro ELSE amount_micro END), 0) AS net
             FROM payments WHERE status = 'active' AND paid_date >= ? AND paid_date <= ?`
        )
        .get(period.from, period.to) as { net: number }
      const income = ctx.db
        .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS total FROM accounting_entries WHERE status = 'active' AND kind = 'income' AND entry_date >= ? AND entry_date <= ?")
        .get(period.from, period.to) as { total: number }
      const expense = ctx.db
        .prepare("SELECT COALESCE(SUM(amount_micro), 0) AS total FROM accounting_entries WHERE status = 'active' AND kind = 'expense' AND entry_date >= ? AND entry_date <= ?")
        .get(period.from, period.to) as { total: number }
      const rows = [
        { line: 'Patient collections (net of refunds)', amount: payments.net },
        { line: 'Other income', amount: income.total },
        { line: 'Total income', amount: payments.net + income.total },
        { line: 'Expenses', amount: -expense.total },
        { line: 'Net', amount: payments.net + income.total - expense.total }
      ]
      return {
        ...base,
        columns: [text('line', 'Line'), money('amount', 'Amount')],
        rows,
        totals: [
          { label: 'Income', value: payments.net + income.total, format: 'money' },
          { label: 'Expenses', value: expense.total, format: 'money' },
          { label: 'Net', value: payments.net + income.total - expense.total, format: 'money' }
        ],
        note: 'Stock purchases are working capital, not expenses; they appear in the purchases list and the stock valuation report.'
      }
    }

    case 'receivables': {
      const rows = ctx.db
        .prepare(
          `SELECT i.invoice_no AS invoice, i.issue_date AS issued, p.code AS patient_code, p.full_name AS patient,
                  i.total_micro AS total, i.paid_micro - i.refunded_micro AS collected, i.due_micro AS due,
                  CAST(julianday(date('now','localtime')) - julianday(i.issue_date) AS INTEGER) AS age_days
             FROM invoices i JOIN patients p ON p.id = i.patient_id
            WHERE i.is_deleted = 0 AND i.status IN ('unpaid','partial') AND i.due_micro > 0
            ORDER BY i.issue_date ASC LIMIT ?`
        )
        .all(filter.limit) as Array<{ invoice: string, issued: string, patient_code: string, patient: string, total: number, collected: number, due: number, age_days: number }>
      const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 }
      for (const row of rows) {
        if (row.age_days <= 30) buckets.current += row.due
        else if (row.age_days <= 60) buckets.d30 += row.due
        else if (row.age_days <= 90) buckets.d60 += row.due
        else if (row.age_days <= 180) buckets.d90 += row.due
        else buckets.older += row.due
      }
      return {
        ...base,
        columns: [text('invoice', 'Invoice'), date('issued', 'Issued'), text('patientCode', 'Patient ID'), text('patient', 'Patient'), number('ageDays', 'Age (days)'), money('total', 'Total'), money('collected', 'Collected'), money('due', 'Due')],
        rows: rows.map((row) => ({
          invoice: row.invoice,
          issued: row.issued,
          patientCode: row.patient_code,
          patient: row.patient,
          ageDays: row.age_days,
          total: row.total,
          collected: row.collected,
          due: row.due
        })),
        totals: [
          { label: 'Outstanding', value: rows.reduce((sum, row) => sum + row.due, 0), format: 'money' },
          { label: '0–30 days', value: buckets.current, format: 'money' },
          { label: '31–60 days', value: buckets.d30, format: 'money' },
          { label: '61–90 days', value: buckets.d60, format: 'money' },
          { label: 'Over 90 days', value: buckets.d90 + buckets.older, format: 'money' }
        ],
        note: rows.length === filter.limit ? `Showing the ${filter.limit} oldest outstanding invoices.` : null
      }
    }

    case 'top_treatments': {
      const rows = ctx.db
        .prepare(
          `SELECT t.name AS treatment, COUNT(*) AS times, SUM(vt.total_micro) AS revenue
             FROM visit_treatments vt
             JOIN treatments t ON t.id = vt.treatment_id
             JOIN visits v ON v.id = vt.visit_id
            WHERE v.is_deleted = 0 AND vt.status <> 'cancelled' AND v.visit_date >= ? AND v.visit_date <= ?
            GROUP BY t.id ORDER BY times DESC, revenue DESC LIMIT ?`
        )
        .all(period.from, period.to, filter.limit) as Array<{ treatment: string, times: number, revenue: number }>
      return {
        ...base,
        columns: [text('treatment', 'Treatment'), number('times', 'Times'), money('revenue', 'Revenue')],
        rows,
        totals: [
          { label: 'Treatments', value: rows.reduce((sum, row) => sum + row.times, 0), format: 'number' },
          { label: 'Revenue', value: rows.reduce((sum, row) => sum + row.revenue, 0), format: 'money' }
        ],
        note: null
      }
    }

    case 'appointment_stats': {
      const rows = ctx.db
        .prepare(
          `SELECT status, COUNT(*) AS appointments FROM appointments
            WHERE is_deleted = 0 AND scheduled_date >= ? AND scheduled_date <= ?
            GROUP BY status ORDER BY appointments DESC`
        )
        .all(period.from, period.to) as Array<{ status: string, appointments: number }>
      const total = rows.reduce((sum, row) => sum + row.appointments, 0)
      return {
        ...base,
        columns: [text('status', 'Status'), number('appointments', 'Appointments'), percent('share', 'Share')],
        rows: rows.map((row) => ({ status: row.status, appointments: row.appointments, share: total === 0 ? 0 : Math.round((row.appointments / total) * 10_000) / 100 })),
        totals: [{ label: 'Appointments', value: total, format: 'number' }],
        note: total === 0 ? 'No appointments were booked in this period.' : null
      }
    }

    case 'patient_growth': {
      const rows = ctx.db
        .prepare(
          `SELECT substr(registration_date, 1, 7) AS month, COUNT(*) AS patients
             FROM patients
            WHERE is_deleted = 0 AND registration_date >= ? AND registration_date <= ?
            GROUP BY month ORDER BY month DESC LIMIT ?`
        )
        .all(period.from, period.to, filter.limit) as Array<{ month: string, patients: number }>
      return {
        ...base,
        columns: [text('month', 'Month'), number('patients', 'New patients')],
        rows: rows.map((row) => ({ month: row.month, patients: row.patients })),
        totals: [{ label: 'New patients', value: rows.reduce((sum, row) => sum + row.patients, 0), format: 'number' }],
        note: null
      }
    }

    case 'dentist_workload': {
      const rows = ctx.db
        .prepare(
          `SELECT d.full_name AS dentist,
                  (SELECT COUNT(*) FROM visits v WHERE v.dentist_id = d.id AND v.is_deleted = 0 AND v.visit_date >= @from AND v.visit_date <= @to) AS visits,
                  (SELECT COUNT(*) FROM appointments a WHERE a.dentist_id = d.id AND a.is_deleted = 0 AND a.scheduled_date >= @from AND a.scheduled_date <= @to) AS appointments,
                  (SELECT COALESCE(SUM(vt.total_micro), 0) FROM visit_treatments vt JOIN visits v ON v.id = vt.visit_id
                    WHERE v.dentist_id = d.id AND v.is_deleted = 0 AND vt.status <> 'cancelled' AND v.visit_date >= @from AND v.visit_date <= @to) AS revenue
             FROM dentists d
            WHERE d.is_deleted = 0
            ORDER BY visits DESC, d.full_name ASC LIMIT @limit`
        )
        .all({ from: period.from, to: period.to, limit: filter.limit }) as Array<{ dentist: string, visits: number, appointments: number, revenue: number }>
      return {
        ...base,
        columns: [text('dentist', 'Dentist'), number('visits', 'Visits'), number('appointments', 'Appointments'), money('revenue', 'Treatment value')],
        rows,
        totals: [
          { label: 'Visits', value: rows.reduce((sum, row) => sum + row.visits, 0), format: 'number' },
          { label: 'Treatment value', value: rows.reduce((sum, row) => sum + row.revenue, 0), format: 'money' }
        ],
        note: null
      }
    }

    case 'stock_value': {
      const rows = ctx.db
        .prepare(
          `SELECT i.category AS category, COUNT(*) AS items, COALESCE(SUM(v.quantity_on_hand), 0) AS quantity,
                  COALESCE(SUM(v.stock_value_micro), 0) AS value,
                  COALESCE(SUM(CASE WHEN i.reorder_level > 0 AND COALESCE(v.quantity_on_hand, 0) <= i.reorder_level THEN 1 ELSE 0 END), 0) AS low_stock,
                  COALESCE(SUM((SELECT COUNT(*) FROM inventory_batches b WHERE b.item_id = i.id AND b.quantity > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date < date('now','localtime'))), 0) AS expired_batches
             FROM inventory_items i LEFT JOIN inventory_current v ON v.item_id = i.id
            WHERE i.is_deleted = 0 AND i.is_active = 1
            GROUP BY i.category ORDER BY value DESC`
        )
        .all() as Array<{ category: string, items: number, quantity: number, value: number, low_stock: number, expired_batches: number }>
      return {
        ...base,
        columns: [text('category', 'Category'), number('items', 'Items'), number('quantity', 'Units'), number('lowStock', 'To reorder'), number('expiredBatches', 'Expired batches'), money('value', 'Value')],
        rows: rows.map((row) => ({
          category: row.category,
          items: row.items,
          quantity: Math.round(row.quantity * 100) / 100,
          lowStock: row.low_stock,
          expiredBatches: row.expired_batches,
          value: row.value
        })),
        totals: [
          { label: 'Stock value', value: rows.reduce((sum, row) => sum + row.value, 0), format: 'money' },
          { label: 'Items to reorder', value: rows.reduce((sum, row) => sum + row.low_stock, 0), format: 'number' }
        ],
        note: null
      }
    }

    default:
      throw notFoundError('report', filter.key)
  }
}
