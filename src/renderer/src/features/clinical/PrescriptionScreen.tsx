import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookMarked, Copy, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { MEDICINE_TIMINGS, PRESCRIPTION_FORMS } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader } from '../../components/ui/primitives'
import { DateInput, Field, Select, TextArea, TextInput, dateInputToInstant, instantToDateInput } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { MEDICINE_FORM_LABELS, MEDICINE_TIMING_LABELS, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { MedicineHistoryEntry, PrescriptionTemplate } from '../../lib/types'

/** `C / C-O / E-R / E / advice` — the header line a dentist writes at the top of a prescription. */
const FORM_LABEL = (form: string): string => MEDICINE_FORM_LABELS[form] ?? form
const TIMING_LABEL = (timing: string): string => MEDICINE_TIMING_LABELS[timing] ?? timing

interface MedicineDraft {
  key: string
  medicineName: string
  form: string
  strength: string
  doseMorning: string
  doseAfternoon: string
  doseNight: string
  timing: string
  durationDays: string
  durationText: string
  quantity: string
  isPrn: boolean
  instructions: string
}

function blankMedicine(): MedicineDraft {
  return {
    key: `m-${Math.random().toString(36).slice(2, 9)}`,
    medicineName: '',
    form: 'tablet',
    strength: '',
    doseMorning: '1',
    doseAfternoon: '',
    doseNight: '1',
    timing: 'after_meal',
    durationDays: '5',
    durationText: '',
    quantity: '',
    isPrn: false,
    instructions: ''
  }
}

/** Medicine rows from a saved prescription or a template (templates carry no ids). */
interface MedicineLike {
  medicineName: string
  form: string
  strength: string | null
  doseMorning: string | null
  doseAfternoon: string | null
  doseNight: string | null
  timing: string
  durationDays?: number | null
  durationText?: string | null
  quantity?: string | null
  isPrn: boolean
  instructions?: string | null
}

function toDraft(medicine: MedicineLike): MedicineDraft {
  return {
    key: `m-${Math.random().toString(36).slice(2, 9)}`,
    medicineName: medicine.medicineName,
    form: medicine.form,
    strength: medicine.strength ?? '',
    doseMorning: medicine.doseMorning ?? '',
    doseAfternoon: medicine.doseAfternoon ?? '',
    doseNight: medicine.doseNight ?? '',
    timing: medicine.timing,
    durationDays: medicine.durationDays === null || medicine.durationDays === undefined ? '' : String(medicine.durationDays),
    durationText: medicine.durationText ?? '',
    quantity: medicine.quantity ?? '',
    isPrn: medicine.isPrn,
    instructions: medicine.instructions ?? ''
  }
}

/**
 * Prescription editor.
 *
 * Follows the Bangladeshi dental prescription convention: the header block carries C / C-O / E-R / E
 * (complaint, on-examination, examination report, extra-oral) plus diagnosis and advice, then the
 * medicine table with morning/afternoon/night doses. The dentist signing the document is captured from
 * the dentist record so the printed header always matches the clinician who wrote it.
 */
export function PrescriptionScreen(): ReactNode {
  const params = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const format = useFormatters()
  const canEdit = usePermission('prescriptions.edit')
  const canDelete = usePermission('prescriptions.delete')
  const canManageTemplates = usePermission('prescriptions.templates')

  const prescriptionId = params.prescriptionId ? Number(params.prescriptionId) : null
  const mode: 'new' | 'edit' | 'view' = prescriptionId === null ? 'new' : canEdit ? 'edit' : 'view'

  const [patientId, setPatientId] = useState(searchParams.get('patientId') ?? '')
  const [dentistId, setDentistId] = useState(searchParams.get('dentistId') ?? '')
  const visitId = searchParams.get('visitId') ?? ''
  const [patientSearch, setPatientSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [rxAt, setRxAt] = useState<string | null>(instantToDateInput(Date.now()))
  const [diagnosis, setDiagnosis] = useState('')
  const [ccText, setCcText] = useState('')
  const [oeText, setOeText] = useState('')
  const [reText, setReText] = useState('')
  const [advice, setAdvice] = useState('')
  const [notes, setNotes] = useState('')
  const [followUp, setFollowUp] = useState<string | null>(null)
  const [medicines, setMedicines] = useState<MedicineDraft[]>([blankMedicine()])
  const [busy, setBusy] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [adviceOpen, setAdviceOpen] = useState(false)
  const [historyFor, setHistoryFor] = useState<number | null>(null)

  const patients = useInvoke('patients.list', { search: debounced === '' ? undefined : debounced, status: 'active', limit: 25, offset: 0 }, { enabled: mode === 'new' })
  const dentists = useInvoke('dentists.list', { includeInactive: false })
  const existing = useInvoke('prescriptions.get', { id: prescriptionId ?? 0 }, { enabled: prescriptionId !== null })
  const medicines_ = useInvoke('prescriptions.medicines', { search: debounced === '' ? undefined : debounced, limit: 50 })
  const adviceLibrary = useInvoke('prescriptions.adviceLibrary', {})
  const templates = useInvoke('prescriptions.templates.list', { includeInactive: false }, { enabled: templateOpen })

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(patientSearch.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [patientSearch])

  useEffect(() => {
    const data = existing.data
    if (!data) return
    setPatientId(String(data.patientId))
    setDentistId(String(data.dentistId))
    setRxAt(instantToDateInput(data.prescriptionAt))
    setDiagnosis(data.diagnosis ?? '')
    setCcText(data.ccText ?? '')
    setOeText(data.oeText ?? '')
    setReText(data.reText ?? '')
    setAdvice(data.advice ?? '')
    setNotes(data.notes ?? '')
    setFollowUp(data.followUpDate ?? null)
    setMedicines(data.medicines.length > 0 ? data.medicines.map(toDraft) : [blankMedicine()])
  }, [existing.data])

  useEffect(() => {
    if (dentistId === '' && dentists.data && dentists.data.length > 0) setDentistId(String(dentists.data[0]?.id))
  }, [dentists.data, dentistId])

  const patientOptions = useMemo(
    () => [
      { value: '', label: debounced === '' ? 'Search for a patient…' : 'Select a patient…' },
      ...((patients.data?.items ?? []).map((entry) => ({ value: String(entry.id), label: `${entry.code} · ${entry.fullName}${entry.phone ? ` · ${entry.phone}` : ''}` })))
    ],
    [patients.data, debounced]
  )

  const setMedicine = (index: number, patch: Partial<MedicineDraft>): void => {
    setMedicines((current) => current.map((medicine, position) => (position === index ? { ...medicine, ...patch } : medicine)))
  }

  const save = async (): Promise<void> => {
    if (patientId === '') {
      toast('warning', 'Choose a patient', 'Every prescription belongs to a patient.')
      return
    }
    if (dentistId === '') {
      toast('warning', 'Choose the signing dentist', 'The prescription header must name the dentist who wrote it.')
      return
    }
    const prepared = medicines
      .filter((medicine) => medicine.medicineName.trim().length > 0)
      .map((medicine, index) => ({
        sortOrder: index,
        medicineName: medicine.medicineName.trim(),
        form: medicine.form as (typeof PRESCRIPTION_FORMS)[number],
        strength: medicine.strength.trim() || null,
        unit: null,
        doseMorning: medicine.isPrn ? null : medicine.doseMorning.trim() || null,
        doseAfternoon: medicine.isPrn ? null : medicine.doseAfternoon.trim() || null,
        doseNight: medicine.isPrn ? null : medicine.doseNight.trim() || null,
        timing: medicine.timing as (typeof MEDICINE_TIMINGS)[number],
        frequency: null,
        durationDays: medicine.isPrn || medicine.durationDays.trim() === '' ? null : Number(medicine.durationDays),
        durationText: medicine.durationText.trim() || null,
        quantity: medicine.quantity.trim() || null,
        isPrn: medicine.isPrn,
        instructions: medicine.instructions.trim() || null
      }))
    if (prepared.length === 0) {
      toast('warning', 'Add at least one medicine', 'Type the medicine name and its dose, or use a saved template.')
      return
    }
    setBusy(true)
    try {
      const saved = await invoke('prescriptions.save', {
        id: prescriptionId,
        patientId: Number(patientId),
        dentistId: Number(dentistId),
        visitId: visitId === '' ? null : Number(visitId),
        prescriptionAt: dateInputToInstant(rxAt, '09:00') ?? Date.now(),
        diagnosis: diagnosis.trim() || null,
        ccText: ccText.trim() || null,
        oeText: oeText.trim() || null,
        reText: reText.trim() || null,
        advice: advice.trim() || null,
        followUpDate: followUp,
        notes: notes.trim() || null,
        medicines: prepared
      })
      toast('success', `Prescription ${saved.rxNo} saved`, 'It is now part of the patient record.')
      navigate(`/prescriptions/${saved.id}`, { replace: true })
    } catch (error) {
      toast('error', 'The prescription could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const applyTemplate = async (template: PrescriptionTemplate): Promise<void> => {
    setMedicines(template.medicines.length > 0 ? template.medicines.map(toDraft) : [blankMedicine()])
    setTemplateOpen(false)
    toast('success', `Template “${template.name}” applied`, 'Review the doses before saving.')
  }

  const removePrescription = async (): Promise<void> => {
    const data = existing.data
    if (!data) return
    const answer = await confirmDialog({
      title: `Delete prescription ${data.rxNo}?`,
      message: 'A deleted prescription is removed from the patient record. Prescriptions that have already been printed cannot be deleted.',
      confirmLabel: 'Delete prescription',
      danger: true,
      confirmationPhrase: data.rxNo
    })
    if (!answer.confirmed) return
    try {
      await invoke('prescriptions.delete', { id: data.id, reason: answer.phrase ?? 'Deleted by clinician' })
      toast('success', 'Prescription deleted')
      navigate('/prescriptions', { replace: true })
    } catch (error) {
      toast('error', 'The prescription could not be deleted', errorMessage(error))
    }
  }

  const duplicate = async (): Promise<void> => {
    const data = existing.data
    if (!data) return
    try {
      const copy = await invoke('prescriptions.duplicate', { id: data.id })
      toast('success', `Prescription ${copy.rxNo} created`, 'A fresh prescription was written from this one.')
      navigate(`/prescriptions/${copy.id}`, { replace: true })
      await existing.reload()
    } catch (error) {
      toast('error', 'The prescription could not be duplicated', errorMessage(error))
    }
  }

  const data = existing.data
  const readOnly = mode === 'view' || (data !== null && mode === 'edit' && data.printedCount > 0 && !canEdit)

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={
          <button type="button" className="row small link" style={{ gap: 6, textDecoration: 'none', background: 'none', border: 0, cursor: 'pointer' }} onClick={() => navigate('/prescriptions')}>
            <ArrowLeft size={14} /> All prescriptions
          </button>
        }
        title={data ? <span className="row" style={{ gap: 10, alignItems: 'baseline' }}><span className="num">{data.rxNo}</span>{data.printedCount > 0 ? <Badge tone="info">printed {data.printedCount}×</Badge> : null}</span> : 'New prescription'}
        subtitle={data ? `${data.patientName} · ${format.date(data.prescriptionAt)}` : 'Write a prescription for a patient seen in this clinic.'}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {mode !== 'view' ? (
              <>
                <Button variant="tertiary" icon={<BookMarked size={16} />} onClick={() => setTemplateOpen(true)}>
                  Use template
                </Button>
                <Button variant="tertiary" icon={<Sparkles size={16} />} onClick={() => setAdviceOpen(true)}>
                  Advice library
                </Button>
                <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={() => void save()}>
                  Save prescription
                </Button>
              </>
            ) : null}
            {data ? (
              <Button variant="secondary" icon={<Copy size={16} />} onClick={() => void duplicate()}>
                Duplicate
              </Button>
            ) : null}
            {data && canDelete && data.printedCount === 0 ? (
              <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => void removePrescription()}>
                Delete
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid--2">
        <Card>
          <CardHeader title="Header" subtitle="Complaint, examination and diagnosis as they appear on the printed sheet." />
          <CardBody>
            <div className="stack">
              {mode === 'new' ? (
                <>
                  <Field label="Find patient" htmlFor="rxPatientSearch" hint="Search by name, patient ID or phone.">
                    <TextInput id="rxPatientSearch" value={patientSearch} onChange={setPatientSearch} maxLength={80} />
                  </Field>
                  <Field label="Patient" htmlFor="rxPatient" required>
                    <Select id="rxPatient" value={patientId} onChange={setPatientId} options={patientOptions} ariaLabel="Patient" />
                  </Field>
                </>
              ) : (
                <Field label="Patient" htmlFor="rxPatientReadonly">
                  <TextInput id="rxPatientReadonly" value={data ? `${data.patientCode} · ${data.patientName}` : 'Loading…'} onChange={() => undefined} disabled />
                </Field>
              )}
              <div className="grid grid--2">
                <Field label="Dentist" htmlFor="rxDentist" required hint="Printed on the header with designations and registration number.">
                  <Select
                    id="rxDentist"
                    value={dentistId}
                    onChange={setDentistId}
                    options={(dentists.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.fullName }))}
                    ariaLabel="Dentist"
                    disabled={readOnly}
                  />
                </Field>
                <Field label="Date" htmlFor="rxDate">
                  <DateInput id="rxDate" value={rxAt} onChange={setRxAt} disabled={readOnly} />
                </Field>
              </div>
              <Field label="C — complaint" htmlFor="rxCc" hint="What the patient reported.">
                <TextArea id="rxCc" value={ccText} onChange={setCcText} rows={2} maxLength={2000} disabled={readOnly} />
              </Field>
              <Field label="C-O — on examination" htmlFor="rxOe">
                <TextArea id="rxOe" value={oeText} onChange={setOeText} rows={2} maxLength={2000} disabled={readOnly} />
              </Field>
              <Field label="E-R — examination report" htmlFor="rxRe">
                <TextArea id="rxRe" value={reText} onChange={setReText} rows={2} maxLength={2000} disabled={readOnly} />
              </Field>
              <Field label="E — extra-oral / investigations" htmlFor="rxExtra" hint="X-ray, laboratory or other findings.">
                <TextArea id="rxExtra" value={diagnosis} onChange={setDiagnosis} rows={2} maxLength={2000} disabled={readOnly} />
              </Field>
              <Field label="Advice" htmlFor="rxAdvice">
                <TextArea id="rxAdvice" value={advice} onChange={setAdvice} rows={3} maxLength={2000} disabled={readOnly} />
              </Field>
              <div className="grid grid--2">
                <Field label="Follow-up date" htmlFor="rxFollowUp">
                  <DateInput id="rxFollowUp" value={followUp} onChange={setFollowUp} disabled={readOnly} />
                </Field>
                <Field label="Internal note" htmlFor="rxNotes">
                  <TextInput id="rxNotes" value={notes} onChange={setNotes} maxLength={1000} disabled={readOnly} />
                </Field>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Medicines"
            subtitle="Dose is written as morning / afternoon / night."
            actions={
              mode !== 'view' ? (
                <Button size="sm" variant="secondary" icon={<Plus size={15} />} onClick={() => setMedicines((current) => [...current, blankMedicine()])}>
                  Add medicine
                </Button>
              ) : null
            }
          />
          <CardBody>
            <div className="medicine-grid">
              <div className="medicine-grid__head">
                <span>Medicine</span>
                <span>M</span>
                <span>A</span>
                <span>N</span>
                <span>Timing</span>
                <span>Days</span>
                <span />
              </div>
              {medicines.map((medicine, index) => (
                <div key={medicine.key} className="medicine-row">
                  <div className="medicine-row__main">
                  <div className="stack" style={{ gap: 4 }}>
                    <TextInput
                      value={medicine.medicineName}
                      onChange={(value) => setMedicine(index, { medicineName: value })}
                      ariaLabel={`Medicine ${index + 1}`}
                      maxLength={160}
                      disabled={readOnly}
                    />
                    <div className="row" style={{ gap: 4 }}>
                      <Select
                        value={medicine.form}
                        onChange={(value: string) => setMedicine(index, { form: value })}
                        ariaLabel={`Form for medicine ${index + 1}`}
                        options={PRESCRIPTION_FORMS.map((form) => ({ value: form, label: FORM_LABEL(form) }))}
                        disabled={readOnly}
                      />
                      <TextInput
                        value={medicine.strength}
                        onChange={(value) => setMedicine(index, { strength: value })}
                        ariaLabel={`Strength for medicine ${index + 1}`}
                        placeholder="500 mg"
                        maxLength={60}
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                  <TextInput value={medicine.isPrn ? '' : medicine.doseMorning} onChange={(value) => setMedicine(index, { doseMorning: value })} ariaLabel={`Morning dose ${index + 1}`} maxLength={20} disabled={readOnly || medicine.isPrn} />
                  <TextInput value={medicine.isPrn ? '' : medicine.doseAfternoon} onChange={(value) => setMedicine(index, { doseAfternoon: value })} ariaLabel={`Afternoon dose ${index + 1}`} maxLength={20} disabled={readOnly || medicine.isPrn} />
                  <TextInput value={medicine.isPrn ? '' : medicine.doseNight} onChange={(value) => setMedicine(index, { doseNight: value })} ariaLabel={`Night dose ${index + 1}`} maxLength={20} disabled={readOnly || medicine.isPrn} />
                  <Select
                    value={medicine.timing}
                    onChange={(value: string) => setMedicine(index, { timing: value })}
                    ariaLabel={`Timing for medicine ${index + 1}`}
                    options={MEDICINE_TIMINGS.map((timing) => ({ value: timing, label: TIMING_LABEL(timing) }))}
                    disabled={readOnly}
                  />
                  <TextInput value={medicine.durationDays} onChange={(value) => setMedicine(index, { durationDays: value.replace(/[^0-9]/g, '') })} ariaLabel={`Days for medicine ${index + 1}`} maxLength={3} disabled={readOnly || medicine.isPrn} />
                  </div>
                  <div className="medicine-row__side">
                    <label className="row small" style={{ gap: 6 }}>
                      <input type="checkbox" checked={medicine.isPrn} disabled={readOnly} onChange={(event) => setMedicine(index, { isPrn: event.target.checked, instructions: event.target.checked && medicine.instructions === '' ? 'Take as needed (SOS)' : medicine.instructions })} />
                      PRN / SOS
                    </label>
                    <Button size="sm" variant="ghost" aria-label={`History for medicine ${index + 1}`} onClick={() => setHistoryFor(historyFor === index ? null : index)}>
                      History
                    </Button>
                    {mode !== 'view' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 size={15} />}
                        aria-label={`Remove medicine ${index + 1}`}
                        onClick={() => setMedicines((current) => (current.length === 1 ? [blankMedicine()] : current.filter((_, position) => position !== index)))}
                      />
                    ) : null}
                  </div>
                  {medicine.isPrn || medicine.instructions.trim() !== '' ? (
                    <div className="medicine-row__note">
                      <TextInput
                        value={medicine.instructions}
                        onChange={(value) => setMedicine(index, { instructions: value })}
                        ariaLabel={`Instructions for medicine ${index + 1}`}
                        placeholder="Instructions (for example: take with plenty of water)"
                        maxLength={300}
                        disabled={readOnly}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {historyFor !== null && medicines[historyFor] ? (
              <div className="stack" style={{ marginTop: 'var(--sp-4)' }}>
                <span className="muted small">
                  {debounced === '' ? 'Recently prescribed medicines' : `Matches for “${debounced}”`} — click to use the same dose.
                </span>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {(medicines_.data ?? []).slice(0, 12).map((entry: MedicineHistoryEntry) => (
                    <button
                      key={`${entry.medicineName}-${entry.form}-${entry.strength ?? ''}`}
                      type="button"
                      className="chip"
                      onClick={() => {
                        const target = medicines[historyFor]
                        const last = (medicines_.data ?? []).find((candidate) => candidate.medicineName === entry.medicineName)
                        setMedicine(historyFor, {
                          medicineName: entry.medicineName,
                          form: entry.form,
                          strength: entry.strength ?? target?.strength ?? ''
                        })
                        if (last) toast('info', entry.medicineName, 'Dose fields are yours to set; the name and form were filled from history.')
                      }}
                    >
                      {entry.medicineName}
                      {entry.strength ? ` ${entry.strength}` : ''} · {entry.useCount}×
                    </button>
                  ))}
                  {(medicines_.data ?? []).length === 0 ? <span className="muted small">No medicine history yet.</span> : null}
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <TemplatePicker open={templateOpen} templates={templates.data ?? []} onClose={() => setTemplateOpen(false)} onApply={(template) => void applyTemplate(template)} canManage={canManageTemplates} />

      <Modal
        open={adviceOpen}
        title="Advice library"
        description="Reusable advice written on previous prescriptions. Selecting one appends it to the advice box."
        onClose={() => setAdviceOpen(false)}
        footer={
          <Button variant="tertiary" onClick={() => setAdviceOpen(false)}>
            Close
          </Button>
        }
      >
        {(adviceLibrary.data ?? []).length === 0 ? (
          <p className="muted">No advice recorded yet. Text typed into the advice box of any prescription is collected here for reuse.</p>
        ) : (
          <ul className="plain-list">
            {(adviceLibrary.data ?? []).map((entry) => (
              <li key={entry} className="plain-list__item">
                <span className="small">{entry}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAdvice((current) => (current.trim() === '' ? entry : `${current}\n${entry}`))
                    setAdviceOpen(false)
                    toast('success', 'Advice added')
                  }}
                >
                  Use
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  )
}

function TemplatePicker({
  open,
  templates,
  onClose,
  onApply,
  canManage
}: {
  open: boolean
  templates: PrescriptionTemplate[]
  onClose(): void
  onApply(template: PrescriptionTemplate): void
  canManage: boolean
}): ReactNode {
  return (
    <Modal
      open={open}
      title="Prescription templates"
      description={canManage ? 'Saved medicine sets. Applying one replaces the current medicine table.' : 'Saved medicine sets shared with you.'}
      onClose={onClose}
      footer={
        <Button variant="tertiary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {templates.length === 0 ? (
        <p className="muted">
          No templates yet. {canManage ? 'Save a template from the prescription editor once you have a set of medicines you prescribe often.' : 'Ask a clinician with template permission to create one.'}
        </p>
      ) : (
        <ul className="plain-list">
          {templates.map((template) => (
            <li key={template.id} className="plain-list__item">
              <span className="stack" style={{ gap: 2 }}>
                <span className="link-strong">{template.name}</span>
                <span className="muted small">
                  {template.medicines.map((medicine) => medicine.medicineName).join(', ')} · used {template.usageCount}×
                </span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => onApply(template)}>
                Apply
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
