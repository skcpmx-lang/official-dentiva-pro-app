import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CircleDollarSign, PackageX, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, KpiCard, PageHeader, Segmented } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { BarChart, DonutChart, LineChart } from '../../components/charts/Charts'
import { useInvoke } from '../../lib/api'
import { APPOINTMENT_STATUS_META, useFormatters } from '../../lib/format'
import { usePermission, useSession } from '../../store/appStore'
import { DASHBOARD_PANELS, type DashboardRange } from '@shared/preferences'
import type { DashboardSummary, RecentEntry } from '../../lib/types'

/**
 * Dashboard.
 *
 * Figures are produced by a single aggregation query in the main process, so the dashboard can never
 * contradict a detail screen. Panels the operator has no permission for are not requested at all — the
 * service decides which parts of the payload exist — and the operator's own preferences decide which of
 * the permitted panels are shown and in what order, through the same catalogue the preferences screen
 * offers.
 */

const RANGE_OPTIONS: Array<{ value: DashboardRange, label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: '7 days' },
  { value: 'last30', label: '30 days' },
  { value: 'thisMonth', label: 'This month' }
]

const RANGE_LABELS: Record<DashboardRange, string> = {
  today: 'today',
  last7: 'the last 7 days',
  last30: 'the last 30 days',
  thisMonth: 'this month'
}

const KIND_LABELS: Record<RecentEntry['kind'], string> = {
  patient: 'Patient',
  invoice: 'Invoice',
  prescription: 'Prescription'
}

function storedPanels(raw: string | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string' && DASHBOARD_PANELS.some((panel) => panel.id === entry))
  } catch {
    return []
  }
}

export function DashboardScreen(): ReactNode {
  const session = useSession()
  const navigate = useNavigate()
  const formatters = useFormatters()
  const canSeeBilling = usePermission('billing.view')
  const canSeeInventory = usePermission('inventory.view')
  const canSeeSchedule = usePermission('appointments.view')
  const canSeeClinical = usePermission('clinical.view')
  const canSeeQueue = usePermission('queue.view')
  const canSeeAudit = usePermission('audit.view')

  const preferences = useInvoke('preferences.get', {})
  const recent = useInvoke('preferences.recent', { limit: 6 })

  const [preset, setPreset] = useState<DashboardRange>('last30')
  const [rangeChosen, setRangeChosen] = useState(false)

  /* The stored period is where the dashboard starts; switching it here is a session-only change. */
  useEffect(() => {
    if (rangeChosen || !preferences.data) return
    const stored = preferences.data['dashboard.range'] as DashboardRange | undefined
    if (stored) setPreset(stored)
  }, [preferences.data, rangeChosen])

  const summary = useInvoke('dashboard.summary', { range: { preset } }, { pollMs: 120_000 })
  const data = summary.data

  const permitted = useMemo(
    () =>
      new Set(
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
        }).map((panel) => panel.id)
      ),
    [canSeeAudit, canSeeBilling, canSeeClinical, canSeeInventory, canSeeQueue, canSeeSchedule]
  )

  /* A saved layout is used as saved; without one, every permitted panel is shown in catalogue order. */
  const stored = storedPanels(preferences.data?.['dashboard.panels'])
  const order = (stored.length > 0 ? stored : DASHBOARD_PANELS.map((panel) => panel.id)).filter((id) => permitted.has(id))

  const appointmentRows = useMemo(() => data?.appointments ?? [], [data])

  const appointmentColumns: Array<Column<DashboardSummary['appointments'][number]>> = [
    { key: 'time', header: 'Time', width: 92, render: (row) => <span className="num">{formatters.time(row.scheduledAt)}</span>, sortValue: (row) => row.scheduledAt },
    {
      key: 'patient',
      header: 'Patient',
      render: (row) => (
        <Link to={`/patients/${row.patientId}`} className="link-strong">
          {row.patientName}
        </Link>
      ),
      sortValue: (row) => row.patientName
    },
    { key: 'code', header: 'Patient ID', width: 130, render: (row) => <span className="num muted">{row.patientCode}</span>, sortValue: (row) => row.patientCode },
    { key: 'dentist', header: 'Dentist', render: (row) => row.dentistName, sortValue: (row) => row.dentistName, secondary: true },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (row) => {
        const meta = APPOINTMENT_STATUS_META[row.status] ?? { label: row.status, tone: 'neutral' as const }
        return <Badge tone={meta.tone}>{meta.label}</Badge>
      },
      sortValue: (row) => row.status
    }
  ]

  const panels: Record<string, ReactNode> = {
    kpis: (
      <div className="grid grid--kpi" key="kpis">
        {(data?.kpis ?? []).map((kpi) => (
          <KpiCard
            key={kpi.key}
            label={kpi.label}
            value={kpi.unit === 'money' ? formatters.money(kpi.value) : formatters.number(kpi.value)}
            meta={
              <span className="row" style={{ gap: 6 }}>
                {kpi.hint}
                {kpi.deltaBp !== null ? (
                  <span className={kpi.deltaBp >= 0 ? 'delta delta--up' : 'delta delta--down'}>
                    {kpi.deltaBp >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {Math.abs(kpi.deltaBp / 100).toFixed(0)}%
                  </span>
                ) : null}
              </span>
            }
            icon={kpi.unit === 'money' ? <CircleDollarSign size={18} /> : <Users size={18} />}
            onClick={kpi.route ? () => navigate(kpi.route!) : undefined}
          />
        ))}
      </div>
    ),

    collections: (
      <Card key="collections">
        <CardHeader
          title="Collections"
          subtitle={`Payments received in ${RANGE_LABELS[preset]}`}
          icon={<CircleDollarSign size={17} />}
          actions={
            <Link to="/patients?filter=due" className="btn btn--tertiary btn--sm">
              View dues
            </Link>
          }
        />
        <CardBody>
          <LineChart
            points={data?.revenueSeries ?? []}
            ariaLabel="Payments received over the selected period"
            formatValue={(value) => formatters.money(value)}
          />
        </CardBody>
      </Card>
    ),

    schedule: (
      <Card key="schedule">
        <CardHeader title="Today's schedule" subtitle="Appointments booked for today" icon={<CalendarClock size={17} />} />
        <CardBody flush>
          <DataTable
            columns={appointmentColumns}
            rows={appointmentRows}
            getRowId={(row) => row.id}
            dense
            emptyTitle="No appointments today"
            emptyMessage="Appointments booked for today appear here."
            onRowClick={(row) => navigate(`/patients/${row.patientId}`)}
          />
        </CardBody>
      </Card>
    ),

    dentistLoad: (
      <Card key="dentistLoad">
        <CardHeader title="Visits per dentist" subtitle={`Workload in ${RANGE_LABELS[preset]}`} />
        <CardBody>
          <BarChart
            points={data?.dentistLoad ?? []}
            ariaLabel="Visits per dentist"
            formatValue={(value) => formatters.number(value)}
            tone="teal"
          />
        </CardBody>
      </Card>
    ),

    dues: (
      <Card key="dues">
        <CardHeader title="Outstanding dues" subtitle="Patients with an unpaid balance" />
        <CardBody flush>
          <DataTable
            columns={[
              {
                key: 'patient',
                header: 'Patient',
                render: (row) => (
                  <Link to={`/patients/${row.patientId}`} className="link-strong">
                    {row.fullName}
                  </Link>
                ),
                sortValue: (row) => row.fullName
              },
              { key: 'code', header: 'Patient ID', width: 128, render: (row) => <span className="num muted">{row.code}</span> },
              { key: 'due', header: 'Due', width: 130, align: 'right', render: (row) => formatters.money(row.dueMicro), sortValue: (row) => row.dueMicro },
              {
                key: 'last',
                header: 'Last payment',
                width: 140,
                render: (row) => (row.lastPaymentAt ? formatters.date(row.lastPaymentAt) : '—'),
                secondary: true
              }
            ]}
            rows={data?.duePatients ?? []}
            getRowId={(row) => row.patientId}
            dense
            emptyTitle="No outstanding dues"
            emptyMessage="Every invoice issued so far is settled."
          />
        </CardBody>
      </Card>
    ),

    lowStock: (
      <Card key="lowStock">
        <CardHeader title="Low stock" subtitle="Items at or below their reorder level" icon={<PackageX size={17} />} />
        <CardBody flush>
          <DataTable
            columns={[
              { key: 'name', header: 'Item', render: (row) => row.name, sortValue: (row) => row.name },
              { key: 'quantity', header: 'On hand', align: 'right', width: 110, render: (row) => `${formatters.quantity(row.quantityOnHand)} ${row.unit}` },
              { key: 'reorder', header: 'Reorder at', align: 'right', width: 110, render: (row) => formatters.quantity(row.reorderLevel) }
            ]}
            rows={data?.lowStock ?? []}
            getRowId={(row) => row.itemId}
            dense
            emptyTitle="Stock levels are healthy"
            emptyMessage="No item has reached its reorder level."
          />
        </CardBody>
      </Card>
    ),

    expiring: (
      <Card key="expiring">
        <CardHeader title="Expiring batches" subtitle="Batches expiring within 90 days" icon={<AlertTriangle size={17} />} />
        <CardBody flush>
          <DataTable
            columns={[
              { key: 'item', header: 'Item', render: (row) => row.itemName, sortValue: (row) => row.itemName },
              { key: 'batch', header: 'Batch', render: (row) => row.batchNo, secondary: true },
              { key: 'expiry', header: 'Expires', render: (row) => formatters.date(Date.parse(`${row.expiryDate}T00:00:00`)), sortValue: (row) => row.expiryDate },
              { key: 'quantity', header: 'Qty', align: 'right', width: 90, render: (row) => formatters.quantity(row.quantity) }
            ]}
            rows={data?.expiringBatches ?? []}
            getRowId={(row) => row.batchId}
            dense
            emptyTitle="No batch is nearing expiry"
            emptyMessage="Nothing in stock expires within the next 90 days."
          />
        </CardBody>
      </Card>
    ),

    queue: (
      <Card key="queue">
        <CardHeader title="Queue right now" subtitle="Patients waiting or in treatment" />
        <CardBody>
          {data ? (
            <DonutChart
              ariaLabel="Queue composition"
              centerLabel="In the clinic"
              formatValue={(value) => formatters.number(value)}
              points={[
                { label: 'Waiting', value: data.queue.waiting },
                { label: 'In treatment', value: data.queue.inProgress },
                { label: 'Completed today', value: data.queue.completedToday }
              ]}
            />
          ) : null}
        </CardBody>
      </Card>
    ),

    recent: (
      <Card key="recent">
        <CardHeader
          title="Recently viewed"
          subtitle={`The records ${session?.fullName ?? 'you'} opened last`}
          actions={
            <Link to="/settings/preferences" className="btn btn--tertiary btn--sm">
              Change
            </Link>
          }
        />
        <CardBody flush>
          {(recent.data ?? []).length === 0 ? (
            <div className="state">
              <span className="state__message">Patient profiles, invoices and prescriptions you open appear here.</span>
            </div>
          ) : (
            <DataTable
              columns={[
                {
                  key: 'title',
                  header: 'Record',
                  render: (row) => (
                    <Link to={row.route} className="link-strong">
                      {row.title}
                    </Link>
                  ),
                  sortValue: (row) => row.title
                },
                { key: 'kind', header: 'Type', width: 130, render: (row) => <Badge tone="neutral">{KIND_LABELS[row.kind]}</Badge>, sortValue: (row) => row.kind },
                { key: 'code', header: 'Reference', width: 150, render: (row) => <span className="num muted">{row.subtitle ?? '—'}</span>, secondary: true }
              ]}
              rows={recent.data ?? []}
              getRowId={(row) => `${row.kind}-${row.id}`}
              dense
              emptyTitle="Nothing opened yet"
            />
          )}
        </CardBody>
      </Card>
    ),

    activity: (
      <Card key="activity">
        <CardHeader title="Recent activity" subtitle="Latest recorded actions on this computer" />
        <CardBody flush>
          <DataTable
            columns={[
              { key: 'at', header: 'When', width: 150, render: (row) => formatters.relative(row.at), sortValue: (row) => row.at },
              { key: 'summary', header: 'Action', render: (row) => row.summary, sortValue: (row) => row.summary },
              { key: 'user', header: 'User', width: 140, render: (row) => row.username ?? 'system', secondary: true }
            ]}
            rows={data?.recentActivity ?? []}
            getRowId={(row) => row.id}
            dense
            emptyTitle="No activity recorded yet"
          />
        </CardBody>
      </Card>
    )
  }

  const wide = order.filter((id) => id === 'kpis')
  const rest = order.filter((id) => id !== 'kpis')

  return (
    <div className="page">
      <PageHeader
        title={`Good day, welcome back`}
        subtitle={data ? `Prepared at ${formatters.dateTime(data.generatedAt)} · all figures are from this computer` : 'Preparing your practice overview'}
        actions={
          <Segmented
            ariaLabel="Dashboard period"
            value={preset}
            onChange={(value) => {
              setRangeChosen(true)
              setPreset(value as DashboardRange)
            }}
            options={RANGE_OPTIONS}
          />
        }
      />

      {summary.error ? (
        <Card>
          <CardBody>
            <div className="state state--error">
              <span className="state__title">The dashboard could not be prepared</span>
              <span className="state__message">{summary.error.message}</span>
              <Button variant="secondary" onClick={() => void summary.reload()}>
                Try again
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {wide.map((id) => panels[id])}

      <div className="grid grid--2">{rest.map((id) => panels[id])}</div>
    </div>
  )
}
