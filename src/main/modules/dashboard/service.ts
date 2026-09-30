import type { ServiceContext } from '../../context'
import { assertAnyPermission } from '../../context'
import { resolveRange } from '../shared/query'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import { countPatients, patientsAddedBetween } from '../patients/service'

/**
 * Dashboard aggregation.
 *
 * Every figure is computed in SQL over the same tables the module screens read, so the dashboard can
 * never disagree with a detail screen. Financial aggregates are only included for actors holding the
 * matching permission — a receptionist without billing rights sees the schedule, not the money.
 */

export interface DashboardKpi {
  key: string
  label: string
  value: number
  unit: 'money' | 'count'
  /** Change against the previous comparable period, in basis points (null when not comparable). */
  deltaBp: number | null
  route: string | null
  hint: string
}

export interface DashboardSummary {
  range: { preset: string, from: string | null, to: string | null }
  kpis: DashboardKpi[]
  appointments: Array<{
    id: number
    scheduledAt: number
    patientId: number
    patientName: string
    patientCode: string
    dentistName: string
    status: string
    reason: string | null
  }>
  queue: { waiting: number, inProgress: number, completedToday: number }
  duePatients: Array<{ patientId: number, code: string, fullName: string, dueMicro: number, lastPaymentAt: number | null }>
  lowStock: Array<{ itemId: number, code: string, name: string, quantityOnHand: number, reorderLevel: number, unit: string }>
  expiringBatches: Array<{ batchId: number, itemName: string, batchNo: string, expiryDate: string, quantity: number }>
  revenueSeries: Array<{ label: string, value: number, meta?: string }>
  dentistLoad: Array<{ label: string, value: number, meta?: string }>
  recentActivity: Array<{ id: number, at: number, module: string, action: string, summary: string, username: string | null }>
  notifications: { unread: number, critical: number }
  generatedAt: number
}

function previousRange(range: { from: string | null, to: string | null }): { from: string | null, to: string | null } {
  if (!range.from || !range.to) return { from: null, to: null }
  const fromMs = fromLocalDate(range.from)
  const toMs = fromLocalDate(range.to)
  const spanDays = Math.max(1, Math.round((toMs - fromMs) / 86_400_000) + 1)
  return {
    from: toLocalDate(fromMs - spanDays * 86_400_000),
    to: toLocalDate(fromMs - 86_400_000)
  }
}

function moneyBetween(ctx: ServiceContext, table: 'invoices' | 'payments', from: string | null, to: string | null): number {
  const column = table === 'invoices' ? 'total_micro' : 'amount_micro'
  const dateColumn = table === 'invoices' ? 'issue_date' : 'paid_date'
  const statusClause = table === 'invoices' ? "status <> 'void'" : "status = 'active'"
  const params: Array<string | number> = []
  let clause = `is_deleted = 0 AND ${statusClause}`
  if (table === 'payments') clause = `${statusClause}`
  if (from) {
    clause += ` AND ${dateColumn} >= ?`
    params.push(from)
  }
  if (to) {
    clause += ` AND ${dateColumn} <= ?`
    params.push(to)
  }
  const row = ctx.db.prepare(`SELECT COALESCE(SUM(${column}), 0) AS total FROM ${table} WHERE ${clause}`).get(...params) as { total: number }
  return row.total
}

export function getDashboardSummary(ctx: ServiceContext, input: { range?: { preset?: string, from?: string | null, to?: string | null } }): DashboardSummary {
  assertAnyPermission(ctx, ['patients.view', 'appointments.view', 'billing.view', 'queue.view', 'inventory.view'])
  const now = ctx.now()
  const range = resolveRange(input.range, now)
  const previous = previousRange(range)

  const canSeeBilling = ctx.actor.permissions.has('billing.view')
  const canSeePayments = ctx.actor.permissions.has('payments.view')
  const canSeeInventory = ctx.actor.permissions.has('inventory.view')
  const canSeeAppointments = ctx.actor.permissions.has('appointments.view')
  const canSeeQueue = ctx.actor.permissions.has('queue.view')

  const newPatients = patientsAddedBetween(ctx, range.from ?? '0000-01-01', range.to ?? '9999-12-31')
  const previousNewPatients = previous.from ? patientsAddedBetween(ctx, previous.from, previous.to ?? previous.from) : 0

  const kpis: DashboardKpi[] = [
    {
      key: 'patients',
      label: 'Active patients',
      value: countPatients(ctx),
      unit: 'count',
      deltaBp: previousNewPatients > 0 ? Math.round(((newPatients - previousNewPatients) / previousNewPatients) * 10_000) : null,
      route: '/patients',
      hint: `${newPatients} registered in the selected period`
    },
    {
      key: 'appointmentsToday',
      label: 'Appointments today',
      value: (
        ctx.db
          .prepare("SELECT COUNT(*) AS count FROM appointments WHERE scheduled_date = ? AND is_deleted = 0 AND status NOT IN ('cancelled','no_show')")
          .get(toLocalDate(now)) as { count: number }
      ).count,
      unit: 'count',
      deltaBp: null,
      route: '/appointments',
      hint: 'Scheduled for today, excluding cancelled'
    },
    {
      key: 'queue',
      label: 'In the queue now',
      value: (
        ctx.db
          .prepare("SELECT COUNT(*) AS count FROM queue_entries WHERE status IN ('waiting','called','in_progress') AND joined_at >= ?")
          .get(fromLocalDate(toLocalDate(now))) as { count: number }
      ).count,
      unit: 'count',
      deltaBp: null,
      route: '/queue',
      hint: 'Waiting, called or in treatment'
    }
  ]

  if (canSeeBilling) {
    const invoiced = moneyBetween(ctx, 'invoices', range.from, range.to)
    const previousInvoiced = previous.from ? moneyBetween(ctx, 'invoices', previous.from, previous.to) : 0
    kpis.push({
      key: 'invoiced',
      label: 'Invoiced',
      value: invoiced,
      unit: 'money',
      deltaBp: previousInvoiced > 0 ? Math.round(((invoiced - previousInvoiced) / previousInvoiced) * 10_000) : null,
      route: '/invoices',
      hint: 'Total billed in the selected period, voided invoices excluded'
    })
    const due = (
      ctx.db.prepare("SELECT COALESCE(SUM(due_micro), 0) AS total FROM invoices WHERE is_deleted = 0 AND status <> 'void'").get() as { total: number }
    ).total
    kpis.push({
      key: 'due',
      label: 'Outstanding dues',
      value: due,
      unit: 'money',
      deltaBp: null,
      route: '/invoices?filter=due',
      hint: 'Unpaid balance across all open invoices'
    })
  }

  if (canSeePayments) {
    const collected = moneyBetween(ctx, 'payments', range.from, range.to)
    const previousCollected = previous.from ? moneyBetween(ctx, 'payments', previous.from, previous.to) : 0
    kpis.push({
      key: 'collected',
      label: 'Collected',
      value: collected,
      unit: 'money',
      deltaBp: previousCollected > 0 ? Math.round(((collected - previousCollected) / previousCollected) * 10_000) : null,
      route: '/payments',
      hint: 'Receipts recorded in the selected period (refunds included as negatives)'
    })
  }

  const appointments = canSeeAppointments
    ? (ctx.db
        .prepare(
          `SELECT a.id, a.scheduled_at AS scheduledAt, p.id AS patientId, p.full_name AS patientName, p.code AS patientCode,
                  d.full_name AS dentistName, a.status, a.reason
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           JOIN dentists d ON d.id = a.dentist_id
           WHERE a.is_deleted = 0 AND a.scheduled_date >= ? AND a.scheduled_date <= ?
           ORDER BY a.scheduled_at ASC LIMIT 12`
        )
        .all(toLocalDate(now), toLocalDate(now)) as DashboardSummary['appointments'])
    : []

  const queue = canSeeQueue
    ? {
        waiting: (ctx.db.prepare("SELECT COUNT(*) AS count FROM queue_entries WHERE status = 'waiting' AND joined_at >= ?").get(fromLocalDate(toLocalDate(now))) as { count: number }).count,
        inProgress: (
          ctx.db.prepare("SELECT COUNT(*) AS count FROM queue_entries WHERE status IN ('called','in_progress') AND joined_at >= ?").get(fromLocalDate(toLocalDate(now))) as { count: number }
        ).count,
        completedToday: (
          ctx.db.prepare("SELECT COUNT(*) AS count FROM queue_entries WHERE status = 'completed' AND joined_at >= ?").get(fromLocalDate(toLocalDate(now))) as { count: number }
        ).count
      }
    : { waiting: 0, inProgress: 0, completedToday: 0 }

  const duePatients = canSeeBilling
    ? (ctx.db
        .prepare(
          `SELECT p.id AS patientId, p.code, p.full_name AS fullName, f.due_micro AS dueMicro,
                  (SELECT MAX(paid_at) FROM payments pm WHERE pm.patient_id = p.id AND pm.status = 'active') AS lastPaymentAt
           FROM patients p JOIN patient_financials f ON f.patient_id = p.id
           WHERE p.is_deleted = 0 AND f.due_micro > 0
           ORDER BY f.due_micro DESC LIMIT 8`
        )
        .all() as DashboardSummary['duePatients'])
    : []

  const lowStock = canSeeInventory
    ? (ctx.db
        .prepare(
          `SELECT item_id AS itemId, code, name, quantity_on_hand AS quantityOnHand, reorder_level AS reorderLevel, unit
           FROM inventory_current
           WHERE is_active = 1 AND quantity_on_hand <= reorder_level
           ORDER BY (quantity_on_hand - reorder_level) ASC LIMIT 8`
        )
        .all() as DashboardSummary['lowStock'])
    : []

  const expiringBatches = canSeeInventory
    ? (ctx.db
        .prepare(
          `SELECT b.id AS batchId, i.name AS itemName, b.batch_no AS batchNo, b.expiry_date AS expiryDate, b.quantity
           FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
           WHERE i.is_deleted = 0 AND b.quantity > 0 AND b.expiry_date IS NOT NULL
             AND b.expiry_date <= date('now', '+90 day')
           ORDER BY b.expiry_date ASC LIMIT 8`
        )
        .all() as DashboardSummary['expiringBatches'])
    : []

  const revenueSeries = canSeePayments ? buildRevenueSeries(ctx, range, now) : []

  const dentistLoad = canSeeAppointments
    ? (ctx.db
        .prepare(
          `SELECT d.full_name AS label, COUNT(v.id) AS value,
                  CAST(COALESCE(SUM(vt.total_micro), 0) AS INTEGER) AS revenue
           FROM dentists d
           LEFT JOIN visits v ON v.dentist_id = d.id AND v.is_deleted = 0 AND v.visit_date >= ? AND v.visit_date <= ?
           LEFT JOIN visit_treatments vt ON vt.visit_id = v.id
           WHERE d.is_deleted = 0 AND d.is_active = 1
           GROUP BY d.id ORDER BY value DESC LIMIT 6`
        )
        .all(range.from ?? '0000-01-01', range.to ?? '9999-12-31') as Array<{ label: string, value: number, revenue: number }>)
        .map((row) => ({ label: row.label, value: row.value, meta: canSeeBilling ? `${row.value} visit(s)` : undefined }))
    : []

  const recentActivity = (ctx.db
    .prepare(
      `SELECT id, at, module, action, summary, username FROM audit_log
       WHERE module NOT IN ('auth') ORDER BY at DESC LIMIT 10`
    )
    .all() as DashboardSummary['recentActivity'])

  const unreadNotifications = (ctx.db.prepare('SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0 AND is_deleted = 0').get() as { count: number }).count
  const criticalNotifications = (
    ctx.db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0 AND is_deleted = 0 AND severity IN ('critical','warning')").get() as { count: number }
  ).count

  return {
    range: { preset: input.range?.preset ?? 'last30', from: range.from, to: range.to },
    kpis,
    appointments,
    queue,
    duePatients,
    lowStock,
    expiringBatches,
    revenueSeries,
    dentistLoad,
    recentActivity,
    notifications: { unread: unreadNotifications, critical: criticalNotifications },
    generatedAt: now
  }
}

/** Payments per day (money in) for the selected range, capped to 31 points so the axis stays legible. */
function buildRevenueSeries(ctx: ServiceContext, range: { from: string | null, to: string | null }, now: number): Array<{ label: string, value: number, meta?: string }> {
  const to = range.to ?? toLocalDate(now)
  const from = range.from ?? toLocalDate(fromLocalDate(to) - 29 * 86_400_000)
  const spanDays = Math.max(1, Math.round((fromLocalDate(to) - fromLocalDate(from)) / 86_400_000) + 1)

  if (spanDays > 31) {
    const rows = ctx.db
      .prepare(
        `SELECT substr(paid_date, 1, 7) AS bucket, COALESCE(SUM(amount_micro), 0) AS total, COUNT(*) AS receipts
         FROM payments WHERE status = 'active' AND paid_date >= ? AND paid_date <= ?
         GROUP BY bucket ORDER BY bucket ASC`
      )
      .all(from, to) as Array<{ bucket: string, total: number, receipts: number }>
    return rows.map((row) => ({ label: monthLabel(row.bucket), value: row.total, meta: `${row.receipts} receipt(s)` }))
  }

  const rows = ctx.db
    .prepare(
      `SELECT paid_date AS bucket, COALESCE(SUM(amount_micro), 0) AS total, COUNT(*) AS receipts
       FROM payments WHERE status = 'active' AND paid_date >= ? AND paid_date <= ?
       GROUP BY bucket ORDER BY bucket ASC`
    )
    .all(from, to) as Array<{ bucket: string, total: number, receipts: number }>
  const byDate = new Map(rows.map((row) => [row.bucket, row]))
  const series: Array<{ label: string, value: number, meta?: string }> = []
  for (let offset = 0; offset < spanDays; offset += 1) {
    const date = toLocalDate(fromLocalDate(from) + offset * 86_400_000)
    const entry = byDate.get(date)
    series.push({ label: date.slice(5), value: entry?.total ?? 0, meta: `${entry?.receipts ?? 0} receipt(s)` })
  }
  return series
}

function monthLabel(bucket: string): string {
  const [year, month] = bucket.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const index = Number(month) - 1
  return `${names[index] ?? month} ${String(year).slice(2)}`
}
