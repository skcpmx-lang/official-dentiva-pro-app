import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Filter, Plus, UserPlus } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Segmented, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Select } from '../../components/ui/form'
import { confirmDialog, toast } from '../../components/ui/overlay'
import { invoke, useInvoke } from '../../lib/api'
import { errorMessage } from '../../lib/api'
import { GENDERS, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { Patient, PatientFilterInput } from '../../lib/types'

/**
 * Patient registry.
 *
 * Search covers Latin and Bengali names, patient IDs, phone numbers and addresses (the main process
 * searches the folded columns, so Bengali text matches regardless of how it was typed). Filters and the
 * page position live in the URL, which means a list can be bookmarked, restored after a refresh and
 * shared inside the clinic by copying the address bar.
 */
export function PatientListScreen(): ReactNode {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const formatters = useFormatters()
  const canCreate = usePermission('patients.create')
  const canExport = usePermission('patients.export')
  const canArchive = usePermission('patients.archive')

  const [search, setSearch] = useState(params.get('q') ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(search)
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>(() => ((params.get('status') as 'active' | 'archived' | 'all') ?? 'active'))
  const [hasDue, setHasDue] = useState(params.get('filter') === 'due')
  const [tag, setTag] = useState(params.get('tag') ?? '')
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const next = new URLSearchParams()
    if (debouncedSearch) next.set('q', debouncedSearch)
    if (status !== 'active') next.set('status', status)
    if (hasDue) next.set('filter', 'due')
    if (tag) next.set('tag', tag)
    setParams(next, { replace: true })
    setOffset(0)
  }, [debouncedSearch, status, hasDue, tag, setParams])

  const filter = useMemo<PatientFilterInput>(
    () => ({
      search: debouncedSearch || undefined,
      status,
      hasDue: hasDue || undefined,
      tags: tag ? [tag] : undefined,
      sortBy: 'recent',
      limit,
      offset
    }),
    [debouncedSearch, status, hasDue, tag, limit, offset]
  )

  const page = useInvoke('patients.list', filter)
  const tags = useInvoke('patients.tags', {})

  const handleExport = async (): Promise<void> => {
    try {
      const result = await invoke('patients.export', filter)
      if (result.path) toast('success', `Exported ${result.rowCount} patient record(s)`, result.path)
    } catch (error) {
      toast('error', 'The export could not be created', errorMessage(error))
    }
  }

  const handleArchive = async (patient: Patient): Promise<void> => {
    const answer = await confirmDialog({
      title: `Archive ${patient.fullName}?`,
      message: 'The patient disappears from the active list but every visit, prescription and invoice stays available for reporting and audit.',
      detail: `${patient.code} · registered ${patient.registrationDate}${patient.dueMicro > 0 ? ` · outstanding due ${formatters.money(patient.dueMicro)}` : ''}`,
      confirmLabel: 'Archive patient',
      danger: true,
      consequences: ['No record is deleted', 'The record can be restored later', 'Printing and billing for this patient are paused']
    })
    if (!answer.confirmed) return
    setBusyId(patient.id)
    try {
      await invoke('patients.archive', { id: patient.id, reason: null })
      toast('success', `${patient.fullName} was archived`)
      await page.reload()
    } catch (error) {
      toast('error', 'The patient could not be archived', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const handleRestore = async (patient: Patient): Promise<void> => {
    setBusyId(patient.id)
    try {
      await invoke('patients.restore', { id: patient.id })
      toast('success', `${patient.fullName} was restored`)
      await page.reload()
    } catch (error) {
      toast('error', 'The patient could not be restored', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const columns: Array<Column<Patient>> = [
    {
      key: 'code',
      header: 'Patient ID',
      width: 132,
      render: (row) => <span className="num">{row.code}</span>,
      sortValue: (row) => row.code
    },
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.fullName}</span>
          {row.fullNameBn ? <span className="bn muted small">{row.fullNameBn}</span> : null}
        </div>
      ),
      sortValue: (row) => row.fullName
    },
    {
      key: 'age',
      header: 'Age / gender',
      width: 130,
      render: (row) => `${row.ageLabel ?? '—'} · ${GENDERS.find((entry) => entry.value === row.gender)?.label ?? row.gender}`,
      sortValue: (row) => row.ageYears ?? -1
    },
    {
      key: 'phone',
      header: 'Phone',
      width: 140,
      render: (row) => (row.phone ? <span className="num">{row.phone}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.phone ?? ''
    },
    {
      key: 'lastVisit',
      header: 'Last visit',
      width: 130,
      render: (row) => (row.lastVisitAt ? formatters.date(row.lastVisitAt) : <span className="muted">never</span>),
      sortValue: (row) => row.lastVisitAt ?? 0,
      secondary: true
    },
    {
      key: 'visits',
      header: 'Visits',
      width: 90,
      align: 'right',
      render: (row) => <span className="num">{row.visitCount}</span>,
      sortValue: (row) => row.visitCount,
      secondary: true
    },
    {
      key: 'due',
      header: 'Due',
      width: 120,
      align: 'right',
      render: (row) => (row.dueMicro > 0 ? <span className="text-danger num">{formatters.money(row.dueMicro)}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.dueMicro
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (row) =>
        row.status === 'active' ? <Badge tone="success">Active</Badge> : row.status === 'deceased' ? <Badge tone="neutral">Deceased</Badge> : <Badge tone="warning">Archived</Badge>,
      sortValue: (row) => row.status
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Patients"
        subtitle={page.data ? `${formatters.number(page.data.total)} record(s) matching the current filters` : 'Loading the patient registry'}
        actions={
          <>
            {canExport ? (
              <Button variant="secondary" icon={<Download size={16} />} onClick={() => void handleExport()}>
                Export CSV
              </Button>
            ) : null}
            {canCreate ? (
              <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => navigate('/patients/new')}>
                New patient
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <CardHeader
          title="Search and filter"
          icon={<Filter size={17} />}
          subtitle="Search by name (English or Bangla), patient ID, phone number or address"
        />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search patients…" ariaLabel="Search patients" autoFocus />
            <Segmented
              ariaLabel="Patient status"
              value={status}
              onChange={(value) => setStatus(value as 'active' | 'archived' | 'all')}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
                { value: 'all', label: 'All' }
              ]}
            />
            <Select
              ariaLabel="Filter by tag"
              value={tag}
              onChange={setTag}
              placeholder="Any tag"
              options={(tags.data ?? []).map((entry) => ({ value: entry.tag, label: `${entry.tag} (${entry.count})` }))}
            />
            <label className="checkbox">
              <input type="checkbox" checked={hasDue} onChange={(event) => setHasDue(event.target.checked)} />
              <span>Only patients with dues</span>
            </label>
          </Toolbar>
        </CardBody>
      </Card>

      <Card>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={page.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={page.loading}
            error={
              page.error ? (
                <div className="stack" style={{ alignItems: 'center' }}>
                  <span className="state__title">The patient list could not be loaded</span>
                  <span className="state__message">{page.error.message}</span>
                  <Button variant="secondary" onClick={() => void page.reload()}>
                    Try again
                  </Button>
                </div>
              ) : undefined
            }
            caption="Patient registry"
            emptyTitle={debouncedSearch ? 'No patient matches this search' : 'No patients yet'}
            emptyMessage={
              debouncedSearch
                ? 'Try a different spelling, part of the phone number, or the patient ID printed on the receipt.'
                : 'Register the first patient to start recording visits, prescriptions and invoices.'
            }
            emptyAction={
              canCreate ? (
                <Button variant="primary" icon={<Plus size={16} />} onClick={() => navigate('/patients/new')}>
                  Register a patient
                </Button>
              ) : undefined
            }
            onRowClick={(row) => navigate(`/patients/${row.id}`)}
            rowActions={(row) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <Link className="btn btn--tertiary btn--sm" to={`/patients/${row.id}`}>
                  Open
                </Link>
                {row.status === 'active' && canArchive ? (
                  <Button size="sm" variant="ghost" loading={busyId === row.id} onClick={() => void handleArchive(row)}>
                    Archive
                  </Button>
                ) : null}
                {row.status !== 'active' && canArchive ? (
                  <Button size="sm" variant="ghost" loading={busyId === row.id} onClick={() => void handleRestore(row)}>
                    Restore
                  </Button>
                ) : null}
              </div>
            )}
            footer={
              page.data && page.data.total > 0 ? (
                <div className="toolbar" style={{ justifyContent: 'space-between', padding: 'var(--sp-3) var(--sp-4)' }}>
                  <span className="muted small">
                    Showing {page.data.offset + 1}–{Math.min(page.data.offset + page.data.limit, page.data.total)} of {page.data.total}
                  </span>
                  <div className="row" style={{ gap: 8 }}>
                    <Button size="sm" variant="tertiary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}>
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      disabled={page.data.offset + page.data.limit >= page.data.total}
                      onClick={() => setOffset(offset + limit)}
                    >
                      Next
                    </Button>
                    <Select
                      ariaLabel="Rows per page"
                      value={String(limit)}
                      onChange={(value) => {
                        setLimit(Number(value))
                        setOffset(0)
                      }}
                      options={[
                        { value: '25', label: '25 / page' },
                        { value: '50', label: '50 / page' },
                        { value: '100', label: '100 / page' },
                        { value: '250', label: '250 / page' }
                      ]}
                    />
                  </div>
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>
    </div>
  )
}
