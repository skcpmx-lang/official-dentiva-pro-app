import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  ChevronsLeft,
  ChevronsRight,
  CalendarClock,
  Cog,
  DatabaseBackup,
  History,
  Printer,
  ListOrdered,
  BarChart3,
  Boxes,
  Calculator,
  Receipt,
  Truck,
  IdCard,
  Info,
  LayoutDashboard,
  Lock,
  LogOut,
  Pill,
  ScrollText,
  Search,
  ShieldCheck,
  Stethoscope,
  Tags,
  UserCog,
  Users,
  UsersRound
} from 'lucide-react'
import { useAppStore, useClinic, usePermission, useSession } from '../../store/appStore'
import { Badge, IconButton } from '../ui/primitives'
import { confirmDialog, toast } from '../ui/overlay'
import { invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { clearSessionState } from '../../store/appStore'

/**
 * Application shell.
 *
 * Holds the navigation rail (permission-filtered), the clinic identity, the global search entry point,
 * today's queue counters, the clock and the session controls. Navigation only lists screens that exist,
 * so a control can never lead to a dead end.
 */

interface NavEntry {
  to: string
  label: string
  icon: ReactNode
  permission?: string | string[]
  badge?: 'queue'
  end?: boolean
}

interface NavSection {
  title: string
  entries: NavEntry[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Practice',
    entries: [
      { to: '/', label: 'Dashboard', icon: <LayoutDashboard size={18} />, end: true },
      { to: '/patients', label: 'Patients', icon: <Users size={18} />, permission: 'patients.view' }
    ]
  },
  {
    title: 'Clinical',
    entries: [
      { to: '/appointments', label: 'Appointments', icon: <CalendarClock size={18} />, permission: 'appointments.view' },
      { to: '/queue', label: 'Queue', icon: <ListOrdered size={18} />, permission: 'queue.view', badge: 'queue' },
      { to: '/visits', label: 'Visits', icon: <Stethoscope size={18} />, permission: 'clinical.view' },
      { to: '/prescriptions', label: 'Prescriptions', icon: <Pill size={18} />, permission: 'prescriptions.view' },
      { to: '/treatments', label: 'Treatments', icon: <Tags size={18} />, permission: 'clinical.view' },
      { to: '/settings/dentists', label: 'Dentists', icon: <Stethoscope size={18} />, permission: 'settings.view' }
    ]
  },
  {
    title: 'Money',
    entries: [{ to: '/invoices', label: 'Invoices', icon: <Receipt size={18} />, permission: 'billing.view' }]
  },
  {
    title: 'Books',
    entries: [
      { to: '/accounting', label: 'Accounting', icon: <Calculator size={18} />, permission: 'accounting.view' },
      { to: '/reports', label: 'Reports', icon: <BarChart3 size={18} />, permission: 'reports.view' }
    ]
  },
  {
    title: 'Stock',
    entries: [
      { to: '/inventory', label: 'Inventory', icon: <Boxes size={18} />, permission: 'inventory.view' },
      { to: '/inventory/suppliers', label: 'Suppliers', icon: <Truck size={18} />, permission: 'suppliers.view' }
    ]
  },
  {
    title: 'Administration',
    entries: [
      { to: '/settings/staff', label: 'Staff', icon: <IdCard size={18} />, permission: 'staff.view' },
      { to: '/settings/users', label: 'Users', icon: <UserCog size={18} />, permission: 'users.view' },
      { to: '/settings/roles', label: 'Roles', icon: <UsersRound size={18} />, permission: 'roles.view' },
      { to: '/settings/printing', label: 'Printing', icon: <Printer size={18} />, permission: ['printing.configure', 'printing.print'] },
      { to: '/settings/backup', label: 'Backup & restore', icon: <DatabaseBackup size={18} />, permission: ['backups.create', 'backups.restore', 'backups.configure'] },
      { to: '/printing/history', label: 'Print history', icon: <History size={18} />, permission: 'printing.print' },
      { to: '/audit', label: 'Audit log', icon: <ScrollText size={18} />, permission: 'audit.view' },
      { to: '/settings', label: 'Settings', icon: <Cog size={18} />, permission: 'settings.view' },
      { to: '/about', label: 'About', icon: <Info size={18} /> }
    ]
  }
]

function initials(fullName: string): string {
  return (
    fullName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'DP'
  )
}

function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function AppShell(): ReactNode {
  const collapsed = useAppStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useAppStore((state) => state.toggleSidebar)
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen)
  const session = useSession()
  const clinic = useClinic()
  const formatters = useFormatters()
  const navigate = useNavigate()
  const clock = useClock()
  const canSeeQueue = usePermission('queue.view')
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  const queue = useInvoke('dashboard.queue', {}, { enabled: canSeeQueue, pollMs: 30_000 })
  const activeQueue = (queue.data?.waiting ?? 0) + (queue.data?.called ?? 0) + (queue.data?.inProgress ?? 0)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

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
    setMenuOpen(false)
    try {
      await invoke('auth.lock', {})
      useAppStore.getState().setLocked(true)
      navigate('/lock', { replace: true })
    } catch (error) {
      toast('error', 'The application could not be locked', error instanceof Error ? error.message : undefined)
    }
  }, [navigate])

  const handleSignOut = useCallback(async () => {
    setMenuOpen(false)
    const answer = await confirmDialog({
      title: 'Sign out of Dentiva Pro?',
      message: 'Unsaved changes in open forms will be lost. Your data stays on this computer.',
      confirmLabel: 'Sign out'
    })
    if (!answer.confirmed) return
    try {
      await invoke('auth.logout', {})
    } finally {
      clearSessionState()
      navigate('/login', { replace: true })
    }
  }, [navigate])

  return (
    <div className="app-shell" data-collapsed={collapsed ? 'true' : undefined}>
      <aside className="sidebar" data-collapsed={collapsed ? 'true' : undefined} aria-label="Main navigation">
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark" aria-hidden="true">
            <BrandMark />
          </span>
          <span className="sidebar__brand-text">
            <strong>Dentiva Pro</strong>
            <span>{clinic?.name || 'Dental practice suite'}</span>
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
                  end={entry.end}
                  className={({ isActive }) => `nav-item${isActive ? ' nav-item--active' : ''}`}
                  title={collapsed ? entry.label : undefined}
                >
                  {entry.icon}
                  <span className="nav-item__label">{entry.label}</span>
                  {entry.badge === 'queue' && activeQueue > 0 ? <span className="nav-item__badge">{activeQueue}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          {!collapsed ? (
            <div className="sidebar__user">
              <span className="avatar" aria-hidden="true">
                {initials(session?.fullName ?? '')}
              </span>
              <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                <strong className="truncate">{session?.fullName}</strong>
                <span className="truncate">{session?.roleCode.replace(/_/g, ' ')}</span>
              </span>
            </div>
          ) : null}
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon={collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
            onClick={toggleSidebar}
          />
        </div>
      </aside>

      <header className="app-header">
        <button type="button" className="app-header__search" onClick={() => setCommandPaletteOpen(true)} aria-label="Open search">
          <Search size={16} />
          <span className="grow">Search patients, invoices and prescriptions</span>
          <Badge tone="neutral">Ctrl K</Badge>
        </button>

        <div className="app-header__actions">
          <div className="app-header__clock" aria-hidden="true">
            <strong className="num">{formatters.time(clock.getTime())}</strong>
            <span className="muted">{formatters.date(clock.getTime())}</span>
          </div>

          {canSeeQueue ? (
            <NavLink to="/" className="chip" aria-label={`${activeQueue} patient(s) in the queue`}>
              Queue: <strong className="num">{activeQueue}</strong>
            </NavLink>
          ) : null}

          <IconButton label="Lock the application (Ctrl+L)" icon={<Lock size={18} />} onClick={() => void handleLock()} />

          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="avatar avatar--button"
              onClick={() => setMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="User menu"
            >
              {initials(session?.fullName ?? '')}
            </button>
            {menuOpen ? (
              <div className="menu" role="menu">
                <div className="menu__label">
                  {session?.fullName}
                  <span className="muted small">{session?.username}</span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  className="menu__item"
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/account/password')
                  }}
                >
                  <ShieldCheck size={15} /> Change password
                </button>
                {session?.permissions.includes('settings.view') ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="menu__item"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/settings')
                    }}
                  >
                    <Cog size={15} /> Settings
                  </button>
                ) : null}
                <div className="menu__separator" />
                <button type="button" role="menuitem" className="menu__item" onClick={() => void handleLock()}>
                  <Lock size={15} /> Lock application
                </button>
                <button type="button" role="menuitem" className="menu__item menu__item--danger" onClick={() => void handleSignOut()}>
                  <LogOut size={15} /> Sign out
                </button>
              </div>
            ) : null}
          </div>
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
