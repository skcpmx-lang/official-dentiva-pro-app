import { z } from 'zod'
import { channel, zDateRange, zLocalDate, zOptionalText, zTrimmed } from '../ipc'
import { zActionResult } from './system'

/* -------------------------------------------------------------------------- */
/* Value objects                                                              */
/* -------------------------------------------------------------------------- */

/** Income or expense. Both live in the same ledger and are separated by `kind`. */
export const ACCOUNTING_KINDS = ['income', 'expense'] as const
export const zAccountingKind = z.enum(ACCOUNTING_KINDS)

/** A closed day is a statement about the cash drawer, so it is recorded rather than recomputed. */
export const zCategoryInput = z.object({
  id: z.number().int().positive().nullish(),
  name: zTrimmed(2, 80, 'Category name'),
  kind: zAccountingKind.default('expense'),
  isActive: z.boolean().default(true)
})

export const zCategory = zCategoryInput.extend({
  id: z.number(),
  isSystem: z.boolean(),
  usageCount: z.number(),
  totalMicro: z.number()
})

export const zEntryInput = z.object({
  id: z.number().int().positive().nullish(),
  kind: zAccountingKind,
  categoryId: z.number().int().positive().nullish(),
  categoryName: zTrimmed(2, 80, 'Category'),
  entryDate: zLocalDate,
  amountMicro: z.number().int().positive().max(999_999_999_999),
  method: z.string().max(32).default('cash'),
  reference: zOptionalText(120),
  party: zOptionalText(160),
  description: zTrimmed(3, 300, 'Description'),
  notes: zOptionalText(1000)
})

export const zEntry = zEntryInput.extend({
  id: z.number(),
  entryNo: z.string(),
  status: z.enum(['active', 'void']),
  voidReason: z.string().nullable(),
  voidedAt: z.number().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const zEntryPage = z.object({
  items: z.array(zEntry),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  totals: z.object({ incomeMicro: z.number(), expenseMicro: z.number(), netMicro: z.number() })
})

export const zEntryFilter = z.object({
  kind: zAccountingKind.optional(),
  categoryId: z.number().int().positive().optional(),
  method: z.string().max(32).optional(),
  search: z.string().max(120).optional(),
  includeVoid: z.boolean().default(false),
  range: zDateRange.optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0)
})

export const zAccountingSummary = z.object({
  from: zLocalDate,
  to: zLocalDate,
  incomeMicro: z.number(),
  expenseMicro: z.number(),
  netMicro: z.number(),
  byCategory: z.array(z.object({ kind: zAccountingKind, category: z.string(), amountMicro: z.number(), entries: z.number() })),
  byMethod: z.array(z.object({ method: z.string(), incomeMicro: z.number(), expenseMicro: z.number() })),
  daily: z.array(z.object({ date: zLocalDate, incomeMicro: z.number(), expenseMicro: z.number() }))
})

export const zDayCloseView = z.object({
  date: zLocalDate,
  isClosed: z.boolean,
  closedAt: z.number().nullable(),
  closedByName: z.string().nullable(),
  countedCashMicro: z.number().nullable(),
  cashCollectedMicro: z.number(),
  cashExpensesMicro: z.number(),
  expectedCashMicro: z.number(),
  varianceMicro: z.number().nullable(),
  byMethod: z.array(z.object({ method: z.string(), amountMicro: z.number() })),
  note: z.string().nullable()
})

export const zDayCloseInput = z.object({
  date: zLocalDate,
  countedCashMicro: z.number().int().min(0).max(999_999_999_999),
  note: zOptionalText(1000)
})

export const zDayCloseHistory = z.object({
  items: z.array(zDayCloseView),
  total: z.number(),
  limit: z.number(),
  offset: z.number()
})

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

/** Formats the renderer and the CSV writer share; a report never returns pre-formatted numbers. */
export const REPORT_FORMATS = ['text', 'number', 'money', 'date', 'percent'] as const

export const zReportColumn = z.object({
  key: z.string(),
  header: z.string(),
  align: z.enum(['left', 'right']).default('left'),
  format: z.enum(REPORT_FORMATS).default('text')
})

export const zReportCell = z.union([z.string(), z.number(), z.null()])

export const zReport = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string(),
  from: zLocalDate.nullable(),
  to: zLocalDate.nullable(),
  generatedAt: z.number(),
  columns: z.array(zReportColumn),
  rows: z.array(z.record(z.string(), zReportCell)),
  totals: z.array(z.object({ label: z.string(), value: zReportCell, format: z.enum(REPORT_FORMATS) })),
  /** Rows the report deliberately leaves out, explained instead of silently dropped. */
  note: z.string().nullable()
})

export const zReportCatalog = z.array(
  z.object({
    key: z.string(),
    title: z.string(),
    description: z.string(),
    usesRange: z.boolean(),
    permission: z.string()
  })
)

/* -------------------------------------------------------------------------- */
/* Channel registry                                                           */
/* -------------------------------------------------------------------------- */

export const accountingChannels = {
  'accounting.categories': channel(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }), z.array(zCategory)),
  'accounting.categories.save': channel(zCategoryInput, zCategory),
  'accounting.categories.archive': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 300, 'Reason') }), zActionResult),

  'accounting.entries': channel(zEntryFilter, zEntryPage),
  'accounting.entry.get': channel(z.object({ id: z.number().int().positive() }), zEntry),
  'accounting.entry.save': channel(zEntryInput, zEntry),
  'accounting.entry.void': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 300, 'Reason') }), zEntry),
  'accounting.entries.export': channel(zEntryFilter, z.object({ path: z.string().nullable(), rowCount: z.number().int() })),

  'accounting.summary': channel(z.object({ from: zLocalDate, to: zLocalDate }), zAccountingSummary),

  'accounting.dayClose': channel(z.object({ date: zLocalDate }), zDayCloseView),
  'accounting.closeDay': channel(zDayCloseInput, zDayCloseView),
  'accounting.reopenDay': channel(z.object({ date: zLocalDate, reason: zTrimmed(3, 300, 'Reason') }), zDayCloseView),
  'accounting.days': channel(z.object({ from: zLocalDate, to: zLocalDate, limit: z.number().int().min(1).max(200).default(60), offset: z.number().int().min(0).default(0) }), zDayCloseHistory),

  'reports.catalog': channel(z.object({}).default({}), zReportCatalog),
  'reports.run': channel(z.object({ key: z.string().max(60), range: zDateRange.optional(), limit: z.number().int().min(1).max(5000).default(500) }), zReport),
  'reports.export': channel(
    z.object({ key: z.string().max(60), range: zDateRange.optional(), limit: z.number().int().min(1).max(5000).default(5000) }),
    z.object({ path: z.string().nullable(), rowCount: z.number().int() })
  )
}
