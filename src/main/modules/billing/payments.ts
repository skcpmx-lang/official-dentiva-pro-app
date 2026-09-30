import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch } from '@shared/bengali'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import { nextCode } from '../../db/counters'
import { getInvoice, recalculateInvoice, type InvoiceRecord } from './invoices'
import type { zPaymentFilter, zPaymentInput } from '@shared/contracts'
import { z } from 'zod'

export type PaymentInput = z.infer<typeof zPaymentInput>
export type PaymentFilter = z.infer<typeof zPaymentFilter>
export type PaymentKind = 'payment' | 'refund'

export interface PaymentRecord {
  id: number
  receiptNo: string
  patientId: number
  patientCode: string
  patientName: string
  invoiceId: number | null
  invoiceNo: string | null
  kind: PaymentKind
  amountMicro: number
  method: string
  reference: string | null
  paidAt: number
  paidDate: string
  receivedByUserId: number | null
  receivedByName: string | null
  reversesPaymentId: number | null
  reversesReceiptNo: string | null
  status: string
  voidReason: string | null
  voidedAt: number | null
  notes: string | null
  createdAt: number
}

interface PaymentRow {
  id: number
  receipt_no: string
  patient_id: number
  patient_code: string
  patient_name: string
  invoice_id: number | null
  invoice_no: string | null
  kind: PaymentKind
  amount_micro: number
  method: string
  reference: string | null
  paid_at: number
  paid_date: string
  received_by_user_id: number | null
  received_by_name: string | null
  reverses_payment_id: number | null
  reverses_receipt_no: string | null
  status: string
  void_reason: string | null
  voided_at: number | null
  notes: string | null
  created_at: number
}

const SELECT_PAYMENT = `
  SELECT pm.*, p.code AS patient_code, p.full_name AS patient_name, i.invoice_no AS invoice_no,
         u.full_name AS received_by_name, r.receipt_no AS reverses_receipt_no
    FROM payments pm
    JOIN patients p ON p.id = pm.patient_id
    LEFT JOIN invoices i ON i.id = pm.invoice_id
    LEFT JOIN users u ON u.id = pm.received_by_user_id
    LEFT JOIN payments r ON r.id = pm.reverses_payment_id
`

function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    patientId: row.patient_id,
    patientCode: row.patient_code,
    patientName: row.patient_name,
    invoiceId: row.invoice_id,
    invoiceNo: row.invoice_no,
    kind: row.kind,
    amountMicro: row.amount_micro,
    method: row.method,
    reference: row.reference,
    paidAt: row.paid_at,
    paidDate: row.paid_date,
    receivedByUserId: row.received_by_user_id,
    receivedByName: row.received_by_name,
    reversesPaymentId: row.reverses_payment_id,
    reversesReceiptNo: row.reverses_receipt_no,
    status: row.status,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    notes: row.notes,
    createdAt: row.created_at
  }
}

function loadPayment(ctx: ServiceContext, id: number): PaymentRecord {
  const row = ctx.db.prepare(`${SELECT_PAYMENT} WHERE pm.id = ?`).get(id) as PaymentRow | undefined
  if (!row) throw notFoundError('payment', id)
  return mapPayment(row)
}

export function listPayments(ctx: ServiceContext, filter: PaymentFilter): {
  items: PaymentRecord[]
  total: number
  limit: number
  offset: number
  totals: { receivedMicro: number, refundedMicro: number }
} {
  assertPermission(ctx, 'payments.view')
  const clauses: string[] = []
  const params: Record<string, unknown> = {}

  if (filter.patientId) {
    clauses.push('pm.patient_id = @patientId')
    params.patientId = filter.patientId
  }
  if (filter.invoiceId) {
    clauses.push('pm.invoice_id = @invoiceId')
    params.invoiceId = filter.invoiceId
  }
  if (filter.method) {
    clauses.push('pm.method = @method')
    params.method = filter.method
  }
  if (filter.kind) {
    clauses.push('pm.kind = @kind')
    params.kind = filter.kind
  }
  if (filter.range) {
    const { preset, from, to } = filter.range
    if (preset === 'today') {
      clauses.push('pm.paid_date = @rangeFrom')
      params.rangeFrom = toLocalDate(ctx.now())
    } else if (preset === 'custom' && (from || to)) {
      if (from) {
        clauses.push('pm.paid_date >= @rangeFrom')
        params.rangeFrom = from
      }
      if (to) {
        clauses.push('pm.paid_date <= @rangeTo')
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
        clauses.push('pm.paid_date >= @rangeFrom AND pm.paid_date <= @rangeTo')
        params.rangeFrom = bound[0]
        params.rangeTo = bound[1]
      }
    }
  }
  if (filter.search && filter.search.trim() !== '') {
    const term = `%${filter.search.trim()}%`
    const fold = `%${foldForSearch(filter.search)}%`
    clauses.push('(pm.receipt_no LIKE @term OR p.full_name LIKE @term OR p.full_name_bn LIKE @term OR p.code LIKE @term OR i.invoice_no LIKE @term OR p.full_name_fold LIKE @fold)')
    params.term = term
    params.fold = fold
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const aggregate = ctx.db
    .prepare(
      `SELECT COUNT(*) AS count,
              COALESCE(SUM(CASE WHEN pm.kind = 'payment' AND pm.status = 'active' THEN pm.amount_micro ELSE 0 END), 0) AS received,
              COALESCE(SUM(CASE WHEN pm.kind = 'refund' AND pm.status = 'active' THEN pm.amount_micro ELSE 0 END), 0) AS refunded
         FROM payments pm
         JOIN patients p ON p.id = pm.patient_id
         LEFT JOIN invoices i ON i.id = pm.invoice_id
         ${where}`
    )
    .get(params) as { count: number, received: number, refunded: number }

  const rows = ctx.db
    .prepare(`${SELECT_PAYMENT} ${where} ORDER BY pm.paid_at DESC, pm.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: filter.limit, offset: filter.offset }) as PaymentRow[]

  return {
    items: rows.map(mapPayment),
    total: aggregate.count,
    limit: filter.limit,
    offset: filter.offset,
    totals: { receivedMicro: aggregate.received, refundedMicro: aggregate.refunded }
  }
}

/**
 * Record money received or returned.
 *
 * Payments are append-only: correcting a mistake voids the entry (which writes a linked reversal row) so
 * the day book always explains itself. Overpayment is refused because the amount due is known exactly;
 * a refund cannot exceed what that invoice actually collected.
 */
export function addPayment(ctx: ServiceContext, input: PaymentInput): InvoiceRecord {
  assertPermission(ctx, 'payments.create')
  const isRefund = input.kind === 'refund'
  if (isRefund) assertPermission(ctx, 'payments.refund')

  const patient = ctx.db.prepare('SELECT id, is_deleted FROM patients WHERE id = ?').get(input.patientId) as { id: number, is_deleted: number } | undefined
  if (!patient) throw notFoundError('patient', input.patientId)
  if (patient.is_deleted === 1) throw stateError('That patient file is archived; financial history stays read-only.')

  if (!input.invoiceId) {
    throw validationError('Choose the invoice this money belongs to.', { invoiceId: 'An invoice is required' })
  }
  const invoice = getInvoice(ctx, input.invoiceId)
  if (invoice.status === 'void') throw stateError(`${invoice.invoiceNo} is void, so no money can be recorded against it.`)
  if (invoice.patientId !== input.patientId) throw validationError('That invoice belongs to a different patient.', { invoiceId: 'Patient mismatch' })

  if (!isRefund && input.amountMicro > invoice.dueMicro) {
    throw validationError(
      `That is more than the outstanding balance (${invoice.dueMicro} µ). Record the exact amount, or refund the difference.`,
      { amountMicro: 'Above the amount due' }
    )
  }
  if (isRefund && input.amountMicro > invoice.paidMicro - invoice.refundedMicro) {
    throw validationError('A refund cannot be larger than the money this invoice has actually collected.', { amountMicro: 'Above the refundable amount' })
  }

  ctx.db.transaction(() => {
    const receiptNo = nextCode(ctx.db, 'receipt', input.paidAt)
    ctx.db
      .prepare(
        `INSERT INTO payments (receipt_no, patient_id, invoice_id, kind, amount_micro, method, reference, paid_at, paid_date, received_by_user_id, notes, status, created_at, updated_at)
         VALUES (@receiptNo, @patientId, @invoiceId, @kind, @amountMicro, @method, @reference, @paidAt, @paidDate, @userId, @notes, 'active', @now, @now)`
      )
      .run({
        receiptNo,
        patientId: input.patientId,
        invoiceId: input.invoiceId,
        kind: input.kind,
        amountMicro: input.amountMicro,
        method: input.method,
        reference: input.reference ?? null,
        paidAt: input.paidAt,
        paidDate: toLocalDate(input.paidAt),
        userId: ctx.actor.userId,
        notes: input.notes ?? null,
        now: ctx.now()
      })
    ctx.audit.write({
      module: 'billing',
      action: isRefund ? 'payment.refund' : 'payment.add',
      entityType: 'payment',
      entityId: input.invoiceId,
      summary: `${isRefund ? 'Refunded' : 'Received'} ${input.amountMicro} µ (${input.method}) against ${invoice.invoiceNo}`,
      detail: { receiptNo }
    })
  })()

  return recalculateInvoice(ctx, input.invoiceId)
}

/**
 * Void a payment.
 *
 * The original row is kept with its reason, and a linked reversal is written, so the receipt history
 * stays complete and the invoice balance is recomputed from the surviving entries.
 */
export function voidPayment(ctx: ServiceContext, input: { id: number, reason: string }): InvoiceRecord {
  assertPermission(ctx, 'payments.void')
  const payment = loadPayment(ctx, input.id)
  if (payment.status === 'void') {
    if (!payment.invoiceId) throw stateError('That payment has no invoice to recompute.')
    return getInvoice(ctx, payment.invoiceId)
  }
  if (!payment.invoiceId) throw stateError('That payment is not linked to an invoice, so it cannot be voided here.')

  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE payments SET status = ?, void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?').run(
      'void',
      input.reason,
      now,
      ctx.actor.userId,
      now,
      input.id
    )
    /*
     * The reversal documents the correction (who voided what, when) but is not money movement, so it is
     * stored with status `reversal` and excluded from the invoice totals. Only real receipts and refunds
     * (status `active`) move money.
     */
    const reversalNo = nextCode(ctx.db, 'receipt', now)
    ctx.db
      .prepare(
        `INSERT INTO payments (receipt_no, patient_id, invoice_id, kind, amount_micro, method, reference, paid_at, paid_date, received_by_user_id, notes, reverses_payment_id, status, created_at, updated_at)
         VALUES (@receiptNo, @patientId, @invoiceId, @kind, @amountMicro, @method, @reference, @paidAt, @paidDate, @userId, @notes, @reverses, 'reversal', @now, @now)`
      )
      .run({
        receiptNo: reversalNo,
        patientId: payment.patientId,
        invoiceId: payment.invoiceId,
        kind: payment.kind,
        amountMicro: payment.amountMicro,
        method: payment.method,
        reference: payment.receiptNo,
        paidAt: now,
        paidDate: toLocalDate(now),
        userId: ctx.actor.userId,
        notes: `Reversal of ${payment.receiptNo}`,
        reverses: payment.id,
        now
      })
    ctx.audit.write({
      module: 'billing',
      action: 'payment.void',
      entityType: 'payment',
      entityId: payment.id,
      summary: `Voided receipt ${payment.receiptNo} (reversal ${reversalNo})`,
      detail: { reason: input.reason }
    })
  })()

  return recalculateInvoice(ctx, payment.invoiceId)
}

/** Money received per day inside a range, for the day-close and reports screens. */
export function dailyCollections(ctx: ServiceContext, from: string, to: string): Array<{ date: string, receivedMicro: number, refundedMicro: number, payments: number }> {
  assertPermission(ctx, 'payments.view')
  const rows = ctx.db
    .prepare(
      `SELECT paid_date AS date,
              COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount_micro ELSE 0 END), 0) AS received,
              COALESCE(SUM(CASE WHEN kind = 'refund' THEN amount_micro ELSE 0 END), 0) AS refunded,
              COUNT(*) AS payments
         FROM payments
        WHERE status = 'active' AND paid_date >= ? AND paid_date <= ?
        GROUP BY paid_date
        ORDER BY paid_date`
    )
    .all(from, to) as Array<{ date: string, received: number, refunded: number, payments: number }>
  return rows.map((row) => ({ date: row.date, receivedMicro: row.received, refundedMicro: row.refunded, payments: row.payments }))
}

/** Totals for one invoice, exposed so the invoice screen and tests share one computation. */
export function invoiceBalance(ctx: ServiceContext, invoiceId: number): { paidMicro: number, refundedMicro: number, dueMicro: number } {
  const invoice = getInvoice(ctx, invoiceId)
  return { paidMicro: invoice.paidMicro, refundedMicro: invoice.refundedMicro, dueMicro: invoice.dueMicro }
}
