import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, Save, UserPlus } from 'lucide-react'
import { zPatientInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader } from '../../components/ui/primitives'
import { DateInput, Field, NumberInput, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { BLOOD_GROUPS, GENDERS, MARITAL_STATUS, PATIENT_STATUSES } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { ApiError } from '../../lib/api'
import { hasBengali } from '@shared/bengali'
import type { PatientInput } from '../../lib/types'

/**
 * Patient registration and editing.
 *
 * Validation runs the same schema the main process uses, and the main process performs its own
 * duplicate-identity check inside the saving transaction. As a convenience the form warns early when a
 * matching name or phone number is already on file, so the operator can open the existing record
 * instead of creating a second file for the same person.
 */

const EMPTY_PATIENT: PatientInput = {
  id: null,
  fullName: '',
  fullNameBn: null,
  dob: null,
  ageYears: null,
  gender: 'unspecified',
  bloodGroup: null,
  phone: null,
  altPhone: null,
  emergencyPhone: null,
  address: null,
  addressBn: null,
  city: null,
  occupation: null,
  maritalStatus: null,
  chiefComplaint: null,
  pastHistory: null,
  allergies: null,
  medicalHistory: null,
  dentalHistory: null,
  currentMedications: null,
  notes: null,
  tags: [],
  status: 'active'
}

export function PatientFormScreen({ mode }: { mode: 'create' | 'edit' }): ReactNode {
  const navigate = useNavigate()
  const params = useParams<{ patientId: string }>()
  const patientId = params.patientId ? Number(params.patientId) : null
  const canEdit = usePermission('patients.edit')
  const canCreate = usePermission('patients.create')

  const existing = useInvoke('patients.get', { id: patientId ?? 0 }, { enabled: mode === 'edit' && patientId !== null })
  const form = useZodForm(zPatientInput, EMPTY_PATIENT)
  const [tagDraft, setTagDraft] = useState('')
  const [duplicates, setDuplicates] = useState<Array<{ id: number, code: string, fullName: string, phone: string | null, registrationDate: string }>>([])
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (mode !== 'edit' || !existing.data) return
    const patient = existing.data
    form.reset({
      id: patient.id,
      fullName: patient.fullName,
      fullNameBn: patient.fullNameBn,
      dob: patient.dob,
      ageYears: patient.ageYears,
      gender: patient.gender as PatientInput['gender'],
      bloodGroup: patient.bloodGroup,
      phone: patient.phone,
      altPhone: patient.altPhone,
      emergencyPhone: patient.emergencyPhone,
      address: patient.address,
      addressBn: patient.addressBn,
      city: patient.city,
      occupation: patient.occupation,
      maritalStatus: patient.maritalStatus,
      chiefComplaint: patient.chiefComplaint,
      pastHistory: patient.pastHistory,
      allergies: patient.allergies,
      medicalHistory: patient.medicalHistory,
      dentalHistory: patient.dentalHistory,
      currentMedications: patient.currentMedications,
      notes: patient.notes,
      tags: patient.tags,
      status: patient.status as PatientInput['status']
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data, mode])

  useEffect(() => {
    if (existing.error) setLoadError(existing.error.message)
  }, [existing.error])

  const values = form.values

  const runDuplicateCheck = async (): Promise<void> => {
    const name = String(values.fullName ?? '').trim()
    if (name.length < 3) {
      setDuplicates([])
      return
    }
    try {
      const matches = await invoke('patients.duplicateCheck', {
        fullName: name,
        phone: values.phone ?? null,
        excludeId: values.id ?? null
      })
      setDuplicates(matches)
    } catch {
      setDuplicates([])
    }
  }

  const addTag = (): void => {
    const tag = tagDraft.trim()
    if (!tag) return
    const current = (values.tags ?? []) as string[]
    if (!current.includes(tag)) form.setValue('tags', [...current, tag])
    setTagDraft('')
  }

  const submit = async (): Promise<void> => {
    if (mode === 'create' && !canCreate) {
      toast('error', 'You do not have permission to register patients')
      return
    }
    if (mode === 'edit' && !canEdit) {
      toast('error', 'You do not have permission to edit patients')
      return
    }
    if (!form.validate()) {
      toast('warning', 'Please correct the highlighted fields')
      return
    }

    if (duplicates.length > 0) {
      const answer = await confirmDialog({
        title: 'A similar patient already exists',
        message: `“${duplicates[0]!.fullName}” (${duplicates[0]!.code}) is already on file. Creating another record for the same person splits their history.`,
        detail: 'Continue only if this is genuinely a different patient.',
        confirmLabel: 'Create a separate record',
        danger: true
      })
      if (!answer.confirmed) return
    }

    setBusy(true)
    try {
      const patient = await invoke('patients.save', form.values)
      toast('success', mode === 'create' ? `Registered ${patient.fullName} (${patient.code})` : `Saved changes to ${patient.fullName}`)
      navigate(`/patients/${patient.id}`, { replace: true })
    } catch (caught) {
      const apiError = caught as ApiError
      if (apiError.fieldErrors) form.setErrors(apiError.fieldErrors)
      toast('error', 'The patient record could not be saved', errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const fieldError = (key: string): string | undefined => form.errors[key]

  if (loadError) {
    return (
      <div className="page">
        <PageHeader title="Patient record" />
        <Card>
          <CardBody>
            <div className="state state--error">
              <span className="state__title">This patient could not be opened</span>
              <span className="state__message">{loadError}</span>
              <Button variant="secondary" onClick={() => navigate('/patients')}>
                Back to patients
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  const title = mode === 'create' ? 'Register a patient' : `Edit ${existing.data?.fullName ?? 'patient'}`
  const subtitle =
    mode === 'create'
      ? 'Record the identity and medical background now — the patient ID is generated automatically.'
      : `Patient ID ${existing.data?.code ?? ''} · registered ${existing.data?.registrationDate ?? ''}`

  const bengaliHint = hasBengali(String(values.fullName ?? '')) ? 'bn' : undefined

  return (
    <div className="page">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <>
            <Button variant="tertiary" onClick={() => navigate(-1)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={<Save size={16} />} loading={busy} onClick={() => void submit()}>
              {mode === 'create' ? 'Register patient' : 'Save changes'}
            </Button>
          </>
        }
      />

      {duplicates.length > 0 ? (
        <Card className="card--warning">
          <CardBody>
            <div className="row" style={{ alignItems: 'flex-start', gap: 'var(--sp-3)' }}>
              <AlertTriangle size={18} className="text-warning" />
              <div className="stack" style={{ gap: 4 }}>
                <strong>Possible duplicate</strong>
                {duplicates.map((match) => (
                  <span key={match.id} className="small">
                    {match.fullName} · {match.code} · {match.phone ?? 'no phone'} · registered {match.registrationDate}{' '}
                    <button type="button" className="link" onClick={() => navigate(`/patients/${match.id}`)}>
                      open record
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <Card>
          <CardHeader title="Identity" icon={<UserPlus size={17} />} subtitle="The patient ID is generated by the application and never edited by hand." />
          <CardBody>
            <div className="grid grid--2">
              <Field label="Full name" htmlFor="fullName" required error={fieldError('fullName')}>
                <TextInput
                  id="fullName"
                  value={String(values.fullName ?? '')}
                  onChange={(value) => form.setValue('fullName', value)}
                  onBlur={() => void runDuplicateCheck()}
                  maxLength={120}
                  disabled={busy}
                />
              </Field>

              <Field label="Name in Bangla (optional)" htmlFor="fullNameBn" error={fieldError('fullNameBn')} hint="Stored as Unicode and printed exactly as typed.">
                <input
                  id="fullNameBn"
                  className={`field__input ${bengaliHint ?? ''}`}
                  value={String(values.fullNameBn ?? '')}
                  onChange={(event) => form.setValue('fullNameBn', event.target.value || null)}
                  maxLength={120}
                  disabled={busy}
                />
              </Field>

              <Field label="Date of birth" htmlFor="dob" error={fieldError('dob')} hint="Leave empty if the patient only knows their age.">
                <DateInput id="dob" value={values.dob ?? null} onChange={(value) => form.setValue('dob', value)} disabled={busy} max={new Date().toISOString().slice(0, 10)} />
              </Field>

              <Field label="Age (years)" htmlFor="ageYears" error={fieldError('ageYears')} hint="Used only when the date of birth is unknown.">
                <NumberInput
                  id="ageYears"
                  value={values.dob ? null : (values.ageYears ?? null)}
                  onChange={(value) => form.setValue('ageYears', value)}
                  min={0}
                  max={130}
                  disabled={busy || Boolean(values.dob)}
                />
              </Field>

              <Field label="Gender" htmlFor="gender" error={fieldError('gender')}>
                <Select
                  id="gender"
                  value={String(values.gender ?? 'unspecified')}
                  onChange={(value) => form.setValue('gender', value as PatientInput['gender'])}
                  options={GENDERS.map((entry) => ({ value: entry.value, label: entry.label }))}
                />
              </Field>

              <Field label="Blood group" htmlFor="bloodGroup" error={fieldError('bloodGroup')}>
                <Select
                  id="bloodGroup"
                  value={String(values.bloodGroup ?? '')}
                  onChange={(value) => form.setValue('bloodGroup', value || null)}
                  placeholder="Not known"
                  options={BLOOD_GROUPS.map((value) => ({ value, label: value }))}
                />
              </Field>

              <Field label="Marital status" htmlFor="maritalStatus" error={fieldError('maritalStatus')}>
                <Select
                  id="maritalStatus"
                  value={String(values.maritalStatus ?? '')}
                  onChange={(value) => form.setValue('maritalStatus', value || null)}
                  placeholder="Not specified"
                  options={MARITAL_STATUS.map((entry) => ({ value: entry.value, label: entry.label }))}
                />
              </Field>

              <Field label="Occupation" htmlFor="occupation" error={fieldError('occupation')}>
                <TextInput id="occupation" value={String(values.occupation ?? '')} onChange={(value) => form.setValue('occupation', value || null)} maxLength={80} disabled={busy} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Contact" subtitle="Phone numbers are stored as entered so the clinic can dial them directly." />
          <CardBody>
            <div className="grid grid--2">
              <Field label="Mobile number" htmlFor="phone" error={fieldError('phone')}>
                <TextInput
                  id="phone"
                  value={String(values.phone ?? '')}
                  onChange={(value) => form.setValue('phone', value || null)}
                  onBlur={() => void runDuplicateCheck()}
                  maxLength={40}
                  disabled={busy}
                />
              </Field>
              <Field label="Alternate number" htmlFor="altPhone" error={fieldError('altPhone')}>
                <TextInput id="altPhone" value={String(values.altPhone ?? '')} onChange={(value) => form.setValue('altPhone', value || null)} maxLength={40} disabled={busy} />
              </Field>
              <Field label="Emergency contact" htmlFor="emergencyPhone" error={fieldError('emergencyPhone')}>
                <TextInput
                  id="emergencyPhone"
                  value={String(values.emergencyPhone ?? '')}
                  onChange={(value) => form.setValue('emergencyPhone', value || null)}
                  maxLength={40}
                  disabled={busy}
                />
              </Field>
              <Field label="City / area" htmlFor="city" error={fieldError('city')}>
                <TextInput id="city" value={String(values.city ?? '')} onChange={(value) => form.setValue('city', value || null)} maxLength={80} disabled={busy} />
              </Field>
              <Field label="Address" htmlFor="address" error={fieldError('address')} span={2}>
                <TextArea id="address" value={String(values.address ?? '')} onChange={(value) => form.setValue('address', value || null)} rows={2} maxLength={300} disabled={busy} />
              </Field>
              <Field label="Address in Bangla" htmlFor="addressBn" error={fieldError('addressBn')} span={2}>
                <TextArea
                  id="addressBn"
                  value={String(values.addressBn ?? '')}
                  onChange={(value) => form.setValue('addressBn', value || null)}
                  rows={2}
                  maxLength={300}
                  disabled={busy}
                  bengali
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Medical background"
            subtitle="Shown to the dentist on every visit and printed on the prescription header when relevant."
          />
          <CardBody>
            <div className="grid grid--2">
              <Field label="Chief complaint" htmlFor="chiefComplaint" error={fieldError('chiefComplaint')} span={2}>
                <TextArea
                  id="chiefComplaint"
                  value={String(values.chiefComplaint ?? '')}
                  onChange={(value) => form.setValue('chiefComplaint', value || null)}
                  rows={2}
                  maxLength={1200}
                  disabled={busy}
                />
              </Field>
              <Field label="Allergies" htmlFor="allergies" error={fieldError('allergies')} hint="Printed prominently on the prescription and visit summary.">
                <TextArea id="allergies" value={String(values.allergies ?? '')} onChange={(value) => form.setValue('allergies', value || null)} rows={2} maxLength={1000} disabled={busy} />
              </Field>
              <Field label="Current medications" htmlFor="currentMedications" error={fieldError('currentMedications')}>
                <TextArea
                  id="currentMedications"
                  value={String(values.currentMedications ?? '')}
                  onChange={(value) => form.setValue('currentMedications', value || null)}
                  rows={2}
                  maxLength={1500}
                  disabled={busy}
                />
              </Field>
              <Field label="Medical history" htmlFor="medicalHistory" error={fieldError('medicalHistory')}>
                <TextArea
                  id="medicalHistory"
                  value={String(values.medicalHistory ?? '')}
                  onChange={(value) => form.setValue('medicalHistory', value || null)}
                  rows={3}
                  maxLength={2000}
                  disabled={busy}
                />
              </Field>
              <Field label="Past dental history" htmlFor="pastHistory" error={fieldError('pastHistory')}>
                <TextArea id="pastHistory" value={String(values.pastHistory ?? '')} onChange={(value) => form.setValue('pastHistory', value || null)} rows={3} maxLength={2000} disabled={busy} />
              </Field>
              <Field label="Dental history notes" htmlFor="dentalHistory" error={fieldError('dentalHistory')} span={2}>
                <TextArea
                  id="dentalHistory"
                  value={String(values.dentalHistory ?? '')}
                  onChange={(value) => form.setValue('dentalHistory', value || null)}
                  rows={2}
                  maxLength={2000}
                  disabled={busy}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Administrative" subtitle="Tags help you group patients such as “diabetic” or “ortho case”." />
          <CardBody>
            <div className="grid grid--2">
              <Field label="Tags" htmlFor="tagDraft" error={fieldError('tags')} hint="Press Enter to add a tag.">
                <div className="stack" style={{ gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      id="tagDraft"
                      className="field__input"
                      value={tagDraft}
                      onChange={(event) => setTagDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          addTag()
                        }
                      }}
                      maxLength={40}
                      disabled={busy}
                      placeholder="Add a tag"
                    />
                    <Button type="button" variant="secondary" onClick={addTag} disabled={busy}>
                      Add
                    </Button>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {((values.tags ?? []) as string[]).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        className="chip chip--removable"
                        onClick={() => form.setValue('tags', ((values.tags ?? []) as string[]).filter((entry) => entry !== tag))}
                        aria-label={`Remove tag ${tag}`}
                      >
                        {tag} ×
                      </button>
                    ))}
                  </div>
                </div>
              </Field>

              <div className="stack">
                {mode === 'edit' ? (
                  <Field label="Record status" htmlFor="status" error={fieldError('status')} hint="Archived patients keep their history and can be restored.">
                    <Select
                      id="status"
                      value={String(values.status ?? 'active')}
                      onChange={(value) => form.setValue('status', value as PatientInput['status'])}
                      options={PATIENT_STATUSES.map((entry) => ({ value: entry.value, label: entry.label }))}
                    />
                  </Field>
                ) : (
                  <div className="row">
                    <Badge tone="info">New record</Badge>
                    <span className="muted small">The patient starts as active with a freshly allocated patient ID.</span>
                  </div>
                )}

                <Field label="Notes" htmlFor="notes" error={fieldError('notes')}>
                  <TextArea id="notes" value={String(values.notes ?? '')} onChange={(value) => form.setValue('notes', value || null)} rows={3} maxLength={2000} disabled={busy} />
                </Field>
              </div>
            </div>
          </CardBody>
        </Card>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="tertiary" onClick={() => navigate(-1)} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon={<Save size={16} />} loading={busy}>
            {mode === 'create' ? 'Register patient' : 'Save changes'}
          </Button>
        </div>
      </form>
    </div>
  )
}
