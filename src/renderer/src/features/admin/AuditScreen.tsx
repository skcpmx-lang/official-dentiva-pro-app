import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, Download, Eye, ShieldCheck, UserRound } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Toolbar } from '../../components/ui/primitives'
import { Select } from '../../components/ui/form'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { formatDateTime } from '../../lib/format'
import type { AuditEntry, RangePreset } from '../../lib/types'

const PAGE_SIZE = 50

const RANGE_OPTIONS: Array<{ value: string, label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'all', label: 'All time' }
]

/**
 * Audit trail.
 *
 * Every privileged action — sign-in, activation, permission change, deletion, restore, print — is written
 * by the main process to an append-only table. Records cannot be edited or deleted from inside the
 * application, so this screen is strictly read-only and exports to CSV for external filing.
 */
export function AuditScreen(): ReactNode {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [module, setModule] = useState('all')
  const [action, setAction] = useState('all')
  const [user, setUser] = useState('all')
  const [result, setResult] = useState('all')
  const [preset, setPreset] = useState<RangePreset>('last30')
  const [offset, setOffset] = useState(0)
  const [detail, setDetail] = useState<AuditEntry | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebounced(search.trim())
      setOffset(0)
    }, 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const filter = useMemo(
    () => ({
      search: debounced === '' ? undefined : debounced,
      module: module === 'all' ? undefined : module,
      action: action === 'all' ? undefined : action,
      userId: user === 'all' ? undefined : Number(user),
      result: result === 'all' ? undefined : (result as 'success' | 'failure'),
      range: { preset },
      limit: PAGE_SIZE,
      offset
    }),
    [debounced, module, action, user, result, preset, offset]
  )

  const page = useInvoke('audit.list', filter)
  const facets = useInvoke('audit.facets', {})

  const columns: Array<Column<AuditEntry>> = [
    {
      key: 'at',
      header: 'When',
      width: 165,
      render: (row) => <span className="num">{formatDateTime(row.at)}</span>,
      sortValue: (row) => row.at
    },
    {
      key: 'user',
      header: 'User',
      width: 150,
      render: (row) => (row.username ? <span>{row.username}</span> : <span className="muted">system</span>),
      sortValue: (row) => row.username ?? ''
    },
    {
      key: 'action',
      header: 'Action',
      width: 210,
      render: (row) => (
        <span className="stack" style={{ gap: 2 }}>
          <span className="num small">{row.action}</span>
          <span className="muted small">{row.module}</span>
        </span>
      ),
      sortValue: (row) => row.action
    },
    {
      key: 'summary',
      header: 'Summary',
      render: (row) => (
        <span className="stack" style={{ gap: 2 }}>
          <span>{row.summary}</span>
          {row.entityType ? (
            <span className="muted small num">
              {row.entityType}
              {row.entityId ? ` #${row.entityId}` : ''}
            </span>
          ) : null}
        </span>
      ),
      sortValue: (row) => row.summary
    },
    {
      key: 'result',
      header: 'Result',
      width: 100,
      render: (row) =>
        row.result === 'success' ? <Badge tone="success">Success</Badge> : <Badge tone="danger">{row.result}</Badge>,
      sortValue: (row) => row.result
    }
  ]

  const total = page.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <div className="page">
      <PageHeader
        title="Audit log"
        subtitle="An append-only history of every privileged action performed in this installation."
        actions={
          <Button
            variant="secondary"
            icon={<Download size={16} />}
            loading={exporting}
            onClick={async () => {
              setExporting(true)
              try {
                const result = await invoke('audit.export', { ...filter, limit: 5000, offset: 0 })
                if (result.path === null) toast('info', 'Export cancelled')
                else toast('success', 'Audit log exported', `${result.rowCount} rows written to ${result.path}`)
              } catch (error) {
                toast('error', 'The audit log could not be exported', errorMessage(error))
              } finally {
                setExporting(false)
              }
            }}
          >
            Export CSV
          </Button>
        }
      />

      <Card>
        <CardHeader
          title="Activity"
          icon={<Activity size={17} />}
          subtitle="Filters run inside the database; the newest entries are listed first."
        />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search summary, action or user…" ariaLabel="Search audit log" />
            <Select
              value={module}
              onChange={(value) => {
                setModule(value)
                setOffset(0)
              }}
              aria-label="Module"
              options={[{ value: 'all', label: 'All modules' }, ...(facets.data?.modules ?? []).map((entry) => ({ value: entry, label: entry }))]}
            />
            <Select
              value={action}
              onChange={(value) => {
                setAction(value)
                setOffset(0)
              }}
              aria-label="Action"
              options={[{ value: 'all', label: 'All actions' }, ...(facets.data?.actions ?? []).map((entry) => ({ value: entry, label: entry }))]}
            />
            <Select
              value={user}
              onChange={(value) => {
                setUser(value)
                setOffset(0)
              }}
              aria-label="User"
              options={[
                { value: 'all', label: 'All users' },
                ...(facets.data?.users ?? []).map((entry) => ({
                  value: String(entry.userId ?? 0),
                  label: entry.username ?? 'system'
                }))
              ]}
            />
            <Select
              value={preset}
              onChange={(value) => {
                setPreset(value as RangePreset)
                setOffset(0)
              }}
              aria-label="Date range"
              options={RANGE_OPTIONS}
            />
            <Select
              value={result}
              onChange={(value) => {
                setResult(value)
                setOffset(0)
              }}
              aria-label="Result"
              options={[
                { value: 'all', label: 'All results' },
                { value: 'success', label: 'Success only' },
                { value: 'failure', label: 'Failures only' }
              ]}
            />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={page.data?.entries ?? []}
            getRowId={(row) => row.id}
            loading={page.loading}
            emptyTitle="No matching audit entries"
            emptyMessage="Widen the date range or clear the filters to see earlier activity."
            rowActions={(row) => (
              <Button size="sm" variant="ghost" icon={<Eye size={15} />} onClick={() => setDetail(row)}>
                Details
              </Button>
            )}
          />
        </CardBody>
        {total > 0 ? (
          <CardBody>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted small">
                {total.toLocaleString()} entries · page {currentPage} of {pageCount}
              </span>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" variant="tertiary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                  Previous
                </Button>
                <Button size="sm" variant="tertiary" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                  Next
                </Button>
              </div>
            </div>
          </CardBody>
        ) : null}
      </Card>

      <Modal
        open={detail !== null}
        size="lg"
        title={detail ? detail.action : 'Audit entry'}
        description={detail ? formatDateTime(detail.at) : undefined}
        onClose={() => setDetail(null)}
        footer={
          <Button variant="tertiary" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail ? (
          <dl className="detail-list">
            <div>
              <dt>User</dt>
              <dd className="row" style={{ gap: 6 }}>
                <UserRound size={14} aria-hidden />
                {detail.username ?? 'system'}
                {detail.userId ? <span className="muted small">#{detail.userId}</span> : null}
              </dd>
            </div>
            <div>
              <dt>Module / action</dt>
              <dd className="num small">
                {detail.module} · {detail.action}
              </dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd>{detail.result}</dd>
            </div>
            <div>
              <dt>Record</dt>
              <dd className="num small">
                {detail.entityType ? `${detail.entityType}${detail.entityId ? ` #${detail.entityId}` : ''}` : '—'}
              </dd>
            </div>
            <div>
              <dt>Session</dt>
              <dd className="num small">{detail.sessionId ?? '—'}</dd>
            </div>
            <div>
              <dt>Summary</dt>
              <dd>{detail.summary}</dd>
            </div>
            {detail.detail ? (
              <div>
                <dt>Recorded detail</dt>
                <dd>
                  <pre className="code-block">{JSON.stringify(detail.detail, null, 2)}</pre>
                </dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Modal>

      <p className="muted small row" style={{ gap: 6 }}>
        <ShieldCheck size={14} aria-hidden /> Audit rows are write-protected by database triggers; they can only be added, never changed or removed.
      </p>
    </div>
  )
}
