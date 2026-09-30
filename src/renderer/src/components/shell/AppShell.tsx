import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  Boxes,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  Cog,
  CreditCard,
  FileText,
  Info,
  LayoutDashboard,
  ListOrdered,
  Lock,
  LogOut,
  Package,
  Pill,
  Receipt,
  ScrollText,
  Search,
  ShieldCheck,
  Stethoscope,
  Users,
  UsersRound
} from 'lucide-react'
import { useAppStore, usePermission } from '../../store/appStore'
import { IconButton, PopoverMenu, Badge } from '../ui/primitives'
import { api } from '../../lib/client'
import { useFormatters } from '../../lib/format'
import { confirmDialog, toast } from '../ui/overlay'
import type { SessionSummary } from '@shared/contracts'

/**
 * Application shell: sidebar (expandable 272 px ↔ 72 px), header with clinic identity, global search
 * entry point, notification centre, live clock, user menu and lock control. Navigation entries are
 * permission-filtered, and the shell never renders a screen the session cannot access.
 */

interface NavEntry {
  to: string
  label: string
  icon: ReactNode
  permission?: string | string[]
  badgeKey?: 'queue' | 'notifications'
}

interface NavSection {
  title: string
  entries: NavEntry[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Practice',
    entries: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
      { to: '/patients', label: 'Patients', icon: <Users size={18} />, permission: 'patients.view' },
      { to: '/appointments', label: 'Appointments', icon: <CalendarDays size={18} />, permission: 'appointments.view' },
      { to: '/queue', label: 'Queue', icon: <ListOrdered size={18} />, permission: 'queue.view', badgeKey: 'queue' }
    ]
  },
  {
    title: 'Clinical',
    entries: [
      { to: '/treatments', label: 'Treatments', icon: <Stethoscope size={18} />, permission: ['clinical.view', 'prescriptions.view'] },
      { to: '/prescriptions', label: 'Prescriptions', icon: <Pill size={18} />, permission: 'prescriptions.view' },
      { to: '/clinical/catalog', label: 'Clinical catalog', icon: <ClipboardList size={18} />, permission: 'clinical.view' }
    ]
  },
  {
    title: 'Billing',
    entries: [
      { to: '/invoices', label: 'Invoices', icon: <Receipt size={18} />, permission: 'billing.view' },
      { to: '/payments', label: 'Payments', icon: <CreditCard size={18} />, permission: 'payments.view' },
      { to: '/inventory', label: 'Inventory', icon: <Package size={18} />, permission: 'inventory.view' },
      { to: '/suppliers', label: 'Suppliers', icon: <Boxes size={18} />, permission: 'suppliers.view' },
      { to: '/accounting', label: 'Accounting', icon: <BarChart3 size={18} />, permission: 'accounting.view' },
      { to: '/reports', label: 'Reports', icon: <FileText size={18} />, permission: 'reports.view' }
    ]
  },
  {
    title: 'Administration',
    entries: [
      { to: '/staff', label: 'Staff & Users', icon: <UsersRound size={18} />, permission: ['staff.view', 'users.view'] },
      { to: '/audit', label: 'Audit log', icon: <ScrollText size={18} />, permission: 'audit.view' },
      { to: '/backup', label: 'Backup & restore', icon: <ShieldCheck size={18} />, permission: ['backups.create', 'backups.restore', 'backups.configure'] },
      { to: '/settings', label: 'Settings', icon: <Cog size={18} />, permission: 'settings.view' },
      { to: '/about', label: 'About', icon: <Info size={18} /> }
    ]
  }
]

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function AppShell(): ReactNode {
  const collapsed = useAppStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const session = useAppStore((state) => state.session)
  const clinic = useAppStore((state) => state.clinic)
  const notifications = useAppStore((state) => state.notifications)
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen)
  const setSession = useAppStore((state) => state.setSession)
  const setLocked = useAppStore((state) => state.setLocked)
  const pushToast = useAppStore((state) => state.pushToast)
  const formatters = useFormatters()
  const navigate = useNavigate()
  const location = useLocation()
  const clock = useClock()
  const [queueCount, setQueueCount] = useState(0)

  const canViewQueue = usePermission('queue.view')

  useEffect(() => {
    if (!canViewQueue) {
      setQueueCount(0)
      return
    }
    let active = true
    const load = async (): Promise<void> => {
      try {
        const summary = await api.queueSummary()
        if (active) setQueueCount(summary.waiting + summary.called + summary.inProgress)
      } catch {
        /* the badge is informational; failures are surfaced on the queue screen itself */
      }
    }
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [canViewQueue])

  const sections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        entries: section.entries.filter((entry) => {
          if (!entry.permission) return true
          const codes = Array.isArray(entry.permission) ? entry.permission : [entry.permission]
          return codes.some((code) => session?.permissions.includes(code))
        })
      })).filter((section) => section.entries.length > 0),
    [session]
  )

  const handleLock = useCallback(async () => {
    try {
      await api.lock()
      setLocked(true)
    } catch {
      pushToast({ kind: 'error', title: 'The application could not be locked', message: 'Please try again.' })
    }
  }, [setLocked, pushToast])

  const handleSignOut = useCallback(async () => {
    const confirmed = await confirmDialog({
      title: 'Sign out of Dentiva Pro?',
      message: 'Any unsaved changes in open forms will be lost.',
      confirmLabel: 'Sign out'
    })
    if (!confirmed) return
    await api.logout()
    setSession(null)
    setLocked(false)
    navigate('/login', { replace: true })
  }, [navigate, setSession, setLocked])

  const handleChangePassword = useCallback(() => {
    navigate('/account/password')
  }, [navigate])

  return (
    <div className="app-shell" data-collapsed={collapsed}>
      <aside className="sidebar" data-collapsed={collapsed} aria-label="Main navigation">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <span className="sidebar__brand-text">
            <strong>Dentiva Pro</strong>
            <span>Dental practice suite</span>
          </span>
        </div>

        <nav className="sidebar__nav">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="sidebar__section">{section.title}</div>
              {section.entries.map((entry) => (
                <NavLink
                  key={entry.to}
                  to={entry.to}
                  end={entry.to === '/'}
                  className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
                  title={collapsed ? entry.label : undefined}
                  aria-current={location.pathname === entry.to ? 'page' : undefined}
                >
                  {entry.icon}
                  <span className="nav-item__label">{entry.label}</span>
                  {entry.badgeKey === 'queue' && queueCount > 0 ? <span className="nav-item__badge">{queueCount}</span> : null}
                  {entry.badgeKey === 'notifications' && notifications.unread > 0 ? (
                    <span className="nav-item__badge">{notifications.unread}</span>
                  ) : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="sidebar__user">
            <span className="avatar" aria-hidden="true">
              {initials(session?.fullName ?? '')}
            </span>
            {!collapsed ? (
              <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                <strong style={{ fontSize: 12.5, color: '#fff' }} className="truncate">
                  {session?.fullName}
                </strong>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.6)' }}>{session?.roleCode.replace(/_/g, ' ')}</span>
              </span>
            ) : null}
          </div>
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon={collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
            onClick={toggleSidebar}
            aria-expanded={!collapsed}
            variant="ghost"
          />
        </div>
      </aside>

      <header className="app-header">
        <div className="app-header__brand">
          <div className="app-header__clinic">
            <strong className="truncate">{clinic?.name || 'Dentiva Pro'}</strong>
            <span className="small muted truncate">{clinic?.phone ?? 'Offline clinic suite'}</span>
          </div>
        </div>

        <button type="button" className="app-header__search" onClick={() => setCommandPaletteOpen(true)} aria-label="Global search">
          <Search size={16} />
          <span className="grow">Search patients, invoices, prescriptions…</span>
          <Badge tone="neutral">Ctrl K</Badge>
        </button>

        <div className="app-header__actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={`Notifications (${notifications.unread} unread)`}
            onClick={() => navigate('/notifications')}
          >
            <Activity size={18} />
            {notifications.unread > 0 ? <span className="icon-btn__dot">{notifications.unread > 9 ? '9+' : notifications.unread}</span> : null}
          </button>

          <div className="app-header__clock" aria-live="off">
            <strong>{formatters.time(clock.getTime())}</strong>
            <span>{formatters.date(clock.getTime())}</span>
          </div>

          <IconButton label="Lock the application (Ctrl+L)" icon={<Lock size={18} />} onClick={handleLock} />

          <PopoverMenu
            trigger={({ toggle }) => (
              <button type="button" className="icon-btn" onClick={toggle} aria-label="User menu" aria-haspopup="menu">
                <span className="avatar" style={{ background: 'var(--brand-600)' }}>
                  {initials(session?.fullName ?? '')}
                </span>
              </button>
            )}
          >
            <div className="menu__label">{session?.fullName}</div>
            <button type="button" className="menu__item" onClick={handleChangePassword}>
              <ShieldCheck size={15} /> Change password
            </button>
            <button type="button" className="menu__item" onClick={() => navigate('/settings')}>
              <Cog size={15} /> Settings
            </button>
            <div className="menu__separator" />
            <button type="button" className="menu__item" onClick={() => void handleLock()}>
              <Lock size={15} /> Lock application
            </button>
            <button type="button" className="menu__item menu__item--danger" onClick={() => void handleSignOut()}>
              <LogOut size={15} /> Sign out
            </button>
          </PopoverMenu>
        </div>
      </header>

      <main className="main" id="main-content">
        <Outlet />
      </main>
    </div>
  )
}

function BrandMark(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 3.2c-1.6 0-2.3.7-3.6.7-1 0-1.9-.5-2.7 0C4.3 4.8 4 7.1 4.4 9.4c.3 1.7.9 2.3 1.3 4 .3 1.3.4 3.1 1.2 4.5.6 1.1 2 1.2 2.5-.1.4-1 .5-2.6.9-3.6.3-.9 1.1-1.4 1.7-1.4s1.4.5 1.7 1.4c.4 1 .5 2.6.9 3.6.5 1.3 1.9 1.2 2.5.1.8-1.4.9-3.2 1.2-4.5.4-1.7 1-2.3 1.3-4 .4-2.3.1-4.6-1.3-5.5-.8-.5-1.7 0-2.7 0-1.3 0-2-.7-3.6-.7z"
        fill="#fff"
        opacity="0.95"
      />
    </svg>
  )
}

export function useSessionSummary(): SessionSummary | null {
  return useAppStore((state) => state.session)
}
