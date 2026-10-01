import { assertAnyPermission } from '../../context'
import { getDashboardSummary } from '../../modules/dashboard/service'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import type { PartialHandlerMap } from '../router'

/**
 * Dashboard and header widget handlers.
 *
 * The queue counters are read here rather than in the queue module because the application shell
 * polls them every 30 seconds on any screen, and the query must stay as cheap as possible.
 */
export function createDashboardHandlers(): PartialHandlerMap {
  return {
    'dashboard.summary': (ctx, input) => getDashboardSummary(ctx, input),

    'dashboard.queue': (ctx) => {
      assertAnyPermission(ctx, ['queue.view', 'appointments.view'])
      const todayStart = fromLocalDate(toLocalDate(ctx.now()))
      const counters = ctx.db
        .prepare(
          `SELECT
             COUNT(CASE WHEN status = 'waiting' AND joined_at >= ? THEN 1 END) AS waiting,
             COUNT(CASE WHEN status = 'called' AND joined_at >= ? THEN 1 END) AS called,
             COUNT(CASE WHEN status = 'in_progress' AND joined_at >= ? THEN 1 END) AS inProgress,
             COUNT(CASE WHEN status = 'completed' AND joined_at >= ? THEN 1 END) AS completedToday
           FROM queue_entries WHERE joined_at >= ?`
        )
        .get(todayStart, todayStart, todayStart, todayStart, todayStart) as { waiting: number, called: number, inProgress: number, completedToday: number }

      const activeEntries = (
        ctx.db
          .prepare(
            `SELECT q.id, q.queue_no AS queueNo, q.patient_id AS patientId, p.full_name AS patientName, p.code AS patientCode,
                    q.status, q.priority, q.joined_at AS joinedAt, d.full_name AS dentistName
             FROM queue_entries q
             JOIN patients p ON p.id = q.patient_id
             LEFT JOIN dentists d ON d.id = q.dentist_id
             WHERE q.status IN ('waiting','called','in_progress') AND q.joined_at >= ?
             ORDER BY q.priority DESC, q.joined_at ASC`
          )
          .all(todayStart) as Array<{
          id: number
          queueNo: number
          patientId: number
          patientName: string
          patientCode: string
          status: string
          priority: number
          joinedAt: number
          dentistName: string | null
        }>
      ).map((entry) => ({ ...entry, waitingMinutes: Math.max(0, Math.floor((ctx.now() - entry.joinedAt) / 60_000)) }))

      return { ...counters, activeEntries }
    }
  }
}
