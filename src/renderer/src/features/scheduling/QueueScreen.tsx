import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { BellRing, ListPlus, Play, RefreshCw, SkipForward, UserCheck, Users } from 'lucide-react'
import { Badge, Button, Card, CardBody, CardHeader, PageHeader, SearchInput, Toolbar } from '../../components/ui/primitives'
import { Field, Select, TextArea, TextInput } from '../../components/ui/form'
import { Modal, toast } from '../../components/ui/overlay'
import { errorMessage, invoke, useInvoke } from '../../lib/api'
import { QUEUE_STATUS_META, useFormatters } from '../../lib/format'
import { usePermission } from '../../store/appStore'
import type { QueueEntry, QueueStatus } from '../../lib/types'

/**
 * Waiting queue.
 *
 * The desk issues a number, calls the patient, starts the consultation and completes it. Everything the
 * board shows comes from the queue service, and the linked appointment follows the same state, so the
 * day book and the queue can never disagree about who is in the chair.
 */
export function QueueScreen(): ReactNode {
  const format = useFormatters()
  const canManage = usePermission('queue.manage')
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [filter, setFilter] = useState('')

  const board = useInvoke('queue.board', { date: null }, { pollMs: 20_000 })

  const items = useMemo(() => {
    const list = board.data?.items ?? []
    if (filter.trim() === '') return list
    const needle = filter.trim().toLowerCase()
    return list.filter((entry) => entry.patientName.toLowerCase().includes(needle) || entry.patientCode.toLowerCase().includes(needle) || String(entry.queueNo) === needle)
  }, [board.data, filter])

  const counters = board.data?.counters

  const move = async (entry: QueueEntry, status: QueueStatus): Promise<void> => {
    setBusyId(entry.id)
    try {
      await invoke('queue.setStatus', { id: entry.id, status })
      await board.reload()
    } catch (error) {
      toast('error', 'The queue entry could not be updated', errorMessage(error))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Waiting queue"
        subtitle={board.data ? `${format.date(Date.parse(board.data.date))} · queue numbers restart every day` : 'Today’s queue'}
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button variant="tertiary" icon={<RefreshCw size={16} />} onClick={() => void board.reload()}>
              Refresh
            </Button>
            {canManage ? (
              <Button variant="primary" icon={<ListPlus size={16} />} onClick={() => setAdding(true)}>
                Add to queue
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="summary-strip">
        <span className="summary-strip__item">
          <span className="summary-strip__label">Waiting</span>
          <strong className="num">{counters?.waiting ?? 0}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Called</span>
          <strong className="num">{counters?.called ?? 0}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">In the chair</span>
          <strong className="num">{counters?.inProgress ?? 0}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Seen today</span>
          <strong className="num">{counters?.completedToday ?? 0}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Average wait</span>
          <strong className="num">{counters?.averageWaitMinutes === null || counters?.averageWaitMinutes === undefined ? '—' : `${counters.averageWaitMinutes} min`}</strong>
        </span>
        <span className="summary-strip__item">
          <span className="summary-strip__label">Skipped / left</span>
          <strong className="num">{counters?.skipped ?? 0}</strong>
        </span>
      </div>

      <Card>
        <CardHeader title="Board" icon={<Users size={17} />} subtitle="Called patients first, then the chair, then those waiting in number order." />
        <CardBody>
          <Toolbar>
            <SearchInput value={filter} onChange={setFilter} placeholder="Filter by name, patient ID or number…" ariaLabel="Filter the queue" />
          </Toolbar>
        </CardBody>
        <CardBody flush>
          {items.length === 0 ? (
            <CardBody>
              <p className="muted">Nobody is waiting. Add a patient when they arrive at the desk.</p>
            </CardBody>
          ) : (
            <ul className="plain-list">
              {items.map((entry) => {
                const meta = QUEUE_STATUS_META[entry.status]
                return (
                  <li key={entry.id} className="plain-list__item">
                    <span className="row" style={{ gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong className="num" style={{ fontSize: '1.2rem', minWidth: 42 }}>
                        #{entry.queueNo}
                      </strong>
                      <span className="stack" style={{ gap: 3 }}>
                        <span className="row" style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <span className="link-strong">{entry.patientName}</span>
                          <span className="num muted small">{entry.patientCode}</span>
                          <Badge tone={meta?.tone ?? 'neutral'}>{meta?.label ?? entry.status}</Badge>
                          {entry.priority > 0 ? <Badge tone="warning">Priority</Badge> : null}
                          {entry.appointmentId ? <Badge tone="info">Booked</Badge> : null}
                        </span>
                        <span className="muted small">
                          Joined {format.time(entry.joinedAt)} · waiting {entry.waitingMinutes} min
                          {entry.dentistName ? ` · ${entry.dentistName}` : ' · dentist not assigned'}
                          {entry.note ? ` · ${entry.note}` : ''}
                        </span>
                      </span>
                    </span>
                    <span className="row" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {busyId === entry.id ? <span className="muted small">Working…</span> : null}
                      {canManage && entry.status === 'waiting' ? (
                        <Button size="sm" variant="secondary" icon={<BellRing size={15} />} onClick={() => void move(entry, 'called')}>
                          Call
                        </Button>
                      ) : null}
                      {canManage && entry.status === 'called' ? (
                        <Button size="sm" variant="tertiary" onClick={() => void move(entry, 'waiting')}>
                          Back to waiting
                        </Button>
                      ) : null}
                      {canManage && (entry.status === 'waiting' || entry.status === 'called') ? (
                        <Button size="sm" variant="primary" icon={<Play size={15} />} onClick={() => void move(entry, 'in_progress')}>
                          Start
                        </Button>
                      ) : null}
                      {canManage && entry.status === 'in_progress' ? (
                        <Button size="sm" variant="primary" icon={<UserCheck size={15} />} onClick={() => void move(entry, 'completed')}>
                          Complete
                        </Button>
                      ) : null}
                      {canManage && (entry.status === 'waiting' || entry.status === 'called') ? (
                        <Button size="sm" variant="ghost" icon={<SkipForward size={15} />} onClick={() => void move(entry, 'skipped')}>
                          Skip
                        </Button>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <AddToQueueDialog
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          void board.reload()
        }}
      />
    </div>
  )
}

function AddToQueueDialog({ open, onClose, onAdded }: { open: boolean, onClose(): void, onAdded(): void }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [patientSearch, setPatientSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [patientId, setPatientId] = useState('')
  const [dentistId, setDentistId] = useState('')
  const [priority, setPriority] = useState('0')
  const [note, setNote] = useState('')
  const [appointmentId, setAppointmentId] = useState('')

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(patientSearch.trim()), 250)
    return () => window.clearTimeout(handle)
  }, [patientSearch])

  useEffect(() => {
    if (!open) return
    setPatientSearch('')
    setPatientId('')
    setDentistId('')
    setPriority('0')
    setNote('')
    setAppointmentId('')
  }, [open])

  const patients = useInvoke('patients.list', { search: debounced === '' ? undefined : debounced, status: 'active', limit: 25, offset: 0 }, { enabled: open })
  const dentists = useInvoke('dentists.list', { includeInactive: false }, { enabled: open })
  const upcoming = useInvoke('appointments.upcoming', { patientId: patientId === '' ? undefined : Number(patientId), limit: 10 }, { enabled: open && patientId !== '' })

  const submit = async (): Promise<void> => {
    if (patientId === '') {
      toast('warning', 'Choose a patient', 'Search for the patient who has arrived.')
      return
    }
    setBusy(true)
    try {
      const entry = await invoke('queue.add', {
        patientId: Number(patientId),
        dentistId: dentistId === '' ? null : Number(dentistId),
        appointmentId: appointmentId === '' ? null : Number(appointmentId),
        priority: Number(priority) as 0 | 1 | 2,
        note: note.trim() === '' ? null : note.trim()
      })
      toast('success', `Queue number ${entry.queueNo}`, `${entry.patientName} is waiting.`)
      onAdded()
      onClose()
    } catch (error) {
      toast('error', 'The patient could not be added to the queue', errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      size="lg"
      title="Add a patient to the queue"
      description="Give them today's next number. If they arrived for a booked appointment, link it so the day book stays accurate."
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="tertiary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            Add to queue
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Find patient" htmlFor="queuePatientSearch" hint="Type a name, patient ID or phone number.">
          <TextInput id="queuePatientSearch" value={patientSearch} onChange={setPatientSearch} maxLength={80} />
        </Field>
        <Field label="Patient" htmlFor="queuePatient" required>
          <Select
            id="queuePatient"
            value={patientId}
            onChange={(value: string) => {
              setPatientId(value)
              setAppointmentId('')
            }}
            ariaLabel="Patient"
            options={[
              { value: '', label: debounced === '' ? 'Search for a patient…' : 'Select a patient…' },
              ...(patients.data?.items ?? []).map((entry) => ({ value: String(entry.id), label: `${entry.code} · ${entry.fullName}${entry.phone ? ` · ${entry.phone}` : ''}` }))
            ]}
          />
        </Field>
        {patientId !== '' ? (
          <Field label="Booked appointment" htmlFor="queueAppointment" hint="Linking the appointment marks it as arrived automatically.">
            <Select
              id="queueAppointment"
              value={appointmentId}
              onChange={setAppointmentId}
              ariaLabel="Booked appointment"
              options={[
                { value: '', label: upcoming.data && upcoming.data.length > 0 ? 'No appointment — walk-in' : 'No upcoming appointment' },
                ...(upcoming.data ?? []).map((entry) => ({
                  value: String(entry.id),
                  label: `${formatDateTimeShort(entry.scheduledAt)} · ${entry.dentistName}${entry.reason ? ` · ${entry.reason}` : ''}`
                }))
              ]}
            />
          </Field>
        ) : null}
        <div className="grid grid--2">
          <Field label="Dentist" htmlFor="queueDentist" hint="Optional until the patient reaches the chair.">
            <Select
              id="queueDentist"
              value={dentistId}
              onChange={setDentistId}
              ariaLabel="Dentist"
              options={[{ value: '', label: 'Not assigned yet' }, ...(dentists.data ?? []).map((entry) => ({ value: String(entry.id), label: entry.fullName }))]}
            />
          </Field>
          <Field label="Priority" htmlFor="queuePriority" hint="Emergency cases can be called ahead of the queue.">
            <Select
              id="queuePriority"
              value={priority}
              onChange={setPriority}
              ariaLabel="Priority"
              options={[
                { value: '0', label: 'Normal' },
                { value: '1', label: 'Urgent' },
                { value: '2', label: 'Emergency' }
              ]}
            />
          </Field>
        </div>
        <Field label="Note" htmlFor="queueNote">
          <TextArea id="queueNote" value={note} onChange={setNote} rows={2} maxLength={300} />
        </Field>
      </div>
    </Modal>
  )
}

/** Short local date-time for the appointment picker, independent of the display format setting. */
function formatDateTimeShort(ms: number): string {
  const date = new Date(ms)
  return `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${date.toTimeString().slice(0, 5)}`
}
