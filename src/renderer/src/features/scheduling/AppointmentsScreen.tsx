import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarCheck, CalendarClock, CalendarPlus, ChevronLeft, ChevronRight, Clock, Pencil, Printer, Trash2, Users } from 'lucide-react'
import { APPOINTMENT_STATUSES } from '@shared/contracts'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Segmented, Toolbar } from '../../components/ui/primitives'
import { DateInput, Field, NumberInput, Select, TextArea, TextInput, TimeInput, dateInputToInstant, instantToDateInput } from '../../components/ui/form'
import { Modal, confirmDialog, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { APPOINTMENT_STATUS_META, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import { PrintDialog } from '../printing/PrintDialog'
import type { Appointment, AppointmentInput } from '../../lib/types'

const STATUS_FILTER = [
  { value: 'active', label: 'Booked and active' },
  { value: 'all', label: 'Every status' },
  ...APPOINTMENT_STATUSES.map((status) => ({ value: status, label: APPOINTMENT_STATUS_META[status]?.label ?? status }))
]

function shiftDate(date: string, days: number): string {
  return toLocalDate(fromLocalDate(date) + days * 86_400_000)
}

/**
 * Appointment book.
 *
 * One day at a time — the way a clinic front desk actually works — with the day's load per dentist, the
 * patient's arrival state, and the actions that move an appointment through its life cycle. Booking uses
 * the slot grid from the main process, so a receptionist sees what is already taken before choosing a time.
 */
export function AppointmentsScreen(): ReactNode {
  const format = useFormatters()
  const today = toLocalDate(Date.now())
  const canCreate = usePermission('appointments.create')
  const canEdit = usePermission('appointments.edit')
  const canCancel = usePermission('appointments.cancel')
  const canDelete = usePermission('appointments.delete')
  const canPrint = usePermission('printing.print')

  const [date, setDate] = useState(today)
  const [dentist, setDentist] = useState('all')
  const [view, setView] = useState<'day' | 'list'>('day')
  const [statusFilter, setStatusFilter] = useState('active')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [editing, setEditing] = useState<{ open: boolean, appointment: Appointment | null }>({ open: false, appointment: null })
  const [printing, setPrinting] = useState<Appointment | null>(null)
  const [cancelTarget, setCancelTarget] = useState<{ appointment: Appointment, status: 'cancelled' | 'no_show' } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(search.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [search])

  const dentists = useInvoke('dentists.list', { includeInactive: false })
  const day = useInvoke('appointments.day', { date }, { enabled: view === 'day' })
  const list = useInvoke(
    'appointments.list',
    {
      search: debounced === '' ? undefined : debounced,
      dentistId: dentist === 'all' ? undefined : Number(dentist),
      status: statusFilter === 'active' || statusFilter === 'all' ? undefined : (statusFilter as Appointment['status']),
      activeOnly: statusFilter !== 'all' && statusFilter !== 'active' ? false : statusFilter !== 'all',
      limit: 100,
      offset: 0
    },
    { enabled: view === 'list' }
  )

  const items = useMemo(() => {
    if (view === 'day') {
      return (day.data?.items ?? []).filter(
        (entry) => (dentist === 'all' || String(entry.dentistId) === dentist) && (debounced === '' || entry.patientName.toLowerCase().includes(debounced.toLowerCase()))
      )
    }
    return (list.data?.items ?? []).filter((entry) => dentist === 'all' || String(entry.dentistId) === dentist)
  }, [view, day.data, list.data, dentist, debounced])

  const applyStatus = async (appointment: Appointment, status: Appointment['status'], reason: string | null): Promise<void> => {
    setBusyId(appointment.id)
    try {
      await invoke('appointments.setStatus', { id: appointment.id, status, reason })
      await Promise.all([day.reload(), list.reload()])
      toast('success', `Appointment marked ${status.replace('_', ' ')}`)
    } catch (error) {
      toast('error', 'The appointment could not be updated', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const changeStatus = async (appointment: Appointment, status: Appointment['status']): Promise<void> => {
    if (status === 'cancelled' || status === 'no_show') {
      setCancelTarget({ appointment, status })
      return
    }
    await applyStatus(appointment, status, null)
  }

  const remove = async (appointment: Appointment): Promise<void> => {
    const answer = await confirmDialog({
      title: `Delete the cancelled appointment for ${appointment.patientName}?`,
      message: 'Deleting removes the entry from the book. It is only possible for cancelled appointments and no-shows.',
      confirmLabel: 'Delete appointment',
      danger: true,
      confirmationPhrase: appointment.patientCode
    })
    if (!answer.confirmed) return
    setBusyId(appointment.id)
    try {
      await invoke('appointments.delete', { id: appointment.id, reason: 'Deleted from the appointment book' })
      await Promise.all([day.reload(), list.reload()])
      toast('success', 'Appointment deleted')
    } catch (error) {
      toast('error', 'The appointment could not be deleted', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  const dayLoad = day.data?.load ?? []

  return (
    <div className="page">
      <PageHeader
        title="Appointments"
        subtitle="The day book, with each patient's arrival state and the load per dentist."
        actions={
          canCreate ? (
            <Button variant="primary" icon={<CalendarPlus size={16} />} onClick={() => setEditing({ open: true, appointment: null })}>
              Book appointment
            </Button>
          ) : null
        }
      />

      <Card>
        <CardHeader
          title={view === 'day' ? format.date(fromLocalDate(date)) : 'Booked ahead'}
          icon={<CalendarClock size={17} />}
          subtitle={view === 'day' ? 'Use the arrows to move a day at a time; the list view searches the whole book.' : 'Appointments that have not been cancelled, newest first.'}
          actions={
            <Segmented
              value={view}
              ariaLabel="View"
              onChange={(value: string) => setView(value as 'day' | 'list')}
              options={[
                { value: 'day', label: 'Day book' },
                { value: 'list', label: 'Search all' }
              ]}
            />
          }
        />
        <CardBody>
          <Toolbar>
            {view === 'day' ? (
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" variant="tertiary" icon={<ChevronLeft size={15} />} aria-label="Previous day" onClick={() => setDate(shiftDate(date, -1))}>
                  Previous
                </Button>
                <Button size="sm" variant={date === today ? 'secondary' : 'tertiary'} onClick={() => setDate(today)}>
                  Today
                </Button>
                <Button size="sm" variant="tertiary" aria-label="Next day" onClick={() => setDate(shiftDate(date, 1))}>
                  Next <ChevronRight size={15} />
                </Button>
              </div>
            ) : null}
            <Select
              value={dentist}
              onChange={(value: string) => setDentist(value)}
              options={[{ value: 'all', label: 'All dentists' }, ...(dentists.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.fullName }))]}
              ariaLabel="Dentist"
            />
            {view === 'list' ? (
              <Select value={statusFilter} onChange={(value: string) => setStatusFilter(value)} options={STATUS_FILTER} ariaLabel="Status" />
            ) : null}
            <SearchInput value={search} onChange={setSearch} placeholder="Filter by patient name…" ariaLabel="Filter appointments" />
          </Toolbar>

          {view === 'day' && dayLoad.length > 0 ? (
            <div className="summary-strip" style={{ marginTop: 'var(--sp-4)' }}>
              {dayLoad.map((entry) => (
                <span key={entry.dentistId} className="summary-strip__item">
                  <span className="summary-strip__label">{entry.dentistName}</span>
                  <strong className="num">
                    {entry.appointments} booking(s) · {Math.round((entry.minutes / 60) * 10) / 10} h
                  </strong>
                </span>
              ))}
            </div>
          ) : null}
        </CardBody>
        <CardBody flush>
          {items.length === 0 ? (
            <CardBody>
              <p className="muted">
                {view === 'day' ? 'Nothing booked for this day. Use “Book appointment”, or move to another date.' : 'No appointment matches these filters.'}
              </p>
            </CardBody>
          ) : (
            <ul className="plain-list">
              {items.map((appointment) => {
                const meta = APPOINTMENT_STATUS_META[appointment.status]
                const editable = canEdit && (appointment.status === 'scheduled' || appointment.status === 'confirmed')
                return (
                  <li key={appointment.id} className="plain-list__item">
                    <span className="stack" style={{ gap: 3 }}>
                      <span className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong className="num">{new Date(appointment.scheduledAt).toTimeString().slice(0, 5)}</strong>
                        <span className="muted small">{appointment.durationMin} min</span>
                        <span className="link-strong">{appointment.patientName}</span>
                        <span className="num muted small">{appointment.patientCode}</span>
                        <Badge tone={meta?.tone ?? 'neutral'}>{meta?.label ?? appointment.status}</Badge>
                        {appointment.queueNo !== null ? <Badge tone="info">Queue #{appointment.queueNo}</Badge> : null}
                      </span>
                      <span className="muted small">
                        {appointment.dentistName}
                        {appointment.reason ? ` · ${appointment.reason}` : ''}
                        {appointment.patientPhone ? ` · ${appointment.patientPhone}` : ''}
                        {appointment.rescheduledFrom ? ` · moved from ${format.dateTime(appointment.rescheduledFrom)}` : ''}
                        {appointment.cancelledReason ? ` · ${appointment.cancelledReason}` : ''}
                      </span>
                    </span>
                    <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {busyId === appointment.id ? <span className="muted small">Working…</span> : null}
                      {canEdit && appointment.status === 'scheduled' ? (
                        <Button size="sm" variant="secondary" onClick={() => void changeStatus(appointment, 'confirmed')}>
                          Confirm
                        </Button>
                      ) : null}
                      {canEdit && (appointment.status === 'scheduled' || appointment.status === 'confirmed') ? (
                        <Button size="sm" variant="secondary" icon={<Users size={15} />} onClick={() => void changeStatus(appointment, 'arrived')}>
                          Check in
                        </Button>
                      ) : null}
                      {canEdit && appointment.status === 'arrived' ? (
                        <Button size="sm" variant="secondary" onClick={() => void changeStatus(appointment, 'in_consultation')}>
                          Start
                        </Button>
                      ) : null}
                      {canEdit && appointment.status === 'in_consultation' ? (
                        <Button size="sm" variant="primary" icon={<CalendarCheck size={15} />} onClick={() => void changeStatus(appointment, 'completed')}>
                          Complete
                        </Button>
                      ) : null}
                      {editable ? (
                        <Button size="sm" variant="tertiary" icon={<Pencil size={15} />} onClick={() => setEditing({ open: true, appointment })}>
                          Reschedule
                        </Button>
                      ) : null}
                      {canCancel && (appointment.status === 'scheduled' || appointment.status === 'confirmed') ? (
                        <Button size="sm" variant="ghost" onClick={() => void changeStatus(appointment, 'no_show')}>
                          No-show
                        </Button>
                      ) : null}
                      {canCancel && ['scheduled', 'confirmed', 'arrived', 'in_consultation'].includes(appointment.status) ? (
                        <Button size="sm" variant="ghost" onClick={() => void changeStatus(appointment, 'cancelled')}>
                          Cancel
                        </Button>
                      ) : null}
                      {canPrint ? (
                        <Button size="sm" variant="ghost" icon={<Printer size={15} />} aria-label={`Print slip for ${appointment.patientName}`} onClick={() => setPrinting(appointment)}>
                          Slip
                        </Button>
                      ) : null}
                      {canDelete && (appointment.status === 'cancelled' || appointment.status === 'no_show') ? (
                        <Button size="sm" variant="ghost" icon={<Trash2 size={15} />} aria-label={`Delete appointment for ${appointment.patientName}`} onClick={() => void remove(appointment)} />
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <CancelAppointmentDialog
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirmed={(reason) => {
          const target = cancelTarget
          setCancelTarget(null)
          if (target) void applyStatus(target.appointment, target.status, reason)
        }}
      />

      <AppointmentDialog
        open={editing.open}
        appointment={editing.appointment}
        onClose={() => setEditing({ open: false, appointment: null })}
        onSaved={() => {
          void day.reload()
          void list.reload()
        }}
      />

      <PrintDialog
        open={printing !== null}
        target={{ documentType: 'appointment_slip', entityId: printing?.id ?? null, label: printing?.patientName }}
        onClose={() => setPrinting(null)}
        onPrinted={() => void day.reload()}
      />
    </div>
  )
}

/**
 * Cancelling and recording a no-show both need a reason that ends up in the appointment history, so they
 * get their own small dialog instead of a bare confirmation.
 */
function CancelAppointmentDialog({
  target,
  onClose,
  onConfirmed
}: {
  target: { appointment: Appointment, status: 'cancelled' | 'no_show' } | null
  onClose(): void
  onConfirmed(reason: string): void
}): ReactNode {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setReason('')
    setBusy(false)
  }, [target])

  if (!target) return null
  const isNoShow = target.status === 'no_show'

  return (
    <Modal
      open
      title={isNoShow ? `Record a no-show for ${target.appointment.patientName}?` : `Cancel the appointment for ${target.appointment.patientName}?`}
      description={
        isNoShow
          ? 'The slot stays unused and the appointment is kept as a no-show.'
          : 'The slot is freed for other patients; the appointment stays in the history with this reason.'
      }
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Keep appointment
          </Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 3}
            onClick={() => {
              setBusy(true)
              onConfirmed(reason.trim())
            }}
          >
            {isNoShow ? 'Record no-show' : 'Cancel appointment'}
          </Button>
        </>
      }
    >
      <Field label="Reason" htmlFor="cancelReason" required hint="At least 3 characters; shown in the appointment history.">
        <TextArea id="cancelReason" value={reason} onChange={setReason} rows={3} maxLength={240} />
      </Field>
    </Modal>
  )
}

function AppointmentDialog({
  open,
  appointment,
  onClose,
  onSaved
}: {
  open: boolean
  appointment: Appointment | null
  onClose(): void
  onSaved(): void
}): ReactNode {
  const [busy, setBusy] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [patientId, setPatientId] = useState('')
  const [dentistId, setDentistId] = useState('')
  const [date, setDate] = useState<string | null>(toLocalDate(Date.now()))
  const [time, setTime] = useState<string | null>('10:00')
  const [duration, setDuration] = useState(20)
  const [reason, setReason] = useState('')
  const [slotAt, setSlotAt] = useState<number | null>(null)

  const isReschedule = appointment !== null

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(patientSearch.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [patientSearch])

  const dentists = useInvoke('dentists.list', { includeInactive: false })
  const patients = useInvoke('patients.list', { search: debounced === '' ? undefined : debounced, status: 'active', limit: 25, offset: 0 }, { enabled: open && !isReschedule })
  const slots = useInvoke(
    'appointments.slots',
    { date: date ?? toLocalDate(Date.now()), dentistId: Number(dentistId) || 0, durationMin: duration },
    { enabled: open && dentistId !== '' && date !== null }
  )

  useEffect(() => {
    if (!open) return
    setPatientSearch('')
    setSlotAt(null)
    if (appointment) {
      setPatientId(String(appointment.patientId))
      setDentistId(String(appointment.dentistId))
      setDate(instantToDateInput(appointment.scheduledAt))
      setTime(new Date(appointment.scheduledAt).toTimeString().slice(0, 5))
      setDuration(appointment.durationMin)
      setReason(appointment.reason ?? '')
      return
    }
    setPatientId('')
    setDentistId(dentists.data && dentists.data.length > 0 ? String(dentists.data[0]?.id) : '')
    setDate(toLocalDate(Date.now()))
    setTime('10:00')
    setDuration(20)
    setReason('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment])

  useEffect(() => {
    if (!appointment && dentistId === '' && dentists.data && dentists.data.length > 0) setDentistId(String(dentists.data[0]?.id))
  }, [dentists.data, dentistId, appointment])

  const submit = async (): Promise<void> => {
    if (patientId === '') {
      toast('warning', 'Choose a patient', 'Search for the patient this appointment is for.')
      return
    }
    if (dentistId === '') {
      toast('warning', 'Choose a dentist', 'Every appointment belongs to a dentist.')
      return
    }
    const scheduledAt = slotAt ?? dateInputToInstant(date, time ?? '00:00')
    if (scheduledAt === null) {
      toast('warning', 'Choose the date and time', 'An appointment needs a specific moment.')
      return
    }
    setBusy(true)
    try {
      if (isReschedule && appointment) {
        await invoke('appointments.reschedule', { id: appointment.id, scheduledAt, durationMin: duration, reason: 'Rescheduled at the front desk' })
        toast('success', 'Appointment moved', 'The original time is kept in the history.')
      } else {
        await invoke('appointments.save', {
          id: null,
          patientId: Number(patientId),
          dentistId: Number(dentistId),
          scheduledAt,
          durationMin: duration,
          reason: reason.trim() === '' ? null : reason.trim(),
          notes: null,
          status: 'scheduled'
        } as AppointmentInput)
        toast('success', 'Appointment booked')
      }
      onSaved()
      onClose()
    } catch (error) {
      toast('error', isReschedule ? 'The appointment could not be moved' : 'The appointment could not be booked', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title={isReschedule ? `Reschedule ${appointment?.patientName ?? ''}` : 'Book an appointment'}
      description={isReschedule ? 'The patient keeps their record; only the time changes.' : 'Search for the patient, choose the dentist, then pick a free slot.'}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {isReschedule ? 'Move appointment' : 'Book appointment'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {!isReschedule ? (
          <>
            <Field label="Find patient" htmlFor="appointmentPatientSearch" hint="Type a name, patient ID or phone number.">
              <TextInput id="appointmentPatientSearch" value={patientSearch} onChange={setPatientSearch} maxLength={80} autoFocus />
            </Field>
            <Field label="Patient" htmlFor="appointmentPatient" required>
              <Select
                id="appointmentPatient"
                value={patientId}
                onChange={setPatientId}
                ariaLabel="Patient"
                options={[
                  { value: '', label: debounced === '' ? 'Search for a patient…' : 'Select a patient…' },
                  ...(patients.data?.items ?? []).map((entry) => ({ value: String(entry.id), label: `${entry.code} · ${entry.fullName}${entry.phone ? ` · ${entry.phone}` : ''}` }))
                ]}
              />
            </Field>
          </>
        ) : (
          <Field label="Patient" htmlFor="appointmentPatientReadonly">
            <TextInput id="appointmentPatientReadonly" value={appointment ? `${appointment.patientCode} · ${appointment.patientName}` : ''} onChange={() => undefined} disabled />
          </Field>
        )}

        <div className="grid grid--2">
          <Field label="Dentist" htmlFor="appointmentDentist" required hint={isReschedule ? 'Moving to another dentist means cancelling and booking again.' : 'Free slots below follow this dentist.'}>
            <Select
              id="appointmentDentist"
              value={dentistId}
              onChange={(value: string) => {
                setDentistId(value)
                setSlotAt(null)
              }}
              ariaLabel="Dentist"
              disabled={isReschedule}
              options={(dentists.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.fullName }))}
            />
          </Field>
          <Field label="Duration (minutes)" htmlFor="appointmentDuration">
            <NumberInput
              id="appointmentDuration"
              value={duration}
              onChange={(value) => {
                setDuration(value ?? 20)
                setSlotAt(null)
              }}
              min={5}
              max={480}
            />
          </Field>
          <Field label="Date" htmlFor="appointmentDate">
            <DateInput
              id="appointmentDate"
              value={date}
              onChange={(value) => {
                setDate(value)
                setSlotAt(null)
              }}
            />
          </Field>
          <Field label="Time" htmlFor="appointmentTime" hint="Or pick a free slot below.">
            <TimeInput
              id="appointmentTime"
              value={time}
              onChange={(value) => {
                setTime(value)
                setSlotAt(null)
              }}
            />
          </Field>
        </div>

        <Field label="Free slots" htmlFor="appointmentSlots" hint="Slots shown in grey are already booked.">
          <div className="row" id="appointmentSlots" style={{ gap: 6, flexWrap: 'wrap' }}>
            {(slots.data ?? []).map((slot) => (
              <button
                key={slot.at}
                type="button"
                className={`chip${slotAt === slot.at ? ' chip--active' : ''}`}
                disabled={slot.taken}
                aria-label={`Slot ${new Date(slot.at).toTimeString().slice(0, 5)}${slot.taken ? ' (taken)' : ''}`}
                onClick={() => {
                  setSlotAt(slot.at)
                  setTime(new Date(slot.at).toTimeString().slice(0, 5))
                }}
              >
                {new Date(slot.at).toTimeString().slice(0, 5)}
              </button>
            ))}
            {slots.data && slots.data.length === 0 ? <span className="muted small">The clinic is closed on this day, or the dentist has no working hours.</span> : null}
          </div>
        </Field>

        <Field label="Reason for the visit" htmlFor="appointmentReasonText" hint="For example: pain in the lower right molar.">
          <TextArea id="appointmentReasonText" value={reason} onChange={setReason} rows={2} maxLength={300} />
        </Field>
        <p className="muted small">
          <Clock size={13} /> The appointment is booked against the chosen dentist; the slot grid already refuses overlapping bookings.
        </p>
      </div>
    </Modal>
  )
}
