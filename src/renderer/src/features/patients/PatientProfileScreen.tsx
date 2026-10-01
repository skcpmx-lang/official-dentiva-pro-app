import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarPlus,
  FileText,
  FolderOpen,
  MapPin,
  Pencil,
  Phone,
  Pill,
  Receipt,
  Trash2,
  Upload
} from 'lucide-react'
import { zReferralInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Stat, Tabs } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, Select, TextArea, TextInput, DateInput, useZodForm } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { GENDERS, useFormatters } from '../../lib/format'
import { readFileAsBase64 } from '../../lib/files'
import { PrintDialog } from '../printing/PrintDialog'
import { usePermission } from '../../store/appStore'
import type { PatientAttachment, Referral, TimelineEntry } from '../../lib/types'

/**
 * Patient profile.
 *
 * One screen for the whole patient story: identity and alerts, the merged timeline across every module
 * (visits, treatments, chart entries, prescriptions, invoices, payments, appointments, referrals and
 * attachments), the financial position with ageing, the attachment archive and referrals.
 *
 * Content is permission-aware: the timeline only contains sources the operator may read, and action
 * buttons are hidden for roles without the matching permission (the main process enforces the same
 * rules regardless).
 */
type TabId = 'overview' | 'timeline' | 'attachments' | 'referrals'

export function PatientProfileScreen(): ReactNode {
  const params = useParams<{ patientId: string }>()
  const patientId = Number(params.patientId)
  const navigate = useNavigate()
  const formatters = useFormatters()
  const [tab, setTab] = useState<TabId>('overview')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [referralOpen, setReferralOpen] = useState(false)
  const [timelineKind, setTimelineKind] = useState<string>('all')

  const canEdit = usePermission('patients.edit')
  const canPrint = usePermission('printing.print')
  const [printOpen, setPrintOpen] = useState(false)
  const canSeeBilling = usePermission('billing.view')

  const summary = useInvoke('patients.summary', { id: patientId }, { enabled: Number.isFinite(patientId) })
  const timeline = useInvoke(
    'patients.timeline',
    { patientId, limit: 100, offset: 0, kinds: timelineKind === 'all' ? undefined : [timelineKind] },
    { enabled: tab === 'timeline' }
  )
  const attachments = useInvoke('attachments.list', { patientId }, { enabled: tab === 'attachments' })
  const referrals = useInvoke('referrals.list', { patientId }, { enabled: tab === 'referrals' })

  const patient = summary.data?.patient
  const financials = summary.data?.financials

  const timelineColumns: Array<Column<TimelineEntry>> = useMemo(
    () => [
      { key: 'at', header: 'When', width: 150, render: (row) => formatters.dateTime(row.at), sortValue: (row) => row.at },
      {
        key: 'kind',
        header: 'Type',
        width: 130,
        render: (row) => <Badge tone={row.kind === 'payment' ? 'success' : row.kind === 'invoice' ? 'info' : 'neutral'}>{row.kind}</Badge>,
        sortValue: (row) => row.kind
      },
      {
        key: 'title',
        header: 'Record',
        render: (row) => (
          <div className="stack" style={{ gap: 2 }}>
            <span>{row.title}</span>
            {row.description ? <span className="muted small">{row.description}</span> : null}
          </div>
        ),
        sortValue: (row) => row.title
      },
      { key: 'dentist', header: 'Dentist', width: 160, render: (row) => row.dentistName ?? '—', secondary: true },
      {
        key: 'amount',
        header: 'Amount',
        width: 130,
        align: 'right',
        render: (row) => (row.amountMicro === null ? '—' : formatters.money(row.amountMicro)),
        sortValue: (row) => row.amountMicro ?? 0
      }
    ],
    [formatters]
  )

  const attachmentColumns: Array<Column<PatientAttachment>> = [
    { key: 'name', header: 'File', render: (row) => row.fileName, sortValue: (row) => row.fileName },
    { key: 'kind', header: 'Type', width: 110, render: (row) => <Badge tone="neutral">{row.kind}</Badge>, sortValue: (row) => row.kind },
    { key: 'date', header: 'Date', width: 120, render: (row) => formatters.date(Date.parse(`${row.attachmentDate}T00:00:00`)), sortValue: (row) => row.attachmentDate },
    { key: 'size', header: 'Size', width: 100, align: 'right', render: (row) => `${Math.max(1, Math.round(row.sizeBytes / 1024))} KB` },
    { key: 'description', header: 'Description', render: (row) => row.description ?? '—', secondary: true }
  ]

  const referralColumns: Array<Column<Referral>> = [
    { key: 'date', header: 'Date', width: 120, render: (row) => formatters.date(Date.parse(`${row.referralDate}T00:00:00`)), sortValue: (row) => row.referralDate },
    {
      key: 'target',
      header: 'Referred to',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>{row.externalDoctor ?? row.specialty ?? 'External provider'}</span>
          {row.organization ? <span className="muted small">{row.organization}</span> : null}
        </div>
      ),
      sortValue: (row) => row.externalDoctor ?? row.specialty ?? ''
    },
    { key: 'reason', header: 'Reason', render: (row) => row.reason ?? '—', secondary: true },
    {
      key: 'followUp',
      header: 'Follow-up',
      width: 150,
      render: (row) => (
        <Badge tone={row.followUpStatus === 'completed' ? 'success' : row.followUpStatus === 'pending' ? 'warning' : 'neutral'}>
          {row.followUpStatus}
        </Badge>
      ),
      sortValue: (row) => row.followUpStatus
    },
    {
      key: 'actions',
      header: '',
      width: 90,
      render: (row) =>
        canEdit ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 size={15} />}
            aria-label={`Delete referral of ${formatters.date(Date.parse(`${row.referralDate}T00:00:00`))}`}
            onClick={async () => {
              const answer = await confirmDialog({
                title: 'Delete this referral?',
                message: 'The referral is removed from the patient record. The action is recorded in the audit log.',
                confirmLabel: 'Delete referral',
                danger: true
              })
              if (!answer.confirmed) return
              try {
                await invoke('referrals.delete', { id: row.id })
                toast('success', 'Referral deleted')
                await referrals.reload()
              } catch (error) {
                toast('error', 'The referral could not be deleted', errorMessage(error))
              }
            }}
          />
        ) : null
    }
  ]

  if (summary.error) {
    return (
      <div className="page">
        <PageHeader title="Patient" />
        <Card>
          <CardBody>
            <div className="state state--error">
              <span className="state__title">This patient record could not be opened</span>
              <span className="state__message">{summary.error.message}</span>
              <Button variant="secondary" onClick={() => navigate('/patients')}>
                Back to patients
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={
          <Link to="/patients" className="row small" style={{ gap: 6, textDecoration: 'none' }}>
            <ArrowLeft size={14} /> All patients
          </Link>
        }
        title={
          <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            {patient?.fullName ?? 'Loading…'}
            {patient ? <span className="num muted">{patient.code}</span> : null}
            {patient && patient.status !== 'active' ? <Badge tone="warning">{patient.status}</Badge> : null}
          </span>
        }
        subtitle={
          patient ? (
            <span className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <span>{[patient.ageLabel, GENDERS.find((entry) => entry.value === patient.gender)?.label, patient.bloodGroup].filter(Boolean).join(' · ')}</span>
              {patient.phone ? (
                <span className="row" style={{ gap: 4 }}>
                  <Phone size={13} /> <span className="num">{patient.phone}</span>
                </span>
              ) : null}
              {patient.city ? (
                <span className="row" style={{ gap: 4 }}>
                  <MapPin size={13} /> {patient.city}
                </span>
              ) : null}
              {patient.fullNameBn ? <span className="bn">{patient.fullNameBn}</span> : null}
            </span>
          ) : null
        }
        actions={
          <>
            {canEdit ? (
              <Button variant="secondary" icon={<Pencil size={16} />} onClick={() => navigate(`/patients/${patientId}/edit`)}>
                Edit record
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="secondary" icon={<FolderOpen size={16} />} onClick={() => setUploadOpen(true)}>
                Add attachment
              </Button>
            ) : null}
            {canEdit ? (
              <Button variant="secondary" icon={<CalendarPlus size={16} />} onClick={() => setReferralOpen(true)}>
                New referral
              </Button>
            ) : null}
            {canPrint ? (
              <Button variant="tertiary" icon={<FileText size={16} />} onClick={() => setPrintOpen(true)}>
                Print summary
              </Button>
            ) : null}
          </>
        }
      />

      {patient?.allergies ? (
        <Card className="card--danger">
          <CardBody>
            <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'flex-start' }}>
              <AlertTriangle size={18} className="text-danger" />
              <div className="stack" style={{ gap: 2 }}>
                <strong>Allergies recorded</strong>
                <span className="small bn">{patient.allergies}</span>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Tabs
        value={tab}
        onChange={(value) => setTab(value as TabId)}
        options={[
          { value: 'overview', label: 'Overview' },
          { value: 'timeline', label: 'Timeline' },
          { value: 'attachments', label: 'Attachments', count: attachments.data?.length },
          { value: 'referrals', label: 'Referrals', count: referrals.data?.length }
        ]}
      />

      {tab === 'overview' ? (
        <>
          <div className="grid grid--kpi">
            <Card>
              <CardBody>
                <Stat label="Visits recorded" value={<span className="num">{patient?.visitCount ?? 0}</span>} />
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <Stat label="Last visit" value={patient?.lastVisitAt ? formatters.date(patient.lastVisitAt) : '—'} />
              </CardBody>
            </Card>
            {canSeeBilling ? (
              <>
                <Card>
                  <CardBody>
                    <Stat label="Invoiced" value={<span className="num">{formatters.money(financials?.invoicedMicro ?? 0)}</span>} />
                  </CardBody>
                </Card>
                <Card>
                  <CardBody>
                    <Stat label="Paid" value={<span className="num">{formatters.money(financials?.paidMicro ?? 0)}</span>} />
                  </CardBody>
                </Card>
                <Card className={(financials?.dueMicro ?? 0) > 0 ? 'card--warning' : undefined}>
                  <CardBody>
                    <Stat label="Outstanding due" value={<span className="num">{formatters.money(financials?.dueMicro ?? 0)}</span>} />
                  </CardBody>
                </Card>
              </>
            ) : null}
          </div>

          <div className="grid grid--2">
            <Card>
              <CardHeader title="Clinical background" icon={<Activity size={17} />} subtitle="Recorded by the clinic; printed on prescriptions where relevant." />
              <CardBody>
                <dl className="definition-list">
                  <div>
                    <dt>Chief complaint</dt>
                    <dd>{patient?.chiefComplaint || '—'}</dd>
                  </div>
                  <div>
                    <dt>Medical history</dt>
                    <dd>{patient?.medicalHistory || '—'}</dd>
                  </div>
                  <div>
                    <dt>Current medications</dt>
                    <dd>{patient?.currentMedications || '—'}</dd>
                  </div>
                  <div>
                    <dt>Allergies</dt>
                    <dd>{patient?.allergies || '—'}</dd>
                  </div>
                  <div>
                    <dt>Past dental history</dt>
                    <dd>{patient?.pastHistory || '—'}</dd>
                  </div>
                </dl>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Contact and identity" subtitle="Used on invoices, prescriptions and printouts." />
              <CardBody>
                <dl className="definition-list">
                  <div>
                    <dt>Patient ID</dt>
                    <dd className="num">{patient?.code}</dd>
                  </div>
                  <div>
                    <dt>Registered</dt>
                    <dd>{patient?.registrationDate}</dd>
                  </div>
                  <div>
                    <dt>Mobile</dt>
                    <dd className="num">{patient?.phone || '—'}</dd>
                  </div>
                  <div>
                    <dt>Alternate</dt>
                    <dd className="num">{patient?.altPhone || '—'}</dd>
                  </div>
                  <div>
                    <dt>Emergency contact</dt>
                    <dd className="num">{patient?.emergencyPhone || '—'}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>
                      {patient?.address || '—'}
                      {patient?.addressBn ? <div className="bn muted small">{patient.addressBn}</div> : null}
                    </dd>
                  </div>
                  <div>
                    <dt>Tags</dt>
                    <dd className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {(patient?.tags ?? []).length === 0 ? '—' : patient?.tags.map((tag) => <Badge key={tag} tone="neutral">{tag}</Badge>)}
                    </dd>
                  </div>
                </dl>
              </CardBody>
            </Card>
          </div>

          {canSeeBilling && financials ? (
            <Card>
              <CardHeader title="Receivables ageing" icon={<Receipt size={17} />} subtitle="Outstanding balance by age, based on each invoice's due date" />
              <CardBody>
                <div className="grid grid--kpi">
                  <Card>
                    <CardBody>
                      <Stat label="Not yet due" value={<span className="num">{formatters.money(financials.aging.current)}</span>} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardBody>
                      <Stat label="1–30 days" value={<span className="num">{formatters.money(financials.aging.days30)}</span>} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardBody>
                      <Stat label="31–60 days" value={<span className="num">{formatters.money(financials.aging.days60)}</span>} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardBody>
                      <Stat label="61–90 days" value={<span className="num">{formatters.money(financials.aging.days90)}</span>} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardBody>
                      <Stat label="Over 90 days" value={<span className="num">{formatters.money(financials.aging.older)}</span>} />
                    </CardBody>
                  </Card>
                </div>
              </CardBody>
            </Card>
          ) : null}

          {summary.data?.activeChartFindings && summary.data.activeChartFindings.length > 0 ? (
            <Card>
              <CardHeader title="Active dental findings" icon={<Activity size={17} />} subtitle="The dental chart is maintained on each visit." />
              <CardBody>
                <ul className="disk-list">
                  {summary.data.activeChartFindings.map((finding) => (
                    <li key={`${finding.toothCode}-${finding.conditionCode}`}>
                      <strong className="num">{finding.toothCode}</strong> · {finding.conditionCode.replace(/_/g, ' ')}
                      {finding.note ? <span className="muted"> — {finding.note}</span> : null}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === 'timeline' ? (
        <Card>
          <CardHeader
            title="Patient timeline"
            subtitle="Every recorded event in reverse order. Entries you are not permitted to read are left out entirely."
            actions={
              <Select
                ariaLabel="Filter timeline"
                value={timelineKind}
                onChange={setTimelineKind}
                options={[
                  { value: 'all', label: 'All activity' },
                  { value: 'visit', label: 'Visits' },
                  { value: 'treatment', label: 'Treatments' },
                  { value: 'prescription', label: 'Prescriptions' },
                  { value: 'invoice', label: 'Invoices' },
                  { value: 'payment', label: 'Payments' },
                  { value: 'appointment', label: 'Appointments' },
                  { value: 'chart', label: 'Dental chart' },
                  { value: 'referral', label: 'Referrals' },
                  { value: 'attachment', label: 'Attachments' }
                ]}
              />
            }
          />
          <CardBody flush>
            <DataTable
              columns={timelineColumns}
              rows={timeline.data?.items ?? []}
              getRowId={(row) => row.id}
              loading={timeline.loading}
              emptyTitle="No activity yet"
              emptyMessage="Visits, prescriptions, invoices and payments appear here as they are recorded."
              onRowClick={(row) => row.route && navigate(row.route)}
            />
          </CardBody>
        </Card>
      ) : null}

      {tab === 'attachments' ? (
        <Card>
          <CardHeader
            title="Attachments"
            subtitle="X-rays, scans and documents stored inside the clinic data folder"
            icon={<Upload size={17} />}
            actions={
              canEdit ? (
                <Button size="sm" variant="primary" icon={<Upload size={15} />} onClick={() => setUploadOpen(true)}>
                  Add file
                </Button>
              ) : null
            }
          />
          <CardBody flush>
            <DataTable
              columns={attachmentColumns}
              rows={attachments.data ?? []}
              getRowId={(row) => row.id}
              loading={attachments.loading}
              emptyTitle="No attachments"
              emptyMessage="Attach X-rays, clinical photographs, referral letters or lab reports here."
              rowActions={(row) => (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Button
                    size="sm"
                    variant="tertiary"
                    onClick={async () => {
                      try {
                        await invoke('attachments.open', { id: row.id })
                      } catch (error) {
                        toast('error', 'The file could not be opened', errorMessage(error))
                      }
                    }}
                  >
                    Open
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        const result = await invoke('attachments.export', { id: row.id })
                        if (result.path) toast('success', 'A copy was saved', result.path)
                      } catch (error) {
                        toast('error', 'The file could not be saved', errorMessage(error))
                      }
                    }}
                  >
                    Save a copy
                  </Button>
                  {canEdit ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={15} />}
                      aria-label={`Delete ${row.fileName}`}
                      onClick={async () => {
                        const answer = await confirmDialog({
                          title: `Delete “${row.fileName}”?`,
                          message: 'The file is removed from disk and hidden from the patient record. The deletion is audited and cannot be undone.',
                          confirmLabel: 'Delete file',
                          danger: true
                        })
                        if (!answer.confirmed) return
                        try {
                          await invoke('attachments.delete', { id: row.id })
                          toast('success', 'Attachment deleted')
                          await attachments.reload()
                        } catch (error) {
                          toast('error', 'The attachment could not be deleted', errorMessage(error))
                        }
                      }}
                    />
                  ) : null}
                </div>
              )}
            />
          </CardBody>
        </Card>
      ) : null}

      {tab === 'referrals' ? (
        <Card>
          <CardHeader
            title="Referrals"
            subtitle="Patients sent to specialists or hospitals, with follow-up status"
            icon={<Pill size={17} />}
            actions={
              canEdit ? (
                <Button size="sm" variant="primary" onClick={() => setReferralOpen(true)}>
                  New referral
                </Button>
              ) : null
            }
          />
          <CardBody flush>
            <DataTable
              columns={referralColumns}
              rows={referrals.data ?? []}
              getRowId={(row) => row.id}
              loading={referrals.loading}
              emptyTitle="No referrals"
              emptyMessage="Record where a patient was referred and whether they returned."
            />
          </CardBody>
        </Card>
      ) : null}

      <UploadAttachmentDialog open={uploadOpen} patientId={patientId} onClose={() => setUploadOpen(false)} onUploaded={() => void attachments.reload()} />
      <ReferralDialog open={referralOpen} patientId={patientId} onClose={() => setReferralOpen(false)} onSaved={() => void referrals.reload()} />
      <PrintDialog
        open={printOpen}
        target={{ documentType: 'patient_summary', entityId: patientId, label: patient?.fullName }}
        onClose={() => setPrintOpen(false)}
      />
    </div>
  )
}

/* --------------------------------------------------------------- Attachments */

function UploadAttachmentDialog({
  open,
  patientId,
  onClose,
  onUploaded
}: {
  open: boolean
  patientId: number
  onClose(): void
  onUploaded(): void
}): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState('document')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = (): void => {
    setFile(null)
    setKind('document')
    setDescription('')
    if (inputRef.current) inputRef.current.value = ''
  }

  const upload = async (): Promise<void> => {
    if (!file) return
    if (file.size > 25 * 1024 * 1024) {
      toast('error', 'Attachments must be smaller than 25 MB')
      return
    }
    setBusy(true)
    try {
      const dataBase64 = await readFileAsBase64(file)
      await invoke('attachments.upload', {
        patientId,
        fileName: file.name,
        dataBase64,
        kind: kind as 'document' | 'xray' | 'scan' | 'photo' | 'report' | 'other',
        description: description || null,
        visitId: null
      })
      toast('success', 'Attachment stored')
      reset()
      onUploaded()
      onClose()
    } catch (error) {
      toast('error', 'The file could not be stored', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Add an attachment"
      description="X-ray images, clinical photographs, lab reports or scanned letters."
      busy={busy}
      onClose={() => {
        reset()
        onClose()
      }}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!file} loading={busy} onClick={() => void upload()}>
            Store file
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="File" htmlFor="attachment-file" required hint="PDF, JPEG, PNG, WebP, DOC/DOCX, TXT or DICOM, up to 25 MB.">
          <input
            id="attachment-file"
            ref={inputRef}
            className="field__input"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.txt,.dcm"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label="Type" htmlFor="attachment-kind">
          <Select
            id="attachment-kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'document', label: 'Document' },
              { value: 'xray', label: 'X-ray' },
              { value: 'scan', label: 'Scan' },
              { value: 'photo', label: 'Clinical photograph' },
              { value: 'report', label: 'Lab report' },
              { value: 'other', label: 'Other' }
            ]}
          />
        </Field>
        <Field label="Description" htmlFor="attachment-description">
          <TextInput id="attachment-description" value={description} onChange={setDescription} maxLength={240} />
        </Field>
      </div>
    </Modal>
  )
}

/* ----------------------------------------------------------------- Referrals */

function ReferralDialog({
  open,
  patientId,
  onClose,
  onSaved
}: {
  open: boolean
  patientId: number
  onClose(): void
  onSaved(): void
}): ReactNode {
  const form = useZodForm(zReferralInput, {
    id: null,
    patientId,
    visitId: null,
    referredByDentistId: null,
    externalDoctor: null,
    specialty: null,
    organization: null,
    address: null,
    phone: null,
    reason: null,
    notes: null,
    referralDate: new Date().toISOString().slice(0, 10),
    followUpStatus: 'pending',
    followUpDate: null
  })
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    setBusy(true)
    try {
      await invoke('referrals.save', form.values)
      toast('success', 'Referral recorded')
      form.reset()
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The referral could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="Record a referral"
      description="Where was the patient sent, and what should happen next?"
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            Save referral
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Receiving doctor" htmlFor="externalDoctor" error={form.errors.externalDoctor}>
          <TextInput id="externalDoctor" value={String(form.values.externalDoctor ?? '')} onChange={(value) => form.setValue('externalDoctor', value || null)} maxLength={120} />
        </Field>
        <Field label="Specialty" htmlFor="specialty" error={form.errors.specialty}>
          <TextInput id="specialty" value={String(form.values.specialty ?? '')} onChange={(value) => form.setValue('specialty', value || null)} maxLength={120} />
        </Field>
        <Field label="Organization / hospital" htmlFor="organization" error={form.errors.organization}>
          <TextInput id="organization" value={String(form.values.organization ?? '')} onChange={(value) => form.setValue('organization', value || null)} maxLength={160} />
        </Field>
        <Field label="Phone" htmlFor="referralPhone" error={form.errors.phone}>
          <TextInput id="referralPhone" value={String(form.values.phone ?? '')} onChange={(value) => form.setValue('phone', value || null)} maxLength={40} />
        </Field>
        <Field label="Address" htmlFor="referralAddress" error={form.errors.address} span={2}>
          <TextInput id="referralAddress" value={String(form.values.address ?? '')} onChange={(value) => form.setValue('address', value || null)} maxLength={240} />
        </Field>
        <Field label="Reason for referral" htmlFor="referralReason" error={form.errors.reason} span={2}>
          <TextArea id="referralReason" value={String(form.values.reason ?? '')} onChange={(value) => form.setValue('reason', value || null)} rows={2} maxLength={1000} />
        </Field>
        <Field label="Referral date" htmlFor="referralDate" error={form.errors.referralDate} required>
          <DateInput id="referralDate" value={form.values.referralDate ?? null} onChange={(value) => form.setValue('referralDate', value ?? new Date().toISOString().slice(0, 10))} />
        </Field>
        <Field label="Follow-up status" htmlFor="followUpStatus" error={form.errors.followUpStatus}>
          <Select
            id="followUpStatus"
            value={String(form.values.followUpStatus ?? 'pending')}
            onChange={(value) => form.setValue('followUpStatus', value as 'pending' | 'scheduled' | 'completed' | 'closed')}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'scheduled', label: 'Follow-up scheduled' },
              { value: 'completed', label: 'Completed' },
              { value: 'closed', label: 'Closed' }
            ]}
          />
        </Field>
        <Field label="Follow-up date" htmlFor="followUpDate" error={form.errors.followUpDate}>
          <DateInput id="followUpDate" value={form.values.followUpDate ?? null} onChange={(value) => form.setValue('followUpDate', value)} />
        </Field>
        <Field label="Notes" htmlFor="referralNotes" error={form.errors.notes} span={2}>
          <TextArea id="referralNotes" value={String(form.values.notes ?? '')} onChange={(value) => form.setValue('notes', value || null)} rows={2} maxLength={1000} />
        </Field>
      </div>
    </Modal>
  )
}
