import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationCounts,
  setNotificationDismissed,
  syncNotifications
} from '../../modules/notifications/service'
import { globalSearch } from '../../search/service'
import type { ServiceContext } from '../../context'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Notifications and global search.
 *
 * Both channels answer with what the signed-in operator may see: notifications are filtered by the
 * permission each row names, and search groups are skipped entirely when the operator cannot open them.
 * The bell and the palette therefore never advertise something that would be refused.
 */
export function createNotificationHandlers(deps: HandlerDeps): PartialHandlerMap {
  /** Keeps every window's badge in step after a read or dismiss action. */
  const publish = (ctx: ServiceContext): void => {
    deps.broadcast('notifications:changed', { unread: notificationCounts(ctx).unread })
  }

  return {
    'notifications.list': (ctx, input) => {
      /* Refresh from live data first: opening the centre always shows the current state of the clinic. */
      syncNotifications(ctx)
      return listNotifications(ctx, { filter: input.filter, limit: input.limit, offset: input.offset })
    },

    'notifications.summary': (ctx) => syncNotifications(ctx),

    'notifications.markRead': (ctx, input) => {
      markNotificationRead(ctx, input.id)
      publish(ctx)
      return { ok: true as const }
    },

    'notifications.markAllRead': (ctx) => {
      syncNotifications(ctx)
      const count = markAllNotificationsRead(ctx)
      publish(ctx)
      return { ok: true as const, count }
    },

    'notifications.dismiss': (ctx, input) => {
      setNotificationDismissed(ctx, input.id, !input.restore)
      publish(ctx)
      return { ok: true as const }
    },

    'search.global': (ctx, input) => globalSearch(ctx, { query: input.query, limitPerGroup: input.limitPerGroup })
  }
}
