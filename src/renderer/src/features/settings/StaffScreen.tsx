import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Archive, IdCard, Pencil, Plus, Upload } from 'lucide-react'
import { zStaffInput } from '@shared/contracts'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Switch, Toolbar } from '../../components/ui/primitives'
import { DataTable, type Column } from '../../components/ui/DataTable'
import { DateInput, Field, MoneyInput, Select, TextArea, TextInput, useZodForm } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { useFormatters } from '../../lib/format'
import { readFileAsBase64 } from '../../lib/files'
import { usePermission } from '../../store/appStore'
import type { Staff, StaffInput } from '../../lib/types'

const STATUS_META: Record<string, { label: string, tone: 'success' | 'warning' | 'neutral' | 'danger' }> = {
  active: { label: 'Active', tone: 'success' },
  probation: { label: 'Probation', tone: 'warning' },
  resigned: { label: 'Resigned', tone: 'neutral' },
  terminated: { label: 'Terminated', tone: 'danger' }
}

const STATUS_OPTIONS = [
  { value: '', label: 'All staff' },
  { value: 'active', label: 'Active' },
  { value: 'probation', label: 'Probation' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' }
]

type StatusFilter = '' | 'active' | 'probation' | 'resigned' | 'terminated'

/**
 * Staff records.
 *
 * Everyone who works at the clinic — assistants, receptionists, technicians, cleaners — is recorded here
 * with their contact details, designation, joining date and employment status. A staff record is not a
 * login: the user account screen links an account to a staff member when the person needs to sign in, and
 * a staff record with a linked account cannot be archived until that account is dealt with, so history
 * never ends up pointing at nothing.
 */
export function StaffScreen(): ReactNode {
  const formatters = useFormatters()
  const canManage = usePermission('staff.manage')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [editing, setEditing] = useState<Staff | null>(null)
  const [creating, setCreating] = useState(false)
  const [archiving, setArchiving] = useState<Staff | null>(null)

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const filter = useMemo(
    () => ({
      search: debounced === '' ? undefined : debounced,
      status: status === '' ? undefined : status,
      includeArchived,
      limit: 200,
      offset: 0
    }),
    [debounced, status, includeArchived]
  )
  const staff = useInvoke('staff.list', filter)

  const columns: Array<Column<Staff>> = [
    {
      key: 'name',
      header: 'Staff member',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span className="link-strong">{row.fullName}</span>
          {row.fullNameBn ? <span className="bn muted small">{row.fullNameBn}</span> : null}
        </div>
      ),
      sortValue: (row) => row.fullName
    },
    {
      key: 'role',
      header: 'Designation',
      render: (row) => (
        <div className="stack" style={{ gap: 2 }}>
          <span>{row.designation ?? '—'}</span>
          {row.department ? <span className="muted small">{row.department}</span> : null}
        </div>
      ),
      sortValue: (row) => row.designation ?? ''
    },
    {
      key: 'phone',
      header: 'Phone',
      width: 150,
      render: (row) => (row.phone ? <span className="num">{row.phone}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.phone ?? ''
    },
    {
      key: 'joiningDate',
      header: 'Joined',
      width: 130,
      render: (row) => (row.joiningDate ? <span className="num">{row.joiningDate}</span> : <span className="muted">—</span>),
      sortValue: (row) => row.joiningDate ?? '',
      secondary: true
    },
    {
      key: 'salary',
      header: 'Salary',
      width: 130,
      align: 'right',
      render: (row) => ((row.salaryMicro ?? null) === null ? <span className="muted">—</span> : <span className="num">{formatters.money(row.salaryMicro ?? 0)}</span>),
      sortValue: (row) => row.salaryMicro ?? 0,
      secondary: true
    },
    {
      key: 'account',
      header: 'Login',
      width: 140,
      render: (row) => (row.linkedUsername ? <span className="num small">{row.linkedUsername}</span> : <span className="muted small">No account</span>),
      sortValue: (row) => row.linkedUsername ?? ''
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (row) => <Badge tone={STATUS_META[row.employmentStatus]?.tone ?? 'neutral'}>{STATUS_META[row.employmentStatus]?.label ?? row.employmentStatus}</Badge>,
      sortValue: (row) => row.employmentStatus
    }
  ]

  return (
    <div className="page">
      <PageHeader
        title="Staff"
        subtitle="Everyone who works at the clinic, with their designation, contact details and employment record."
        actions={
          canManage ? (
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreating(true)}>
              Add staff member
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader
          title="Staff register"
          icon={<IdCard size={17} />}
          subtitle="A login account can be linked from the Users screen; it is never created automatically."
        />
        <CardBody>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search name, phone or designation…" ariaLabel="Search staff" />
            <Select value={status} onChange={(value: string) => setStatus(value as StatusFilter)} options={STATUS_OPTIONS} ariaLabel="Employment status" />
            <Switch checked={includeArchived} onChange={setIncludeArchived} label="Show archived" />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={staff.data?.items ?? []}
            getRowId={(row) => row.id}
            loading={staff.loading}
            emptyTitle="No staff recorded"
            emptyMessage="Add the people who work at the clinic so visits, prescriptions and payments stay attributable."
            rowActions={(row) =>
              canManage ? (
                <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon={<Pencil size={15} />} aria-label={`Edit ${row.fullName}`} onClick={() => setEditing(row)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Archive size={15} />} aria-label={`Archive ${row.fullName}`} onClick={() => setArchiving(row)}>
                    Archive
                  </Button>
                </div>
              ) : null
            }
          />
        </CardBody>
      </Card>

      <StaffDialog
        staff={creating ? null : editing}
        open={creating || editing !== null}
        onClose={() => {
          setCreating(false)
          setEditing(null)
        }}
        onSaved={() => void staff.reload()}
      />

      <ArchiveStaffDialog
        staff={archiving}
        onClose={() => setArchiving(null)}
        onArchived={() => {
          setArchiving(null)
          void staff.reload()
        }}
      />
    </div>
  )
}

function staffDefaults(): StaffInput {
  return {
    id: null,
    fullName: '',
    fullNameBn: null,
    dob: null,
    gender: 'unspecified',
    address: null,
    phone: null,
    emergencyContact: null,
    bloodGroup: null,
    nationalId: null,
    designation: null,
    department: null,
    salaryMicro: null,
    joiningDate: null,
    employmentStatus: 'active',
    notes: null
  }
}

function StaffDialog({
  staff,
  open,
  onClose,
  onSaved
}: {
  staff: Staff | null
  open: boolean
  onClose(): void
  onSaved(): void
}): ReactNode {
  const form = useZodForm(zStaffInput, staffDefaults())
  const [busy, setBusy] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    if (!staff) {
      form.reset(staffDefaults())
      setPhoto(null)
      return
    }
    form.reset({
      id: staff.id,
      fullName: staff.fullName,
      fullNameBn: staff.fullNameBn,
      dob: staff.dob,
      gender: staff.gender as StaffInput['gender'],
      address: staff.address,
      phone: staff.phone,
      emergencyContact: staff.emergencyContact,
      bloodGroup: staff.bloodGroup,
      nationalId: staff.nationalId,
      designation: staff.designation,
      department: staff.department,
      salaryMicro: staff.salaryMicro,
      joiningDate: staff.joiningDate,
      employmentStatus: staff.employmentStatus as StaffInput['employmentStatus'],
      notes: staff.notes
    })
    setPhoto(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, staff])

  const save = async (): Promise<void> => {
    if (!form.validate()) return
    setBusy(true)
    try {
      const saved = await invoke('staff.save', form.values as StaffInput)
      if (photo && saved.id) await uploadPhoto(saved.id, photo)
      toast('success', staff ? 'Staff record updated' : `${saved.fullName} added to the register`)
      onSaved()
      onClose()
    } catch (error) {
      toast('error', 'The staff record could not be saved', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const uploadPhoto = async (id: number, file: File): Promise<void> => {
    if (file.size > 5 * 1024 * 1024) {
      toast('warning', 'Photo not saved', 'Choose an image smaller than 5 MB.')
      return
    }
    const dataBase64 = await readFileAsBase64(file)
    await invoke('staff.uploadPhoto', { id, fileName: file.name, dataBase64 })
    if (photoInput.current) photoInput.current.value = ''
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={staff ? `Edit ${staff.fullName}` : 'Add a staff member'}
      description="Employment details stay on the record; nothing here creates a login."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {staff ? 'Save changes' : 'Add to register'}
          </Button>
        </>
      }
    >
      <div className="grid grid--2">
        <Field label="Full name" htmlFor="staffName" required error={form.errors.fullName}>
          <TextInput id="staffName" value={String(form.values.fullName ?? '')} onChange={(value) => form.setValue('fullName', value)} maxLength={120} />
        </Field>
        <Field label="Name in Bangla" htmlFor="staffNameBn" error={form.errors.fullNameBn}>
          <TextInput id="staffNameBn" value={String(form.values.fullNameBn ?? '')} onChange={(value) => form.setValue('fullNameBn', value || null)} maxLength={120} />
        </Field>
        <Field label="Designation" htmlFor="staffDesignation" hint="Receptionist, dental assistant, technician…" error={form.errors.designation}>
          <TextInput id="staffDesignation" value={String(form.values.designation ?? '')} onChange={(value) => form.setValue('designation', value || null)} maxLength={80} />
        </Field>
        <Field label="Department" htmlFor="staffDepartment" error={form.errors.department}>
          <TextInput id="staffDepartment" value={String(form.values.department ?? '')} onChange={(value) => form.setValue('department', value || null)} maxLength={80} />
        </Field>
        <Field label="Phone" htmlFor="staffPhone" error={form.errors.phone}>
          <TextInput id="staffPhone" value={String(form.values.phone ?? '')} onChange={(value) => form.setValue('phone', value || null)} maxLength={40} />
        </Field>
        <Field label="Emergency contact" htmlFor="staffEmergency" error={form.errors.emergencyContact}>
          <TextInput id="staffEmergency" value={String(form.values.emergencyContact ?? '')} onChange={(value) => form.setValue('emergencyContact', value || null)} maxLength={120} />
        </Field>
        <Field label="Date of birth" htmlFor="staffDob" error={form.errors.dob}>
          <DateInput id="staffDob" value={form.values.dob ?? null} onChange={(value) => form.setValue('dob', value)} />
        </Field>
        <Field label="Gender" htmlFor="staffGender" error={form.errors.gender}>
          <Select
            id="staffGender"
            value={String(form.values.gender ?? 'unspecified')}
            onChange={(value) => form.setValue('gender', value as StaffInput['gender'])}
            options={[
              { value: 'unspecified', label: 'Not recorded' },
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
              { value: 'other', label: 'Other' }
            ]}
            ariaLabel="Gender"
          />
        </Field>
        <Field label="Blood group" htmlFor="staffBlood" error={form.errors.bloodGroup}>
          <TextInput id="staffBlood" value={String(form.values.bloodGroup ?? '')} onChange={(value) => form.setValue('bloodGroup', value || null)} maxLength={6} />
        </Field>
        <Field label="National ID" htmlFor="staffNid" error={form.errors.nationalId}>
          <TextInput id="staffNid" value={String(form.values.nationalId ?? '')} onChange={(value) => form.setValue('nationalId', value || null)} maxLength={40} />
        </Field>
        <Field label="Joining date" htmlFor="staffJoining" error={form.errors.joiningDate}>
          <DateInput id="staffJoining" value={form.values.joiningDate ?? null} onChange={(value) => form.setValue('joiningDate', value)} />
        </Field>
        <Field label="Employment status" htmlFor="staffStatus" error={form.errors.employmentStatus}>
          <Select
            id="staffStatus"
            value={String(form.values.employmentStatus ?? 'active')}
            onChange={(value) => form.setValue('employmentStatus', value as StaffInput['employmentStatus'])}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'probation', label: 'Probation' },
              { value: 'resigned', label: 'Resigned' },
              { value: 'terminated', label: 'Terminated' }
            ]}
            ariaLabel="Employment status"
          />
        </Field>
        <Field label="Monthly salary (৳)" htmlFor="staffSalary" error={form.errors.salaryMicro}>
          <MoneyInput id="staffSalary" value={form.values.salaryMicro ?? null} onChange={(value) => form.setValue('salaryMicro', value)} />
        </Field>
        <Field label="Address" htmlFor="staffAddress" span={2} error={form.errors.address}>
          <TextArea id="staffAddress" value={String(form.values.address ?? '')} onChange={(value) => form.setValue('address', value || null)} rows={2} maxLength={300} />
        </Field>
        <Field label="Notes" htmlFor="staffNotes" span={2} error={form.errors.notes}>
          <TextArea id="staffNotes" value={String(form.values.notes ?? '')} onChange={(value) => form.setValue('notes', value || null)} rows={2} maxLength={1000} />
        </Field>
        <Field label="Photo" htmlFor="staffPhoto" span={2} hint="Optional JPEG or PNG portrait, up to 5 MB. It is stored with the record, never uploaded anywhere.">
          <div className="row" style={{ gap: 8 }}>
            <input
              id="staffPhoto"
              ref={photoInput}
              className="field__input"
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
            />
            <Button variant="secondary" icon={<Upload size={15} />} disabled={!photo} onClick={() => (staff ? void uploadPhoto(staff.id, photo!) : undefined)}>
              Upload now
            </Button>
          </div>
        </Field>
      </div>
    </Modal>
  )
}

function ArchiveStaffDialog({
  staff,
  onClose,
  onArchived
}: {
  staff: Staff | null
  onClose(): void
  onArchived(): void
}): ReactNode {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setReason('')
  }, [staff?.id])

  const archive = async (): Promise<void> => {
    if (!staff) return
    setBusy(true)
    try {
      await invoke('staff.archive', { id: staff.id, reason: reason.trim() === '' ? null : reason.trim() })
      toast('success', `${staff.fullName} archived`)
      onArchived()
    } catch (error) {
      toast('error', 'The staff record could not be archived', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={staff !== null}
      title={staff ? `Archive ${staff.fullName}?` : 'Archive staff member'}
      description="The record leaves the active register but nothing is destroyed: history keeps pointing at this person, and the record can be reviewed later."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void archive()}>
            Archive
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="archiveReason" hint="Optional, e.g. “Left on 30 September”.">
        <TextArea id="archiveReason" value={reason} onChange={setReason} rows={2} maxLength={240} />
      </Field>
    </Modal>
  )
}
