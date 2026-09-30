import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { saveDentist, type DentistInput } from '@main/modules/dentists/service'
import {
  appointmentSlots,
  appointmentsForDay,
  deleteAppointment,
  listAppointments,
  rescheduleAppointment,
  saveAppointment,
  setAppointmentStatus,
  upcomingAppointments,
  type AppointmentInput
} from '@main/modules/scheduling/appointments'
import { addQueueEntry, queueBoard, removeQueueEntry, setQueueStatus } from '@main/modules/scheduling/queue'
import { fromLocalDate, toLocalDate } from '@shared/datetime'

/**
 * Scheduling integration tests.
 *
 * The appointment book and the queue are where clinical work, billing and the front desk meet, so these
 * tests pin down the rules that keep them consistent: no double-booking, transitions that cannot skip
 * steps, cancellation that demands a reason, arrival that creates exactly one queue entry, and a queue
 * that refuses to erase a patient who has already been seen.
 */

let harness: TestHarness
let patientId: number
let secondPatientId: number
let dentistId: number

function patientInput(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    fullName: 'Rakib Hasan',
    fullNameBn: 'রাকিব হাসান',
    dob: null,
    ageYears: 32,
    gender: 'male',
    bloodGroup: null,
    phone: '01712345678',
    altPhone: null,
    emergencyPhone: null,
    address: null,
    addressBn: null,
    city: 'Tangail',
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
    status: 'active',
    ...overrides
  } as PatientInput
}

function dentistInput(overrides: Partial<DentistInput> = {}): DentistInput {
  return {
    id: null,
    fullName: 'Dr Ayesha Rahman',
    fullNameBn: null,
    phone: null,
    email: null,
    registrationNo: 'BMDC-12345',
    signatureLabel: null,
    color: null,
    designations: ['Consultant Dental Surgeon'],
    qualifications: [],
    schedules: [],
    isActive: true,
    sortOrder: 1,
    ...overrides
  } as DentistInput
}

function appointmentInput(at: number, overrides: Partial<AppointmentInput> = {}): AppointmentInput {
  return {
    id: null,
    patientId,
    dentistId,
    scheduledAt: at,
    durationMin: 30,
    reason: 'Toothache',
    notes: null,
    status: 'scheduled',
    ...overrides
  } as AppointmentInput
}

beforeEach(() => {
  harness = createHarness()
  patientId = savePatient(harness.ctx(), patientInput()).id
  secondPatientId = savePatient(harness.ctx(), patientInput({ fullName: 'Nabila Akter', fullNameBn: 'নাবিলা আক্তার', phone: '01898765432' })).id
  dentistId = saveDentist(harness.ctx(), dentistInput()).id
})

afterEach(() => {
  harness.cleanup()
})

describe('appointments', () => {
  it('books an appointment on the local date and lists it for that day', () => {
    const at = fromLocalDate(toLocalDate(Date.now())) + 10 * 3_600_000
    const appointment = saveAppointment(harness.ctx(), appointmentInput(at))

    expect(appointment.id).toBeGreaterThan(0)
    expect(appointment.scheduledDate).toBe(toLocalDate(at))
    expect(appointment.status).toBe('scheduled')
    expect(appointment.queueEntryId).toBeNull()

    const day = appointmentsForDay(harness.ctx(), toLocalDate(at))
    expect(day.items).toHaveLength(1)
    expect(day.items[0]?.patientName).toBe('Rakib Hasan')
    expect(day.load.find((entry) => entry.dentistId === dentistId)?.minutes).toBe(30)
  })

  it('refuses a booking that overlaps another appointment for the same dentist', () => {
    const at = fromLocalDate('2026-10-05') + 10 * 3_600_000
    saveAppointment(harness.ctx(), appointmentInput(at))

    expect(() => saveAppointment(harness.ctx(), appointmentInput(at + 10 * 60_000, { patientId: secondPatientId }))).toThrow(/already booked/i)
    /* A different dentist can still take the slot. */
    const otherDentist = saveDentist(harness.ctx(), dentistInput({ fullName: 'Dr Kamal Hossain', registrationNo: 'BMDC-54321' })).id
    expect(saveAppointment(harness.ctx(), appointmentInput(at + 10 * 60_000, { patientId: secondPatientId, dentistId: otherDentist })).id).toBeGreaterThan(0)
  })

  it('walks the appointment through arrival, consultation and completion, and refuses illegal jumps', () => {
    const at = fromLocalDate('2026-10-06') + 11 * 3_600_000
    const appointment = saveAppointment(harness.ctx(), appointmentInput(at))

    expect(() => setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'completed' })).toThrow(/cannot be marked/i)

    expect(setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'confirmed' }).status).toBe('confirmed')
    expect(setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'arrived' }).status).toBe('arrived')
    expect(setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'in_consultation' }).status).toBe('in_consultation')
    const completed = setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'completed' })
    expect(completed.status).toBe('completed')

    const events = harness.database.db
      .prepare('SELECT from_status, to_status FROM appointment_events WHERE appointment_id = ? ORDER BY id')
      .all(appointment.id) as Array<{ from_status: string | null, to_status: string }>
    expect(events.map((event) => event.to_status)).toEqual(['scheduled', 'confirmed', 'arrived', 'in_consultation', 'completed'])
  })

  it('requires a reason to cancel and keeps a cancelled appointment out of the active list', () => {
    const at = fromLocalDate('2026-10-07') + 9 * 3_600_000
    const appointment = saveAppointment(harness.ctx(), appointmentInput(at))

    expect(() => setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'cancelled', reason: 'x' })).toThrow(/reason/i)
    const cancelled = setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'cancelled', reason: 'Patient called to cancel' })
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.cancelledReason).toBe('Patient called to cancel')

    const active = listAppointments(harness.ctx(), { activeOnly: true, limit: 50, offset: 0 } as never)
    expect(active.items).toHaveLength(0)
    const all = listAppointments(harness.ctx(), { activeOnly: false, limit: 50, offset: 0 } as never)
    expect(all.items).toHaveLength(1)

    /* A cancelled appointment can be deleted; a live one cannot. */
    expect(deleteAppointment(harness.ctx(), { id: appointment.id, reason: 'Duplicate booking' })).toEqual({ ok: true })
    expect(listAppointments(harness.ctx(), { activeOnly: false, limit: 50, offset: 0 } as never).items).toHaveLength(0)

    const live = saveAppointment(harness.ctx(), appointmentInput(at + 3_600_000))
    expect(() => deleteAppointment(harness.ctx(), { id: live.id, reason: 'Mistake' })).toThrow(/cancel the appointment first/i)
  })

  it('reschedules without losing the original time and refuses to move a finished appointment', () => {
    const at = fromLocalDate('2026-10-08') + 14 * 3_600_000
    const appointment = saveAppointment(harness.ctx(), appointmentInput(at))
    const moved = at + 86_400_000

    const rescheduled = rescheduleAppointment(harness.ctx(), { id: appointment.id, scheduledAt: moved, reason: 'Patient request' })
    expect(rescheduled.scheduledAt).toBe(moved)
    expect(rescheduled.rescheduledFrom).toBe(at)
    expect(rescheduled.scheduledDate).toBe(toLocalDate(moved))

    setAppointmentStatus(harness.ctx(), { id: appointment.id, status: 'cancelled', reason: 'Clinic closed that day' })
    expect(() => rescheduleAppointment(harness.ctx(), { id: appointment.id, scheduledAt: moved + 86_400_000 })).toThrow(/cannot|not started/i)
  })

  it('builds a slot grid that marks booked slots as taken and lists only what lies ahead', () => {
    const date = toLocalDate(Date.now() + 2 * 86_400_000)
    const at = fromLocalDate(date) + 10 * 3_600_000
    const booked = saveAppointment(harness.ctx(), appointmentInput(at, { durationMin: 30 }))

    const slots = appointmentSlots(harness.ctx(), { date, dentistId, durationMin: 30 })
    expect(slots.length).toBeGreaterThan(0)
    expect(slots.filter((slot) => slot.taken)).toHaveLength(1)
    expect(slots.find((slot) => slot.taken)?.at).toBe(at)

    /* The same slot for another dentist is free, and the booked appointment is the only one ahead. */
    const otherDentist = saveDentist(harness.ctx(), dentistInput({ fullName: 'Dr Farhana Islam', registrationNo: 'BMDC-98765' })).id
    expect(appointmentSlots(harness.ctx(), { date, dentistId: otherDentist, durationMin: 30 }).every((slot) => !slot.taken)).toBe(true)

    const upcoming = upcomingAppointments(harness.ctx(), { patientId, limit: 10 })
    expect(upcoming.map((entry) => entry.id)).toEqual([booked.id])
    expect(upcoming.every((entry) => entry.scheduledAt >= Date.now())).toBe(true)
  })

  it('refuses appointments for archived patients and inactive dentists', () => {
    const at = fromLocalDate('2026-10-09') + 15 * 3_600_000
    harness.database.db.prepare("UPDATE patients SET is_deleted = 1 WHERE id = ?").run(secondPatientId)
    expect(() => saveAppointment(harness.ctx(), appointmentInput(at, { patientId: secondPatientId }))).toThrow(/archived/i)

    harness.database.db.prepare('UPDATE dentists SET is_active = 0 WHERE id = ?').run(dentistId)
    expect(() => saveAppointment(harness.ctx(), appointmentInput(at))).toThrow(/inactive/i)
  })

  it('enforces appointment permissions in the service layer', () => {
    const at = fromLocalDate('2026-10-10') + 12 * 3_600_000
    const booking = harness.ctx(['appointments.create', 'appointments.view', 'patients.view'])
    const created = saveAppointment(booking, appointmentInput(at))
    expect(created.id).toBeGreaterThan(0)

    const reader = harness.ctx(['appointments.view'])
    expect(() => saveAppointment(reader, appointmentInput(at + 3_600_000))).toThrow(/permission/i)
    expect(() => setAppointmentStatus(reader, { id: created.id, status: 'confirmed' })).toThrow(/permission/i)
    expect(() => deleteAppointment(reader, { id: created.id, reason: 'No reason' })).toThrow(/permission/i)
    expect(() => listAppointments(harness.ctx(['queue.view']), { activeOnly: true, limit: 10, offset: 0 } as never)).toThrow(/permission/i)
  })
})

describe('queue', () => {
  it('issues daily queue numbers, tracks waiting time and completes the linked appointment', () => {
    const at = fromLocalDate(toLocalDate(Date.now())) + 9 * 3_600_000
    const appointment = saveAppointment(harness.ctx(), appointmentInput(at))

    const first = addQueueEntry(harness.ctx(), { patientId, dentistId, appointmentId: appointment.id })
    const second = addQueueEntry(harness.ctx(), { patientId: secondPatientId, dentistId, priority: 1 })
    expect(first.queueNo).toBe(1)
    expect(second.queueNo).toBe(2)
    expect(first.status).toBe('waiting')

    /* Arrival is reflected on the appointment, and the same appointment cannot join twice. */
    const appointmentAfterCheckIn = listAppointments(harness.ctx(), { patientId, activeOnly: true, limit: 5, offset: 0 } as never).items[0]
    expect(appointmentAfterCheckIn?.status).toBe('arrived')
    expect(appointmentAfterCheckIn?.queueNo).toBe(1)
    expect(() => addQueueEntry(harness.ctx(), { patientId, dentistId, appointmentId: appointment.id })).toThrow(/already in the queue/i)

    const board = queueBoard(harness.ctx(), { date: null })
    expect(board.counters.waiting).toBe(2)
    expect(board.items[0]?.queueNo).toBe(2) /* priority 1 is called first */
    expect(board.items.find((entry) => entry.queueNo === 1)?.waitingMinutes).toBeGreaterThanOrEqual(0)

    expect(setQueueStatus(harness.ctx(), { id: first.id, status: 'called' }).calledAt).not.toBeNull()
    expect(setQueueStatus(harness.ctx(), { id: first.id, status: 'in_progress' }).status).toBe('in_progress')
    expect(setQueueStatus(harness.ctx(), { id: first.id, status: 'completed' }).status).toBe('completed')

    const completedAppointment = listAppointments(harness.ctx(), { patientId, activeOnly: false, limit: 5, offset: 0 } as never).items[0]
    expect(completedAppointment?.status).toBe('completed')
    expect(queueBoard(harness.ctx(), { date: null }).counters.completedToday).toBe(1)
  })

  it('refuses illegal queue transitions and protects patients who have been seen', () => {
    const entry = addQueueEntry(harness.ctx(), { patientId })
    expect(() => setQueueStatus(harness.ctx(), { id: entry.id, status: 'completed' })).toThrow(/cannot be moved/i)

    setQueueStatus(harness.ctx(), { id: entry.id, status: 'called' })
    setQueueStatus(harness.ctx(), { id: entry.id, status: 'in_progress' })
    expect(() => removeQueueEntry(harness.ctx(), { id: entry.id, reason: 'Wrong patient' })).toThrow(/cannot be removed/i)

    setQueueStatus(harness.ctx(), { id: entry.id, status: 'completed' })
    expect(() => removeQueueEntry(harness.ctx(), { id: entry.id, reason: 'Tidy up' })).toThrow(/cannot be removed/i)

    const skipped = addQueueEntry(harness.ctx(), { patientId: secondPatientId })
    setQueueStatus(harness.ctx(), { id: skipped.id, status: 'skipped' })
    expect(removeQueueEntry(harness.ctx(), { id: skipped.id, reason: 'Left without being seen' })).toEqual({ ok: true })
  })

  it('enforces queue permissions and rejects archived patients', () => {
    const manager = harness.ctx(['queue.manage', 'queue.view'])
    const entry = addQueueEntry(manager, { patientId })
    expect(entry.queueNo).toBeGreaterThan(0)

    expect(() => addQueueEntry(harness.ctx(['queue.view']), { patientId })).toThrow(/permission/i)
    expect(() => queueBoard(harness.ctx(['appointments.view']), { date: null })).toThrow(/permission/i)
    expect(() => setQueueStatus(harness.ctx(['queue.view']), { id: entry.id, status: 'called' })).toThrow(/permission/i)

    harness.database.db.prepare('UPDATE patients SET is_deleted = 1 WHERE id = ?').run(secondPatientId)
    expect(() => addQueueEntry(manager, { patientId: secondPatientId })).toThrow(/archived/i)
  })
})
