import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, CircleDollarSign, PackageX, TrendingDown, TrendingUp, Users } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, KpiCard, PageHeader, Segmented } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { BarChart, DonutChart, LineChart } from '../../components/charts/Charts'
import { useInvoke } from '../../lib/api'
import { APPOINTMENT_STATUS_META, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { DashboardSummary } from '../../lib/types'

/**
 * Dashboard.
 *
 * Figures are produced by a single aggregation query in the main process, so the dashboard can never
 * contradict a detail screen. Panels the operator has no permission for are not requested at all —
 * the service decides which parts of the payload exist.
 */
export function DashboardScreen(): ReactNode {
  const [preset, setPreset] = useState<'today' | 'last7' | 'last30' | 'thisMonth'>('last30')
  const navigate = useNavigate()
  const formatters = useFormatters()
  const canSeeBilling = usePermission('billing.view')
  const canSeeInventory = usePermission('inventory.view')

  const summary = useInvoke('dashboard.summary', { range: { preset } }, { pollMs: 120_000 })
  const data = summary.data

  const kpis = data?.kpis ?? []
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

  return (
    <div className="page">
      <PageHeader
        title={`Good day, welcome back`}
        subtitle={data ? `Prepared at ${formatters.dateTime(data.generatedAt)} · all figures are from this computer` : 'Preparing your practice overview'}
        actions={
          <Segmented
            ariaLabel="Dashboard period"
            value={preset}
            onChange={(value) => setPreset(value)}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'last7', label: '7 days' },
              { value: 'last30', label: '30 days' },
              { value: 'thisMonth', label: 'This month' }
            ]}
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

      <div className="grid grid--kpi">
        {kpis.map((kpi) => (
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

      <div className="grid grid--two">
        <Card>
          <CardHeader
            title="Collections"
            subtitle="Payments received in the selected period"
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

        <Card>
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
      </div>

      <div className="grid grid--two">
        <Card>
          <CardHeader title="Visits per dentist" subtitle="Workload in the selected period" />
          <CardBody>
            <BarChart
              points={data?.dentistLoad ?? []}
              ariaLabel="Visits per dentist"
              formatValue={(value) => formatters.number(value)}
              tone="teal"
            />
          </CardBody>
        </Card>

        {canSeeBilling ? (
          <Card>
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
        ) : null}
      </div>

      {canSeeInventory ? (
        <div className="grid grid--two">
          <Card>
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

          <Card>
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
        </div>
      ) : null}

      <div className="grid grid--two">
        <Card>
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

        <Card>
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
      </div>
    </div>
  )
}
