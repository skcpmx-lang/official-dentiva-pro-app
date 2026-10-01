import { useMemo, useState, type ReactNode } from 'react'
import { FileText, RefreshCw, RotateCcw } from 'lucide-react'
import { PRINT_DOCUMENT_TYPES } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Select } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { PrintHistoryEntry } from '../../lib/types'

/**
 * Print history.
 *
 * Every preview, print, PDF and test page the clinic produced, with the outcome. A failed job keeps the
 * rendered document, so the operator can look at exactly what failed to print and send it again — the
 * record is never lost to a printer that refused it.
 */

const DOCUMENT_LABELS: Record<string, string> = {
  prescription: 'Prescription',
  invoice: 'Invoice',
  payment_receipt: 'Payment receipt',
  appointment_slip: 'Appointment slip',
  patient_summary: 'Patient summary',
  report: 'Report',
  test: 'Test page'
}

const ACTION_LABELS: Record<string, string> = { print: 'Print', pdf: 'PDF', preview: 'Preview', test: 'Test page' }

export function PrintHistoryScreen(): ReactNode {
  const format = useFormatters()
  const canPrint = usePermission('printing.print')

  const [documentType, setDocumentType] = useState('')
  const [result, setResult] = useState('')
  const [viewing, setViewing] = useState<{ title: string, html: string, fileName: string } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const history = useInvoke('printing.history', {
    documentType: documentType === '' ? undefined : (documentType as PrintHistoryEntry['documentType']),
    result: result === '' ? undefined : (result as 'success' | 'failed'),
    limit: 100,
    offset: 0
  })

  const entries = history.data?.items ?? []

  const columns: Array<Column<PrintHistoryEntry>> = useMemo(
    () => [
      { key: 'at', header: 'When', width: 170, render: (row) => format.dateTime(row.at) },
      { key: 'documentType', header: 'Document', width: 150, render: (row) => DOCUMENT_LABELS[row.documentType] ?? row.documentType },
      {
        key: 'title',
        header: 'Record',
        render: (row) => (
          <span className="stack" style={{ gap: 2 }}>
            <span className="link-strong">{row.title}</span>
            <span className="muted small">
              {row.reference ?? 'No reference'} · {ACTION_LABELS[row.action] ?? row.action}
              {row.profileName ? ` · ${row.profileName}` : ''}
            </span>
          </span>
        )
      },
      { key: 'printerName', header: 'Printer', width: 180, render: (row) => row.printerName ?? '—' },
      { key: 'paperClass', header: 'Paper', width: 100, render: (row) => row.paperClass.toUpperCase() },
      {
        key: 'result',
        header: 'Result',
        width: 150,
        render: (row) => (
          <span className="stack" style={{ gap: 2 }}>
            <Badge tone={row.result === 'success' ? 'success' : 'danger'}>{row.result === 'success' ? 'Printed' : 'Failed'}</Badge>
            {row.result === 'failed' && row.failureReason ? <span className="muted small">{row.failureReason}</span> : null}
          </span>
        )
      },
      { key: 'performedByName', header: 'By', width: 150, render: (row) => row.performedByName ?? '—' }
    ],
    [format]
  )

  const view = async (entry: PrintHistoryEntry): Promise<void> => {
    try {
      const payload = await invoke('printing.history.payload', { id: entry.id })
      setViewing(payload)
    } catch (error) {
      toast('warning', 'The document is not on file', errorMessage(error))
    }
  }

  const retry = async (entry: PrintHistoryEntry): Promise<void> => {
    setBusyId(entry.id)
    try {
      const outcome = await invoke('printing.retry', { historyId: entry.id, printerName: null })
      if (outcome.ok) {
        toast('success', 'Sent to the printer again', outcome.printerName ?? entry.title)
      } else {
        toast('error', 'The printer refused the document again', outcome.failureReason ?? '')
      }
      await history.reload()
    } catch (error) {
      toast('error', 'The document could not be retried', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page">
      <PageHeader title="Print history" subtitle="What was printed, when, by whom and whether the printer accepted it." actions={<Badge tone="neutral">{history.data?.total ?? 0} records</Badge>} />

      <Card>
        <CardHeader title="Attempts" subtitle="Failed jobs keep the rendered document until it is retried or saved." actions={
          <Button size="sm" variant="ghost" icon={<RefreshCw size={15} />} onClick={() => void history.reload()} loading={history.loading}>
            Refresh
          </Button>
        } />
        <CardBody>
          <Toolbar>
            <Select
              value={documentType}
              onChange={setDocumentType}
              options={[{ value: '', label: 'All documents' }, ...PRINT_DOCUMENT_TYPES.map((type) => ({ value: type, label: DOCUMENT_LABELS[type] ?? type }))]}
              ariaLabel="Document type"
            />
            <Select
              value={result}
              onChange={setResult}
              options={[
                { value: '', label: 'All results' },
                { value: 'success', label: 'Printed' },
                { value: 'failed', label: 'Failed' }
              ]}
              ariaLabel="Result"
            />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={entries}
            getRowId={(row) => row.id}
            loading={history.loading}
            emptyTitle="Nothing printed yet"
            emptyMessage="Previews, prints, PDFs and test pages are recorded here."
            rowActions={(row) =>
              row.hasPayload || row.result === 'failed' ? (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  {row.hasPayload ? (
                    <Button size="sm" variant="ghost" icon={<FileText size={15} />} aria-label={`View ${row.title}`} onClick={() => void view(row)}>
                      View
                    </Button>
                  ) : null}
                  {row.result === 'failed' && canPrint ? (
                    <Button size="sm" variant="secondary" icon={<RotateCcw size={15} />} aria-label={`Retry ${row.title}`} loading={busyId === row.id} onClick={() => void retry(row)}>
                      Retry
                    </Button>
                  ) : null}
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <Modal
        open={viewing !== null}
        size="xl"
        title={viewing ? `Failed document — ${viewing.title}` : 'Failed document'}
        description="This is the exact document the printer was asked to print."
        onClose={() => setViewing(null)}
        footer={
          <Button variant="tertiary" onClick={() => setViewing(null)}>
            Close
          </Button>
        }
      >
        {viewing ? <iframe className="print-preview" style={{ height: '58vh' }} title="Kept document" sandbox="" srcDoc={viewing.html} /> : null}
      </Modal>
    </div>
  )
}
