import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ClipboardList, FileText, Plus, Save, Stethoscope, Trash2 } from 'lucide-react'
import { conditionLabel } from '@shared/dental'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Segmented } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { DateInput, Field, MoneyInput, NumberInput, Select, TextArea, TextInput, TimeInput, dateInputToInstant, instantToDateInput } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import { ToothGrid } from './ToothGrid'
import type { ChartEntry, Treatment, VisitInput, VisitTreatment } from '../../lib/types'

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  draft: 'warning',
  final: 'success',
  cancelled: 'neutral'
}

const TREATMENT_STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'cancelled', label: 'Cancelled' }
]

/**
 * The visit record — the heart of the clinical module.
 *
 * One screen holds everything that belongs to a single encounter: the written record, the treatments
 * performed (with the teeth they were performed on), the findings, the dental chart entries recorded
 * during the visit and the prescriptions written for it. Saving is explicit; finalising locks the
 * record into the clinical history (it can still be amended, and every amendment is audited).
 */
export function VisitScreen(): ReactNode {
  const params = useParams()
  const navigate = useNavigate()
  const visitId = Number(params.visitId)
  const format = useFormatters()
  const canEdit = usePermission('clinical.edit')
  const canCreate = usePermission('clinical.create')
  const canDelete = usePermission('clinical.delete')
  const canPrescribe = usePermission('prescriptions.create')
  const dentists = useInvoke('dentists.list', { includeInactive: false })

  const [busy, setBusy] = useState(false)
  const [lineDialog, setLineDialog] = useState<{ open: boolean, line: VisitTreatment | null }>({ open: false, line: null })
  const [chartConditionChoice, setChartConditionChoice] = useState('')

  const visit = useInvoke('visits.get', { id: visitId })
  const chart = useInvoke('chart.get', { patientId: visit.data?.patientId ?? 0 }, { enabled: (visit.data?.patientId ?? 0) > 0 })

  const [notes, setNotes] = useState({
    chiefComplaint: '',
    history: '',
    examination: '',
    diagnosis: '',
    advice: '',
    treatmentPlan: '',
    notes: '',
    findingsSummary: ''
  })
  const [dentistId, setDentistId] = useState('')
  const [visitDate, setVisitDate] = useState<string | null>(null)
  const [visitTime, setVisitTime] = useState<string | null>(null)

  useEffect(() => {
    const data = visit.data
    if (!data) return
    setNotes({
      chiefComplaint: data.chiefComplaint ?? '',
      history: data.history ?? '',
      examination: data.examination ?? '',
      diagnosis: data.diagnosis ?? '',
      advice: data.advice ?? '',
      treatmentPlan: data.treatmentPlan ?? '',
      notes: data.notes ?? '',
      findingsSummary: data.findingsSummary ?? ''
    })
    setDentistId(String(data.dentistId))
    setVisitDate(instantToDateInput(data.visitAt))
    setVisitTime(new Date(data.visitAt).toTimeString().slice(0, 5))
  }, [visit.data])

  /*
   * The condition a tooth click records is derived while rendering — the operator's own choice, else the
   * first active condition — so the select can never display a condition the visit does not hold.
   */
  const chartConditionOptions = useMemo(
    () => (chart.data?.conditions ?? []).filter((condition) => condition.isActive).map((condition) => ({ value: condition.code, label: condition.name })),
    [chart.data]
  )
  const chartCondition = chartConditionChoice !== '' ? chartConditionChoice : chartConditionOptions[0]?.value ?? ''

  const save = async (status?: 'draft' | 'final'): Promise<void> => {
    const data = visit.data
    if (!data) return
    const visitAt = dateInputToInstant(visitDate, visitTime ?? '00:00')
    if (visitAt === null) {
      toast('warning', 'Enter the visit date', 'A visit must have a date and time.')
      return
    }
    setBusy(true)
    try {
      const payload: VisitInput = {
        id: data.id,
        patientId: data.patientId,
        dentistId: Number(dentistId) || data.dentistId,
        appointmentId: null,
        visitAt,
        chiefComplaint: notes.chiefComplaint || null,
        history: notes.history || null,
        examination: notes.examination || null,
        diagnosis: notes.diagnosis || null,
        findingsSummary: notes.findingsSummary || null,
        advice: notes.advice || null,
        treatmentPlan: notes.treatmentPlan || null,
        nextAppointmentAt: null,
        notes: notes.notes || null,
        status: status ?? data.status
      } as VisitInput
      const saved = await invoke('visits.save', payload)
      await visit.reload()
      toast('success', status === 'final' ? `Visit ${saved.visitNo} finalised` : `Visit ${saved.visitNo} saved`)
    } catch (error) {
      toast('error', 'The visit could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (status: 'draft' | 'final' | 'cancelled'): Promise<void> => {
    const data = visit.data
    if (!data) return
    if (status === 'cancelled') {
      const answer = await confirmDialog({
        title: `Cancel visit ${data.visitNo}?`,
        message: 'The visit stays in the history marked as cancelled. Invoices and prescriptions are not affected and must be handled separately.',
        confirmLabel: 'Cancel visit',
        danger: true,
        confirmationPhrase: data.visitNo
      })
      if (!answer.confirmed) return
      setBusy(true)
      try {
        await invoke('visits.setStatus', { id: data.id, status, reason: answer.phrase ?? 'Cancelled by clinical staff' })
        await visit.reload()
        toast('success', 'Visit cancelled')
      } catch (error) {
        toast('error', 'The visit could not be cancelled', errorMessage(error))
      } finally {
        setBusy(false)
      }
      return
    }
    setBusy(true)
    try {
      await invoke('visits.setStatus', { id: data.id, status, reason: null })
      await visit.reload()
      toast('success', status === 'final' ? 'Visit finalised' : 'Visit reopened as draft')
    } catch (error) {
      toast('error', 'The visit status could not be changed', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const recordChartEntry = async (toothCode: string): Promise<void> => {
    const data = visit.data
    if (!data || chartCondition === '') return
    try {
      await invoke('chart.setEntry', {
        patientId: data.patientId,
        visitId: data.id,
        toothCode,
        dentition: 'adult',
        conditionCode: chartCondition,
        treatmentCode: null,
        status: 'active',
        note: null
      })
      await chart.reload()
      toast('success', `Tooth ${toothCode} recorded`, conditionLabel(chartCondition))
    } catch (error) {
      toast('error', 'The chart entry could not be recorded', errorMessage(error))
    }
  }

  const lineColumns: Array<Column<VisitTreatment>> = [
    {
      key: 'treatment',
      header: 'Treatment',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.treatmentName}</span>
          <span className="muted small">
            {row.toothCodes.length > 0 ? `Teeth ${row.toothCodes.join(', ')}` : 'No specific tooth'}
            {row.notes ? ` · ${row.notes}` : ''}
          </span>
        </div>
      ),
      sortValue: (row) => row.treatmentName
    },
    {
      key: 'status',
      header: 'Status',
      width: 130,
      render: (row) => <Badge tone={row.status === 'completed' ? 'success' : row.status === 'cancelled' ? 'neutral' : 'warning'}>{row.status.replace('_', ' ')}</Badge>,
      sortValue: (row) => row.status
    },
    { key: 'quantity', header: 'Qty', width: 70, align: 'right', render: (row) => <span className="num">{row.quantity}</span>, sortValue: (row) => row.quantity },
    {
      key: 'unit',
      header: 'Unit fee',
      width: 130,
      align: 'right',
      render: (row) => <span className="num">{format.money(row.unitPriceMicro)}</span>,
      sortValue: (row) => row.unitPriceMicro
    },
    {
      key: 'discount',
      header: 'Discount',
      width: 120,
      align: 'right',
      render: (row) => (row.discountMicro > 0 ? <span className="num">{format.money(row.discountMicro)}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.discountMicro,
      secondary: true
    },
    {
      key: 'total',
      header: 'Total',
      width: 130,
      align: 'right',
      render: (row) => <span className="num link-strong">{format.money(row.totalMicro)}</span>,
      sortValue: (row) => row.totalMicro
    }
  ]

  if (!Number.isFinite(visitId) || visitId <= 0) {
    return (
      <div className="page">
        <PageHeader title="Visit" subtitle="That visit could not be found." />
      </div>
    )
  }

  const data = visit.data
  const byTooth = chart.data?.byTooth ?? {}
  const editable = canEdit && data?.status !== 'cancelled'

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={
          <Link to="/visits" className="row small" style={{ gap: 6, textDecoration: 'none' }}>
            <ArrowLeft size={14} /> All visits
          </Link>
        }
        title={
          data ? (
            <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
              <span className="num">{data.visitNo}</span>
              <Badge tone={STATUS_TONE[data.status] ?? 'neutral'}>{data.status}</Badge>
            </span>
          ) : (
            'Visit'
          )
        }
        subtitle={
          data ? (
            <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Link className="link" to={`/patients/${data.patientId}`}>
                {data.patientName}
              </Link>
              {data.patientNameBn ? <span className="bn muted">{data.patientNameBn}</span> : null}
              <span className="muted">· {format.dateTime(data.visitAt)} · {data.dentistName}</span>
            </span>
          ) : (
            'Loading the visit…'
          )
        }
        actions={
          data ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <Button variant="tertiary" icon={<FileText size={16} />} onClick={() => navigate(`/patients/${data.patientId}`)}>
                Patient record
              </Button>
              {canCreate ? (
                <Button
                  variant="secondary"
                  icon={<Stethoscope size={16} />}
                  onClick={() => navigate(`/chart/${data.patientId}`)}
                >
                  Dental chart
                </Button>
              ) : null}
              {editable ? (
                <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={() => void save()}>
                  Save
                </Button>
              ) : null}
              {editable && data.status === 'draft' ? (
                <Button variant="primary" loading={busy} onClick={() => void save('final')}>
                  Finalise visit
                </Button>
              ) : null}
              {canEdit && data.status === 'final' ? (
                <Button variant="tertiary" loading={busy} onClick={() => void setStatus('draft')}>
                  Reopen as draft
                </Button>
              ) : null}
              {canEdit && data.status !== 'cancelled' ? (
                <Button variant="ghost" loading={busy} onClick={() => void setStatus('cancelled')}>
                  Cancel visit
                </Button>
              ) : null}
              {canDelete && data.status === 'cancelled' && data.invoices.length === 0 && data.prescriptions.length === 0 ? (
                <Button
                  variant="danger"
                  icon={<Trash2 size={16} />}
                  onClick={async () => {
                    const answer = await confirmDialog({
                      title: 'Delete this cancelled visit?',
                      message: 'Deleting removes the visit from the clinical history. This is only possible while no invoice or prescription refers to it.',
                      confirmLabel: 'Delete visit',
                      danger: true,
                      confirmationPhrase: data.visitNo
                    })
                    if (!answer.confirmed) return
                    try {
                      await invoke('visits.delete', { id: data.id, reason: 'Deleted after cancellation' })
                      toast('success', 'Visit deleted')
                      navigate('/visits', { replace: true })
                    } catch (error) {
                      toast('error', 'The visit could not be deleted', errorMessage(error))
                    }
                  }}
                >
                  Delete
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      {data ? (
        <>
          <div className="summary-strip">
            <span className="summary-strip__item">
              <span className="summary-strip__label">Treatments</span>
              <strong className="num">{data.totals.treatmentCount}</strong>
            </span>
            <span className="summary-strip__item">
              <span className="summary-strip__label">Value</span>
              <strong className="num">{format.money(data.totals.totalMicro)}</strong>
            </span>
            <span className="summary-strip__item">
              <span className="summary-strip__label">Invoiced</span>
              <strong className="num">{format.money(data.invoices.reduce((sum, invoice) => sum + invoice.totalMicro, 0))}</strong>
            </span>
            <span className="summary-strip__item">
              <span className="summary-strip__label">Due</span>
              <strong className="num">{format.money(data.invoices.reduce((sum, invoice) => sum + invoice.dueMicro, 0))}</strong>
            </span>
            <span className="summary-strip__item">
              <span className="summary-strip__label">Prescriptions</span>
              <strong className="num">{data.prescriptions.length}</strong>
            </span>
          </div>

          <div className="grid grid--2">
            <Card>
              <CardHeader title="Clinical record" icon={<ClipboardList size={17} />} subtitle="Written notes become part of the permanent record." />
              <CardBody>
                <div className="stack">
                  <div className="grid grid--2">
                    <Field label="Dentist" htmlFor="visitDentist">
                      <Select
                        id="visitDentist"
                        value={dentistId}
                        onChange={setDentistId}
                        ariaLabel="Dentist"
                        options={(dentists.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.fullName }))}
                        disabled={!editable}
                      />
                    </Field>
                    <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                      <Field label="Date" htmlFor="visitDate">
                        <DateInput id="visitDate" value={visitDate} onChange={setVisitDate} disabled={!editable} />
                      </Field>
                      <Field label="Time" htmlFor="visitTime">
                        <TimeInput id="visitTime" value={visitTime} onChange={setVisitTime} disabled={!editable} />
                      </Field>
                    </div>
                  </div>
                  <Field label="Chief complaint" htmlFor="visitComplaint">
                    <TextArea id="visitComplaint" value={notes.chiefComplaint} onChange={(value) => setNotes({ ...notes, chiefComplaint: value })} rows={2} maxLength={1000} disabled={!editable} />
                  </Field>
                  <Field label="History" htmlFor="visitHistory">
                    <TextArea id="visitHistory" value={notes.history} onChange={(value) => setNotes({ ...notes, history: value })} rows={2} maxLength={2000} disabled={!editable} />
                  </Field>
                  <Field label="Examination" htmlFor="visitExamination">
                    <TextArea id="visitExamination" value={notes.examination} onChange={(value) => setNotes({ ...notes, examination: value })} rows={3} maxLength={2000} disabled={!editable} />
                  </Field>
                  <Field label="Diagnosis" htmlFor="visitDiagnosis">
                    <TextArea id="visitDiagnosis" value={notes.diagnosis} onChange={(value) => setNotes({ ...notes, diagnosis: value })} rows={2} maxLength={2000} disabled={!editable} />
                  </Field>
                  <Field label="Advice" htmlFor="visitAdvice">
                    <TextArea id="visitAdvice" value={notes.advice} onChange={(value) => setNotes({ ...notes, advice: value })} rows={2} maxLength={2000} disabled={!editable} />
                  </Field>
                  <Field label="Treatment plan" htmlFor="visitPlan">
                    <TextArea id="visitPlan" value={notes.treatmentPlan} onChange={(value) => setNotes({ ...notes, treatmentPlan: value })} rows={2} maxLength={2000} disabled={!editable} />
                  </Field>
                  <Field label="Internal notes" htmlFor="visitNotes" hint="Not printed on clinical documents unless you choose to include them.">
                    <TextArea id="visitNotes" value={notes.notes} onChange={(value) => setNotes({ ...notes, notes: value })} rows={2} maxLength={2000} disabled={!editable} />
                  </Field>
                  {editable ? (
                    <div className="row" style={{ gap: 8 }}>
                      <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={() => void save()}>
                        Save record
                      </Button>
                    </div>
                  ) : (
                    <p className="muted small">
                      {data.status === 'cancelled'
                        ? 'This visit is cancelled and can no longer be edited.'
                        : 'Your role can read the record but not amend it.'}
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>

            <div className="stack">
              <Card>
                <CardHeader
                  title="Treatments performed"
                  subtitle="Fees are copied to the invoice when billing is raised."
                  actions={
                    canCreate && editable ? (
                      <Button size="sm" variant="secondary" icon={<Plus size={15} />} onClick={() => setLineDialog({ open: true, line: null })}>
                        Add treatment
                      </Button>
                    ) : null
                  }
                />
                <CardBody flush>
                  <DataTable
                    columns={lineColumns}
                    rows={data.treatments}
                    getRowId={(row) => row.id}
                    emptyTitle="No treatment recorded"
                    emptyMessage="Add each procedure performed during this visit, with the teeth involved."
                    rowActions={(row) =>
                      editable ? (
                        <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <Button size="sm" variant="ghost" onClick={() => setLineDialog({ open: true, line: row })}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 size={15} />}
                            aria-label={`Remove ${row.treatmentName}`}
                            onClick={async () => {
                              const answer = await confirmDialog({
                                title: `Remove “${row.treatmentName}”?`,
                                message: 'Removing a treatment line cannot be undone. Invoiced lines must be voided on their invoice first.',
                                confirmLabel: 'Remove',
                                danger: true
                              })
                              if (!answer.confirmed) return
                              try {
                                await invoke('visits.treatments.remove', { id: row.id })
                                await visit.reload()
                                toast('success', 'Treatment line removed')
                              } catch (error) {
                                toast('error', 'The treatment line could not be removed', errorMessage(error))
                              }
                            }}
                          />
                        </div>
                      ) : null
                    }
                  />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Dental chart entry" subtitle="Click a tooth to record the selected condition on this visit." />
                <CardBody>
                  <div className="stack">
                    <Select
                      value={chartCondition}
                      onChange={setChartConditionChoice}
                      ariaLabel="Condition"
                      options={chartConditionOptions}
                    />
                    <ToothGrid
                      dentition="adult"
                      byTooth={byTooth as Record<string, ChartEntry>}
                      disabled={!canCreate || !editable}
                      onSelect={(code) => void recordChartEntry(code)}
                    />
                    <p className="muted small">
                      {chart.data && chart.data.entries.length > 0
                        ? `${chart.data.entries.length} chart entr(y/ies) recorded for this patient.`
                        : 'Nothing on the chart yet for this patient.'}{' '}
                      <Link className="link" to={`/chart/${data.patientId}`}>
                        Open the full chart
                      </Link>
                    </p>
                  </div>
                </CardBody>
              </Card>

              <FindingsCard visitId={data.id} findings={data.findings} editable={Boolean(editable)} onSaved={() => void visit.reload()} />

              <Card>
                <CardHeader
                  title="Prescriptions"
                  icon={<FileText size={17} />}
                  subtitle="Prescriptions written for this visit."
                  actions={
                    canPrescribe && editable ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<Plus size={15} />}
                        onClick={() => navigate(`/prescriptions/new?patientId=${data.patientId}&dentistId=${data.dentistId}&visitId=${data.id}`)}
                      >
                        Write prescription
                      </Button>
                    ) : null
                  }
                />
                <CardBody>
                  {data.prescriptions.length === 0 ? (
                    <p className="muted small">No prescription written for this visit.</p>
                  ) : (
                    <ul className="plain-list">
                      {data.prescriptions.map((prescription) => (
                        <li key={prescription.id} className="plain-list__item">
                          <span className="stack" style={{ gap: 2 }}>
                            <span className="num link-strong">{prescription.rxNo}</span>
                            <span className="muted small">{format.dateTime(prescription.prescriptionAt)}</span>
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => navigate(`/prescriptions/${prescription.id}`)}>
                            Open
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>

              {data.invoices.length > 0 ? (
                <Card>
                  <CardHeader title="Invoices" subtitle="Raised for this visit. Billing screens handle payments and refunds." />
                  <CardBody>
                    <ul className="plain-list">
                      {data.invoices.map((invoice) => (
                        <li key={invoice.id} className="plain-list__item">
                          <span className="stack" style={{ gap: 2 }}>
                            <span className="num link-strong">{invoice.invoiceNo}</span>
                            <span className="muted small">
                              {format.money(invoice.totalMicro)} · paid {format.money(invoice.paidMicro)} · due {format.money(invoice.dueMicro)}
                            </span>
                          </span>
                          <Badge tone={invoice.dueMicro > 0 ? 'warning' : 'success'}>{invoice.status}</Badge>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <Card>
          <CardBody>
            <p className="muted">Loading the visit…</p>
          </CardBody>
        </Card>
      )}

      {data ? (
        <TreatmentLineDialog
          open={lineDialog.open}
          line={lineDialog.line}
          visitId={data.id}
          onClose={() => setLineDialog({ open: false, line: null })}
          onSaved={() => {
            void visit.reload()
            void chart.reload()
          }}
        />
      ) : null}
    </div>
  )
}

/** Findings recorded on the visit, chosen from the clinical vocabulary. */
function FindingsCard({
  visitId,
  findings,
  editable,
  onSaved
}: {
  visitId: number
  findings: Array<{ id: number, findingCode: string, findingName: string, toothCode: string | null, severity: string | null, notes: string | null }>
  editable: boolean
  onSaved(): void
}): ReactNode {
  const [draft, setDraft] = useState(findings)
  const [busy, setBusy] = useState(false)
  const conditions = useInvoke('chart.conditions', { includeInactive: false })

  useEffect(() => {
    setDraft(findings)
  }, [findings])

  const save = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('visits.findings.set', {
        visitId,
        findings: draft.map((finding) => ({
          findingId: null,
          findingCode: finding.findingCode,
          toothCode: finding.toothCode,
          severity: finding.severity,
          notes: finding.notes
        }))
      })
      toast('success', 'Findings saved')
      onSaved()
    } catch (error) {
      toast('error', 'The findings could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Clinical findings"
        subtitle="Vocabulary-driven findings, optionally tied to a tooth."
        actions={
          editable ? (
            <div className="row" style={{ gap: 8 }}>
              <Button
                size="sm"
                variant="tertiary"
                icon={<Plus size={15} />}
                onClick={() => setDraft([...draft, { id: 0, findingCode: 'caries', findingName: conditionLabel('caries'), toothCode: null, severity: null, notes: null }])}
              >
                Add
              </Button>
              <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
                Save findings
              </Button>
            </div>
          ) : null
        }
      />
      <CardBody>
        {draft.length === 0 ? (
          <p className="muted small">No findings recorded on this visit.</p>
        ) : (
          <div className="stack">
            {draft.map((finding, index) => (
              <div key={`${finding.id}-${index}`} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <Field label={index === 0 ? 'Finding' : ''} htmlFor={`finding-${index}`}>
                  <Select
                    id={`finding-${index}`}
                    value={finding.findingCode}
                    onChange={(value: string) =>
                      setDraft(draft.map((entry, entryIndex) => (entryIndex === index ? { ...entry, findingCode: value, findingName: conditionLabel(value) } : entry)))
                    }
                    ariaLabel="Finding"
                    disabled={!editable}
                    options={(conditions.data ?? []).map((condition) => ({ value: condition.code, label: condition.name }))}
                  />
                </Field>
                <Field label={index === 0 ? 'Tooth' : ''} htmlFor={`finding-tooth-${index}`}>
                  <TextInput
                    id={`finding-tooth-${index}`}
                    value={finding.toothCode ?? ''}
                    onChange={(value) => setDraft(draft.map((entry, entryIndex) => (entryIndex === index ? { ...entry, toothCode: value || null } : entry)))}
                    maxLength={8}
                    disabled={!editable}
                  />
                </Field>
                <Field label={index === 0 ? 'Severity' : ''} htmlFor={`finding-severity-${index}`}>
                  <TextInput
                    id={`finding-severity-${index}`}
                    value={finding.severity ?? ''}
                    onChange={(value) => setDraft(draft.map((entry, entryIndex) => (entryIndex === index ? { ...entry, severity: value || null } : entry)))}
                    maxLength={20}
                    disabled={!editable}
                  />
                </Field>
                <Field label={index === 0 ? 'Notes' : ''} htmlFor={`finding-notes-${index}`}>
                  <TextInput
                    id={`finding-notes-${index}`}
                    value={finding.notes ?? ''}
                    onChange={(value) => setDraft(draft.map((entry, entryIndex) => (entryIndex === index ? { ...entry, notes: value || null } : entry)))}
                    maxLength={300}
                    disabled={!editable}
                  />
                </Field>
                {editable ? (
                  <Button
                    variant="ghost"
                    icon={<Trash2 size={15} />}
                    aria-label={`Remove finding ${index + 1}`}
                    onClick={() => setDraft(draft.filter((_, entryIndex) => entryIndex !== index))}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  )
}

/** Add or edit one treatment line, including the teeth it was performed on. */
function TreatmentLineDialog({
  open,
  line,
  visitId,
  onClose,
  onSaved
}: {
  open: boolean
  line: VisitTreatment | null
  visitId: number
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [treatmentId, setTreatmentId] = useState('')
  const [name, setName] = useState('')
  const [teeth, setTeeth] = useState<string[]>([])
  const [quantity, setQuantity] = useState(1)
  const [unitPrice, setUnitPrice] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [status, setStatus] = useState<VisitTreatment['status']>('completed')
  const [lineNotes, setLineNotes] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const treatments = useInvoke('treatments.list', { includeInactive: false }, { enabled: open })

  useEffect(() => {
    if (!open) return
    if (line) {
      setTreatmentId(line.treatmentId ? String(line.treatmentId) : '')
      setName(line.treatmentName)
      setTeeth(line.toothCodes)
      setQuantity(line.quantity)
      setUnitPrice(line.unitPriceMicro)
      setDiscount(line.discountMicro)
      setStatus(line.status)
      setLineNotes(line.notes ?? '')
      return
    }
    setTreatmentId('')
    setName('')
    setTeeth([])
    setQuantity(1)
    setUnitPrice(0)
    setDiscount(0)
    setStatus('completed')
    setLineNotes('')
  }, [open, line])

  const chooseTreatment = (id: string): void => {
    setTreatmentId(id)
    const treatment: Treatment | undefined = (treatments.data ?? []).find((entry) => String(entry.id) === id)
    if (treatment) {
      setName(treatment.name)
      setUnitPrice(treatment.defaultPriceMicro)
    }
  }

  const submit = async (): Promise<void> => {
    if (name.trim().length === 0) {
      toast('warning', 'Choose a treatment', 'Select a treatment from the catalogue or type a description.')
      return
    }
    setBusy(true)
    try {
      const payload = {
        visitId,
        treatmentId: treatmentId === '' ? null : Number(treatmentId),
        treatmentName: name.trim(),
        toothCodes: teeth,
        quantity,
        unitPriceMicro: unitPrice,
        discountMicro: discount,
        status,
        notes: lineNotes.trim() === '' ? null : lineNotes.trim()
      }
      if (line) await invoke('visits.treatments.update', { ...payload, id: line.id })
      else await invoke('visits.treatments.add', payload)
      toast('success', line ? 'Treatment line updated' : 'Treatment added')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The treatment line could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const selectedTeeth = useMemo(() => teeth, [teeth])

  return (
    <>
      <Modal
        open={open}
        size="lg"
        title={line ? `Edit ${line.treatmentName}` : 'Add treatment'}
        description="The fee recorded here is what the patient is billed for this line."
        busy={busy}
        onClose={onClose}
        footer={
          <>
            <Button variant="tertiary" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void submit()}>
              {line ? 'Save line' : 'Add to visit'}
            </Button>
          </>
        }
      >
        <div className="grid grid--2">
          <Field label="Treatment" htmlFor="lineTreatment" required hint="Picking from the catalogue fills the usual fee.">
            <Select
              id="lineTreatment"
              value={treatmentId}
              onChange={chooseTreatment}
              ariaLabel="Treatment"
              options={[{ value: '', label: 'Custom / not in catalogue' }, ...(treatments.data ?? []).map((entry) => ({ value: String(entry.id), label: `${entry.name} · ${entry.code}` }))]}
            />
          </Field>
          <Field label="Description" htmlFor="lineName" required>
            <TextInput id="lineName" value={name} onChange={setName} maxLength={160} />
          </Field>
          <Field label="Teeth" htmlFor="lineTeeth" hint="FDI numbers, comma separated (for example 36, 37).">
            <div className="row" style={{ gap: 8 }}>
              <TextInput id="lineTeeth" value={teeth.join(', ')} onChange={(value) => setTeeth(value.split(',').map((entry) => entry.trim().toUpperCase()).filter((entry) => entry.length > 0))} />
              <Button type="button" variant="secondary" onClick={() => setPickerOpen(true)}>
                Pick
              </Button>
            </div>
          </Field>
          <Field label="Status" htmlFor="lineStatus">
            <Select id="lineStatus" value={status} onChange={(value: string) => setStatus(value as VisitTreatment['status'])} ariaLabel="Status" options={TREATMENT_STATUS_OPTIONS} />
          </Field>
          <Field label="Quantity" htmlFor="lineQuantity">
            <NumberInput id="lineQuantity" value={quantity} onChange={(value) => setQuantity(value ?? 1)} min={0.01} max={1000} />
          </Field>
          <Field label="Unit fee (৳)" htmlFor="linePrice">
            <MoneyInput id="linePrice" value={unitPrice} onChange={(value) => setUnitPrice(value ?? 0)} />
          </Field>
          <Field label="Discount (৳)" htmlFor="lineDiscount" hint="Discounts above your role limit are refused when the invoice is raised.">
            <MoneyInput id="lineDiscount" value={discount} onChange={(value) => setDiscount(value ?? 0)} />
          </Field>
          <Field label="Line total" htmlFor="lineTotal">
            <TextInput id="lineTotal" value={(Math.round(quantity * unitPrice) - discount).toString()} onChange={() => undefined} disabled />
          </Field>
          <Field label="Notes" htmlFor="lineNotes" span={2}>
            <TextInput id="lineNotes" value={lineNotes} onChange={setLineNotes} maxLength={500} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={pickerOpen}
        size="xl"
        title="Choose the teeth involved"
        description="Click the teeth treated in this line. The selection is stored as FDI numbers."
        onClose={() => setPickerOpen(false)}
        footer={
          <>
            <Button variant="tertiary" onClick={() => setTeeth([])}>
              Clear selection
            </Button>
            <Button variant="primary" onClick={() => setPickerOpen(false)}>
              Use {selectedTeeth.length} tooth(es)
            </Button>
          </>
        }
      >
        <div className="stack">
          <Segmented
            value="adult"
            ariaLabel="Dentition"
            onChange={() => undefined}
            options={[
              { value: 'adult', label: 'Adult (11–48)' },
              { value: 'primary', label: 'Primary (51–85)' }
            ]}
          />
          <p className="muted small">Primary teeth are recorded the same way — pick 51–85 for a child.</p>
          <ToothGrid
            dentition="adult"
            selected={teeth}
            onSelect={(code) => setTeeth((current) => (current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code].sort()))}
          />
          <ToothGrid
            dentition="primary"
            selected={teeth}
            onSelect={(code) => setTeeth((current) => (current.includes(code) ? current.filter((entry) => entry !== code) : [...current, code].sort()))}
          />
        </div>
      </Modal>
    </>
  )
}
