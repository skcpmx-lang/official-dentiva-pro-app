import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Download, Play, Printer } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, PageHeader } from '../../components/ui/primitives'
import { Select } from '../../components/ui/form'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { toast } from '../../components/ui/overlay'
import { formatBDT } from '@shared/money'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { usePermission } from '../../store/appStore'
import { PrintDialog } from '../printing/PrintDialog'
import type { ReportCatalogEntry, ReportCell, ReportResult } from '../../lib/types'

const RANGE_OPTIONS = [
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'lastYear', label: 'Last year' },
  { value: 'today', label: 'Today' }
]

type RangeKey = 'last30' | 'thisMonth' | 'last90' | 'lastYear' | 'today'

/**
 * Reports.
 *
 * Every report comes from the same engine, so this screen is a thin, honest shell: choose a report, choose
 * a period, and the service returns typed columns and raw rows. Nothing is totalled here — the totals come
 * from the database — which is why the CSV export can promise the same numbers the table shows.
 */
export function ReportsScreen(): ReactNode {
  const canExport = usePermission('accounting.export')
  const canPrint = usePermission('printing.print')

  const [key, setKey] = useState('revenue_daily')
  const [range, setRange] = useState<RangeKey>('last30')
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<ReportResult | null>(null)
  const [exporting, setExporting] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)

  const catalog = useInvoke('reports.catalog', {})

  useEffect(() => {
    const first = catalog.data?.[0]
    if (first && !catalog.data?.some((entry: ReportCatalogEntry) => entry.key === key)) setKey(first.key)
  }, [catalog.data, key])

  const definition = useMemo(() => catalog.data?.find((entry: ReportCatalogEntry) => entry.key === key) ?? null, [catalog.data, key])

  const run = async (): Promise<void> => {
    setRunning(true)
    try {
      const result = await invoke('reports.run', { key, range: { preset: range }, limit: 500 })
      setReport(result)
    } catch (error) {
      setReport(null)
      toast('error', 'The report could not be run', errorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, range, catalog.data])

  const columns: Array<Column<Record<string, ReportCell>>> = (report?.columns ?? []).map((column) => ({
    key: column.key,
    header: column.header,
    align: column.align,
    width: column.format === 'money' ? 140 : column.format === 'number' ? 110 : undefined,
    render: (row) => <span className={column.format === 'money' || column.format === 'number' ? 'num' : undefined}>{cellText(row[column.key], column.format)}</span>
  }))

  const exportCsv = async (): Promise<void> => {
    setExporting(true)
    try {
      const result = await invoke('reports.export', { key, range: { preset: range }, limit: 5000 })
      if (result.path === null) toast('info', 'Export cancelled')
      else toast('success', 'Report exported', `${result.rowCount} rows written to ${result.path}`)
    } catch (error) {
      toast('error', 'The report could not be exported', errorMessage(error))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Reports"
        subtitle="Operational and financial summaries, straight from the clinic's own data."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button variant="secondary" icon={<Play size={16} />} loading={running} onClick={() => void run()}>
              Refresh
            </Button>
            {canPrint ? (
              <Button variant="secondary" icon={<Printer size={16} />} disabled={!report} onClick={() => setPrintOpen(true)}>
                Print / PDF
              </Button>
            ) : null}
            {canExport ? (
              <Button variant="primary" icon={<Download size={16} />} loading={exporting} disabled={!report} onClick={() => void exportCsv()}>
                Export CSV
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader title="Choose a report" icon={<BarChart3 size={17} />} subtitle={definition?.description} />
        <CardBody>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <Select
              value={key}
              onChange={(value: string) => setKey(value)}
              options={(catalog.data ?? []).map((entry: ReportCatalogEntry) => ({ value: entry.key, label: entry.title }))}
              ariaLabel="Report"
            />
            <Select
              value={range}
              onChange={(value: string) => setRange(value as RangeKey)}
              options={RANGE_OPTIONS}
              ariaLabel="Period"
            />
            {definition ? <span className="muted small">{definition.usesRange ? 'Uses the selected period.' : 'Not period based — shows the current position.'}</span> : null}
          </div>
        </CardBody>
      </Card>

      {report ? (
        <Card>
          <CardHeader
            title={report.title}
            subtitle={report.from && report.to ? `${report.from} → ${report.to}` : 'Current position'}
            actions={
              <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
                {report.totals.map((total) => (
                  <span key={total.label} className="summary-strip__item">
                    <span className="summary-strip__label">{total.label}</span>
                    <strong className="num">{cellText(total.value, total.format)}</strong>
                  </span>
                ))}
              </div>
            }
          />
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={report.rows}
              getRowId={(row) => JSON.stringify(row)}
              loading={running}
              emptyTitle="No rows for this period"
              emptyMessage={report.note ?? 'Try a wider period.'}
            />
          </CardBody>
          {report.note ? (
            <CardBody>
              <p className="muted small">{report.note}</p>
            </CardBody>
          ) : null}
        </Card>
      ) : (
        <Card>
          <CardBody>
            <p className="muted">{running ? 'Running the report…' : 'This report returned no result. Press Refresh to run it again.'}</p>
          </CardBody>
        </Card>
      )}

      <PrintDialog
        open={printOpen}
        target={{
          documentType: 'report',
          reportKey: report?.key,
          reportFrom: report?.from ?? undefined,
          reportTo: report?.to ?? undefined,
          label: report?.title
        }}
        onClose={() => setPrintOpen(false)}
      />
    </div>
  )
}

/** One place where raw report cells become text; the shared money formatter keeps every screen identical. */
function cellText(cell: ReportCell | undefined, format: string): string {
  if (cell === null || cell === undefined) return '—'
  if (format === 'money') return formatBDT(Number(cell))
  if (format === 'number') return Number(cell).toLocaleString('en-IN')
  if (format === 'percent') return `${Number(cell).toFixed(2)} %`
  return String(cell)
}
