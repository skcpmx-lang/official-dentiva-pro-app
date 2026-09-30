import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch } from '@shared/bengali'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import type { zAppointmentFilter, zAppointmentInput } from '@shared/contracts'
import { z } from 'zod'

export type AppointmentInput = z.infer<typeof zAppointmentInput>
export type AppointmentFilter = z.infer<typeof zAppointmentFilter>
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'arrived' | 'in_consultation' | 'completed' | 'cancelled' | 'no_show'

export interface AppointmentRecord {
  id: number
  patientId: number
  dentistId: number
  patientCode: string
  patientName: string
  patientNameBn: string | null
  patientPhone: string | null
  dentistName: string
  scheduledAt: number
  scheduledDate: string
  durationMin: number
  reason: string | null
  notes: string | null
  status: AppointmentStatus
  cancelledReason: string | null
  rescheduledFrom: number | null
  visitId: number | null
  createdAt: number
  updatedAt: number
  queueEntryId: number | null
  queueNo: number | null
  queueStatus: 'waiting' | 'called' | 'in_progress' | 'completed' | 'skipped' | 'left' | null
}

/** Statuses in which an appointment still occupies the dentist's time. */
const BLOCKING_STATUSES = `('scheduled','confirmed','arrived','in_consultation')`

interface AppointmentRow {
  id: number
  patient_id: number
  dentist_id: number
  scheduled_at: number
  scheduled_date: string
  duration_min: number
  reason: string | null
  notes: string | null
  status: AppointmentStatus
  cancelled_reason: string | null
  rescheduled_from: number | null
  visit_id: number | null
  created_at: number
  updated_at: number
  patient_code: string
  patient_name: string
  patient_name_bn: string | null
  patient_phone: string | null
  dentist_name: string
  queue_entry_id: number | null
  queue_no: number | null
  queue_status: AppointmentRecord['queueStatus']
}

const SELECT_APPOINTMENT = `
  SELECT a.*, p.code AS patient_code, p.full_name AS patient_name, p.full_name_bn AS patient_name_bn, p.phone AS patient_phone,
         d.full_name AS dentist_name,
         q.id AS queue_entry_id, q.queue_no AS queue_no, q.status AS queue_status
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id
    JOIN dentists d ON d.id = a.dentist_id
    LEFT JOIN queue_entries q ON q.appointment_id = a.id AND q.status IN ('waiting','called','in_progress')
`

function mapAppointment(row: AppointmentRow): AppointmentRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    dentistId: row.dentist_id,
    patientCode: row.patient_code,
    patientName: row.patient_name,
    patientNameBn: row.patient_name_bn,
    patientPhone: row.patient_phone,
    dentistName: row.dentist_name,
    scheduledAt: row.scheduled_at,
    scheduledDate: row.scheduled_date,
    durationMin: row.duration_min,
    reason: row.reason,
    notes: row.notes,
    status: row.status,
    cancelledReason: row.cancelled_reason,
    rescheduledFrom: row.rescheduled_from,
    visitId: row.visit_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    queueEntryId: row.queue_entry_id,
    queueNo: row.queue_no,
    queueStatus: row.queue_status
  }
}

function loadAppointment(ctx: ServiceContext, id: number): AppointmentRecord {
  const row = ctx.db.prepare(`${SELECT_APPOINTMENT} WHERE a.id = ? AND a.is_deleted = 0`).get(id) as AppointmentRow | undefined
  if (!row) throw notFoundError('appointment', id)
  return mapAppointment(row)
}

function assertPatient(ctx: ServiceContext, patientId: number): void {
  const row = ctx.db.prepare('SELECT is_deleted, status FROM patients WHERE id = ?').get(patientId) as
    | { is_deleted: number, status: string }
    | undefined
  if (!row) throw notFoundError('patient', patientId)
  if (row.is_deleted === 1 || row.status !== 'active') throw stateError('That patient file is archived, so no appointment can be booked for it.')
}

function assertDentist(ctx: ServiceContext, dentistId: number): void {
  const row = ctx.db.prepare('SELECT is_active, is_deleted FROM dentists WHERE id = ?').get(dentistId) as
    | { is_active: number, is_deleted: number }
    | undefined
  if (!row || row.is_deleted === 1) throw notFoundError('dentist', dentistId)
  if (row.is_active !== 1) throw stateError('That dentist is inactive, so no appointment can be booked with them.')
}

/**
 * Refuse a booking that overlaps another appointment for the same dentist.
 *
 * The check runs inside the writing transaction, so two operators booking the same slot at the same
 * moment cannot both succeed.
 */
function assertSlotFree(ctx: ServiceContext, dentistId: number, scheduledAt: number, durationMin: number, excludeId: number | null): void {
  const end = scheduledAt + durationMin * 60_000
  const clash = ctx.db
    .prepare(
      `SELECT a.id, a.scheduled_at, a.duration_min, p.full_name AS patient_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id
        WHERE a.dentist_id = @dentistId
          AND a.is_deleted = 0
          AND a.status IN ${BLOCKING_STATUSES}
          AND a.scheduled_at < @end
          AND (a.scheduled_at + a.duration_min * 60000) > @start
          AND (@excludeId IS NULL OR a.id <> @excludeId)
        LIMIT 1`
    )
    .get({ dentistId, start: scheduledAt, end, excludeId }) as { scheduled_at: number, patient_name: string } | undefined
  if (clash) {
    const time = new Date(clash.scheduled_at).toTimeString().slice(0, 5)
    throw validationError(`That time is already booked (${clash.patient_name} at ${time}). Choose another slot or dentist.`, {
      scheduledAt: 'Overlaps an existing appointment'
    })
  }
}

function recordEvent(ctx: ServiceContext, appointmentId: number, from: string | null, to: string, note: string | null): void {
  ctx.db
    .prepare('INSERT INTO appointment_events (appointment_id, from_status, to_status, at, by_user_id, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(appointmentId, from, to, ctx.now(), ctx.actor.userId, note)
}

export function listAppointments(ctx: ServiceContext, filter: AppointmentFilter): { items: AppointmentRecord[], total: number, limit: number, offset: number } {
  assertPermission(ctx, 'appointments.view')
  const clauses: string[] = ['a.is_deleted = 0']
  const params: Record<string, unknown> = {}

  if (filter.patientId) {
    clauses.push('a.patient_id = @patientId')
    params.patientId = filter.patientId
  }
  if (filter.dentistId) {
    clauses.push('a.dentist_id = @dentistId')
    params.dentistId = filter.dentistId
  }
  if (filter.status) {
    clauses.push('a.status = @status')
    params.status = filter.status
  } else if (filter.activeOnly) {
    clauses.push("a.status NOT IN ('cancelled','no_show')")
  }
  if (filter.range) {
    const { preset, from, to } = filter.range
    if (preset === 'today') {
      clauses.push('a.scheduled_date = @rangeFrom')
      params.rangeFrom = toLocalDate(ctx.now())
    } else if (preset === 'custom' && (from || to)) {
      if (from) {
        clauses.push('a.scheduled_date >= @rangeFrom')
        params.rangeFrom = from
      }
      if (to) {
        clauses.push('a.scheduled_date <= @rangeTo')
        params.rangeTo = to
      }
    } else if (preset !== 'all' && preset !== 'custom') {
      const today = toLocalDate(ctx.now())
      const shift = (days: number): string => toLocalDate(fromLocalDate(today) - days * 86_400_000)
      const bounds: Record<string, [string, string]> = {
        yesterday: [shift(1), shift(1)],
        last7: [shift(6), today],
        last30: [shift(29), today],
        last90: [shift(89), today],
        thisMonth: [`${today.slice(0, 7)}-01`, today],
        lastYear: [shift(364), today]
      }
      const bound = bounds[preset]
      if (bound) {
        clauses.push('a.scheduled_date >= @rangeFrom AND a.scheduled_date <= @rangeTo')
        params.rangeFrom = bound[0]
        params.rangeTo = bound[1]
      }
    }
  }
  if (filter.search && filter.search.trim() !== '') {
    const term = `%${filter.search.trim()}%`
    const fold = `%${foldForSearch(filter.search)}%`
    clauses.push(`(p.full_name LIKE @term OR p.full_name_bn LIKE @term OR p.phone LIKE @term OR p.code LIKE @term OR p.full_name_fold LIKE @fold)`)
    params.term = term
    params.fold = fold
  }

  const where = clauses.join(' AND ')
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE ${where}`).get(params) as { count: number }).count
  const rows = ctx.db
    .prepare(`${SELECT_APPOINTMENT} WHERE ${where} ORDER BY a.scheduled_at DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.limit, offset: filter.offset }) as AppointmentRow[]
  return { items: rows.map(mapAppointment), total, limit: filter.limit, offset: filter.offset }
}

/** Everything booked on one local date, plus the day's load per dentist. */
export function appointmentsForDay(ctx: ServiceContext, date: string): { date: string, load: Array<{ dentistId: number, dentistName: string, minutes: number, appointments: number }>, items: AppointmentRecord[] } {
  assertPermission(ctx, 'appointments.view')
  const rows = ctx.db
    .prepare(`${SELECT_APPOINTMENT} WHERE a.scheduled_date = ? AND a.is_deleted = 0 ORDER BY a.scheduled_at ASC`)
    .all(date) as AppointmentRow[]
  const items = rows.map(mapAppointment)

  const load = ctx.db
    .prepare(
      `SELECT d.id AS dentist_id, d.full_name AS dentist_name,
              COALESCE(SUM(a.duration_min), 0) AS minutes, COUNT(a.id) AS appointments
         FROM dentists d
         LEFT JOIN appointments a ON a.dentist_id = d.id AND a.scheduled_date = @date AND a.is_deleted = 0 AND a.status NOT IN ('cancelled','no_show')
        WHERE d.is_deleted = 0 AND d.is_active = 1
        GROUP BY d.id
        ORDER BY d.sort_order, d.full_name`
    )
    .all({ date }) as Array<{ dentist_id: number, dentist_name: string, minutes: number, appointments: number }>

  return {
    date,
    items,
    load: load.map((entry) => ({ dentistId: entry.dentist_id, dentistName: entry.dentist_name, minutes: entry.minutes, appointments: entry.appointments }))
  }
}

export function getAppointment(ctx: ServiceContext, id: number): AppointmentRecord {
  assertPermission(ctx, 'appointments.view')
  return loadAppointment(ctx, id)
}

/** Appointments that still lie ahead, for the queue desk and the patient profile. */
export function upcomingAppointments(ctx: ServiceContext, input: { patientId?: number, limit: number }): AppointmentRecord[] {
  assertPermission(ctx, 'appointments.view')
  const clauses = ["a.is_deleted = 0", "a.status IN ('scheduled','confirmed')", 'a.scheduled_at >= @from']
  const params: Record<string, unknown> = { from: ctx.now(), limit: input.limit }
  if (input.patientId) {
    clauses.push('a.patient_id = @patientId')
    params.patientId = input.patientId
  }
  const rows = ctx.db
    .prepare(`${SELECT_APPOINTMENT} WHERE ${clauses.join(' AND ')} ORDER BY a.scheduled_at ASC LIMIT @limit`)
    .all(params) as AppointmentRow[]
  return rows.map(mapAppointment)
}

export function saveAppointment(ctx: ServiceContext, input: AppointmentInput): AppointmentRecord {
  assertPermission(ctx, input.id ? 'appointments.edit' : 'appointments.create')
  assertPatient(ctx, input.patientId)
  assertDentist(ctx, input.dentistId)
  if (input.status === 'cancelled' || input.status === 'no_show') {
    assertPermission(ctx, 'appointments.cancel')
  }
  const date = toLocalDate(input.scheduledAt)

  if (input.id) {
    const existing = loadAppointment(ctx, input.id)
    if (input.scheduledAt !== existing.scheduledAt || input.durationMin !== existing.durationMin) {
      assertSlotFree(ctx, input.dentistId, input.scheduledAt, input.durationMin, input.id)
    }
    ctx.db.transaction(() => {
      ctx.db
        .prepare(
          `UPDATE appointments
              SET patient_id = @patientId, dentist_id = @dentistId, scheduled_at = @scheduledAt, scheduled_date = @scheduledDate,
                  duration_min = @durationMin, reason = @reason, notes = @notes, status = @status, updated_at = @now
            WHERE id = @id`
        )
        .run({
          id: input.id,
          patientId: input.patientId,
          dentistId: input.dentistId,
          scheduledAt: input.scheduledAt,
          scheduledDate: date,
          durationMin: input.durationMin,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          status: input.status,
          now: ctx.now()
        })
      if (existing.status !== input.status) recordEvent(ctx, input.id as number, existing.status, input.status, 'Status set while editing')
      ctx.audit.write({ module: 'appointments', action: 'update', entityType: 'appointment', entityId: input.id, summary: `Updated appointment for ${existing.patientName}`, detail: { scheduledAt: input.scheduledAt } })
    })()
    return loadAppointment(ctx, input.id)
  }

  assertSlotFree(ctx, input.dentistId, input.scheduledAt, input.durationMin, null)
  const id = ctx.db.transaction(() => {
    const result = ctx.db
      .prepare(
        `INSERT INTO appointments (patient_id, dentist_id, scheduled_at, scheduled_date, duration_min, reason, notes, status, created_by, created_at, updated_at)
         VALUES (@patientId, @dentistId, @scheduledAt, @scheduledDate, @durationMin, @reason, @notes, @status, @userId, @now, @now)`
      )
      .run({
        patientId: input.patientId,
        dentistId: input.dentistId,
        scheduledAt: input.scheduledAt,
        scheduledDate: date,
        durationMin: input.durationMin,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        status: input.status,
        userId: ctx.actor.userId,
        now: ctx.now()
      })
    const inserted = Number(result.lastInsertRowid)
    recordEvent(ctx, inserted, null, input.status, 'Appointment booked')
    ctx.audit.write({
      module: 'appointments',
      action: 'create',
      entityType: 'appointment',
      entityId: inserted,
      summary: `Booked an appointment on ${date}`,
      detail: { patientId: input.patientId, dentistId: input.dentistId, scheduledAt: input.scheduledAt }
    })
    return inserted
  })()
  return loadAppointment(ctx, id)
}

export function setAppointmentStatus(ctx: ServiceContext, input: { id: number, status: AppointmentStatus, reason?: string | null }): AppointmentRecord {
  assertPermission(ctx, input.status === 'cancelled' || input.status === 'no_show' ? 'appointments.cancel' : 'appointments.edit')
  const existing = loadAppointment(ctx, input.id)
  if (existing.status === input.status) return existing

  const allowed: Record<AppointmentStatus, AppointmentStatus[]> = {
    scheduled: ['confirmed', 'arrived', 'cancelled', 'no_show'],
    confirmed: ['arrived', 'cancelled', 'no_show'],
    arrived: ['in_consultation', 'cancelled'],
    in_consultation: ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
    no_show: []
  }
  if (!allowed[existing.status].includes(input.status)) {
    throw stateError(`A ${existing.status.replace('_', ' ')} appointment cannot be marked ${input.status.replace('_', ' ')}.`)
  }
  if ((input.status === 'cancelled' || input.status === 'no_show') && (input.reason ?? '').trim().length < 3) {
    throw validationError('Give a short reason when cancelling or recording a no-show.', { reason: 'At least 3 characters' })
  }

  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE appointments SET status = ?, cancelled_reason = ?, updated_at = ? WHERE id = ?').run(
      input.status,
      input.status === 'cancelled' || input.status === 'no_show' ? (input.reason ?? null) : existing.cancelledReason,
      ctx.now(),
      input.id
    )
    recordEvent(ctx, input.id, existing.status, input.status, input.reason ?? null)
    ctx.audit.write({
      module: 'appointments',
      action: 'status',
      entityType: 'appointment',
      entityId: input.id,
      summary: `Appointment ${existing.status} → ${input.status}`,
      detail: { reason: input.reason ?? null }
    })
  })()
  return loadAppointment(ctx, input.id)
}

export function rescheduleAppointment(
  ctx: ServiceContext,
  input: { id: number, scheduledAt: number, durationMin?: number, reason?: string | null }
): AppointmentRecord {
  assertPermission(ctx, 'appointments.edit')
  const existing = loadAppointment(ctx, input.id)
  if (existing.status !== 'scheduled' && existing.status !== 'confirmed') {
    throw stateError('Only an appointment that has not started yet can be rescheduled.')
  }
  const durationMin = input.durationMin ?? existing.durationMin
  assertSlotFree(ctx, existing.dentistId, input.scheduledAt, durationMin, existing.id)
  ctx.db.transaction(() => {
    ctx.db
      .prepare('UPDATE appointments SET scheduled_at = ?, scheduled_date = ?, duration_min = ?, rescheduled_from = ?, updated_at = ? WHERE id = ?')
      .run(input.scheduledAt, toLocalDate(input.scheduledAt), durationMin, existing.scheduledAt, ctx.now(), input.id)
    recordEvent(ctx, input.id, existing.status, existing.status, `Rescheduled from ${new Date(existing.scheduledAt).toISOString()}${input.reason ? ` — ${input.reason}` : ''}`)
    ctx.audit.write({
      module: 'appointments',
      action: 'reschedule',
      entityType: 'appointment',
      entityId: input.id,
      summary: `Rescheduled ${existing.patientName}`,
      detail: { from: existing.scheduledAt, to: input.scheduledAt }
    })
  })()
  return loadAppointment(ctx, input.id)
}

export function deleteAppointment(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'appointments.delete')
  const existing = loadAppointment(ctx, input.id)
  if (existing.status !== 'cancelled' && existing.status !== 'no_show') {
    throw stateError('Only a cancelled appointment or a no-show can be deleted. Cancel the appointment first.')
  }
  const openQueue = ctx.db
    .prepare("SELECT COUNT(*) AS count FROM queue_entries WHERE appointment_id = ? AND status IN ('waiting','called','in_progress')")
    .get(input.id) as { count: number }
  if (openQueue.count > 0) throw stateError('This appointment still has a patient in the queue. Finish or remove the queue entry first.')

  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE appointments SET is_deleted = 1, updated_at = ? WHERE id = ?').run(ctx.now(), input.id)
    ctx.audit.write({
      module: 'appointments',
      action: 'delete',
      entityType: 'appointment',
      entityId: input.id,
      summary: `Deleted appointment for ${existing.patientName} (${existing.status})`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}

/**
 * Bookable slots for one dentist on one date.
 *
 * The grid runs from the clinic's opening to closing time in steps of the requested duration; slots that
 * overlap an existing appointment are returned as taken so the picker can grey them out.
 */
export function appointmentSlots(ctx: ServiceContext, input: { date: string, dentistId: number, durationMin: number }): Array<{ at: number, taken: boolean }> {
  assertPermission(ctx, 'appointments.view')
  const clinic = ctx.db.prepare('SELECT opening_time, closing_time, weekly_closed_days FROM clinic WHERE id = 1').get() as
    | { opening_time: string | null, closing_time: string | null, weekly_closed_days: string | null }
    | undefined
  const open = clinic?.opening_time && clinic.opening_time.trim() !== '' ? clinic.opening_time : '09:00'
  const close = clinic?.closing_time && clinic.closing_time.trim() !== '' ? clinic.closing_time : '21:00'
  const [openHour, openMinute] = open.split(':').map(Number)
  const [closeHour, closeMinute] = close.split(':').map(Number)
  const dayStart = fromLocalDate(input.date)
  const start = dayStart + (openHour ?? 9) * 3_600_000 + (openMinute ?? 0) * 60_000
  const end = dayStart + (closeHour ?? 21) * 3_600_000 + (closeMinute ?? 0) * 60_000
  const step = input.durationMin * 60_000

  const booked = ctx.db
    .prepare(
      `SELECT scheduled_at, duration_min FROM appointments
        WHERE dentist_id = ? AND scheduled_date = ? AND is_deleted = 0 AND status IN ${BLOCKING_STATUSES}`
    )
    .all(input.dentistId, input.date) as Array<{ scheduled_at: number, duration_min: number }>

  const slots: Array<{ at: number, taken: boolean }> = []
  for (let at = start; at + step <= end; at += step) {
    const slotEnd = at + step
    const taken = booked.some((entry) => entry.scheduled_at < slotEnd && entry.scheduled_at + entry.duration_min * 60_000 > at)
    slots.push({ at, taken })
  }
  return slots
}

/** Count of appointments in a local date range, used by the dashboard and reports. */
export function countAppointments(ctx: ServiceContext, from: string, to: string): number {
  const row = ctx.db
    .prepare("SELECT COUNT(*) AS count FROM appointments WHERE is_deleted = 0 AND status NOT IN ('cancelled','no_show') AND scheduled_date >= ? AND scheduled_date <= ?")
    .get(from, to) as { count: number }
  return row.count
}

export function statusLabel(status: AppointmentStatus): string {
  return status.replace('_', ' ')
}
