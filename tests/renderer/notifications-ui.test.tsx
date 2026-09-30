import { describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { NotificationBell } from '../../src/renderer/src/components/shell/NotificationBell'
import { NotificationsScreen } from '../../src/renderer/src/features/notifications/NotificationsScreen'
import { Toaster } from '../../src/renderer/src/components/ui/overlay'
import { useAppStore } from '../../src/renderer/src/store/appStore'
import { callLog, mockChannels } from './setup'
import type { NotificationCounts, NotificationItem, SessionSummary } from '../../src/renderer/src/lib/types'

/**
 * Notification bell and centre.
 *
 * The bell has to show the real badge, list what needs attention, and act on it: opening a record marks
 * it read, dismissing hides it, and “mark all read” clears the badge. The centre adds the filters and the
 * restore action for something dismissed by mistake.
 */

function signIn(): void {
  const session: SessionSummary = {
    id: 'session-notify',
    userId: 1,
    username: 'admin',
    fullName: 'Shohan Khan',
    roleCode: 'administrator',
    permissions: ['inventory.view', 'billing.view', 'appointments.view', 'backups.create'],
    locked: false,
    lastActivityAt: Date.now(),
    autoLockMinutes: 5,
    mustChangePassword: false
  }
  useAppStore.setState({ session, clinic: null, settings: {}, stage: 'ready', locked: false, commandPaletteOpen: false })
}

const items: NotificationItem[] = [
  {
    id: 21,
    type: 'stock.low',
    severity: 'warning',
    title: 'Composite resin is low on stock',
    message: '2 syringe in stock (reorder level 5). Code ITM-2026-0007.',
    entityType: 'inventory_item',
    entityId: 7,
    actionRoute: '/inventory/7',
    requiresPermission: 'inventory.view',
    createdAt: Date.UTC(2026, 9, 1, 9, 15),
    isRead: false,
    readAt: null,
    isDismissed: false,
    dismissedAt: null
  },
  {
    id: 22,
    type: 'billing.invoice-overdue',
    severity: 'warning',
    title: 'Invoice INV-2026-0042 is overdue',
    message: '৳ 1,200.00 is due from Rakib Hasan (payment was due 2026-09-01).',
    entityType: 'invoice',
    entityId: 42,
    actionRoute: '/invoices/42',
    requiresPermission: 'billing.view',
    createdAt: Date.UTC(2026, 9, 1, 8, 0),
    isRead: true,
    readAt: Date.UTC(2026, 9, 1, 8, 30),
    isDismissed: false,
    dismissedAt: null
  }
]

const counts: NotificationCounts = { unread: 1, critical: 1, unreadCritical: 1, total: 2 }

function LocationProbe(): ReactElement {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

function mockNotifications(list: NotificationItem[] = items): void {
  mockChannels({
    'notifications.summary': () => counts,
    'notifications.list': () => ({ items: list, total: list.length, counts }),
    'notifications.markRead': () => ({ ok: true as const }),
    'notifications.dismiss': () => ({ ok: true as const }),
    'notifications.markAllRead': () => ({ ok: true as const, count: 1 })
  })
}

describe('notification bell', () => {
  it('shows the unread badge, opens the list and acts on an entry', async () => {
    signIn()
    mockNotifications()
    render(
      <MemoryRouter initialEntries={['/']}>
        <NotificationBell />
        <LocationProbe />
        <Toaster />
      </MemoryRouter>
    )

    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
    expect(await screen.findByText('Composite resin is low on stock')).toBeInTheDocument()
    expect(screen.getByText(/Nothing needs attention|2 unread|1 unread/)).toBeTruthy()

    /* Opening a record marks it read and navigates to it. */
    await userEvent.click(screen.getByText('Composite resin is low on stock'))
    await waitFor(() => {
      expect(callLog.filter((entry) => entry.channel === 'notifications.markRead').at(-1)?.payload).toEqual({ id: 21 })
    })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/inventory/7'))

    /* Dismissing removes it from the list without touching the record. */
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Invoice INV-2026-0042 is overdue' }))
    await waitFor(() => {
      expect(callLog.filter((entry) => entry.channel === 'notifications.dismiss').at(-1)?.payload).toEqual({ id: 22, restore: false })
    })

    /* The popover is still open after dismissing; “mark all read” clears the badge. */
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mark all read' }))
    await waitFor(() => expect(callLog.some((entry) => entry.channel === 'notifications.markAllRead')).toBe(true))
  })
})

describe('notification centre', () => {
  it('filters, marks read, dismisses and restores', async () => {
    signIn()
    mockNotifications()
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <NotificationsScreen />
        <LocationProbe />
        <Toaster />
      </MemoryRouter>
    )

    expect(await screen.findByText('Composite resin is low on stock')).toBeInTheDocument()
    expect(screen.getByText('What needs attention')).toBeInTheDocument()
    expect(callLog.filter((entry) => entry.channel === 'notifications.list').at(-1)?.payload).toMatchObject({ filter: 'all' })

    /* The filter is sent to the main process, which applies it inside the permission scope. */
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }))
    await waitFor(() => {
      expect(callLog.filter((entry) => entry.channel === 'notifications.list').at(-1)?.payload).toMatchObject({ filter: 'unread' })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Mark Composite resin is low on stock as read' }))
    await waitFor(() => {
      expect(callLog.filter((entry) => entry.channel === 'notifications.markRead').at(-1)?.payload).toEqual({ id: 21 })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss Invoice INV-2026-0042 is overdue' }))
    await waitFor(() => {
      expect(callLog.filter((entry) => entry.channel === 'notifications.dismiss').at(-1)?.payload).toEqual({ id: 22, restore: false })
    })

    await userEvent.click(screen.getByRole('button', { name: 'Open Composite resin is low on stock' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/inventory/7'))
  })

  it('offers restore for something that was dismissed', async () => {
    signIn()
    mockNotifications([
      {
        ...items[0]!,
        id: 30,
        isRead: true,
        readAt: Date.UTC(2026, 9, 1, 10, 0),
        isDismissed: true,
        dismissedAt: Date.UTC(2026, 9, 1, 10, 5)
      }
    ])
    render(
      <MemoryRouter initialEntries={['/notifications']}>
        <NotificationsScreen />
        <Toaster />
      </MemoryRouter>
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Dismissed' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Restore Composite resin is low on stock' }))
    await waitFor(() => {
      expect(callLog.filter((entry) => entry.channel === 'notifications.dismiss').at(-1)?.payload).toEqual({ id: 30, restore: true })
    })
  })
})
