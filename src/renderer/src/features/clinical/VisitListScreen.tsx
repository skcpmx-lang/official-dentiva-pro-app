import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarPlus, Download, Eye, Stethoscope } from 'lucide-react'
import { zVisitInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Switch, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { VisitInput, VisitListItem, RangePreset } from '../../lib/types'

const RANGE_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'last90', label: 'Last 90 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'all', label: 'All time' }
]

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'final', label: 'Final' },
  { value: 'cancelled', label: 'Cancelled' }
]

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'warning',
  final: 'success',
  cancelled: 'neutral'
}

/**
 * Visit register.
 *
 * Every clinical encounter is a visit: complaints, examination, diagnosis, treatments performed, chart
 * entries and prescriptions all hang off it. This list is the clinic's work history, searchable by
 * patient, document number, phone or clinical text.
 */
export function VisitListScreen(): ReactNode {
  const navigate = useNavigate()
  const format = useFormatters()
  const canCreate = usePermission('clinical.create')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [dentist, setDentist] = useState('all')
  const [status, setStatus] = useState('all')
  const [preset, setPreset] = useState<RangePreset>('last30')
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
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
      status: status === 'all' ? undefined : (status as VisitListItem['status']),
      mine: mine || undefined,
      range: { preset },
      limit: pageSize,
      offset: page * pageSize
    }),
    [debounced, dentist, status, mine, preset, page]
  )

  const visits = useInvoke('visits.list', filter)
  const total = visits.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  const columns: Array<Column<VisitListItem>> = [
    {
      key: 'visit',
      header: 'Visit',
      width: 165,
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="num link-strong">{row.visitNo}</span>
          <span className="muted small">{format.dateTime(row.visitAt)}</span>
        </div>
      ),
      sortValue: (row) => row.visitNo
    },
    {
      key: 'patient',
      header: 'Patient',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>{row.patientName}{row.patientAgeYears !== null ? <span className="muted small"> · {row.patientAgeYears}y</span> : null}</span>
          {row.patientNameBn ? <span className="bn muted small">{row.patientNameBn}</span> : null}
        </div>
      ),
      sortValue: (row) => row.patientName
    },
    {
      key: 'dentist',
      header: 'Dentist',
      width: 190,
      render: (row) => <span>{row.dentistName}</span>,
      sortValue: (row) => row.dentistName
    },
    {
      key: 'diagnosis',
      header: 'Diagnosis / treatments',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>{row.diagnosis ?? row.chiefComplaint ?? <span className="muted">—</span>}</span>
          <span className="muted small">
            {row.treatments.length === 0 ? 'No treatment recorded' : row.treatments.map((entry) => entry.treatmentName).join(', ')}
          </span>
        </div>
      ),
      sortValue: (row) => row.diagnosis ?? ''
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (row) => <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>{row.status}</Badge>,
      sortValue: (row) => row.status
    },
    {
      key: 'value',
      header: 'Treatments value',
      width: 150,
      align: 'right',
      render: (row) => <span className="num">{format.money(row.totals.totalMicro)}</span>,
      sortValue: (row) => row.totals.totalMicro
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Visits"
        subtitle="Clinical encounters with their diagnosis, treatments and prescriptions."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="tertiary"
              icon={<Download size={16} />}
              loading={exporting}
              onClick={async () => {
                setExporting(true)
                try {
                  const result = await invoke('visits.export', { ...filter, limit: 5000, offset: 0 })
                  if (result.path === null) toast('info', 'Export cancelled')
                  else toast('success', 'Visits exported', `${result.rowCount} rows written to ${result.path}`)
                } catch (error) {
                  toast('error', 'The visits could not be exported', errorMessage(error))
                } finally {
                  setExporting(false)
                }
              }}
            >
              Export CSV
            </Button>
            {canCreate ? (
              <Button variant="primary" icon={<CalendarPlus size={16} />} onClick={() => setCreating(true)}>
                New visit
              </Button>
            ) : null}
          </div>
        }
      />

      <Card>
        <CardHeader title="Visit register" icon={<Stethoscope size={17} />} subtitle="Newest first. Draft visits are still being written up." />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search visit no, patient, phone or diagnosis…" ariaLabel="Search visits" />
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
              value={status}
              onChange={(value: string) => {
                setStatus(value)
                setPage(0)
              }}
              options={STATUS_OPTIONS}
              ariaLabel="Status"
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
            <Switch checked={mine} onChange={(checked) => { setMine(checked); setPage(0) }} label="My visits only" />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={visits.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={visits.loading}
            emptyTitle="No visits found"
            emptyMessage="Adjust the filters, or record a new visit from here or from the patient's profile."
            rowActions={(row) => (
              <Button size="sm" variant="ghost" icon={<Eye size={15} />} onClick={() => navigate(`/visits/${row.id}`)}>
                Open
              </Button>
            )}
          />
        </CardBody>
        {total > 0 ? (
          <CardBody>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="muted small">
                {total.toLocaleString()} visit(s) · page {page + 1} of {pageCount}
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

      <NewVisitDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(visitId) => {
          void visits.reload()
          navigate(`/visits/${visitId}`)
        }}
      />
    </div>
  )
}

/** Patient picker + first details. Full clinical notes are written on the visit screen. */
function NewVisitDialog({ open, onClose, onCreated }: { open: boolean; onClose(): void; onCreated(visitId: number): void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [patientId, setPatientId] = useState('')
  const [dentistId, setDentistId] = useState('')

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(patientSearch.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [patientSearch])

  const dentists = useInvoke('dentists.list', { includeInactive: false })
  const patients = useInvoke('patients.list', { search: debounced === '' ? undefined : debounced, status: 'active', limit: 25, offset: 0 })

  const form = useZodForm(zVisitInput, {
    id: null,
    patientId: 0,
    dentistId: 0,
    appointmentId: null,
    visitAt: Date.now(),
    chiefComplaint: null,
    history: null,
    examination: null,
    diagnosis: null,
    findingsSummary: null,
    advice: null,
    treatmentPlan: null,
    nextAppointmentAt: null,
    notes: null,
    status: 'draft'
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      id: null,
      patientId: 0,
      dentistId: 0,
      appointmentId: null,
      visitAt: Date.now(),
      chiefComplaint: null,
      history: null,
      examination: null,
      diagnosis: null,
      findingsSummary: null,
      advice: null,
      treatmentPlan: null,
      nextAppointmentAt: null,
      notes: null,
      status: 'draft'
    })
    setPatientSearch('')
    setPatientId('')
    setDentistId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (dentistId === '' && dentists.data && dentists.data.length > 0) setDentistId(String(dentists.data[0]?.id))
  }, [dentists.data, dentistId])

  const start = async (): Promise<void> => {
    if (patientId === '') {
      toast('warning', 'Choose a patient', 'Search for the patient by name, ID or phone number.')
      return
    }
    if (dentistId === '') {
      toast('warning', 'Choose a dentist', 'Every visit belongs to the dentist who performed it.')
      return
    }
    const payload: VisitInput = {
      ...(form.values as VisitInput),
      patientId: Number(patientId),
      dentistId: Number(dentistId)
    }
    setBusy(true)
    try {
      const visit = await invoke('visits.save', payload)
      toast('success', `Visit ${visit.visitNo} started`, 'Add examination notes and treatments on the visit screen.')
      onCreated(visit.id)
      onClose()
    } catch (error) {
      toast('error', 'The visit could not be started', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const patientOptions = [
    { value: '', label: debounced === '' ? 'Search for a patient…' : 'Select a patient…' },
    ...(patients.data?.items ?? []).map((entry) => ({ value: String(entry.id), label: `${entry.code} · ${entry.fullName}${entry.phone ? ` · ${entry.phone}` : ''}` }))
  ]

  return (
    <Modal
      open={open}
      size="lg"
      title="New visit"
      description="Pick the patient and the treating dentist, then record the clinical details."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void start()}>
            Start visit
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Find patient" htmlFor="visitPatientSearch" hint="Type a name, patient ID or phone number. Bangla names can be typed directly.">
          <TextInput id="visitPatientSearch" value={patientSearch} onChange={setPatientSearch} maxLength={80} autoFocus />
        </Field>
        <Field label="Patient" htmlFor="visitPatient" required>
          <Select
            id="visitPatient"
            value={patientId}
            onChange={setPatientId}
            options={patientOptions}
            ariaLabel="Patient"
            disabled={patients.loading && patients.data === null}
          />
        </Field>
        <div className="grid grid--2">
          <Field label="Dentist" htmlFor="visitDentist" required>
            <Select
              id="visitDentist"
              value={dentistId}
              onChange={setDentistId}
              options={(dentists.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.fullName }))}
              ariaLabel="Dentist"
            />
          </Field>
          <Field label="Chief complaint" htmlFor="visitComplaint">
            <TextInput
              id="visitComplaint"
              value={String(form.values.chiefComplaint ?? '')}
              onChange={(value) => form.setValue('chiefComplaint', value || null)}
              maxLength={1000}
            />
          </Field>
        </div>
        <Field label="Notes" htmlFor="visitNotes" hint="Optional at this point — the full record is written on the visit screen.">
          <TextArea id="visitNotes" value={String(form.values.notes ?? '')} onChange={(value) => form.setValue('notes', value || null)} rows={2} maxLength={2000} />
        </Field>
        <p className="muted small">
          The visit is created as a draft and keeps that status until you finalise it. Draft visits are visible to clinical staff only for their department&apos;s
          reports.
        </p>
      </div>
    </Modal>
  )
}
