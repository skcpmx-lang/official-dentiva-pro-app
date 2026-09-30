import {
  appointmentSlots,
  appointmentsForDay,
  deleteAppointment,
  getAppointment,
  listAppointments,
  rescheduleAppointment,
  saveAppointment,
  setAppointmentStatus,
  upcomingAppointments
} from '../../modules/scheduling/appointments'
import { addQueueEntry, queueBoard, removeQueueEntry, setQueueStatus } from '../../modules/scheduling/queue'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Handlers for scheduling: the appointment book and the waiting queue.
 *
 * Every handler is a straight call into the service, where authorisation, transition rules and auditing
 * live. Nothing in this file can be bypassed by a renderer that skips a button.
 */
export function createSchedulingHandlers(_deps: HandlerDeps): PartialHandlerMap {
  return {
    'appointments.list': (ctx, input) => listAppointments(ctx, input),
    'appointments.day': (ctx, input) => appointmentsForDay(ctx, input.date),
    'appointments.get': (ctx, input) => getAppointment(ctx, input.id),
    'appointments.save': (ctx, input) => saveAppointment(ctx, input),
    'appointments.setStatus': (ctx, input) => setAppointmentStatus(ctx, input),
    'appointments.reschedule': (ctx, input) => rescheduleAppointment(ctx, input),
    'appointments.delete': (ctx, input) => deleteAppointment(ctx, input),
    'appointments.upcoming': (ctx, input) => upcomingAppointments(ctx, input),
    'appointments.slots': (ctx, input) => appointmentSlots(ctx, input),

    'queue.board': (ctx, input) => queueBoard(ctx, input),
    'queue.add': (ctx, input) => addQueueEntry(ctx, input),
    'queue.setStatus': (ctx, input) => setQueueStatus(ctx, input),
    'queue.remove': (ctx, input) => removeQueueEntry(ctx, input)
  }
}
