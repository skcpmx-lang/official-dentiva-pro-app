/**
 * Notification vocabulary.
 *
 * Shared because the main process derives the alerts, the preferences screen lets an operator mute
 * individual types, and the renderer labels them: one list keeps all three in step.
 */

export const NOTIFICATION_TYPES = {
  lowStock: 'stock.low',
  expiringStock: 'stock.expiring',
  expiredStock: 'stock.expired',
  overdueInvoice: 'billing.invoice-overdue',
  missedAppointment: 'appointments.missed',
  backupDue: 'backup.due'
} as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES]

export const NOTIFICATION_TYPE_VALUES: readonly string[] = Object.values(NOTIFICATION_TYPES)

export interface NotificationTypeDef {
  type: string
  label: string
  description: string
  /** True when the alert is only raised for a condition that must not be missed. */
  critical: boolean
}

export const NOTIFICATION_TYPE_DEFS: readonly NotificationTypeDef[] = [
  { type: NOTIFICATION_TYPES.lowStock, label: 'Low stock', description: 'An item reached its reorder level.', critical: false },
  { type: NOTIFICATION_TYPES.expiringStock, label: 'Stock near expiry', description: 'A batch expires within the warning window.', critical: false },
  { type: NOTIFICATION_TYPES.expiredStock, label: 'Stock expired', description: 'A batch in stock is past its expiry date.', critical: true },
  { type: NOTIFICATION_TYPES.overdueInvoice, label: 'Overdue invoices', description: 'An invoice passed its payment due date.', critical: false },
  { type: NOTIFICATION_TYPES.missedAppointment, label: 'Missed appointments', description: 'An appointment was never checked in or cancelled.', critical: false },
  { type: NOTIFICATION_TYPES.backupDue, label: 'Backup due', description: 'No backup has been taken within the configured interval.', critical: false }
] as const
