import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Building2, FolderOpen, Save, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Button, Card, CardBody, CardHeader, Checkbox, PageHeader, Tabs, Toolbar } from '../../components/ui/primitives'
import { Field, Select, TextArea, TextInput } from '../../components/ui/form'
import { toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useAppStore, usePermission } from '../../store/appStore'
import type { ClinicProfile, SettingDef } from '../../lib/types'

/**
 * Settings.
 *
 * The tabs are built from the setting catalogue the main process reports, so a setting can never be
 * shown here without a matching definition (and therefore without validation). Values are validated
 * again in the main process; this screen only collects them.
 */
type TabId = 'clinic' | 'practice' | 'clinical' | 'security' | 'interface' | 'locations'

const TAB_LABELS: Array<{ value: TabId, label: string }> = [
  { value: 'clinic', label: 'Clinic profile' },
  { value: 'practice', label: 'Practice & billing' },
  { value: 'clinical', label: 'Clinical & inventory' },
  { value: 'security', label: 'Security' },
  { value: 'interface', label: 'Interface' },
  { value: 'locations', label: 'Data locations' }
]

function groupForTab(tab: TabId): string[] {
  switch (tab) {
    case 'clinic':
      return []
    case 'practice':
      return ['practice', 'invoice', 'prescription', 'print', 'backup']
    case 'clinical':
      return ['clinical', 'inventory', 'notifications']
    case 'security':
      return ['security']
    case 'interface':
      return ['ui']
    default:
      return []
  }
}

export function SettingsScreen(): ReactNode {
  const canModify = usePermission('settings.modify')
  const [tab, setTab] = useState<TabId>('clinic')

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Clinic identity, numbering, clinical defaults and security policy. Changes are validated and audited."
      />
      <Tabs value={tab} onChange={(value) => setTab(value as TabId)} options={TAB_LABELS} />
      {tab === 'clinic' ? <ClinicProfilePanel canModify={canModify} /> : null}
      {tab === 'practice' ? <SettingsGroupPanel tab={tab} canModify={canModify} /> : null}
      {tab === 'clinical' ? <SettingsGroupPanel tab={tab} canModify={canModify} /> : null}
      {tab === 'security' ? <SettingsGroupPanel tab={tab} canModify={canModify} /> : null}
      {tab === 'interface' ? <SettingsGroupPanel tab={tab} canModify={canModify} /> : null}
      {tab === 'locations' ? <DataLocationsPanel /> : null}
    </div>
  )
}

/* -------------------------------------------------------------- Clinic profile */

function ClinicProfilePanel({ canModify }: { canModify: boolean }): ReactNode {
  const clinic = useInvoke('settings.clinic', {})
  const setClinic = useAppStore((state) => state.setClinic)
  const [draft, setDraft] = useState<ClinicProfile | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (clinic.data) setDraft(clinic.data)
  }, [clinic.data])

  const update = (patch: Partial<ClinicProfile>): void => setDraft((current) => (current ? { ...current, ...patch } : current))

  const save = async (): Promise<void> => {
    if (!draft) return
    setBusy(true)
    try {
      const saved = await invoke('settings.updateClinic', {
        name: draft.name,
        nameBn: draft.nameBn,
        address: draft.address,
        addressBn: draft.addressBn,
        phone: draft.phone,
        altPhone: draft.altPhone,
        email: draft.email,
        website: draft.website,
        openingTime: draft.openingTime,
        closingTime: draft.closingTime,
        weeklyClosedDays: draft.weeklyClosedDays,
        footerMessage: draft.footerMessage,
        invoiceFooter: draft.invoiceFooter,
        prescriptionFooter: draft.prescriptionFooter,
        emergencyInstruction: draft.emergencyInstruction
      })
      setClinic(saved)
      toast('success', 'Clinic profile saved', 'Printouts and the header now use these details.')
    } catch (error) {
      toast('error', 'The clinic profile could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (clinic.loading || !draft) {
    return (
      <Card>
        <CardBody>
          <span className="muted">Loading the clinic profile…</span>
        </CardBody>
      </Card>
    )
  }

  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  return (
    <Card>
      <CardHeader title="Clinic identity" icon={<Building2 size={17} />} subtitle="Printed on every prescription, invoice, receipt and report." />
      <CardBody>
        <div className="grid grid--2">
          <Field label="Clinic name" htmlFor="clinicName" required>
            <TextInput id="clinicName" value={draft.name} onChange={(value) => update({ name: value })} maxLength={120} disabled={!canModify} />
          </Field>
          <Field label="Clinic name in Bangla" htmlFor="clinicNameBn">
            <input id="clinicNameBn" className="field__input bn" value={draft.nameBn ?? ''} onChange={(event) => update({ nameBn: event.target.value || null })} maxLength={120} disabled={!canModify} />
          </Field>
          <Field label="Phone" htmlFor="clinicPhone">
            <TextInput id="clinicPhone" value={draft.phone ?? ''} onChange={(value) => update({ phone: value || null })} maxLength={40} disabled={!canModify} />
          </Field>
          <Field label="Alternate phone" htmlFor="clinicAltPhone">
            <TextInput id="clinicAltPhone" value={draft.altPhone ?? ''} onChange={(value) => update({ altPhone: value || null })} maxLength={40} disabled={!canModify} />
          </Field>
          <Field label="Email" htmlFor="clinicEmail">
            <TextInput id="clinicEmail" type="email" value={draft.email ?? ''} onChange={(value) => update({ email: value || null })} maxLength={160} disabled={!canModify} />
          </Field>
          <Field label="Website" htmlFor="clinicWebsite">
            <TextInput id="clinicWebsite" value={draft.website ?? ''} onChange={(value) => update({ website: value || null })} maxLength={160} disabled={!canModify} />
          </Field>
          <Field label="Address" htmlFor="clinicAddress" span={2}>
            <TextArea id="clinicAddress" value={draft.address ?? ''} onChange={(value) => update({ address: value || null })} rows={2} maxLength={300} disabled={!canModify} />
          </Field>
          <Field label="Address in Bangla" htmlFor="clinicAddressBn" span={2}>
            <TextArea id="clinicAddressBn" value={draft.addressBn ?? ''} onChange={(value) => update({ addressBn: value || null })} rows={2} maxLength={300} disabled={!canModify} bengali />
          </Field>
          <Field label="Opening time" htmlFor="clinicOpening">
            <input id="clinicOpening" className="field__input" type="time" value={draft.openingTime ?? '10:00'} onChange={(event) => update({ openingTime: event.target.value })} disabled={!canModify} />
          </Field>
          <Field label="Closing time" htmlFor="clinicClosing">
            <input id="clinicClosing" className="field__input" type="time" value={draft.closingTime ?? '20:00'} onChange={(event) => update({ closingTime: event.target.value })} disabled={!canModify} />
          </Field>
          <Field label="Weekly closed days" htmlFor="clinicClosedDays" span={2} hint="Used to warn when booking outside working days.">
            <div className="row" style={{ gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
              {weekdays.map((day, index) => (
                <Checkbox
                  key={day}
                  checked={draft.weeklyClosedDays.includes(index)}
                  disabled={!canModify}
                  label={day}
                  onChange={(checked) =>
                    update({
                      weeklyClosedDays: checked ? [...draft.weeklyClosedDays, index].sort() : draft.weeklyClosedDays.filter((value) => value !== index)
                    })
                  }
                />
              ))}
            </div>
          </Field>
          <Field label="Prescription footer" htmlFor="clinicRxFooter" span={2} hint="Appears at the bottom of every prescription.">
            <TextArea id="clinicRxFooter" value={draft.prescriptionFooter ?? ''} onChange={(value) => update({ prescriptionFooter: value || null })} rows={2} maxLength={400} disabled={!canModify} />
          </Field>
          <Field label="Invoice footer" htmlFor="clinicInvoiceFooter" span={2}>
            <TextArea id="clinicInvoiceFooter" value={draft.invoiceFooter ?? ''} onChange={(value) => update({ invoiceFooter: value || null })} rows={2} maxLength={400} disabled={!canModify} />
          </Field>
          <Field label="Emergency instruction" htmlFor="clinicEmergency" span={2} hint="Printed on the prescription as an after-hours contact instruction.">
            <TextInput id="clinicEmergency" value={draft.emergencyInstruction ?? ''} onChange={(value) => update({ emergencyInstruction: value || null })} maxLength={400} disabled={!canModify} />
          </Field>
        </div>

        <Toolbar>
          <span className="muted small">Changes apply to new printouts. Already printed documents are never altered.</span>
          <div className="grow" />
          <Button variant="primary" icon={<Save size={16} />} disabled={!canModify} loading={busy} onClick={() => void save()}>
            Save clinic profile
          </Button>
        </Toolbar>
      </CardBody>
    </Card>
  )
}

/* ------------------------------------------------------------- Setting groups */

function SettingsGroupPanel({ tab, canModify }: { tab: TabId, canModify: boolean }): ReactNode {
  const defs = useInvoke('settings.defs', {})
  const all = useInvoke('settings.all', {})
  const mergeSettings = useAppStore((state) => state.mergeSettings)
  const settings = useAppStore((state) => state.settings)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (all.data) setDraft(all.data as Record<string, string>)
  }, [all.data])

  const groups = groupForTab(tab)
  const relevant = useMemo(() => (defs.data ?? []).filter((def) => groups.includes(def.group)), [defs.data, groups])

  const changed = relevant.filter((def) => draft[def.key] !== settings[def.key])

  const save = async (): Promise<void> => {
    const values: Record<string, string> = {}
    for (const def of changed) values[def.key] = draft[def.key] ?? def.default
    if (Object.keys(values).length === 0) {
      toast('info', 'Nothing to save', 'No setting was changed.')
      return
    }
    setBusy(true)
    try {
      const saved = await invoke('settings.update', { values })
      mergeSettings(saved as Record<string, string>)
      toast('success', `${Object.keys(values).length} setting(s) saved`)
    } catch (error) {
      toast('error', 'The settings could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (defs.loading || all.loading) {
    return (
      <Card>
        <CardBody>
          <span className="muted">Loading settings…</span>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={TAB_LABELS.find((entry) => entry.value === tab)?.label ?? 'Settings'}
        icon={<SlidersHorizontal size={17} />}
        subtitle="Defaults applied to new records. Existing records keep the values they were saved with."
      />
      <CardBody>
        <div className="grid grid--2">
          {relevant.map((def) => (
            <SettingField
              key={def.key}
              def={def}
              value={draft[def.key] ?? def.default}
              disabled={!canModify}
              onChange={(value) => setDraft((current) => ({ ...current, [def.key]: value }))}
            />
          ))}
        </div>
        <Toolbar>
          <span className="muted small">{changed.length > 0 ? `${changed.length} unsaved change(s)` : 'No unsaved changes'}</span>
          <div className="grow" />
          <Button variant="primary" icon={<Save size={16} />} disabled={!canModify || changed.length === 0} loading={busy} onClick={() => void save()}>
            Save settings
          </Button>
        </Toolbar>
      </CardBody>
    </Card>
  )
}

function SettingField({
  def,
  value,
  disabled,
  onChange
}: {
  def: SettingDef
  value: string
  disabled?: boolean
  onChange(value: string): void
}): ReactNode {
  const id = `setting-${def.key.replace(/\./g, '-')}`

  if (def.type === 'boolean') {
    return (
      <Field label={def.label} htmlFor={id} hint={def.description}>
        <Checkbox id={id} checked={value === 'true'} disabled={disabled} label={def.label} onChange={(checked) => onChange(checked ? 'true' : 'false')} />
      </Field>
    )
  }

  if (def.type === 'enum' || def.type === 'dateFormat' || def.type === 'timeFormat') {
    const options =
      def.type === 'dateFormat'
        ? [
            { value: 'dd/MM/yyyy', label: '31/12/2026 (day/month/year)' },
            { value: 'MM/dd/yyyy', label: '12/31/2026 (month/day/year)' },
            { value: 'yyyy-MM-dd', label: '2026-12-31 (ISO)' },
            { value: 'dd MMM yyyy', label: '31 Dec 2026' }
          ]
        : (def.values ?? []).map((option) => ({ value: option, label: option.replace(/_/g, ' ') }))
    return (
      <Field label={def.label} htmlFor={id} hint={def.description}>
        <Select id={id} value={value} onChange={onChange} options={options} disabled={disabled} />
      </Field>
    )
  }

  if (def.type === 'number') {
    return (
      <Field label={def.label} htmlFor={id} hint={def.description}>
        <input
          id={id}
          className="field__input"
          type="number"
          min={def.min}
          max={def.max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
      </Field>
    )
  }

  if (def.type === 'time') {
    return (
      <Field label={def.label} htmlFor={id} hint={def.description}>
        <input id={id} className="field__input" type="time" value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      </Field>
    )
  }

  return (
    <Field label={def.label} htmlFor={id} hint={def.description}>
      <TextInput id={id} value={value} onChange={onChange} disabled={disabled} maxLength={400} />
    </Field>
  )
}

/* -------------------------------------------------------------- Data locations */

function DataLocationsPanel(): ReactNode {
  const environment = useInvoke('app.environment', {})
  const canConfigureBackups = usePermission('backups.configure')

  const open = async (kind: 'data' | 'logs' | 'exports' | 'backups' | 'attachments'): Promise<void> => {
    try {
      await invoke('app.openDataFolder', { kind })
    } catch (error) {
      toast('error', 'The folder could not be opened', errorMessage(error))
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Where your data lives"
          subtitle="Everything Dentiva Pro stores stays inside these folders on this computer. Nothing is uploaded anywhere."
          icon={<FolderOpen size={17} />}
        />
        <CardBody>
          <dl className="definition-list">
            <div>
              <dt>Data folder</dt>
              <dd className="row" style={{ gap: 8 }}>
                <code className="code-inline">{environment.data?.dataDirectory ?? '—'}</code>
                <Button size="sm" variant="tertiary" onClick={() => void open('data')}>
                  Open
                </Button>
              </dd>
            </div>
            <div>
              <dt>Attachments</dt>
              <dd className="row" style={{ gap: 8 }}>
                <Button size="sm" variant="tertiary" onClick={() => void open('attachments')}>
                  Open attachments folder
                </Button>
              </dd>
            </div>
            <div>
              <dt>Backups</dt>
              <dd className="row" style={{ gap: 8 }}>
                <code className="code-inline">{environment.data?.defaultBackupDirectory ?? '—'}</code>
                <Button size="sm" variant="tertiary" onClick={() => void open('backups')}>
                  Open
                </Button>
              </dd>
            </div>
            <div>
              <dt>Exports</dt>
              <dd className="row" style={{ gap: 8 }}>
                <code className="code-inline">{environment.data?.exportsDirectory ?? '—'}</code>
                <Button size="sm" variant="tertiary" onClick={() => void open('exports')}>
                  Open
                </Button>
              </dd>
            </div>
            <div>
              <dt>Log files</dt>
              <dd className="row" style={{ gap: 8 }}>
                <code className="code-inline">{environment.data?.logDirectory ?? '—'}</code>
                <Button size="sm" variant="tertiary" onClick={() => void open('logs')}>
                  Open
                </Button>
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Housekeeping"
          subtitle="Maintenance tasks are safe to run at any time. Keep a backup before large housekeeping."
          icon={<ShieldCheck size={17} />}
        />
        <CardBody>
          <ul className="disk-list">
            <li>The database runs in write-ahead logging mode; interrupted sessions never corrupt it.</li>
            <li>Attachments are stored per patient under the data folder and are included in backups.</li>
            <li>Log files are rotated automatically and never contain clinical text or passwords.</li>
          </ul>
          <p className="muted small">
            {canConfigureBackups
              ? 'Automatic backups can be configured from the backup screen.'
              : 'Ask an administrator with backup rights to review the backup schedule.'}
          </p>
        </CardBody>
      </Card>
    </>
  )
}
