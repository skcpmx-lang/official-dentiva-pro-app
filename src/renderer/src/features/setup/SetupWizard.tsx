import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Building2, CheckCircle2, Printer, Stethoscope, UserRound, Wallet } from 'lucide-react'
import { zClinicProfileInput, zDentistInput, zSetupAdministratorInput } from '@shared/contracts'
import { Button, Card, CardBody, CardHeader, PageHeader } from '../../components/ui/primitives'
import { Field, NumberInput, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { CURRENCY_CODE } from '../../lib/format'
import { applyBootstrap } from '../../App'
import { useNavigate } from 'react-router-dom'

const STEPS = [
  { key: 'clinic', label: 'Clinic profile', icon: Building2 },
  { key: 'dentists', label: 'Dentists', icon: Stethoscope },
  { key: 'administrator', label: 'Administrator', icon: UserRound },
  { key: 'preferences', label: 'Preferences', icon: Wallet },
  { key: 'review', label: 'Review', icon: CheckCircle2 }
] as const

type StepKey = (typeof STEPS)[number]['key']

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * First-run setup wizard.
 *
 * Runs once per installation, immediately after activation, and creates the clinic profile, at least one
 * dentist, the administrator account and the working preferences. Each step writes to the database as it
 * is completed, so an interrupted setup resumes at the first incomplete step instead of starting over.
 */
export function SetupWizard(): ReactNode {
  const status = useInvoke('setup.status', {})
  const navigate = useNavigate()
  const [step, setStep] = useState<StepKey>('clinic')
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<null | Awaited<ReturnType<typeof loadSummary>>>(null)

  const loadSummary = () => invoke('setup.summary', {})

  // An interrupted setup resumes at the first step that is still incomplete.
  useEffect(() => {
    const data = status.data
    if (!data) return
    if (!data.hasClinic) setStep('clinic')
    else if (data.dentistCount === 0) setStep('dentists')
    else if (!data.hasAdministrator) setStep('administrator')
    else setStep('preferences')
  }, [status.data])

  const completed = useMemo(
    () => ({
      clinic: Boolean(status.data?.hasClinic),
      dentists: (status.data?.dentistCount ?? 0) > 0,
      administrator: Boolean(status.data?.hasAdministrator),
      preferences: false,
      review: false
    }),
    [status.data]
  )

  const goToReview = async (): Promise<void> => {
    try {
      const data = await loadSummary()
      setSummary(data)
      setStep('review')
    } catch (error) {
      toast('error', 'The setup summary could not be loaded', errorMessage(error))
    }
  }

  const finish = async (): Promise<void> => {
    const answer = await confirmDialog({
      title: 'Finish setup and open Dentiva Pro?',
      message:
        'The clinic profile, dentists and administrator account will be used for every prescription, invoice and printed document. Details can still be changed later in Settings.',
      confirmLabel: 'Finish setup'
    })
    if (!answer.confirmed) return
    setBusy(true)
    try {
      await invoke('setup.complete', { confirmation: 'COMPLETE SETUP' })
      const payload = await invoke('app.bootstrap', {})
      applyBootstrap(payload)
      toast('success', 'Setup complete', 'Sign in with the administrator account you just created.')
      navigate(payload.stage === 'ready' ? '/' : '/login', { replace: true })
    } catch (error) {
      toast('error', 'Setup could not be completed', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!status.data) return <div className="center-screen muted">Reading setup status…</div>

  const currentIndex = STEPS.findIndex((entry) => entry.key === step)

  return (
    <div className="center-screen center-screen--wide">
      <PageHeader
        title="Set up Dentiva Pro"
        subtitle={`This takes a few minutes and is done once per installation. Currency is fixed to ${CURRENCY_CODE}.`}
      />

      <div className="wizard">
        <ol className="wizard__steps">
          {STEPS.map((entry, index) => {
            const Icon = entry.icon
            const done = completed[entry.key] || index < currentIndex
            return (
              <li key={entry.key} className={`wizard__step${index === currentIndex ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
                <button
                  type="button"
                  className="wizard__step-button"
                  disabled={index > currentIndex && !completed.clinic}
                  onClick={() => setStep(entry.key)}
                >
                  <span className="wizard__step-icon">
                    <Icon size={16} aria-hidden />
                  </span>
                  <span className="stack" style={{ gap: 2, alignItems: 'flex-start' }}>
                    <span>{entry.label}</span>
                    {done ? <span className="muted small">completed</span> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <div className="wizard__body">
          {step === 'clinic' ? <ClinicStep onDone={() => { void status.reload(); setStep('dentists') }} /> : null}
          {step === 'dentists' ? <DentistStep onDone={() => { void status.reload(); setStep('administrator') }} /> : null}
          {step === 'administrator' ? (
            <AdministratorStep
              onBack={() => setStep('dentists')}
              onDone={() => {
                void status.reload()
                setStep('preferences')
              }}
            />
          ) : null}
          {step === 'preferences' ? (
            <PreferencesStep
              onBack={() => setStep('administrator')}
              onDone={() => {
                void status.reload()
                void goToReview()
              }}
            />
          ) : null}
          {step === 'review' ? (
            <Card>
              <CardHeader title="Review and finish" icon={<Printer size={17} />} subtitle="Confirm the installation details below." />
              <CardBody>
                {summary === null ? (
                  <p className="muted">Loading the setup summary…</p>
                ) : (
                  <div className="stack">
                    <dl className="detail-list">
                      <div>
                        <dt>Clinic</dt>
                        <dd>
                          {summary.clinic.name}
                          {summary.clinic.nameBn ? <span className="bn muted"> · {summary.clinic.nameBn}</span> : null}
                        </dd>
                      </div>
                      <div>
                        <dt>Address</dt>
                        <dd>
                          {summary.clinic.address ?? '—'}
                          {summary.clinic.addressBn ? <span className="bn muted"> · {summary.clinic.addressBn}</span> : null}
                        </dd>
                      </div>
                      <div>
                        <dt>Contact</dt>
                        <dd className="num">{summary.clinic.phone ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>Dentists</dt>
                        <dd>{summary.dentists.map((dentist) => dentist.fullName).join(', ')}</dd>
                      </div>
                      <div>
                        <dt>Administrator</dt>
                        <dd className="num">
                          {summary.administrator.fullName} ({summary.administrator.username})
                        </dd>
                      </div>
                      <div>
                        <dt>Data folder</dt>
                        <dd className="num small" style={{ wordBreak: 'break-all' }}>
                          {summary.dataDirectory}
                        </dd>
                      </div>
                      <div>
                        <dt>Default backup folder</dt>
                        <dd className="num small" style={{ wordBreak: 'break-all' }}>
                          {summary.backupDirectory}
                        </dd>
                      </div>
                    </dl>
                    <p className="muted small">
                      Nothing leaves this computer. Dentiva Pro stores the database, attachments, exports, logs and backups only inside the folders
                      above.
                    </p>
                    <div className="row" style={{ gap: 8 }}>
                      <Button variant="tertiary" onClick={() => setStep('preferences')}>
                        Back
                      </Button>
                      <Button variant="primary" loading={busy} onClick={() => void finish()}>
                        Finish setup
                      </Button>
                    </div>
                  </div>
                )}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ClinicStep({ onDone }: { onDone(): void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [closedDays, setClosedDays] = useState<number[]>([5])
  const form = useZodForm(zClinicProfileInput, {
    name: '',
    nameBn: null,
    logoPath: null,
    address: null,
    addressBn: null,
    phone: null,
    altPhone: null,
    email: null,
    website: null,
    openingTime: '09:00',
    closingTime: '21:00',
    weeklyClosedDays: [5],
    footerMessage: null,
    invoiceFooter: null,
    prescriptionFooter: null,
    emergencyInstruction: null
  })

  useEffect(() => {
    let cancelled = false
    void invoke('app.bootstrap', {})
      .then((payload) => {
        if (cancelled || !payload.clinic) return
        form.reset({
          name: payload.clinic.name,
          nameBn: payload.clinic.nameBn,
          logoPath: payload.clinic.logoPath,
          address: payload.clinic.address,
          addressBn: payload.clinic.addressBn,
          phone: payload.clinic.phone,
          altPhone: payload.clinic.altPhone,
          email: payload.clinic.email,
          website: payload.clinic.website,
          openingTime: payload.clinic.openingTime ?? '09:00',
          closingTime: payload.clinic.closingTime ?? '21:00',
          weeklyClosedDays: payload.clinic.weeklyClosedDays,
          footerMessage: payload.clinic.footerMessage,
          invoiceFooter: payload.clinic.invoiceFooter,
          prescriptionFooter: payload.clinic.prescriptionFooter,
          emergencyInstruction: payload.clinic.emergencyInstruction
        })
        setClosedDays(payload.clinic.weeklyClosedDays)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (): Promise<void> => {
    if (!form.validate()) return
    setBusy(true)
    try {
      await invoke('setup.clinic', { ...form.values, weeklyClosedDays: closedDays } as never)
      toast('success', 'Clinic profile saved')
      onDone()
    } catch (error) {
      toast('error', 'The clinic profile could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Clinic profile"
        icon={<Building2 size={17} />}
        subtitle="Printed on every prescription, invoice and report header. Bangla text is optional but recommended."
      />
      <CardBody>
        <div className="grid grid--two">
          <Field label="Clinic name" htmlFor="clinicName" required error={form.errors.name}>
            <TextInput id="clinicName" value={String(form.values.name ?? '')} onChange={(value) => form.setValue('name', value)} maxLength={120} />
          </Field>
          <Field label="Clinic name in Bangla" htmlFor="clinicNameBn" error={form.errors.nameBn}>
            <input
              id="clinicNameBn"
              className="field__input bn"
              value={String(form.values.nameBn ?? '')}
              onChange={(event) => form.setValue('nameBn', event.target.value || null)}
              maxLength={120}
            />
          </Field>
          <Field label="Address" htmlFor="clinicAddress" span={2}>
            <TextInput id="clinicAddress" value={String(form.values.address ?? '')} onChange={(value) => form.setValue('address', value || null)} maxLength={300} />
          </Field>
          <Field label="Address in Bangla" htmlFor="clinicAddressBn" span={2}>
            <input
              id="clinicAddressBn"
              className="field__input bn"
              value={String(form.values.addressBn ?? '')}
              onChange={(event) => form.setValue('addressBn', event.target.value || null)}
              maxLength={300}
            />
          </Field>
          <Field label="Phone" htmlFor="clinicPhone">
            <TextInput id="clinicPhone" value={String(form.values.phone ?? '')} onChange={(value) => form.setValue('phone', value || null)} maxLength={40} />
          </Field>
          <Field label="Alternate phone" htmlFor="clinicAltPhone">
            <TextInput id="clinicAltPhone" value={String(form.values.altPhone ?? '')} onChange={(value) => form.setValue('altPhone', value || null)} maxLength={40} />
          </Field>
          <Field label="Email" htmlFor="clinicEmail">
            <TextInput id="clinicEmail" type="email" value={String(form.values.email ?? '')} onChange={(value) => form.setValue('email', value || null)} maxLength={160} />
          </Field>
          <Field label="Website or Facebook page" htmlFor="clinicWebsite">
            <TextInput id="clinicWebsite" value={String(form.values.website ?? '')} onChange={(value) => form.setValue('website', value || null)} maxLength={160} />
          </Field>
          <Field label="Opening time" htmlFor="clinicOpen" hint="24-hour clock, for example 09:00.">
            <TextInput id="clinicOpen" value={String(form.values.openingTime ?? '')} onChange={(value) => form.setValue('openingTime', value || null)} maxLength={5} />
          </Field>
          <Field label="Closing time" htmlFor="clinicClose" hint="Used for the queue and appointment defaults.">
            <TextInput id="clinicClose" value={String(form.values.closingTime ?? '')} onChange={(value) => form.setValue('closingTime', value || null)} maxLength={5} />
          </Field>
          <Field label="Weekly closed day(s)" span={2} hint="Appointments are flagged when they are booked on a closed day.">
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {WEEKDAYS.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  className={`chip${closedDays.includes(index) ? ' chip--active' : ''}`}
                  onClick={() =>
                    setClosedDays((current) => (current.includes(index) ? current.filter((day) => day !== index) : [...current, index].sort()))
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Prescription footer" htmlFor="rxFooter" span={2} hint="Printed at the bottom of every prescription, for example follow-up advice.">
            <TextArea id="rxFooter" value={String(form.values.prescriptionFooter ?? '')} onChange={(value) => form.setValue('prescriptionFooter', value || null)} rows={2} maxLength={400} />
          </Field>
          <Field label="Invoice footer" htmlFor="invoiceFooter" span={2}>
            <TextArea id="invoiceFooter" value={String(form.values.invoiceFooter ?? '')} onChange={(value) => form.setValue('invoiceFooter', value || null)} rows={2} maxLength={400} />
          </Field>
          <Field label="Emergency instruction" htmlFor="emergency" span={2} hint="Printed on patient cards and appointment slips.">
            <TextArea id="emergency" value={String(form.values.emergencyInstruction ?? '')} onChange={(value) => form.setValue('emergencyInstruction', value || null)} rows={2} maxLength={400} />
          </Field>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 'var(--sp-4)' }}>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Save and continue
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function DentistStep({ onDone }: { onDone(): void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const dentists = useInvoke('dentists.list', { includeInactive: false })
  const [draft, setDraft] = useState({
    fullName: '',
    fullNameBn: '',
    designations: '',
    registrationNo: '',
    phone: '',
    signatureLabel: ''
  })

  const add = async (): Promise<void> => {
    const parsed = zDentistInput.safeParse({
      fullName: draft.fullName,
      fullNameBn: draft.fullNameBn || null,
      registrationNo: draft.registrationNo || null,
      phone: draft.phone || null,
      signatureLabel: draft.signatureLabel || null,
      designations: draft.designations
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    })
    if (!parsed.success) {
      toast('warning', 'Check the dentist details', parsed.error.issues[0]?.message ?? 'Some fields need attention.')
      return
    }
    setBusy(true)
    try {
      await invoke('setup.dentists', { dentists: [parsed.data] })
      toast('success', `${parsed.data.fullName} added`)
      setDraft({ fullName: '', fullNameBn: '', designations: '', registrationNo: '', phone: '', signatureLabel: '' })
      await dentists.reload()
    } catch (error) {
      toast('error', 'The dentist could not be added', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Dentists"
        icon={<Stethoscope size={17} />}
        subtitle="At least one dentist is required — the name and degrees are printed on prescriptions."
      />
      <CardBody>
        <div className="grid grid--two">
          <Field label="Full name" htmlFor="newDentistName" required>
            <TextInput id="newDentistName" value={draft.fullName} onChange={(value) => setDraft({ ...draft, fullName: value })} maxLength={120} />
          </Field>
          <Field label="Name in Bangla" htmlFor="newDentistNameBn">
            <input
              id="newDentistNameBn"
              className="field__input bn"
              value={draft.fullNameBn}
              onChange={(event) => setDraft({ ...draft, fullNameBn: event.target.value })}
              maxLength={120}
            />
          </Field>
          <Field label="Degrees and designations" htmlFor="newDentistDegrees" hint="Separate with commas, for example BDS, MDS (Orthodontics).">
            <TextInput id="newDentistDegrees" value={draft.designations} onChange={(value) => setDraft({ ...draft, designations: value })} maxLength={200} />
          </Field>
          <Field label="BMDC registration number" htmlFor="newDentistRegistration">
            <TextInput id="newDentistRegistration" value={draft.registrationNo} onChange={(value) => setDraft({ ...draft, registrationNo: value })} maxLength={60} />
          </Field>
          <Field label="Phone" htmlFor="newDentistPhone">
            <TextInput id="newDentistPhone" value={draft.phone} onChange={(value) => setDraft({ ...draft, phone: value })} maxLength={40} />
          </Field>
          <Field label="Signature label" htmlFor="newDentistSignature">
            <TextInput id="newDentistSignature" value={draft.signatureLabel} onChange={(value) => setDraft({ ...draft, signatureLabel: value })} maxLength={120} />
          </Field>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 'var(--sp-4)' }}>
          <Button variant="secondary" loading={busy} onClick={() => void add()}>
            Add dentist
          </Button>
          <Button variant="primary" disabled={(dentists.data ?? []).length === 0} onClick={onDone}>
            Continue
          </Button>
        </div>

        {(dentists.data ?? []).length > 0 ? (
          <ul className="plain-list" style={{ marginTop: 'var(--sp-4)' }}>
            {dentists.data?.map((dentist) => (
              <li key={dentist.id} className="plain-list__item">
                <span className="stack" style={{ gap: 2 }}>
                  <strong>{dentist.fullName}</strong>
                  <span className="muted small">
                    {dentist.designationList.join(', ') || 'No degrees recorded'}
                    {dentist.registrationNo ? ` · BMDC ${dentist.registrationNo}` : ''}
                  </span>
                </span>
                {dentist.fullNameBn ? <span className="bn muted">{dentist.fullNameBn}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small" style={{ marginTop: 'var(--sp-3)' }}>
            No dentist recorded yet.
          </p>
        )}
      </CardBody>
    </Card>
  )
}

function AdministratorStep({ onDone, onBack }: { onDone(): void, onBack(): void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const status = useInvoke('setup.status', {})
  const form = useZodForm(zSetupAdministratorInput, {
    fullName: '',
    username: '',
    password: '',
    confirmPassword: '',
    dentistId: null
  })

  const submit = async (): Promise<void> => {
    if (!form.validate()) return
    if (form.values.password !== form.values.confirmPassword) {
      form.setError('confirmPassword', 'The two passwords do not match.')
      return
    }
    setBusy(true)
    try {
      await invoke('setup.administrator', {
        fullName: String(form.values.fullName),
        username: String(form.values.username),
        password: String(form.values.password),
        confirmPassword: String(form.values.confirmPassword)
      })
      toast('success', 'Administrator account created', 'Sign in with these details from now on.')
      onDone()
    } catch (error) {
      toast('error', 'The administrator account could not be created', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (status.data?.hasAdministrator) {
    return (
      <Card>
        <CardHeader title="Administrator" icon={<UserRound size={17} />} subtitle="An administrator account already exists." />
        <CardBody>
          <dl className="detail-list">
            <div>
              <dt>Username</dt>
              <dd className="num">{status.data.adminUsername}</dd>
            </div>
          </dl>
          <div className="row" style={{ gap: 8, marginTop: 'var(--sp-3)' }}>
            <Button variant="primary" onClick={onDone}>
              Continue
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Administrator account"
        icon={<UserRound size={17} />}
        subtitle="The administrator owns every permission, manages users and roles, and can perform backups and restores."
      />
      <CardBody>
        <div className="grid grid--two">
          <Field label="Full name" htmlFor="adminFullName" required error={form.errors.fullName}>
            <TextInput id="adminFullName" value={String(form.values.fullName ?? '')} onChange={(value) => form.setValue('fullName', value)} maxLength={120} />
          </Field>
          <Field label="Username" htmlFor="adminUsername" required error={form.errors.username} hint="Used at sign-in. Letters, numbers, dot, dash or underscore.">
            <TextInput id="adminUsername" value={String(form.values.username ?? '')} onChange={(value) => form.setValue('username', value)} maxLength={32} />
          </Field>
          <Field label="Password" htmlFor="adminPassword" required error={form.errors.password} hint="At least 6 characters. Stored only as a salted scrypt hash.">
            <input
              id="adminPassword"
              className="field__input"
              type="password"
              value={String(form.values.password ?? '')}
              onChange={(event) => form.setValue('password', event.target.value)}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm password" htmlFor="adminConfirm" required error={form.errors.confirmPassword}>
            <input
              id="adminConfirm"
              className="field__input"
              type="password"
              value={String(form.values.confirmPassword ?? '')}
              onChange={(event) => form.setValue('confirmPassword', event.target.value)}
              maxLength={128}
              autoComplete="new-password"
            />
          </Field>
        </div>
        <p className="muted small" style={{ marginTop: 'var(--sp-3)' }}>
          Write the password down and keep it somewhere safe: there is no online password recovery in an offline application. The administrator can
          reset other users' passwords from Settings → Users.
        </p>
        <div className="row" style={{ gap: 8, marginTop: 'var(--sp-4)' }}>
          <Button variant="tertiary" onClick={onBack}>
            Back
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Create administrator
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function PreferencesStep({ onDone, onBack }: { onDone(): void, onBack(): void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [values, setValues] = useState({
    'clinic.currency': 'BDT',
    'clinic.defaultConsultationFee': '500',
    'session.autoLockMinutes': '5',
    'print.defaultPaper': 'a4',
    'ui.density': 'comfortable',
    'ui.language': 'en',
    'backup.autoEnabled': 'true',
    'backup.keepCount': '10',
    'queue.tokenPrefix': 'Q'
  })
  const saved = useInvoke('preferences.get', {})

  useEffect(() => {
    if (!saved.data) return
    setValues((current) => ({ ...current, ...saved.data }))
  }, [saved.data])

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      await invoke('setup.preferences', { values })
      toast('success', 'Preferences saved')
      onDone()
    } catch (error) {
      toast('error', 'The preferences could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Working preferences" icon={<Wallet size={17} />} subtitle="Sensible defaults for a Bangladeshi clinic. Everything can be changed later in Settings." />
      <CardBody>
        <div className="grid grid--two">
          <Field label="Currency" htmlFor="prefCurrency" hint="Dentiva Pro records money in Bangladeshi Taka only.">
            <TextInput id="prefCurrency" value={values['clinic.currency']} onChange={(value) => setValues({ ...values, 'clinic.currency': value })} maxLength={8} disabled />
          </Field>
          <Field label="Default consultation fee (৳)" htmlFor="prefFee" hint="Pre-filled on new visit records.">
            <NumberInput
              id="prefFee"
              value={Number(values['clinic.defaultConsultationFee'])}
              onChange={(value) => setValues({ ...values, 'clinic.defaultConsultationFee': String(value ?? 0) })}
              min={0}
              step={50}
            />
          </Field>
          <Field label="Auto-lock after (minutes)" htmlFor="prefLock" hint="The application locks itself after this much inactivity.">
            <NumberInput
              id="prefLock"
              value={Number(values['session.autoLockMinutes'])}
              onChange={(value) => setValues({ ...values, 'session.autoLockMinutes': String(value ?? 5) })}
              min={1}
              max={120}
            />
          </Field>
          <Field label="Queue token prefix" htmlFor="prefQueue" hint="Tokens look like A-014.">
            <TextInput id="prefQueue" value={values['queue.tokenPrefix']} onChange={(value) => setValues({ ...values, 'queue.tokenPrefix': value })} maxLength={3} />
          </Field>
          <Field label="Default paper size" htmlFor="prefPaper">
            <select
              id="prefPaper"
              className="field__input"
              value={values['print.defaultPaper']}
              onChange={(event) => setValues({ ...values, 'print.defaultPaper': event.target.value })}
            >
              <option value="a4">A4 (210 × 297 mm)</option>
              <option value="a5">A5 (148 × 210 mm)</option>
              <option value="letter">Letter (216 × 279 mm)</option>
              <option value="thermal80">Thermal 80 mm</option>
              <option value="thermal58">Thermal 58 mm</option>
            </select>
          </Field>
          <Field label="Interface density" htmlFor="prefDensity">
            <select
              id="prefDensity"
              className="field__input"
              value={values['ui.density']}
              onChange={(event) => setValues({ ...values, 'ui.density': event.target.value })}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </Field>
          <Field label="Automatic backups" htmlFor="prefBackup" hint="A backup is written to the backup folder when the application closes each day.">
            <select
              id="prefBackup"
              className="field__input"
              value={values['backup.autoEnabled']}
              onChange={(event) => setValues({ ...values, 'backup.autoEnabled': event.target.value })}
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </Field>
          <Field label="Backups to keep" htmlFor="prefBackupCount" hint="Older automatic backups are rotated after this many copies.">
            <NumberInput
              id="prefBackupCount"
              value={Number(values['backup.keepCount'])}
              onChange={(value) => setValues({ ...values, 'backup.keepCount': String(value ?? 10) })}
              min={2}
              max={200}
            />
          </Field>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 'var(--sp-4)' }}>
          <Button variant="tertiary" onClick={onBack}>
            Back
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Save and review
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
