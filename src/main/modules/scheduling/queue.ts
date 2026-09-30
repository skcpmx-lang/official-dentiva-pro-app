import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { notFoundError, stateError } from '@shared/errors'
import { fromLocalDate, toLocalDate } from '@shared/datetime'

export type QueueStatus = 'waiting' | 'called' | 'in_progress' | 'completed' | 'skipped' | 'left'

export interface QueueEntryRecord {
  id: number
  queueNo: number
  patientId: number
  patientCode: string
  patientName: string
  patientNameBn: string | null
  patientPhone: string | null
  dentistId: number | null
  dentistName: string | null
  appointmentId: number | null
  visitId: number | null
  status: QueueStatus
  priority: number
  joinedAt: number
  calledAt: number | null
  startedAt: number | null
  completedAt: number | null
  note: string | null
  waitingMinutes: number
}

interface QueueRow {
  id: number
  queue_no: number
  patient_id: number
  patient_code: string
  patient_name: string
  patient_name_bn: string | null
  patient_phone: string | null
  dentist_id: number | null
  dentist_name: string | null
  appointment_id: number | null
  visit_id: number | null
  status: QueueStatus
  priority: number
  joined_at: number
  called_at: number | null
  started_at: number | null
  completed_at: number | null
  note: string | null
}

const SELECT_QUEUE = `
  SELECT q.*, p.code AS patient_code, p.full_name AS patient_name, p.full_name_bn AS patient_name_bn, p.phone AS patient_phone,
         d.full_name AS dentist_name
    FROM queue_entries q
    JOIN patients p ON p.id = q.patient_id
    LEFT JOIN dentists d ON d.id = q.dentist_id
`

function mapEntry(row: QueueRow, now: number): QueueEntryRecord {
  const waitingEnd = row.called_at ?? row.started_at ?? now
  const waitingMinutes = row.status === 'waiting' ? Math.max(0, Math.round((now - row.joined_at) / 60_000)) : Math.max(0, Math.round((waitingEnd - row.joined_at) / 60_000))
  return {
    id: row.id,
    queueNo: row.queue_no,
    patientId: row.patient_id,
    patientCode: row.patient_code,
    patientName: row.patient_name,
    patientNameBn: row.patient_name_bn,
    patientPhone: row.patient_phone,
    dentistId: row.dentist_id,
    dentistName: row.dentist_name,
    appointmentId: row.appointment_id,
    visitId: row.visit_id,
    status: row.status,
    priority: row.priority,
    joinedAt: row.joined_at,
    calledAt: row.called_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    note: row.note,
    waitingMinutes
  }
}

function loadEntry(ctx: ServiceContext, id: number): QueueEntryRecord {
  const row = ctx.db.prepare(`${SELECT_QUEUE} WHERE q.id = ?`).get(id) as QueueRow | undefined
  if (!row) throw notFoundError('queue entry', id)
  return mapEntry(row, ctx.now())
}

function assertPatient(ctx: ServiceContext, patientId: number): void {
  const row = ctx.db.prepare('SELECT is_deleted, status FROM patients WHERE id = ?').get(patientId) as
    | { is_deleted: number, status: string }
    | undefined
  if (!row) throw notFoundError('patient', patientId)
  if (row.is_deleted === 1 || row.status !== 'active') throw stateError('That patient file is archived, so they cannot join the queue.')
}

/**
 * The queue board for one day.
 *
 * Entries are kept per day; the board shows the day's entries ordered by status flow (called first,
 * then in progress, then waiting by number) so the desk always sees who is next.
 */
export function queueBoard(ctx: ServiceContext, input: { date?: string | null }): {
  date: string
  items: QueueEntryRecord[]
  counters: { waiting: number, called: number, inProgress: number, completedToday: number, skipped: number, averageWaitMinutes: number | null }
} {
  assertPermission(ctx, 'queue.view')
  const date = input.date ?? toLocalDate(ctx.now())
  const dayStart = fromLocalDate(date)
  const dayEnd = dayStart + 86_400_000 - 1
  const rows = ctx.db
    .prepare(
      `${SELECT_QUEUE}
        WHERE q.joined_at >= @from AND q.joined_at <= @to
        ORDER BY CASE q.status WHEN 'called' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting' THEN 2 ELSE 3 END,
                 q.priority DESC, q.queue_no ASC`
    )
    .all({ from: dayStart, to: dayEnd }) as QueueRow[]
  const now = ctx.now()
  const items = rows.map((row) => mapEntry(row, now))

  const callStats = ctx.db
    .prepare(
      `SELECT AVG(called_at - joined_at) AS average
         FROM queue_entries
        WHERE joined_at >= @from AND joined_at <= @to AND called_at IS NOT NULL`
    )
    .get({ from: dayStart, to: dayEnd }) as { average: number | null }

  return {
    date,
    items,
    counters: {
      waiting: items.filter((entry) => entry.status === 'waiting').length,
      called: items.filter((entry) => entry.status === 'called').length,
      inProgress: items.filter((entry) => entry.status === 'in_progress').length,
      completedToday: items.filter((entry) => entry.status === 'completed').length,
      skipped: items.filter((entry) => entry.status === 'skipped' || entry.status === 'left').length,
      averageWaitMinutes: callStats.average === null || callStats.average === undefined ? null : Math.round(callStats.average / 60_000)
    }
  }
}

/**
 * Add a patient to today's queue.
 *
 * Queue numbers restart every day. When the patient arrived for a booked appointment, the appointment is
 * linked and marked `arrived` so the two records never disagree.
 */
export function addQueueEntry(
  ctx: ServiceContext,
  input: { patientId: number, dentistId?: number | null, appointmentId?: number | null, priority?: number, note?: string | null }
): QueueEntryRecord {
  assertPermission(ctx, 'queue.manage')
  assertPatient(ctx, input.patientId)
  const now = ctx.now()
  const today = toLocalDate(now)
  const dayStart = fromLocalDate(today)
  const dayEnd = dayStart + 86_400_000 - 1

  if (input.appointmentId) {
    const appointment = ctx.db
      .prepare('SELECT id, patient_id, dentist_id, status FROM appointments WHERE id = ? AND is_deleted = 0')
      .get(input.appointmentId) as { id: number, patient_id: number, dentist_id: number, status: string } | undefined
    if (!appointment) throw notFoundError('appointment', input.appointmentId)
    if (appointment.patient_id !== input.patientId) throw stateError('That appointment belongs to a different patient.')
    const open = ctx.db
      .prepare("SELECT COUNT(*) AS count FROM queue_entries WHERE appointment_id = ? AND status IN ('waiting','called','in_progress')")
      .get(input.appointmentId) as { count: number }
    if (open.count > 0) throw stateError('That appointment is already in the queue.')
  }

  const id = ctx.db.transaction(() => {
    const next = ctx.db
      .prepare('SELECT COALESCE(MAX(queue_no), 0) + 1 AS next FROM queue_entries WHERE joined_at >= ? AND joined_at <= ?')
      .get(dayStart, dayEnd) as { next: number }
    const result = ctx.db
      .prepare(
        `INSERT INTO queue_entries (patient_id, dentist_id, appointment_id, queue_no, status, priority, joined_at, note, created_by)
         VALUES (@patientId, @dentistId, @appointmentId, @queueNo, 'waiting', @priority, @now, @note, @userId)`
      )
      .run({
        patientId: input.patientId,
        dentistId: input.dentistId ?? null,
        appointmentId: input.appointmentId ?? null,
        queueNo: next.next,
        priority: input.priority ?? 0,
        now,
        note: input.note ?? null,
        userId: ctx.actor.userId
      })
    const inserted = Number(result.lastInsertRowid)
    if (input.appointmentId) {
      ctx.db.prepare("UPDATE appointments SET status = 'arrived', updated_at = ? WHERE id = ? AND status IN ('scheduled','confirmed')").run(now, input.appointmentId)
      ctx.db
        .prepare('INSERT INTO appointment_events (appointment_id, from_status, to_status, at, by_user_id, note) VALUES (?, ?, ?, ?, ?, ?)')
        .run(input.appointmentId, null, 'arrived', now, ctx.actor.userId, 'Added to the queue')
    }
    ctx.audit.write({ module: 'queue', action: 'add', entityType: 'queue_entry', entityId: inserted, summary: `Queue number ${next.next} issued`, detail: { patientId: input.patientId } })
    return inserted
  })()
  return loadEntry(ctx, id)
}

export function setQueueStatus(
  ctx: ServiceContext,
  input: { id: number, status: QueueStatus }
): QueueEntryRecord {
  assertPermission(ctx, 'queue.manage')
  const existing = loadEntry(ctx, input.id)
  if (existing.status === input.status) return existing

  const allowed: Record<QueueStatus, QueueStatus[]> = {
    waiting: ['called', 'in_progress', 'skipped', 'left'],
    called: ['in_progress', 'waiting', 'skipped', 'left'],
    in_progress: ['completed', 'waiting'],
    completed: [],
    skipped: [],
    left: ['waiting']
  }
  if (!allowed[existing.status].includes(input.status)) {
    throw stateError(`A ${existing.status.replace('_', ' ')} queue entry cannot be moved to ${input.status.replace('_', ' ')}.`)
  }

  const now = ctx.now()
  const calledAt = existing.calledAt ?? (input.status === 'called' || input.status === 'in_progress' ? now : null)
  const startedAt = existing.startedAt ?? (input.status === 'in_progress' ? now : null)
  const completedAt = input.status === 'completed' ? now : null

  ctx.db.transaction(() => {
    ctx.db
      .prepare('UPDATE queue_entries SET status = @status, called_at = @calledAt, started_at = @startedAt, completed_at = @completedAt WHERE id = @id')
      .run({ id: input.id, status: input.status, calledAt, startedAt, completedAt })
    /* Completing the queue entry closes the appointment too, so the day's list reflects reality. */
    if (input.status === 'completed' && existing.appointmentId) {
      ctx.db.prepare("UPDATE appointments SET status = 'completed', updated_at = ? WHERE id = ? AND status IN ('arrived','in_consultation')").run(now, existing.appointmentId)
      ctx.db
        .prepare('INSERT INTO appointment_events (appointment_id, from_status, to_status, at, by_user_id, note) VALUES (?, ?, ?, ?, ?, ?)')
        .run(existing.appointmentId, null, 'completed', now, ctx.actor.userId, 'Queue entry completed')
    }
    ctx.audit.write({
      module: 'queue',
      action: 'status',
      entityType: 'queue_entry',
      entityId: input.id,
      summary: `Queue ${existing.queueNo}: ${existing.status} → ${input.status}`
    })
  })()
  return loadEntry(ctx, input.id)
}

/** Remove an entry that never reached the chair (wrong patient, duplicate, patient left). */
export function removeQueueEntry(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'queue.manage')
  const existing = loadEntry(ctx, input.id)
  if (existing.status === 'completed' || existing.status === 'in_progress') {
    throw stateError('A patient who is being seen or has been seen cannot be removed from the queue; the record must stay.')
  }
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM queue_entries WHERE id = ?').run(input.id)
    ctx.audit.write({
      module: 'queue',
      action: 'remove',
      entityType: 'queue_entry',
      entityId: input.id,
      summary: `Removed queue entry ${existing.queueNo} (${existing.status})`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}
