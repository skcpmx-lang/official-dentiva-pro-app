import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Calculator,
  CalendarClock,
  Cog,
  DatabaseBackup,
  History,
  IdCard,
  LayoutDashboard,
  ListOrdered,
  Lock,
  LogOut,
  Pill,
  Printer,
  Receipt,
  ScrollText,
  Search,
  Tags,
  Truck,
  UserCog,
  Users
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { Modal } from '../ui/overlay'
import { invoke, useInvoke } from '../../lib/api'
import { clearSessionState } from '../../store/appStore'
import type { SearchGroup } from '../../lib/types'

/**
 * Command palette and global search (Ctrl+K).
 *
 * With an empty box it offers actions: navigating to a screen the operator may open, locking, signing
 * out. As soon as something is typed it searches the clinic — patients, appointments, invoices, payments,
 * prescriptions, visits, treatments, stock, suppliers, staff and the ledger — and groups the results the
 * way a receptionist thinks about them. Groups the operator may not open are never returned by the main
 * process, so nothing here can offer a record that would be refused.
 */

interface Command {
  id: string
  label: string
  hint?: string
  icon: ReactNode
  permission?: string
  run(): void | Promise<void>
}

interface Row {
  key: string
  kind: 'group' | 'result' | 'command'
  label: string
  meta?: string | null
  groupLabel?: string
  icon?: ReactNode
  act?(): void | Promise<void>
}

const DEBOUNCE_MS = 220

export function CommandPalette(): ReactNode {
  const open = useAppStore((state) => state.commandPaletteOpen)
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen)
  const permissions = useAppStore((state) => state.session?.permissions ?? [])
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!useAppStore.getState().commandPaletteOpen)
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault()
        void (async () => {
          await invoke('auth.lock', {})
          useAppStore.getState().setLocked(true)
          navigate('/lock', { replace: true })
        })()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [navigate, setOpen])

  useEffect(() => {
    if (open) {
      setQuery('')
      setDebounced('')
      setActive(0)
      window.setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS)
    return () => window.clearTimeout(handle)
  }, [query])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'dashboard', label: 'Go to dashboard', icon: <LayoutDashboard size={16} />, run: () => navigate('/') },
      { id: 'patients', label: 'Go to patients', icon: <Users size={16} />, permission: 'patients.view', run: () => navigate('/patients') },
      { id: 'new-patient', label: 'Register a new patient', hint: 'Patients › New', icon: <Users size={16} />, permission: 'patients.create', run: () => navigate('/patients/new') },
      { id: 'appointments', label: 'Go to the appointment book', icon: <CalendarClock size={16} />, permission: 'appointments.view', run: () => navigate('/appointments') },
      { id: 'queue', label: 'Go to the waiting queue', icon: <ListOrdered size={16} />, permission: 'queue.view', run: () => navigate('/queue') },
      { id: 'visits', label: 'Go to visits', icon: <CalendarClock size={16} />, permission: 'clinical.view', run: () => navigate('/visits') },
      { id: 'prescriptions', label: 'Go to prescriptions', icon: <Pill size={16} />, permission: 'prescriptions.view', run: () => navigate('/prescriptions') },
      { id: 'new-prescription', label: 'Write a new prescription', hint: 'Prescriptions › New', icon: <Pill size={16} />, permission: 'prescriptions.create', run: () => navigate('/prescriptions/new') },
      { id: 'treatments', label: 'Go to the treatment catalogue', icon: <Tags size={16} />, permission: 'clinical.view', run: () => navigate('/treatments') },
      { id: 'invoices', label: 'Go to invoices', icon: <Receipt size={16} />, permission: 'billing.view', run: () => navigate('/invoices') },
      { id: 'dues', label: 'Show invoices with dues', icon: <Receipt size={16} />, permission: 'billing.view', run: () => navigate('/invoices?hasDue=1') },
      { id: 'inventory', label: 'Go to inventory', icon: <Boxes size={16} />, permission: 'inventory.view', run: () => navigate('/inventory') },
      { id: 'accounting', label: 'Go to accounting', icon: <Calculator size={16} />, permission: 'accounting.view', run: () => navigate('/accounting') },
      { id: 'reports', label: 'Open reports', icon: <BarChart3 size={16} />, permission: 'reports.view', run: () => navigate('/reports') },
      { id: 'suppliers', label: 'Go to suppliers and purchases', icon: <Truck size={16} />, permission: 'suppliers.view', run: () => navigate('/inventory/suppliers') },
      { id: 'staff', label: 'Go to staff register', icon: <IdCard size={16} />, permission: 'staff.view', run: () => navigate('/settings/staff') },
      { id: 'users', label: 'Go to users', icon: <UserCog size={16} />, permission: 'users.view', run: () => navigate('/settings/users') },
      { id: 'settings', label: 'Go to settings', icon: <Cog size={16} />, permission: 'settings.view', run: () => navigate('/settings') },
      { id: 'notifications', label: 'Open the notification centre', icon: <ScrollText size={16} />, run: () => navigate('/notifications') },
      { id: 'printing', label: 'Go to printing settings', icon: <Printer size={16} />, permission: 'printing.configure', run: () => navigate('/settings/printing') },
      { id: 'print-history', label: 'Open the print history', icon: <History size={16} />, permission: 'printing.print', run: () => navigate('/printing/history') },
      { id: 'backup', label: 'Go to backup & restore', icon: <DatabaseBackup size={16} />, permission: 'backups.create', run: () => navigate('/settings/backup') },
      { id: 'audit', label: 'Go to the audit log', icon: <ScrollText size={16} />, permission: 'audit.view', run: () => navigate('/audit') },
      {
        id: 'lock',
        label: 'Lock the application',
        hint: 'Ctrl+L',
        icon: <Lock size={16} />,
        run: async () => {
          await invoke('auth.lock', {})
          useAppStore.getState().setLocked(true)
          navigate('/lock', { replace: true })
        }
      },
      {
        id: 'signout',
        label: 'Sign out',
        icon: <LogOut size={16} />,
        run: async () => {
          await invoke('auth.logout', {})
          clearSessionState()
          navigate('/login', { replace: true })
        }
      }
    ]
    /* Filter with the real permission set: a command the operator cannot run is never offered. */
    return list.filter((command) => !command.permission || permissions.includes(command.permission))
  }, [navigate, permissions])

  const commandMatches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle) || command.hint?.toLowerCase().includes(needle))
  }, [commands, query])

  const searching = debounced.length > 0
  const search = useInvoke('search.global', { query: debounced, limitPerGroup: 5 }, { enabled: searching })

  const closeAndRun = async (action: () => void | Promise<void>): Promise<void> => {
    setOpen(false)
    await action()
  }

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = []
    if (searching && search.data) {
      for (const group of search.data.groups as SearchGroup[]) {
        list.push({ key: `group-${group.key}`, kind: 'group', label: group.label })
        for (const item of group.items) {
          list.push({
            key: `result-${group.key}-${item.id}`,
            kind: 'result',
            label: item.title,
            meta: item.meta ?? item.subtitle,
            groupLabel: group.label,
            act: () => navigate(item.route)
          })
        }
      }
    }
    for (const command of commandMatches) {
      list.push({ key: `command-${command.id}`, kind: 'command', label: command.label, meta: command.hint ?? null, icon: command.icon, act: () => command.run() })
    }
    return list
  }, [searching, search.data, commandMatches, navigate])

  /* Keyboard navigation walks the actionable rows only; group headings are skipped. */
  const actionable = useMemo(() => rows.filter((row) => row.kind !== 'group'), [rows])
  const activeRow = actionable[Math.min(active, Math.max(actionable.length - 1, 0))]

  useEffect(() => {
    setActive(0)
  }, [debounced])

  if (!open) return null

  const move = (delta: number): void => {
    if (actionable.length === 0) return
    setActive((value) => (value + delta + actionable.length) % actionable.length)
  }

  const searchFailed = searching && search.error !== null
  const nothing = actionable.length === 0 && !search.loading

  return (
    <Modal
      open
      size="sm"
      title="Search and commands"
      description="Type to search patients, appointments, invoices, stock and more. Enter opens the highlighted row."
      onClose={() => setOpen(false)}
    >
      <div className="field__control" style={{ marginBottom: 'var(--sp-3)' }}>
        <Search size={16} className="field__icon" aria-hidden="true" />
        <input
          ref={inputRef}
          className="field__input"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setActive(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              move(1)
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              move(-1)
            } else if (event.key === 'Enter') {
              event.preventDefault()
              if (activeRow?.act) void closeAndRun(activeRow.act)
            }
          }}
          placeholder="Search patients, invoices, stock… or type a command"
          aria-label="Search the clinic"
          role="combobox"
          aria-expanded
          aria-controls="command-list"
          aria-activedescendant={activeRow ? `row-${activeRow.key}` : undefined}
        />
      </div>

      {searching ? (
        <p className="muted small" style={{ padding: '0 var(--sp-3) var(--sp-2)' }} role="status">
          {search.loading
            ? 'Searching…'
            : searchFailed
              ? 'Search is unavailable right now. Showing commands instead.'
              : `${search.data?.total ?? 0} match(es) for “${debounced}”.`}
        </p>
      ) : null}

      <ul className="command-list" id="command-list" role="listbox" aria-label="Search results and commands">
        {nothing ? (
          <li className="muted small" style={{ padding: 'var(--sp-3)' }}>
            {searching ? `Nothing matches “${debounced}”.` : 'Type to search, or pick an action.'}
          </li>
        ) : (
          rows.map((row) => {
            if (row.kind === 'group') {
              return (
                <li key={row.key} className="command-list__group" role="presentation">
                  {row.label}
                </li>
              )
            }
            const index = actionable.findIndex((entry) => entry.key === row.key)
            const selected = index === active
            return (
              <li key={row.key}>
                <button
                  id={`row-${row.key}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`command-list__item${selected ? ' command-list__item--active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => row.act && void closeAndRun(row.act)}
                >
                  {row.icon ?? <ArrowRight size={14} className="muted" />}
                  <span className="grow">{row.label}</span>
                  {row.meta ? <span className="muted small">{row.meta}</span> : null}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </Modal>
  )
}
