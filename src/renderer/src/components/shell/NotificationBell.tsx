import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, X } from 'lucide-react'
import { Badge, IconButton } from '../ui/primitives'
import { toast } from '../ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import type { NotificationItem } from '../../lib/types'

/**
 * Notification bell.
 *
 * The badge counts what the signed-in operator may actually open, refreshes when the main process reports
 * a change and every minute while the window is open. Each entry opens the record it is about, is marked
 * read on the way and can be dismissed without leaving the popover.
 */

const SEVERITY_TONE: Record<string, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info'
}

export function NotificationBell(): ReactNode {
  const navigate = useNavigate()
  const format = useFormatters()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const summary = useInvoke('notifications.summary', {}, { pollMs: 60_000 })
  const list = useInvoke('notifications.list', { filter: 'unread', limit: 8, offset: 0 }, { enabled: open })

  const unread = summary.data?.unread ?? 0
  const critical = summary.data?.critical ?? 0

  useEffect(() => {
    const unsubscribe = window.dentiva.on('notifications:changed', () => {
      void summary.reload()
      if (open) void list.reload()
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const openItem = async (item: NotificationItem): Promise<void> => {
    setOpen(false)
    if (!item.isRead) {
      try {
        await invoke('notifications.markRead', { id: item.id })
      } catch (error) {
        toast('error', 'The notification could not be marked as read', errorMessage(error))
      }
    }
    if (item.actionRoute) navigate(item.actionRoute)
    else navigate('/notifications')
  }

  const dismiss = async (item: NotificationItem): Promise<void> => {
    try {
      await invoke('notifications.dismiss', { id: item.id, restore: false })
      await list.reload()
      await summary.reload()
    } catch (error) {
      toast('error', 'The notification could not be dismissed', errorMessage(error))
    }
  }

  const markAll = async (): Promise<void> => {
    try {
      const result = await invoke('notifications.markAllRead', {})
      toast('success', 'Notifications marked as read', `${result.count} notification(s) cleared.`)
      await list.reload()
      await summary.reload()
    } catch (error) {
      toast('error', 'Notifications could not be marked as read', errorMessage(error))
    }
  }

  return (
    <div className="popover-anchor" ref={containerRef}>
      <IconButton
        label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        icon={
          <span className="bell">
            <Bell size={18} />
            {critical > 0 ? <span className="bell__alert" aria-hidden="true" /> : null}
          </span>
        }
        onClick={() => setOpen((value) => !value)}
      />
      {unread > 0 ? (
        <span className="bell__count" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}

      {open ? (
        <div className="menu menu--wide" role="dialog" aria-label="Notifications">
          <div className="menu__label">
            Notifications
            <span className="muted small">{unread === 0 ? 'Nothing needs attention' : `${unread} unread · ${critical} needing attention`}</span>
          </div>

          {list.loading && !list.data ? <p className="menu__empty muted small">Loading…</p> : null}
          {list.data && list.data.items.length === 0 ? (
            <p className="menu__empty muted small">You are up to date. Nothing in the clinic needs attention right now.</p>
          ) : null}

          {list.data?.items.map((item) => (
            <div key={item.id} className="notification">
              <button type="button" className="notification__body" onClick={() => void openItem(item)}>
                <span className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <Badge tone={SEVERITY_TONE[item.severity] ?? 'neutral'}>{item.severity}</Badge>
                  <span className="link-strong">{item.title}</span>
                </span>
                <span className="muted small">{item.message}</span>
                <span className="muted small">{format.relative(item.createdAt)}</span>
              </button>
              <IconButton label={`Dismiss ${item.title}`} icon={<X size={15} />} onClick={() => void dismiss(item)} />
            </div>
          ))}

          <div className="menu__separator" />
          <div className="row" style={{ gap: 8, padding: '0 var(--sp-2)' }}>
            <button type="button" role="menuitem" className="menu__item" onClick={() => void markAll()} disabled={unread === 0}>
              <CheckCheck size={15} /> Mark all read
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu__item"
              onClick={() => {
                setOpen(false)
                navigate('/notifications')
              }}
            >
              View all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
