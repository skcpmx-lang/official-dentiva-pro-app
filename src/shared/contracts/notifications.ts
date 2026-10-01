import { z } from 'zod'
import { channel } from '../ipc'
import { zActionResult } from './system'

/**
 * Notification centre.
 *
 * A notification always points at the record it is about (entity + route) and names the permission that
 * reveals it, so the bell can never show a hint of data the signed-in operator may not open. Rows are
 * deduplicated by `dedupeKey`: the same low-stock item or overdue invoice updates one row instead of
 * piling up, and reading or dismissing it stays remembered.
 */

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'critical'] as const
export const zNotificationSeverity = z.enum(NOTIFICATION_SEVERITIES)

export const NOTIFICATION_FILTERS = ['all', 'unread', 'critical', 'dismissed'] as const
export const zNotificationFilter = z.enum(NOTIFICATION_FILTERS)

export const zNotification = z.object({
  id: z.number(),
  type: z.string(),
  severity: zNotificationSeverity,
  title: z.string(),
  message: z.string(),
  entityType: z.string().nullable(),
  entityId: z.number().nullable(),
  /** Renderer route that opens the record, e.g. `/invoices/12`. */
  actionRoute: z.string().nullable(),
  requiresPermission: z.string().nullable(),
  createdAt: z.number(),
  isRead: z.boolean(),
  readAt: z.number().nullable(),
  isDismissed: z.boolean(),
  dismissedAt: z.number().nullable()
})

export const zNotificationCounts = z.object({
  unread: z.number(),
  critical: z.number(),
  unreadCritical: z.number(),
  total: z.number()
})

export const notificationsChannels = {
  'notifications.list': channel(
    z
      .object({
        filter: zNotificationFilter.default('all'),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0)
      })
      .default({ filter: 'all', limit: 50, offset: 0 }),
    z.object({ items: z.array(zNotification), total: z.number(), counts: zNotificationCounts })
  ),
  /** Refreshes the operational notifications from live data and returns the badge counts. */
  'notifications.summary': channel(z.object({}).default({}), zNotificationCounts),
  'notifications.markRead': channel(z.object({ id: z.number().int().positive() }), zActionResult),
  'notifications.markAllRead': channel(z.object({}).default({}), z.object({ ok: z.literal(true), count: z.number() })),
  'notifications.dismiss': channel(
    z.object({ id: z.number().int().positive(), restore: z.boolean().default(false) }),
    zActionResult
  )
} as const
