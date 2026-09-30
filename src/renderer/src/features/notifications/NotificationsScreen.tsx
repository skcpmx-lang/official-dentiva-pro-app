import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, CheckCheck, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Segmented } from '../../components/ui/primitives'
import { toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import type { NotificationFilter, NotificationItem } from '../../lib/types'

/**
 * Notification centre.
 *
 * The full history of what the clinic is being told to look at, with the filters an operator needs at the
 * start of a shift: everything live, only unread, only the ones that need attention, and what has been
 * dismissed. Each row opens the record it is about; dismissing hides it without deleting anything.
 */

const FILTERS: Array<{ value: NotificationFilter, label: string }> = [
  { value: 'all', label: 'Live' },
  { value: 'unread', label: 'Unread' },
  { value: 'critical', label: 'Needs attention' },
  { value: 'dismissed', label: 'Dismissed' }
]

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info'
}

export function NotificationsScreen(): ReactNode {
  const navigate = useNavigate()
  const format = useFormatters()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [busyId, setBusyId] = useState<number | null>(null)

  const page = useInvoke('notifications.list', { filter, limit: 100, offset: 0 })

  const counts = page.data?.counts ?? { unread: 0, critical: 0, unreadCritical: 0, total: 0 }

  const emptyMessage = useMemo(() => {
    if (filter === 'dismissed') return 'Nothing has been dismissed yet.'
    if (filter === 'unread') return 'Every notification has been read.'
    if (filter === 'critical') return 'Nothing needs attention right now.'
    return 'The clinic has nothing that needs attention: stock levels, expiry dates, dues and the backup schedule are all in order.'
  }, [filter])

  const act = async (item: NotificationItem, action: 'read' | 'dismiss' | 'restore'): Promise<void> => {
    setBusyId(item.id)
    try {
      if (action === 'read') await invoke('notifications.markRead', { id: item.id })
      else await invoke('notifications.dismiss', { id: item.id, restore: action === 'restore' })
      await page.reload()
    } catch (error) {
      toast('error', 'The notification could not be updated', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const markAll = async (): Promise<void> => {
    try {
      const result = await invoke('notifications.markAllRead', {})
      toast('success', 'Notifications marked as read', `${result.count} notification(s) cleared.`)
      await page.reload()
    } catch (error) {
      toast('error', 'Notifications could not be marked as read', errorMessage(error))
    }
  }

  const open = async (item: NotificationItem): Promise<void> => {
    if (!item.isRead) await act(item, 'read')
    if (item.actionRoute) navigate(item.actionRoute)
  }

  return (
    <div className="page">
      <PageHeader
        title="Notifications"
        subtitle="Raised from live clinic data — stock, expiry, dues, appointments and backups."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Button variant="tertiary" icon={<RefreshCw size={16} />} onClick={() => void page.reload()} loading={page.loading}>
              Refresh
            </Button>
            <Button variant="secondary" icon={<CheckCheck size={16} />} onClick={() => void markAll()} disabled={counts.unread === 0}>
              Mark all read
            </Button>
          </div>
        }
      />

      <Card>
        <CardHeader
          title="What needs attention"
          subtitle={
            counts.unread === 0
              ? 'Nothing is waiting to be read.'
              : `${counts.unread} unread · ${counts.critical} needing attention`
          }
          actions={<Segmented options={FILTERS} value={filter} onChange={(value) => setFilter(value as NotificationFilter)} ariaLabel="Notification filter" />}
        />
        <CardBody>
          {page.loading && !page.data ? <p className="muted">Loading…</p> : null}

          {page.data && page.data.items.length === 0 ? (
            <div className="empty-state">
              <BellOff size={28} aria-hidden="true" />
              <p className="muted">{emptyMessage}</p>
            </div>
          ) : null}

          {page.data && page.data.items.length > 0 ? (
            <ul className="plain-list">
              {page.data.items.map((item) => (
                <li key={item.id} className={`plain-list__item notification-row${item.isDismissed ? ' notification-row--muted' : ''}`}>
                  <span className="stack" style={{ gap: 4 }}>
                    <span className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge tone={SEVERITY_TONE[item.severity] ?? 'neutral'}>{item.severity}</Badge>
                      <span className="link-strong">{item.title}</span>
                      {!item.isRead && !item.isDismissed ? <Badge tone="info">unread</Badge> : null}
                      {item.isDismissed ? <Badge tone="neutral">dismissed</Badge> : null}
                    </span>
                    <span className="muted small">{item.message}</span>
                    <span className="muted small">
                      {format.dateTime(item.createdAt)}
                      {item.requiresPermission ? ` · needs “${item.requiresPermission}”` : ''}
                    </span>
                  </span>

                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {item.actionRoute ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ExternalLink size={15} />}
                        aria-label={`Open ${item.title}`}
                        onClick={() => void open(item)}
                        loading={busyId === item.id}
                      >
                        Open
                      </Button>
                    ) : null}
                    {!item.isRead && !item.isDismissed ? (
                      <Button size="sm" variant="ghost" icon={<CheckCheck size={15} />} aria-label={`Mark ${item.title} as read`} onClick={() => void act(item, 'read')}>
                        Read
                      </Button>
                    ) : null}
                    {item.isDismissed ? (
                      <Button size="sm" variant="ghost" icon={<RotateCcw size={15} />} aria-label={`Restore ${item.title}`} onClick={() => void act(item, 'restore')}>
                        Restore
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" icon={<BellOff size={15} />} aria-label={`Dismiss ${item.title}`} onClick={() => void act(item, 'dismiss')}>
                        Dismiss
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}
