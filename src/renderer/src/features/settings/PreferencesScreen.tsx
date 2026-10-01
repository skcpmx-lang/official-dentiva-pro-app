import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ArrowUp, BellRing, LayoutDashboard, RotateCcw, Save } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, Checkbox, PageHeader, Toolbar } from '../../components/ui/primitives'
import { Select } from '../../components/ui/form'
import { confirmDanger, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { usePermission, useSession } from '../../store/appStore'
import { DASHBOARD_PANELS, type DashboardRange } from '@shared/preferences'
import { NOTIFICATION_TYPE_DEFS } from '@shared/notifications'
import type { RecentEntry } from '../../lib/types'

/**
 * My preferences.
 *
 * Everything on this screen is per account: the dashboard layout and period, which alerts reach this
 * operator's bell, and the list of records this login opened last. The values are validated in the main
 * process against the same catalogues the screens render from, so a panel or an alert type offered here
 * is one the application really knows how to draw.
 */

const RANGE_OPTIONS: Array<{ value: DashboardRange, label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' }
]

const KIND_LABELS: Record<RecentEntry['kind'], string> = {
  patient: 'Patient',
  invoice: 'Invoice',
  prescription: 'Prescription'
}

function readJsonArray(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

export function PreferencesScreen(): ReactNode {
  const session = useSession()
  const canSeeBilling = usePermission('billing.view')
  const canSeeSchedule = usePermission('appointments.view')
  const canSeeInventory = usePermission('inventory.view')
  const canSeeClinical = usePermission('clinical.view')
  const canSeeQueue = usePermission('queue.view')
  const canSeeAudit = usePermission('audit.view')

  const saved = useInvoke('preferences.get', {})
  const recent = useInvoke('preferences.recent', { limit: 8 })

  const [range, setRange] = useState<DashboardRange>('last30')
  const [panels, setPanels] = useState<string[]>([])
  const [muted, setMuted] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  /* Panels this operator is allowed to place: an unpermitted one would only ever render as a blank. */
  const offered = useMemo(
    () =>
      DASHBOARD_PANELS.filter((panel) => {
        switch (panel.permission) {
          case null:
            return true
          case 'billing.view':
            return canSeeBilling
          case 'appointments.view':
            return canSeeSchedule
          case 'clinical.view':
            return canSeeClinical
          case 'inventory.view':
            return canSeeInventory
          case 'queue.view':
            return canSeeQueue
          case 'audit.view':
            return canSeeAudit
          default:
            return false
        }
      }),
    [canSeeAudit, canSeeBilling, canSeeClinical, canSeeInventory, canSeeQueue, canSeeSchedule]
  )

  useEffect(() => {
    if (!saved.data) return
    const storedRange = saved.data['dashboard.range'] as DashboardRange | undefined
    if (storedRange) setRange(storedRange)
    setPanels(readJsonArray(saved.data['dashboard.panels']))
    setMuted(readJsonArray(saved.data['notifications.muted']))
  }, [saved.data])

  /* A fresh account has nothing stored: the offered panels start selected, in catalogue order. */
  const selected = panels.length > 0 ? panels : offered.map((panel) => panel.id)

  const move = (id: string, direction: -1 | 1): void => {
    const order = [...selected]
    const index = order.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= order.length) return
    const [entry] = order.splice(index, 1)
    order.splice(target, 0, entry!)
    setPanels(order)
  }

  const togglePanel = (id: string, on: boolean): void => {
    const next = on ? [...selected, id] : selected.filter((entry) => entry !== id)
    /* At least one panel has to stay: an empty dashboard is not a layout, it is a blank screen. */
    if (next.length === 0) {
      toast('warning', 'Keep one panel', 'Your dashboard needs at least one panel to show.')
      return
    }
    setPanels(next)
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('preferences.set', {
        values: {
          'dashboard.range': range,
          'dashboard.panels': JSON.stringify(selected),
          'notifications.muted': JSON.stringify(muted)
        }
      })
      toast('success', 'Preferences saved', 'Your dashboard and bell now follow these choices.')
      await saved.reload()
    } catch (error) {
      toast('error', 'The preferences could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const clearRecent = async (): Promise<void> => {
    const confirmed = await confirmDanger({
      title: 'Clear recently viewed',
      message: 'The list of records you opened last is kept for your account only. Clearing it does not touch any patient, invoice or prescription record.',
      confirmLabel: 'Clear the list'
    })
    if (!confirmed) return
    try {
      await invoke('preferences.set', {
        values: { 'recent.patient': '[]', 'recent.invoice': '[]', 'recent.prescription': '[]' }
      })
      toast('success', 'Recently viewed cleared')
      await recent.reload()
    } catch (error) {
      toast('error', 'The list could not be cleared', errorMessage(error))
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="My preferences"
        subtitle={`Dashboard layout, alerts and history for ${session?.fullName ?? 'this account'}. Nothing here affects what you are allowed to do.`}
        actions={
          <Toolbar>
            <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={() => void save()}>
              Save preferences
            </Button>
          </Toolbar>
        }
      />

      <Card>
        <CardHeader
          title="Your dashboard"
          icon={<LayoutDashboard size={17} />}
          subtitle="Pick the panels you want, and the period the dashboard opens on."
        />
        <CardBody>
          <div className="grid grid--2">
            <div className="stack">
              <label className="field__label" htmlFor="prefRange">
                Opening period
              </label>
              <Select
                id="prefRange"
                value={range}
                onChange={(value) => setRange(value as DashboardRange)}
                options={RANGE_OPTIONS}
                ariaLabel="Dashboard opening period"
              />
              <span className="muted">
                The dashboard still lets you switch periods without saving; this is only where it starts.
              </span>
            </div>

            <div className="stack">
              <span className="field__label">Panels</span>
              <div className="stack" style={{ gap: 6 }}>
                {offered.map((panel) => {
                  const index = selected.indexOf(panel.id)
                  return (
                    <div key={panel.id} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                      <Checkbox
                        checked={index >= 0}
                        onChange={(checked) => togglePanel(panel.id, checked)}
                        label={
                          <span className="stack" style={{ gap: 0 }}>
                            <span>{panel.label}</span>
                            <span className="muted">{panel.description}</span>
                          </span>
                        }
                      />
                      {index >= 0 ? (
                        <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${panel.label} up`}
                            disabled={index === 0}
                            onClick={() => move(panel.id, -1)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={`Move ${panel.label} down`}
                            disabled={index === selected.length - 1}
                            onClick={() => move(panel.id, 1)}
                          >
                            <ArrowDown size={15} />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  )
                })}
                <span className="muted">
                  Only panels your role can open are offered. A panel you switch off is hidden, not deleted — you can bring it back at any time.
                </span>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Alerts in the bell"
          icon={<BellRing size={17} />}
          subtitle="Switch off the alert types you do not need on your own bell. Critical alerts always arrive."
        />
        <CardBody>
          <div className="stack" style={{ gap: 8 }}>
            {NOTIFICATION_TYPE_DEFS.map((definition) => (
              <div key={definition.type} className="row" style={{ gap: 10, alignItems: 'center' }}>
                <Checkbox
                  checked={!muted.includes(definition.type)}
                  onChange={(checked) => setMuted((current) => (checked ? current.filter((type) => type !== definition.type) : [...current, definition.type]))}
                  label={
                    <span className="row" style={{ gap: 8 }}>
                      <span>{definition.label}</span>
                      {definition.critical ? <Badge tone="danger">Critical</Badge> : null}
                    </span>
                  }
                />
                <span className="muted">{definition.description}</span>
              </div>
            ))}
            <span className="muted">
              Muting hides routine entries of a type from your list and badge. If a muted condition becomes critical it is shown anyway, and nothing is
              deleted — switching the alert back on brings its history with it.
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Recently viewed"
          icon={<RotateCcw size={17} />}
          subtitle="The last records this account opened. Stored on this computer, for you only."
          actions={
            <Button variant="secondary" onClick={() => void clearRecent()} disabled={(recent.data ?? []).length === 0}>
              Clear the list
            </Button>
          }
        />
        <CardBody>
          {(recent.data ?? []).length === 0 ? (
            <span className="muted">Nothing opened yet. Patient profiles, invoices and prescriptions you open appear here.</span>
          ) : (
            <ul className="plain-list">
              {(recent.data ?? []).map((entry) => (
                <li key={`${entry.kind}-${entry.id}`} className="plain-list__item">
                  <Badge tone="neutral">{KIND_LABELS[entry.kind]}</Badge>
                  <Link className="link-strong" to={entry.route}>
                    {entry.title}
                  </Link>
                  {entry.subtitle ? <span className="muted num">{entry.subtitle}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
