import { z } from 'zod'
import { channel, zLocalDate, zOptionalText, zRangePreset, zTrimmed } from '../ipc'
import { zActionResult } from './system'

/* -------------------------------------------------------------------------- */
/* Value objects                                                              */
/* -------------------------------------------------------------------------- */

export const INVOICE_STATUSES = ['unpaid', 'partial', 'paid', 'void'] as const

/**
 * Payment categories used in Bangladesh. These are record labels only: Dentiva Pro never talks to a
 * wallet or bank provider, it records how the money was received.
 */
export const PAYMENT_METHODS = ['cash', 'bank', 'card', 'bkash', 'nagad', 'rocket', 'upay', 'other_wallet', 'other'] as const
/** Money in (`payment`) or money back out (`refund`). Adjustments are made by voiding and re-recording. */
export const PAYMENT_KINDS = ['payment', 'refund'] as const

export const zInvoiceLineInput = z.object({
  id: z.number().int().positive().nullish(),
  treatmentId: z.number().int().positive().nullish(),
  visitTreatmentId: z.number().int().positive().nullish(),
  description: zTrimmed(1, 200, 'Line description'),
  toothCodes: z.array(z.string().max(8)).max(40).default([]),
  quantity: z.number().min(0.01).max(1000).default(1),
  unitPriceMicro: z.number().int().min(0).max(999_999_999_999),
  discountMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  notes: zOptionalText(300)
})

export const zInvoiceInput = z.object({
  id: z.number().int().positive().nullish(),
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullish(),
  appointmentId: z.number().int().positive().nullish(),
  issueAt: z.number().int().positive(),
  dueDate: zLocalDate.nullish(),
  discountBp: z.number().int().min(0).max(10_000).default(0),
  notes: zOptionalText(1000),
  lines: z.array(zInvoiceLineInput).min(1).max(100)
})

export const zInvoiceLine = zInvoiceLineInput.extend({
  id: z.number(),
  lineTotalMicro: z.number(),
  /** True while the line still points at a visit treatment that has not been billed anywhere else. */
  billed: z.boolean()
})

export const zInvoice = zInvoiceInput.extend({
  id: z.number(),
  invoiceNo: z.string(),
  patientCode: z.string(),
  patientName: z.string(),
  patientNameBn: z.string().nullable(),
  patientPhone: z.string().nullable(),
  status: z.enum(INVOICE_STATUSES),
  issueDate: zLocalDate,
  subtotalMicro: z.number(),
  discountMicro: z.number(),
  totalMicro: z.number(),
  paidMicro: z.number(),
  dueMicro: z.number(),
  refundedMicro: z.number(),
  voidReason: z.string().nullable(),
  voidedAt: z.number().nullable(),
  printedCount: z.number(),
  lastPrintedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lines: z.array(zInvoiceLine),
  payments: z.array(
    z.object({
      id: z.number(),
      receiptNo: z.string(),
      kind: z.enum(PAYMENT_KINDS),
      amountMicro: z.number(),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().nullable(),
      paidAt: z.number(),
      status: z.string(),
      receivedByName: z.string().nullable()
    })
  )
})

export const zInvoicePage = z.object({
  items: z.array(zInvoice),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  totals: z.object({ invoicedMicro: z.number(), paidMicro: z.number(), dueMicro: z.number(), refundedMicro: z.number() })
})

export const zInvoiceFilter = z.object({
  patientId: z.number().int().positive().optional(),
  visitId: z.number().int().positive().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  /** Only invoices with an outstanding balance. */
  hasDue: z.boolean().optional(),
  search: z.string().max(120).optional(),
  range: z.object({ preset: zRangePreset, from: zLocalDate.optional(), to: zLocalDate.optional() }).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0)
})

export const zPaymentInput = z.object({
  patientId: z.number().int().positive(),
  invoiceId: z.number().int().positive().nullish(),
  kind: z.enum(PAYMENT_KINDS).default('payment'),
  amountMicro: z.number().int().min(1).max(999_999_999_999),
  method: z.enum(PAYMENT_METHODS).default('cash'),
  reference: zOptionalText(120),
  paidAt: z.number().int().positive(),
  notes: zOptionalText(500)
})

export const zPayment = zPaymentInput.extend({
  id: z.number(),
  receiptNo: z.string(),
  patientCode: z.string(),
  patientName: z.string(),
  invoiceNo: z.string().nullable(),
  paidDate: zLocalDate,
  receivedByUserId: z.number().nullable(),
  receivedByName: z.string().nullable(),
  reversesPaymentId: z.number().nullable(),
  reversesReceiptNo: z.string().nullable(),
  status: z.string(),
  voidReason: z.string().nullable(),
  voidedAt: z.number().nullable(),
  createdAt: z.number()
})

export const zPaymentPage = z.object({
  items: z.array(zPayment),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  totals: z.object({ receivedMicro: z.number(), refundedMicro: z.number() })
})

export const zPaymentFilter = z.object({
  patientId: z.number().int().positive().optional(),
  invoiceId: z.number().int().positive().optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  kind: z.enum(PAYMENT_KINDS).optional(),
  search: z.string().max(120).optional(),
  range: z.object({ preset: zRangePreset, from: zLocalDate.optional(), to: zLocalDate.optional() }).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0)
})

/** Unbilled treatment lines of a visit, ready to become invoice lines. */
export const zBillableLine = z.object({
  visitTreatmentId: z.number(),
  treatmentId: z.number().nullable(),
  description: z.string(),
  toothCodes: z.array(z.string()),
  quantity: z.number(),
  unitPriceMicro: z.number(),
  discountMicro: z.number(),
  totalMicro: z.number(),
  billed: z.boolean()
})

/* -------------------------------------------------------------------------- */
/* Channel registry                                                           */
/* -------------------------------------------------------------------------- */

export const billingChannels = {
  'invoices.list': channel(zInvoiceFilter, zInvoicePage),
  'invoices.get': channel(z.object({ id: z.number().int().positive() }), zInvoice),
  'invoices.save': channel(zInvoiceInput, zInvoice),
  'invoices.void': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(5, 240, 'Reason') }), zInvoice),
  'invoices.delete': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 240, 'Reason') }), zActionResult),
  'invoices.billable': channel(z.object({ visitId: z.number().int().positive() }), z.array(zBillableLine)),
  'invoices.forVisit': channel(z.object({ visitId: z.number().int().positive() }), z.array(zInvoice)),
  'invoices.export': channel(zInvoiceFilter, z.object({ path: z.string().nullable(), rowCount: z.number().int() })),

  'payments.list': channel(zPaymentFilter, zPaymentPage),
  'payments.add': channel(zPaymentInput, zInvoice),
  'payments.void': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(5, 240, 'Reason') }), zInvoice),
  'payments.export': channel(zPaymentFilter, z.object({ path: z.string().nullable(), rowCount: z.number().int() })),

  /** Daily collection totals per payment day, used by the day-close and reports screens. */
  'reports.dailyCollections': channel(
    z.object({ from: zLocalDate, to: zLocalDate }),
    z.array(z.object({ date: zLocalDate, receivedMicro: z.number(), refundedMicro: z.number(), payments: z.number() }))
  )
} as const
