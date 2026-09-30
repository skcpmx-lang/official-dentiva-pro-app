import { useEffect, useState, type ReactNode } from 'react'
import { Pencil, Plus, Stethoscope } from 'lucide-react'
import { zDentistInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, Switch } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { Field, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { usePermission } from '../../store/appStore'
import type { Dentist, DentistInput } from '../../lib/types'

/**
 * Dentists.
 *
 * A dentist record drives the prescription header (name, degrees, registration number), the signature
 * line, the appointment calendar and the visit attribution. Degrees and qualifications are edited as
 * free-text lists so any Bangladeshi qualification (BDS, MDS, FCPS, PGT …) can be recorded verbatim.
 */
export function DentistsScreen(): ReactNode {
  const canModify = usePermission('settings.modify')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [editing, setEditing] = useState<Dentist | null>(null)
  const [creating, setCreating] = useState(false)
  const dentists = useInvoke('dentists.list', { includeInactive })

  const columns: Array<Column<Dentist>> = [
    {
      key: 'name',
      header: 'Dentist',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.fullName}</span>
          {row.fullNameBn ? <span className="bn muted small">{row.fullNameBn}</span> : null}
        </div>
      ),
      sortValue: (row) => row.fullName
    },
    {
      key: 'designations',
      header: 'Degrees / designations',
      render: (row) => (row.designationList.length > 0 ? row.designationList.join(', ') : <span className="muted">—</span>),
      sortValue: (row) => row.designationList.join(', ')
    },
    {
      key: 'registration',
      header: 'BMDC registration',
      width: 170,
      render: (row) => (row.registrationNo ? <span className="num">{row.registrationNo}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.registrationNo ?? '',
      secondary: true
    },
    {
      key: 'phone',
      header: 'Phone',
      width: 140,
      render: (row) => (row.phone ? <span className="num">{row.phone}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.phone ?? ''
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (row) => (row.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Inactive</Badge>),
      sortValue: (row) => (row.isActive ? 1 : 0)
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Dentists"
        subtitle="Dentists appear on prescriptions, invoices, appointments and visit records."
        actions={
          canModify ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Add dentist
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader
          title="Practice dentists"
          icon={<Stethoscope size={17} />}
          actions={
            <Switch checked={includeInactive} onChange={setIncludeInactive} label="Show inactive dentists" />
          }
        />
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={dentists.data ?? []}
            getRowId={(row) => row.id}
            loading={dentists.loading}
            emptyTitle="No dentists recorded"
            emptyMessage="Add the dentists working at this clinic so visits and prescriptions can be attributed correctly."
            rowActions={(row) =>
              canModify ? (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="tertiary" icon={<Pencil size={15} />} onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await invoke('dentists.setActive', { id: row.id, isActive: !row.isActive })
                        toast('success', row.isActive ? `${row.fullName} is now inactive` : `${row.fullName} is active again`)
                        await dentists.reload()
                      } catch (error) {
                        toast('error', 'The dentist could not be updated', errorMessage(error))
                      }
                    }}
                  >
                    {row.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <DentistDialog
        dentist={creating ? null : editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => void dentists.reload()}
      />
    </div>
  )
}

function DentistDialog({
  dentist,
  open,
  onClose,
  onSaved
}: {
  dentist: Dentist | null
  open: boolean
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [designationDraft, setDesignationDraft] = useState('')
  const form = useZodForm(zDentistInput, {
    id: null,
    fullName: '',
    fullNameBn: null,
    phone: null,
    email: null,
    registrationNo: null,
    signatureLabel: null,
    color: null,
    isActive: true,
    sortOrder: 0,
    designations: [],
    qualifications: [],
    schedules: []
  })

  useEffect(() => {
    if (!open) return
    if (!dentist) {
      form.reset({
        id: null,
        fullName: '',
        fullNameBn: null,
        phone: null,
        email: null,
        registrationNo: null,
        signatureLabel: null,
        color: null,
        isActive: true,
        sortOrder: 0,
        designations: [],
        qualifications: [],
        schedules: []
      })
      return
    }
    form.reset({
      id: dentist.id,
      fullName: dentist.fullName,
      fullNameBn: dentist.fullNameBn,
      phone: dentist.phone,
      email: dentist.email,
      registrationNo: dentist.registrationNo,
      signatureLabel: dentist.signatureLabel,
      color: dentist.color,
      isActive: dentist.isActive,
      sortOrder: dentist.sortOrder,
      designations: dentist.designationList,
      qualifications: dentist.qualificationList.map((title) => ({ title, institution: null, year: null })),
      schedules: []
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dentist])

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    setBusy(true)
    try {
      await invoke('dentists.save', form.values as DentistInput)
      toast('success', dentist ? 'Dentist updated' : 'Dentist added')
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The dentist record could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const designations = (form.values.designations ?? []) as string[]

  return (
    <Modal
      open={open}
      size="lg"
      title={dentist ? `Edit ${dentist.fullName}` : 'Add a dentist'}
      description="These details are printed on prescriptions and used on visit records."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {dentist ? 'Save changes' : 'Add dentist'}
          </Button>
        </>
      }
    >
      <div className="grid grid--two">
        <Field label="Full name" htmlFor="dentistName" required error={form.errors.fullName}>
          <TextInput id="dentistName" value={String(form.values.fullName ?? '')} onChange={(value) => form.setValue('fullName', value)} maxLength={120} />
        </Field>
        <Field label="Name in Bangla" htmlFor="dentistNameBn" error={form.errors.fullNameBn}>
          <input
            id="dentistNameBn"
            className="field__input bn"
            value={String(form.values.fullNameBn ?? '')}
            onChange={(event) => form.setValue('fullNameBn', event.target.value || null)}
            maxLength={120}
          />
        </Field>
        <Field label="Phone" htmlFor="dentistPhone" error={form.errors.phone}>
          <TextInput id="dentistPhone" value={String(form.values.phone ?? '')} onChange={(value) => form.setValue('phone', value || null)} maxLength={40} />
        </Field>
        <Field label="Email" htmlFor="dentistEmail" error={form.errors.email}>
          <TextInput id="dentistEmail" type="email" value={String(form.values.email ?? '')} onChange={(value) => form.setValue('email', value || null)} maxLength={160} />
        </Field>
        <Field label="BMDC registration number" htmlFor="dentistRegistration" error={form.errors.registrationNo}>
          <TextInput id="dentistRegistration" value={String(form.values.registrationNo ?? '')} onChange={(value) => form.setValue('registrationNo', value || null)} maxLength={60} />
        </Field>
        <Field label="Signature label" htmlFor="dentistSignature" error={form.errors.signatureLabel} hint="Printed under the signature line, for example “Consultant Dental Surgeon”.">
          <TextInput id="dentistSignature" value={String(form.values.signatureLabel ?? '')} onChange={(value) => form.setValue('signatureLabel', value || null)} maxLength={120} />
        </Field>
        <Field label="Degrees and designations" htmlFor="designationDraft" error={form.errors.designations} span={2} hint="Printed after the dentist's name on every prescription.">
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}>
              <input
                id="designationDraft"
                className="field__input"
                value={designationDraft}
                onChange={(event) => setDesignationDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const value = designationDraft.trim()
                    if (value && !designations.includes(value)) form.setValue('designations', [...designations, value])
                    setDesignationDraft('')
                  }
                }}
                placeholder="e.g. BDS, MDS (Orthodontics)"
                maxLength={80}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  const value = designationDraft.trim()
                  if (value && !designations.includes(value)) form.setValue('designations', [...designations, value])
                  setDesignationDraft('')
                }}
              >
                Add
              </Button>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {designations.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  className="chip chip--removable"
                  onClick={() => form.setValue('designations', designations.filter((value) => value !== entry))}
                >
                  {entry} ×
                </button>
              ))}
            </div>
          </div>
        </Field>
        <Field label="Active" htmlFor="dentistActive" span={2} hint="Inactive dentists keep their history but are not offered for new appointments.">
          <Switch
            checked={Boolean(form.values.isActive)}
            onChange={(checked) => form.setValue('isActive', checked)}
            label={form.values.isActive ? 'Offers appointments' : 'Not offered for appointments'}
          />
        </Field>
      </div>
      <p className="muted small" style={{ marginTop: 'var(--sp-3)' }}>
        Weekly duty schedules are configured on the dentist's record once the appointment module is in use; qualified dentists can be assigned per
        appointment immediately.
      </p>
    </Modal>
  )
}
