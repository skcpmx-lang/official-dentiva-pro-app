import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Eye, FilePlus2, Pill } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Select } from '../../components/ui/form'
import { toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { PrescriptionListItem, RangePreset } from '../../lib/types'

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'all', label: 'All time' }
]

/**
 * Prescription register.
 *
 * Searchable history of everything written: the medicines on each prescription are shown inline so a
 * clinician can spot the last course of antibiotics without opening the document.
 */
export function PrescriptionListScreen(): ReactNode {
  const navigate = useNavigate()
  const format = useFormatters()
  const canCreate = usePermission('prescriptions.create')
  const canExport = usePermission('prescriptions.export')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [dentist, setDentist] = useState('all')
  const [preset, setPreset] = useState<RangePreset>('last90')
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

  const dentists = useInvoke('dentists.list', { includeInactive: false })

  const filter = useMemo(
    () => ({
      search: debounced === '' ? undefined : debounced,
      dentistId: dentist === 'all' ? undefined : Number(dentist),
      range: { preset },
      limit: pageSize,
      offset: page * pageSize
    }),
    [debounced, dentist, preset, page]
  )

  const prescriptions = useInvoke('prescriptions.list', filter)
  const total = prescriptions.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const columns: Array<Column<PrescriptionListItem>> = [
    {
      key: 'rx',
      header: 'Prescription',
      width: 150,
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="num link-strong">{row.rxNo}</span>
          <span className="muted small">{format.dateTime(row.prescriptionAt)}</span>
        </div>
      ),
      sortValue: (row) => row.rxNo
    },
    {
      key: 'patient',
      header: 'Patient',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>
            {row.patientName}
            {row.patientAgeYears !== null ? <span className="muted small"> · {row.patientAgeYears}y</span> : null}
          </span>
          {row.patientNameBn ? <span className="bn muted small">{row.patientNameBn}</span> : null}
        </div>
      ),
      sortValue: (row) => row.patientName
    },
    { key: 'dentist', header: 'Dentist', width: 180, render: (row) => row.dentistName, sortValue: (row) => row.dentistName },
    {
      key: 'medicines',
      header: 'Medicines',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>{row.medicines.slice(0, 3).map((medicine) => medicine.medicineName).join(', ') || '—'}</span>
          {row.medicines.length > 3 ? <span className="muted small">and {row.medicines.length - 3} more</span> : null}
        </div>
      ),
      sortValue: (row) => row.medicines.length
    },
    {
      key: 'printed',
      header: 'Printed',
      width: 110,
      render: (row) => (row.printedCount > 0 ? <Badge tone="info">{row.printedCount}×</Badge> : <span className="muted small">Not yet</span>),
      sortValue: (row) => row.printedCount,
      secondary: true
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Prescriptions"
        subtitle="Every prescription written, with the signing dentist and the medicines prescribed."
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
                    const result = await invoke('prescriptions.export', { ...filter, limit: 5000, offset: 0 })
                    if (result.path === null) toast('info', 'Export cancelled')
                    else toast('success', 'Prescriptions exported', `${result.rowCount} rows written to ${result.path}`)
                  } catch (error) {
                    toast('error', 'The prescriptions could not be exported', errorMessage(error))
                  } finally {
                    setExporting(false)
                  }
                }}
              >
                Export CSV
              </Button>
            ) : null}
            {canCreate ? (
              <Button variant="primary" icon={<FilePlus2 size={16} />} onClick={() => navigate('/prescriptions/new')}>
                New prescription
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader title="Register" icon={<Pill size={17} />} subtitle="Newest first." />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search Rx no, patient, phone or medicine…" ariaLabel="Search prescriptions" />
            <Select
              value={dentist}
              onChange={(value: string) => {
                setDentist(value)
                setPage(0)
              }}
              options={[{ value: 'all', label: 'All dentists' }, ...(dentists.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.fullName }))]}
              ariaLabel="Dentist"
            />
            <Select
              value={preset}
              onChange={(value: string) => {
                setPreset(value as RangePreset)
                setPage(0)
              }}
              options={RANGE_OPTIONS}
              ariaLabel="Date range"
            />
            <Link className="link small" to="/patients">
              <ArrowLeft size={14} /> Patients
            </Link>
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={prescriptions.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={prescriptions.loading}
            emptyTitle="No prescriptions found"
            emptyMessage="Write a prescription from a visit, or change the filters above."
            rowActions={(row) => (
              <Button size="sm" variant="ghost" icon={<Eye size={15} />} onClick={() => navigate(`/prescriptions/${row.id}`)}>
                Open
              </Button>
            )}
          />
        </CardBody>
        {total > 0 ? (
          <CardBody>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted small">
                {total.toLocaleString()} prescription(s) · page {page + 1} of {pageCount}
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
