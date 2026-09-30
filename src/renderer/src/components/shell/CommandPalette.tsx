import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CalendarClock, Cog, LayoutDashboard, ListOrdered, Lock, LogOut, Pill, ScrollText, Search, Tags, UserCog, Users } from 'lucide-react'
import { useAppStore, usePermission } from '../../store/appStore'
import { Modal } from '../ui/overlay'
import { invoke } from '../../lib/api'
import { clearSessionState } from '../../store/appStore'

/**
 * Command palette (Ctrl+K).
 *
 * Every entry performs a real action: navigating to a screen the operator is allowed to open, or
 * locking / signing out of the application. Entries are filtered by permission, so the palette never
 * offers something that would be refused.
 */

interface Command {
  id: string
  label: string
  hint?: string
  icon: ReactNode
  permission?: string
  run(): void | Promise<void>
}

export function CommandPalette(): ReactNode {
  const open = useAppStore((state) => state.commandPaletteOpen)
  const setOpen = useAppStore((state) => state.setCommandPaletteOpen)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const canViewPatients = usePermission('patients.view')
  const canViewUsers = usePermission('users.view')
  const canViewSettings = usePermission('settings.view')
  const canViewAudit = usePermission('audit.view')

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
      setActive(0)
      window.setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'dashboard', label: 'Go to dashboard', icon: <LayoutDashboard size={16} />, run: () => navigate('/') },
      {
        id: 'patients',
        label: 'Go to patients',
        icon: <Users size={16} />,
        permission: 'patients.view',
        run: () => navigate('/patients')
      },
      {
        id: 'new-patient',
        label: 'Register a new patient',
        hint: 'Patients › New',
        icon: <Users size={16} />,
        permission: 'patients.create',
        run: () => navigate('/patients/new')
      },
      { id: 'appointments', label: 'Go to the appointment book', icon: <CalendarClock size={16} />, permission: 'appointments.view', run: () => navigate('/appointments') },
      { id: 'queue', label: 'Go to the waiting queue', icon: <ListOrdered size={16} />, permission: 'queue.view', run: () => navigate('/queue') },
      { id: 'visits', label: 'Go to visits', icon: <CalendarClock size={16} />, permission: 'clinical.view', run: () => navigate('/visits') },
      { id: 'prescriptions', label: 'Go to prescriptions', icon: <Pill size={16} />, permission: 'prescriptions.view', run: () => navigate('/prescriptions') },
      { id: 'new-prescription', label: 'Write a new prescription', hint: 'Prescriptions › New', icon: <Pill size={16} />, permission: 'prescriptions.create', run: () => navigate('/prescriptions/new') },
      { id: 'treatments', label: 'Go to the treatment catalogue', icon: <Tags size={16} />, permission: 'clinical.view', run: () => navigate('/treatments') },
      { id: 'users', label: 'Go to users', icon: <UserCog size={16} />, permission: 'users.view', run: () => navigate('/settings/users') },
      { id: 'settings', label: 'Go to settings', icon: <Cog size={16} />, permission: 'settings.view', run: () => navigate('/settings') },
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
    return list.filter((command) => {
      if (!command.permission) return true
      if (command.permission === 'patients.view') return canViewPatients
      if (command.permission === 'users.view') return canViewUsers
      if (command.permission === 'settings.view') return canViewSettings
      if (command.permission === 'audit.view') return canViewAudit
      return true
    })
  }, [canViewPatients, canViewSettings, canViewUsers, canViewAudit, navigate])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle) || command.hint?.toLowerCase().includes(needle))
  }, [commands, query])

  if (!open) return null

  const runCommand = async (command: Command): Promise<void> => {
    setOpen(false)
    await command.run()
  }

  return (
    <Modal
      open
      size="sm"
      title="Search and commands"
      description="Type to filter. Press Enter to run the highlighted command."
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
              setActive((value) => Math.min(value + 1, filtered.length - 1))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActive((value) => Math.max(value - 1, 0))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const command = filtered[active]
              if (command) void runCommand(command)
            }
          }}
          placeholder="What do you want to do?"
          aria-label="Command"
        />
      </div>

      <ul className="command-list" role="listbox" aria-label="Commands">
        {filtered.length === 0 ? (
          <li className="muted small" style={{ padding: 'var(--sp-3)' }}>
            No command matches “{query}”.
          </li>
        ) : (
          filtered.map((command, index) => (
            <li key={command.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={`command-list__item${index === active ? ' command-list__item--active' : ''}`}
                onMouseEnter={() => setActive(index)}
                onClick={() => void runCommand(command)}
              >
                {command.icon}
                <span className="grow">{command.label}</span>
                {command.hint ? <span className="muted small">{command.hint}</span> : <ArrowRight size={14} className="muted" />}
              </button>
            </li>
          ))
        )}
      </ul>
    </Modal>
  )
}
