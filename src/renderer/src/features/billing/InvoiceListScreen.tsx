import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Eye, FilePlus2, Receipt, Wallet } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Switch, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Select } from '../../components/ui/form'
import { toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { INVOICE_STATUS_META, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { Invoice, RangePreset } from '../../lib/types'

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'all', label: 'All time' }
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'Every status' },
  { value: 'unpaid', label: 'Unpaid' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' }
]

/**
 * Invoice register.
 *
 * The clinic's money list: what was billed, what has been collected and what is still owed. Totals under
 * the filters are computed by the service across the whole result set, not just the visible page, so the
 * figures can be trusted for a day's takings.
 */
export function InvoiceListScreen(): ReactNode {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const format = useFormatters()
  const canCreate = usePermission('billing.create')
  const canExport = usePermission('billing.export')

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('all')
  const [preset, setPreset] = useState<RangePreset>(searchParams.get('hasDue') === '1' ? 'all' : 'last30')
  const [hasDue, setHasDue] = useState(searchParams.get('hasDue') === '1')
  const [page, setPage] = useState(0)
  const [exporting, setExporting] = useState(false)
  const pageSize = 25

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebounced(search.trim())
      setPage(0)
    }, 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const filter = useMemo(
    () => ({
      search: debounced === '' ? undefined : debounced,
      status: status === 'all' ? undefined : (status as Invoice['status']),
      hasDue: hasDue || undefined,
      range: { preset },
      limit: pageSize,
      offset: page * pageSize
    }),
    [debounced, status, hasDue, preset, page]
  )

  const invoices = useInvoke('invoices.list', filter)
  const total = invoices.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const totals = invoices.data?.totals

  const columns: Array<Column<Invoice>> = [
    {
      key: 'invoice',
      header: 'Invoice',
      width: 150,
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="num link-strong">{row.invoiceNo}</span>
          <span className="muted small">{format.date(row.issueAt)}</span>
        </div>
      ),
      sortValue: (row) => row.invoiceNo
    },
    {
      key: 'patient',
      header: 'Patient',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>{row.patientName}</span>
          {row.patientNameBn ? <span className="bn muted small">{row.patientNameBn}</span> : null}
        </div>
      ),
      sortValue: (row) => row.patientName
    },
    {
      key: 'lines',
      header: 'Billed for',
      render: (row) => <span className="small">{row.lines.map((line) => line.description).join(', ')}</span>,
      sortValue: (row) => row.lines.length
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (row) => {
        const meta = INVOICE_STATUS_META[row.status]
        return <Badge tone={meta?.tone ?? 'neutral'}>{meta?.label ?? row.status}</Badge>
      },
      sortValue: (row) => row.status
    },
    { key: 'total', header: 'Total', width: 130, align: 'right', render: (row) => <span className="num">{format.money(row.totalMicro)}</span>, sortValue: (row) => row.totalMicro },
    {
      key: 'paid',
      header: 'Paid',
      width: 130,
      align: 'right',
      render: (row) => <span className="num">{format.money(row.paidMicro)}</span>,
      sortValue: (row) => row.paidMicro,
      secondary: true
    },
    {
      key: 'due',
      header: 'Due',
      width: 130,
      align: 'right',
      render: (row) => (row.dueMicro > 0 ? <span className="num link-strong">{format.money(row.dueMicro)}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.dueMicro
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Invoices"
        subtitle="What the clinic has billed, collected and is still owed."
        actions={
          <div className="row" style={{ gap: 8 }}>
            {canExport ? (
              <Button
                variant="tertiary"
                icon={<Download size={16} />}
                loading={exporting}
                onClick={async () => {
                  setExporting(true)
                  try {
                    const result = await invoke('invoices.export', { ...filter, limit: 5000, offset: 0 })
                    if (result.path === null) toast('info', 'Export cancelled')
                    else toast('success', 'Invoices exported', `${result.rowCount} rows written to ${result.path}`)
                  } catch (error) {
                    toast('error', 'The invoices could not be exported', errorMessage(error))
                  } finally {
                    setExporting(false)
                  }
                }}
              >
                Export CSV
              </Button>
            ) : null}
            {canCreate ? (
              <Button variant="primary" icon={<FilePlus2 size={16} />} onClick={() => navigate('/invoices/new')}>
                Raise invoice
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="summary-strip">
        <span className="summary-strip__item">
          <span className="summary-strip__label">Invoiced (filtered)</span>
          <strong className="num">{format.money(totals?.invoicedMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Collected</span>
          <strong className="num">{format.money(totals?.paidMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Outstanding</span>
          <strong className="num">{format.money(totals?.dueMicro ?? 0)}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Refunded</span>
          <strong className="num">{format.money(totals?.refundedMicro ?? 0)}</strong>
        </span>
      </div>

      <Card>
        <CardHeader title="Register" icon={<Receipt size={17} />} subtitle="Newest first." />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search invoice no, patient, phone…" ariaLabel="Search invoices" />
            <Select value={status} onChange={(value: string) => setStatus(value)} options={STATUS_OPTIONS} ariaLabel="Status" />
            <Select value={preset} onChange={(value: string) => setPreset(value as RangePreset)} options={RANGE_OPTIONS} ariaLabel="Date range" />
            <Switch checked={hasDue} onChange={(checked) => setHasDue(checked)} label="Only with dues" />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={invoices.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={invoices.loading}
            emptyTitle="No invoices found"
            emptyMessage="Raise an invoice from a completed visit, or widen the filters."
            rowActions={(row) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <Button size="sm" variant="ghost" icon={<Eye size={15} />} onClick={() => navigate(`/invoices/${row.id}`)}>
                  Open
                </Button>
                {canCreate && row.status !== 'void' && row.dueMicro > 0 ? (
                  <Button size="sm" variant="secondary" icon={<Wallet size={15} />} onClick={() => navigate(`/invoices/${row.id}?pay=1`)}>
                    Take payment
                  </Button>
                ) : null}
              </div>
            )}
          />
        </CardBody>
        {total > 0 ? (
          <CardBody>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted small">
                {total.toLocaleString()} invoice(s) · page {page + 1} of {pageCount}
              </span>
              <div className="row" style={{ gap: 8 }}>
                <Button size="sm" variant="tertiary" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>
                  Previous
                </Button>
                <Button size="sm" variant="tertiary" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </CardBody>
        ) : null}
      </Card>
    </div>
  )
}
