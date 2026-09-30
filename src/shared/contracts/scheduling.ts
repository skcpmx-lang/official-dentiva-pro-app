import { z } from 'zod'
import { channel, zLocalDate, zOptionalText, zRangePreset, zTrimmed } from '../ipc'
import { zActionResult } from './system'

/* -------------------------------------------------------------------------- */
/* Value objects                                                              */
/* -------------------------------------------------------------------------- */

export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'arrived', 'in_consultation', 'completed', 'cancelled', 'no_show'] as const
export const QUEUE_STATUSES = ['waiting', 'called', 'in_progress', 'completed', 'skipped', 'left'] as const

export const zAppointmentInput = z.object({
  id: z.number().int().positive().nullish(),
  patientId: z.number().int().positive(),
  dentistId: z.number().int().positive(),
  scheduledAt: z.number().int().positive(),
  durationMin: z.number().int().min(5).max(480).default(20),
  reason: zOptionalText(300),
  notes: zOptionalText(1000),
  status: z.enum(APPOINTMENT_STATUSES).default('scheduled')
})

export const zAppointment = zAppointmentInput.extend({
  id: z.number(),
  patientCode: z.string(),
  patientName: z.string(),
  patientNameBn: z.string().nullable(),
  patientPhone: z.string().nullable(),
  dentistName: z.string(),
  /** Local `YYYY-MM-DD` of the appointment, which is how the calendar groups. */
  scheduledDate: zLocalDate,
  status: z.enum(APPOINTMENT_STATUSES),
  cancelledReason: z.string().nullable(),
  rescheduledFrom: z.number().nullable(),
  visitId: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  /** Queue entry currently linked to this appointment, if the patient has been checked in. */
  queueEntryId: z.number().nullable(),
  queueNo: z.number().nullable(),
  queueStatus: z.enum(QUEUE_STATUSES).nullable()
})

export const zAppointmentPage = z.object({
  items: z.array(zAppointment),
  total: z.number(),
  limit: z.number(),
  offset: z.number()
})

export const zAppointmentFilter = z.object({
  patientId: z.number().int().positive().optional(),
  dentistId: z.number().int().positive().optional(),
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  /** Filter out cancelled/no-show appointments (used by the calendar's default view). */
  activeOnly: z.boolean().default(true),
  search: z.string().max(120).optional(),
  range: z.object({ preset: zRangePreset, from: zLocalDate.optional(), to: zLocalDate.optional() }).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  offset: z.number().int().min(0).default(0)
})

export const zAppointmentDay = z.object({
  date: zLocalDate,
  /** Booked minutes per dentist, so the calendar can warn about a full day. */
  load: z.array(z.object({ dentistId: z.number(), dentistName: z.string(), minutes: z.number(), appointments: z.number() })),
  items: z.array(zAppointment)
})

export const zQueueEntry = z.object({
  id: z.number(),
  queueNo: z.number(),
  patientId: z.number(),
  patientCode: z.string(),
  patientName: z.string(),
  patientNameBn: z.string().nullable(),
  patientPhone: z.string().nullable(),
  dentistId: z.number().nullable(),
  dentistName: z.string().nullable(),
  appointmentId: z.number().nullable(),
  visitId: z.number().nullable(),
  status: z.enum(QUEUE_STATUSES),
  priority: z.number(),
  joinedAt: z.number(),
  calledAt: z.number().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  note: z.string().nullable(),
  waitingMinutes: z.number()
})

export const zQueueBoard = z.object({
  date: zLocalDate,
  items: z.array(zQueueEntry),
  counters: z.object({
    waiting: z.number(),
    called: z.number(),
    inProgress: z.number(),
    completedToday: z.number(),
    skipped: z.number(),
    averageWaitMinutes: z.number().nullable()
  })
})

/* -------------------------------------------------------------------------- */
/* Channel registry                                                           */
/* -------------------------------------------------------------------------- */

export const schedulingChannels = {
  'appointments.list': channel(zAppointmentFilter, zAppointmentPage),
  'appointments.day': channel(z.object({ date: zLocalDate }), zAppointmentDay),
  'appointments.get': channel(z.object({ id: z.number().int().positive() }), zAppointment),
  'appointments.save': channel(zAppointmentInput, zAppointment),
  'appointments.setStatus': channel(
    z.object({ id: z.number().int().positive(), status: z.enum(APPOINTMENT_STATUSES), reason: zOptionalText(240) }),
    zAppointment
  ),
  'appointments.reschedule': channel(
    z.object({ id: z.number().int().positive(), scheduledAt: z.number().int().positive(), durationMin: z.number().int().min(5).max(480).optional(), reason: zOptionalText(240) }),
    zAppointment
  ),
  'appointments.delete': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 240, 'Reason') }), zActionResult),
  'appointments.upcoming': channel(
    z.object({ patientId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(50).default(20) }).default({ limit: 20 }),
    z.array(zAppointment)
  ),
  'appointments.slots': channel(
    z.object({ date: zLocalDate, dentistId: z.number().int().positive(), durationMin: z.number().int().min(5).max(480).default(20) }),
    z.array(z.object({ at: z.number(), taken: z.boolean() }))
  ),

  'queue.board': channel(z.object({ date: zLocalDate.nullish() }).default({ date: null }), zQueueBoard),
  'queue.add': channel(
    z.object({
      patientId: z.number().int().positive(),
      dentistId: z.number().int().positive().nullish(),
      appointmentId: z.number().int().positive().nullish(),
      priority: z.number().int().min(0).max(2).default(0),
      note: zOptionalText(300)
    }),
    zQueueEntry
  ),
  'queue.setStatus': channel(z.object({ id: z.number().int().positive(), status: z.enum(QUEUE_STATUSES) }), zQueueEntry),
  'queue.remove': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 240, 'Reason') }), zActionResult)
} as const
