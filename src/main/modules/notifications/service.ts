import type { ServiceContext } from '../../context'
import { notFoundError } from '@shared/errors'
import { formatBDT } from '@shared/money'
import { toLocalDate } from '@shared/datetime'
import { NOTIFICATION_TYPES, NOTIFICATION_TYPE_VALUES } from '@shared/notifications'
import { mutedNotificationTypes } from '../preferences/service'
import { getBooleanSetting, getNumberSetting, getSettingSafe } from '../settings/service'
import type { Db } from '../../db/connection'

/**
 * Notification centre.
 *
 * Notifications are raised from live clinic data — low stock, batches that expired or are about to,
 * invoices past their due date, appointments that were never actioned and a backup that has come due —
 * so the bell always reflects the state of the clinic rather than a log of past events. Every row is
 * deduplicated by `dedupe_key`: the same item or invoice refreshes one row, and a row that is no longer
 * true is retired automatically. Reading or dismissing a notification is remembered.
 */

export { NOTIFICATION_TYPES }

/** Types the live sync owns; a row of one of these types is retired when its condition disappears. */
const SYNCED_TYPES: string[] = [...NOTIFICATION_TYPE_VALUES]

const MISSED_APPOINTMENT_WINDOW_DAYS = 14
const LOW_STOCK_LIMIT = 200
const EXPIRY_LIMIT = 200
const OVERDUE_LIMIT = 200

export interface NotificationCounts {
  unread: number
  critical: number
  unreadCritical: number
  total: number
}

export interface NotificationRecord {
  id: number
  type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  entityType: string | null
  entityId: number | null
  actionRoute: string | null
  requiresPermission: string | null
  createdAt: number
  isRead: boolean
  readAt: number | null
  isDismissed: boolean
  dismissedAt: number | null
}

export interface NotificationInput {
  dedupeKey: string
  type: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  message: string
  entityType?: string | null
  entityId?: number | null
  actionRoute?: string | null
  requiresPermission?: string | null
}

interface NotificationRow {
  id: number
  type: string
  severity: string
  title: string
  message: string
  entity_type: string | null
  entity_id: number | null
  action_route: string | null
  requires_permission: string | null
  created_at: number
  is_read: number
  read_at: number | null
  is_dismissed: number
  dismissed_at: number | null
}

function mapRow(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    severity: (row.severity as NotificationRecord['severity']) ?? 'info',
    title: row.title,
    message: row.message,
    entityType: row.entity_type,
    entityId: row.entity_id,
    actionRoute: row.action_route,
    requiresPermission: row.requires_permission,
    createdAt: row.created_at,
    isRead: row.is_read === 1,
    readAt: row.read_at,
    isDismissed: row.is_dismissed === 1,
    dismissedAt: row.dismissed_at
  }
}

/**
 * Records a notification, or refreshes the row that already carries the same dedupe key. The read and
 * dismissed state is deliberately preserved: re-raising a condition the operator has already dealt with
 * would be exactly the spam the notification centre exists to avoid.
 */
export function raiseNotification(db: Db, input: NotificationInput, at: number): number {
  const existing = db.prepare('SELECT id FROM notifications WHERE dedupe_key = ?').get(input.dedupeKey) as { id: number } | undefined
  if (existing) {
    db.prepare(
      `UPDATE notifications
          SET type = @type, severity = @severity, title = @title, message = @message, entity_type = @entityType,
              entity_id = @entityId, action_route = @actionRoute, requires_permission = @requiresPermission,
              created_at = @at
        WHERE id = @id`
    ).run({
      id: existing.id,
      type: input.type,
      severity: input.severity,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actionRoute: input.actionRoute ?? null,
      requiresPermission: input.requiresPermission ?? null,
      at
    })
    return existing.id
  }
  const result = db
    .prepare(
      `INSERT INTO notifications (dedupe_key, type, severity, title, message, entity_type, entity_id, action_route,
         requires_permission, created_at)
       VALUES (@dedupeKey, @type, @severity, @title, @message, @entityType, @entityId, @actionRoute,
         @requiresPermission, @at)`
    )
    .run({
      dedupeKey: input.dedupeKey,
      type: input.type,
      severity: input.severity,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actionRoute: input.actionRoute ?? null,
      requiresPermission: input.requiresPermission ?? null,
      at
    })
  return Number(result.lastInsertRowid)
}

/* -------------------------------------------------------------------------- */
/* Live generation                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Rebuilds the operational notifications from the current data and retires the ones that no longer
 * apply. Runs without a permission check because it only maintains the notification table; what a
 * given operator may see is decided when the list is read.
 */
export function syncNotifications(ctx: ServiceContext): NotificationCounts {
  const at = ctx.now()
  const alive: number[] = []
  const raise = (input: NotificationInput): void => {
    alive.push(raiseNotification(ctx.db, input, at))
  }

  if (getBooleanSetting(ctx, 'inventory.lowStockAlerts')) {
    const rows = ctx.db
      .prepare(
        `SELECT item_id, code, name, unit, quantity_on_hand, reorder_level
           FROM inventory_current
          WHERE is_active = 1 AND reorder_level > 0 AND quantity_on_hand <= reorder_level
          ORDER BY (reorder_level - quantity_on_hand) DESC, name
          LIMIT ?`
      )
      .all(LOW_STOCK_LIMIT) as Array<{ item_id: number, code: string, name: string, unit: string, quantity_on_hand: number, reorder_level: number }>
    for (const row of rows) {
      raise({
        dedupeKey: `stock-low:${row.item_id}`,
        type: NOTIFICATION_TYPES.lowStock,
        severity: row.quantity_on_hand <= 0 ? 'critical' : 'warning',
        title: `${row.name} is ${row.quantity_on_hand <= 0 ? 'out of stock' : 'low on stock'}`,
        message: `${row.quantity_on_hand} ${row.unit} in stock (reorder level ${row.reorder_level}). Code ${row.code}.`,
        entityType: 'inventory_item',
        entityId: row.item_id,
        actionRoute: `/inventory/${row.item_id}`,
        requiresPermission: 'inventory.view'
      })
    }
  }

  const expiryWarningDays = getNumberSetting(ctx, 'inventory.expiryWarningDays')
  const expiryRows = ctx.db
    .prepare(
      `SELECT b.id, b.batch_no, b.expiry_date, b.quantity, i.id AS item_id, i.name, i.unit
         FROM inventory_batches b
         JOIN inventory_items i ON i.id = b.item_id
        WHERE i.is_deleted = 0 AND i.is_active = 1 AND b.quantity > 0
          AND b.expiry_date IS NOT NULL AND b.expiry_date <= date('now', '+' || ? || ' days')
        ORDER BY b.expiry_date
        LIMIT ?`
    )
    .all(expiryWarningDays, EXPIRY_LIMIT) as Array<{ id: number, batch_no: string | null, expiry_date: string, quantity: number, item_id: number, name: string, unit: string }>
  const today = toLocalDate(at)
  for (const row of expiryRows) {
    const expired = row.expiry_date < today
    raise({
      dedupeKey: `stock-expiry:${row.id}`,
      type: expired ? NOTIFICATION_TYPES.expiredStock : NOTIFICATION_TYPES.expiringStock,
      severity: expired ? 'critical' : 'warning',
      title: expired ? `${row.name} has an expired batch` : `${row.name} expires soon`,
      message: `Batch ${row.batch_no ?? row.id} (${row.quantity} ${row.unit}) expired on ${row.expiry_date}.`.replace(
        'expired on',
        expired ? 'expired on' : 'expires on'
      ),
      entityType: 'inventory_batch',
      entityId: row.id,
      actionRoute: `/inventory/${row.item_id}`,
      requiresPermission: 'inventory.view'
    })
  }

  const overdueDays = getNumberSetting(ctx, 'notifications.overdueInvoiceDays')
  const overdueRows = ctx.db
    .prepare(
      `SELECT i.id, i.invoice_no, i.due_date, i.due_micro, p.id AS patient_id, p.full_name
         FROM invoices i
         JOIN patients p ON p.id = i.patient_id
        WHERE i.is_deleted = 0 AND i.status <> 'void' AND i.due_micro > 0 AND i.due_date IS NOT NULL
          AND i.due_date < date('now', '-' || ? || ' days')
        ORDER BY i.due_date
        LIMIT ?`
    )
    .all(overdueDays, OVERDUE_LIMIT) as Array<{ id: number, invoice_no: string, due_date: string, due_micro: number, patient_id: number, full_name: string }>
  for (const row of overdueRows) {
    raise({
      dedupeKey: `invoice-overdue:${row.id}`,
      type: NOTIFICATION_TYPES.overdueInvoice,
      severity: 'warning',
      title: `Invoice ${row.invoice_no} is overdue`,
      message: `${formatBDT(row.due_micro)} is due from ${row.full_name} (payment was due ${row.due_date}).`,
      entityType: 'invoice',
      entityId: row.id,
      actionRoute: `/invoices/${row.id}`,
      requiresPermission: 'billing.view'
    })
  }

  if (getBooleanSetting(ctx, 'notifications.missedAppointmentAlerts')) {
    const rows = ctx.db
      .prepare(
        `SELECT a.id, a.scheduled_at, a.scheduled_date, p.id AS patient_id, p.full_name, d.full_name AS dentist_name
           FROM appointments a
           JOIN patients p ON p.id = a.patient_id
           LEFT JOIN dentists d ON d.id = a.dentist_id AND d.is_deleted = 0
          WHERE a.is_deleted = 0 AND a.status = 'scheduled' AND a.scheduled_at < ?
            AND a.scheduled_date >= date('now', '-' || ? || ' days')
          ORDER BY a.scheduled_at DESC`
      )
      .all(at, MISSED_APPOINTMENT_WINDOW_DAYS) as Array<{ id: number, scheduled_at: number, scheduled_date: string, patient_id: number, full_name: string, dentist_name: string | null }>
    for (const row of rows) {
      raise({
        dedupeKey: `appointment-missed:${row.id}`,
        type: NOTIFICATION_TYPES.missedAppointment,
        severity: 'warning',
        title: `Appointment for ${row.full_name} was not marked`,
        message: `Booked for ${row.scheduled_date}${row.dentist_name ? ` with ${row.dentist_name}` : ''} and still marked as scheduled.`,
        entityType: 'appointment',
        entityId: row.id,
        actionRoute: `/appointments?date=${row.scheduled_date}`,
        requiresPermission: 'appointments.view'
      })
    }
  }

  if (getBooleanSetting(ctx, 'notifications.backupReminder')) {
    const frequencyDays = Number(getSettingSafe(ctx, 'backup.frequencyDays', '0')) || 0
    const lastRunAt = Number(getSettingSafe(ctx, 'backup.lastRunAt', '')) || 0
    if (frequencyDays > 0 && (lastRunAt === 0 || at - lastRunAt >= frequencyDays * 86_400_000)) {
      raise({
        dedupeKey: `backup-due:${today}`,
        type: NOTIFICATION_TYPES.backupDue,
        severity: 'info',
        title: 'A backup is due',
        message: lastRunAt === 0
          ? 'No automatic backup has been recorded yet. Open Backup & restore and create one.'
          : `The last automatic backup was on ${toLocalDate(lastRunAt)}; the schedule is every ${frequencyDays} day(s).`,
        entityType: 'backup',
        entityId: null,
        actionRoute: '/settings/backup',
        requiresPermission: 'backups.create'
      })
    }
  }

  /* Retire notifications whose condition no longer exists, so the bell only shows live work. */
  const placeholders = alive.map(() => '?').join(',')
  const typePlaceholders = SYNCED_TYPES.map(() => '?').join(',')
  if (alive.length > 0) {
    ctx.db
      .prepare(
        `UPDATE notifications SET is_dismissed = 1, dismissed_at = ?
          WHERE is_dismissed = 0 AND type IN (${typePlaceholders}) AND id NOT IN (${placeholders})`
      )
      .run(at, ...SYNCED_TYPES, ...alive)
  } else {
    ctx.db
      .prepare(`UPDATE notifications SET is_dismissed = 1, dismissed_at = ? WHERE is_dismissed = 0 AND type IN (${typePlaceholders})`)
      .run(at, ...SYNCED_TYPES)
  }

  return notificationCounts(ctx)
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

function permissionClause(ctx: ServiceContext): { sql: string, params: string[] } {
  const permissions = [...ctx.actor.permissions]
  if (permissions.length === 0) return { sql: '(requires_permission IS NULL)', params: [] }
  return {
    sql: `(requires_permission IS NULL OR requires_permission IN (${permissions.map(() => '?').join(',')}))`,
    params: permissions
  }
}

/**
 * Applies the operator's own alert preferences on top of the permission filter. Muting a type hides its
 * routine entries from the bell and the list, but never hides a critical one: a muted type that turns
 * critical — expired stock, an overdrawn safety limit — still reaches the operator who asked for quiet.
 */
function muteClause(ctx: ServiceContext): { sql: string, params: string[] } {
  const muted = mutedNotificationTypes(ctx)
  if (muted.length === 0) return { sql: '(1 = 1)', params: [] }
  return { sql: `(severity = 'critical' OR type NOT IN (${muted.map(() => '?').join(',')}))`, params: muted }
}

/** The complete visibility filter for one operator: what they may see, minus what they muted. */
function visibleClause(ctx: ServiceContext): { sql: string, params: string[] } {
  const permission = permissionClause(ctx)
  const mute = muteClause(ctx)
  return { sql: `(${permission.sql} AND ${mute.sql})`, params: [...permission.params, ...mute.params] }
}

export function notificationCounts(ctx: ServiceContext): NotificationCounts {
  const { sql, params } = visibleClause(ctx)
  const row = ctx.db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN is_read = 0 AND is_dismissed = 0 THEN 1 ELSE 0 END), 0) AS unread,
              COALESCE(SUM(CASE WHEN is_dismissed = 0 AND severity IN ('critical','warning') THEN 1 ELSE 0 END), 0) AS critical,
              COALESCE(SUM(CASE WHEN is_read = 0 AND is_dismissed = 0 AND severity IN ('critical','warning') THEN 1 ELSE 0 END), 0) AS unread_critical
         FROM notifications WHERE ${sql}`
    )
    .get(...params) as { total: number, unread: number, critical: number, unread_critical: number }
  return { total: row.total, unread: row.unread, critical: row.critical, unreadCritical: row.unread_critical }
}

export function listNotifications(
  ctx: ServiceContext,
  filter: { filter: 'all' | 'unread' | 'critical' | 'dismissed', limit: number, offset: number }
): { items: NotificationRecord[], total: number, counts: NotificationCounts } {
  const { sql, params } = visibleClause(ctx)
  const conditions = [sql]
  if (filter.filter === 'unread') conditions.push('is_read = 0', 'is_dismissed = 0')
  else if (filter.filter === 'critical') conditions.push('is_dismissed = 0', "severity IN ('critical','warning')")
  else if (filter.filter === 'dismissed') conditions.push('is_dismissed = 1')
  else conditions.push('is_dismissed = 0')

  const where = conditions.join(' AND ')
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM notifications WHERE ${where}`).get(...params) as { count: number }).count
  const rows = ctx.db
    .prepare(
      `SELECT id, type, severity, title, message, entity_type, entity_id, action_route, requires_permission, created_at,
              is_read, read_at, is_dismissed, dismissed_at
         FROM notifications WHERE ${where}
        ORDER BY is_read, (severity = 'critical') DESC, created_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(...params, filter.limit, filter.offset) as NotificationRow[]

  return { items: rows.map(mapRow), total, counts: notificationCounts(ctx) }
}

/* -------------------------------------------------------------------------- */
/* Mutating                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Loads a notification the signed-in operator is allowed to see. The router already requires a session;
 * scoping the lookup by the same permission clause as the list keeps the two consistent, so an id that
 * belongs to another operator's permission set answers "not found" instead of leaking its existence.
 */
function loadOwnNotification(ctx: ServiceContext, id: number): NotificationRecord {
  const { sql, params } = visibleClause(ctx)
  const row = ctx.db
    .prepare(
      `SELECT id, type, severity, title, message, entity_type, entity_id, action_route, requires_permission, created_at,
              is_read, read_at, is_dismissed, dismissed_at
         FROM notifications WHERE id = ? AND ${sql}`
    )
    .get(id, ...params) as NotificationRow | undefined
  if (!row) throw notFoundError('notification', id)
  return mapRow(row)
}

export function markNotificationRead(ctx: ServiceContext, id: number): void {
  loadOwnNotification(ctx, id)
  ctx.db.prepare('UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND is_read = 0').run(ctx.now(), id)
}

export function markAllNotificationsRead(ctx: ServiceContext): number {
  const { sql, params } = permissionClause(ctx)
  const result = ctx.db
    .prepare(`UPDATE notifications SET is_read = 1, read_at = ? WHERE is_read = 0 AND is_dismissed = 0 AND ${sql}`)
    .run(ctx.now(), ...params)
  return result.changes
}

export function setNotificationDismissed(ctx: ServiceContext, id: number, dismissed: boolean): void {
  loadOwnNotification(ctx, id)
  const at = ctx.now()
  ctx.db
    .prepare('UPDATE notifications SET is_dismissed = @dismissed, dismissed_at = @at, is_read = 1, read_at = COALESCE(read_at, @at) WHERE id = @id')
    .run({ id, dismissed: dismissed ? 1 : 0, at })
}
