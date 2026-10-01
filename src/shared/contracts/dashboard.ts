import { z } from 'zod'
import { channel, zDateRange, zLocalDate } from '../ipc'

/** Dashboard and header widgets: aggregate figures, today's schedule, queue counters, alerts. */

export const zDashboardKpi = z.object({
  key: z.string(),
  label: z.string(),
  value: z.number(),
  unit: z.enum(['money', 'count']),
  deltaBp: z.number().nullable(),
  route: z.string().nullable(),
  hint: z.string()
})

export const zDashboardSummary = z.object({
  range: z.object({ preset: z.string(), from: zLocalDate.nullable(), to: zLocalDate.nullable() }),
  kpis: z.array(zDashboardKpi),
  appointments: z.array(
    z.object({
      id: z.number(),
      scheduledAt: z.number(),
      patientId: z.number(),
      patientName: z.string(),
      patientCode: z.string(),
      dentistName: z.string(),
      status: z.string(),
      reason: z.string().nullable()
    })
  ),
  queue: z.object({ waiting: z.number(), inProgress: z.number(), completedToday: z.number() }),
  duePatients: z.array(
    z.object({
      patientId: z.number(),
      code: z.string(),
      fullName: z.string(),
      dueMicro: z.number(),
      lastPaymentAt: z.number().nullable()
    })
  ),
  lowStock: z.array(
    z.object({
      itemId: z.number(),
      code: z.string(),
      name: z.string(),
      quantityOnHand: z.number(),
      reorderLevel: z.number(),
      unit: z.string()
    })
  ),
  expiringBatches: z.array(
    z.object({ batchId: z.number(), itemName: z.string(), batchNo: z.string(), expiryDate: zLocalDate, quantity: z.number() })
  ),
  revenueSeries: z.array(z.object({ label: z.string(), value: z.number(), meta: z.string().optional() })),
  dentistLoad: z.array(z.object({ label: z.string(), value: z.number(), meta: z.string().optional() })),
  recentActivity: z.array(
    z.object({ id: z.number(), at: z.number(), module: z.string(), action: z.string(), summary: z.string(), username: z.string().nullable() })
  ),
  notifications: z.object({ unread: z.number(), critical: z.number() }),
  generatedAt: z.number()
})

export const zQueueCounters = z.object({
  waiting: z.number(),
  called: z.number(),
  inProgress: z.number(),
  completedToday: z.number(),
  activeEntries: z.array(
    z.object({
      id: z.number(),
      queueNo: z.number(),
      patientId: z.number(),
      patientName: z.string(),
      patientCode: z.string(),
      status: z.string(),
      priority: z.number(),
      joinedAt: z.number(),
      dentistName: z.string().nullable(),
      waitingMinutes: z.number()
    })
  )
})

export const dashboardChannels = {
  'dashboard.summary': channel(z.object({ range: zDateRange.optional() }).default({}), zDashboardSummary),
  'dashboard.queue': channel(z.object({}).default({}), zQueueCounters)
} as const
