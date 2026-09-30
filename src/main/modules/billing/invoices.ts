import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch } from '@shared/bengali'
import { fromLocalDate, toLocalDate } from '@shared/datetime'
import { computeInvoiceTotals, invoiceStatusFor, lineTotal, percent, type Micro } from '@shared/money'
import { discountLimitFor } from '@shared/permissions'
import { nextCode } from '../../db/counters'
import type { zInvoiceFilter, zInvoiceInput, zInvoiceLineInput } from '@shared/contracts'
import { z } from 'zod'

export type InvoiceInput = z.infer<typeof zInvoiceInput>
export type InvoiceFilter = z.infer<typeof zInvoiceFilter>
export type InvoiceLineInput = z.infer<typeof zInvoiceLineInput>
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'

export interface InvoiceLineRecord {
  id: number
  treatmentId: number | null
  visitTreatmentId: number | null
  description: string
  toothCodes: string[]
  quantity: number
  unitPriceMicro: number
  discountMicro: number
  lineTotalMicro: number
  notes: string | null
  billed: boolean
}

export interface InvoicePaymentRecord {
  id: number
  receiptNo: string
  kind: 'payment' | 'refund'
  amountMicro: number
  method: string
  reference: string | null
  paidAt: number
  status: string
  receivedByName: string | null
}

export interface InvoiceRecord {
  id: number
  invoiceNo: string
  patientId: number
  patientCode: string
  patientName: string
  patientNameBn: string | null
  patientPhone: string | null
  visitId: number | null
  appointmentId: number | null
  issueAt: number
  issueDate: string
  dueDate: string | null
  status: InvoiceStatus
  subtotalMicro: number
  discountMicro: number
  discountBp: number
  totalMicro: number
  paidMicro: number
  dueMicro: number
  refundedMicro: number
  notes: string | null
  voidReason: string | null
  voidedAt: number | null
  printedCount: number
  lastPrintedAt: number | null
  createdAt: number
  updatedAt: number
  lines: InvoiceLineRecord[]
  payments: InvoicePaymentRecord[]
}

interface InvoiceRow {
  id: number
  invoice_no: string
  patient_id: number
  patient_code: string
  patient_name: string
  patient_name_bn: string | null
  patient_phone: string | null
  visit_id: number | null
  appointment_id: number | null
  issue_at: number
  issue_date: string
  due_date: string | null
  status: InvoiceStatus
  subtotal_micro: number
  discount_micro: number
  discount_bp: number
  total_micro: number
  paid_micro: number
  due_micro: number
  refunded_micro: number
  notes: string | null
  void_reason: string | null
  voided_at: number | null
  printed_count: number
  last_printed_at: number | null
  created_at: number
  updated_at: number
}

const SELECT_INVOICE = `
  SELECT i.*, p.code AS patient_code, p.full_name AS patient_name, p.full_name_bn AS patient_name_bn, p.phone AS patient_phone
    FROM invoices i JOIN patients p ON p.id = i.patient_id
`

function loadLines(ctx: ServiceContext, invoiceId: number): InvoiceLineRecord[] {
  const rows = ctx.db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY sort_order, id').all(invoiceId) as Array<{
    id: number
    treatment_id: number | null
    visit_treatment_id: number | null
    description: string
    tooth_codes: string | null
    quantity: number
    unit_price_micro: number
    discount_micro: number
    line_total_micro: number
    notes: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    treatmentId: row.treatment_id,
    visitTreatmentId: row.visit_treatment_id,
    description: row.description,
    toothCodes: row.tooth_codes ? (JSON.parse(row.tooth_codes) as string[]) : [],
    quantity: row.quantity,
    unitPriceMicro: row.unit_price_micro,
    discountMicro: row.discount_micro,
    lineTotalMicro: row.line_total_micro,
    notes: row.notes,
    billed: row.visit_treatment_id !== null
  }))
}

function loadPayments(ctx: ServiceContext, invoiceId: number): InvoicePaymentRecord[] {
  const rows = ctx.db
    .prepare(
      `SELECT pm.*, u.full_name AS received_by_name
         FROM payments pm LEFT JOIN users u ON u.id = pm.received_by_user_id
        WHERE pm.invoice_id = ? AND pm.status = 'active'
        ORDER BY pm.paid_at, pm.id`
    )
    .all(invoiceId) as Array<{
    id: number
    receipt_no: string
    kind: 'payment' | 'refund'
    amount_micro: number
    method: string
    reference: string | null
    paid_at: number
    status: string
    received_by_name: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    receiptNo: row.receipt_no,
    kind: row.kind,
    amountMicro: row.amount_micro,
    method: row.method,
    reference: row.reference,
    paidAt: row.paid_at,
    status: row.status,
    receivedByName: row.received_by_name
  }))
}

function mapInvoice(ctx: ServiceContext, row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    patientId: row.patient_id,
    patientCode: row.patient_code,
    patientName: row.patient_name,
    patientNameBn: row.patient_name_bn,
    patientPhone: row.patient_phone,
    visitId: row.visit_id,
    appointmentId: row.appointment_id,
    issueAt: row.issue_at,
    issueDate: row.issue_date,
    dueDate: row.due_date,
    status: row.status,
    subtotalMicro: row.subtotal_micro,
    discountMicro: row.discount_micro,
    discountBp: row.discount_bp,
    totalMicro: row.total_micro,
    paidMicro: row.paid_micro,
    dueMicro: row.due_micro,
    refundedMicro: row.refunded_micro,
    notes: row.notes,
    voidReason: row.void_reason,
    voidedAt: row.voided_at,
    printedCount: row.printed_count,
    lastPrintedAt: row.last_printed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lines: loadLines(ctx, row.id),
    payments: loadPayments(ctx, row.id)
  }
}

export function getInvoice(ctx: ServiceContext, id: number): InvoiceRecord {
  assertPermission(ctx, 'billing.view')
  const row = ctx.db.prepare(`${SELECT_INVOICE} WHERE i.id = ? AND i.is_deleted = 0`).get(id) as InvoiceRow | undefined
  if (!row) throw notFoundError('invoice', id)
  return mapInvoice(ctx, row)
}

/**
 * Recompute an invoice from its lines and active payments.
 *
 * Totals are never edited directly: they are always derived by the shared money module, so an invoice
 * shown in the interface, printed on paper and reported in accounting can never disagree.
 */
export function recalculateInvoice(ctx: ServiceContext, invoiceId: number): InvoiceRecord {
  const row = ctx.db.prepare('SELECT total_micro, paid_micro, refunded_micro, status FROM invoices WHERE id = ?').get(invoiceId) as
    | { total_micro: number, paid_micro: number, refunded_micro: number, status: InvoiceStatus }
    | undefined
  if (!row) throw notFoundError('invoice', invoiceId)

  const payments = ctx.db
    .prepare("SELECT kind, amount_micro FROM payments WHERE invoice_id = ? AND status = 'active'")
    .all(invoiceId) as Array<{ kind: 'payment' | 'refund', amount_micro: number }>
  const signed = payments.map((payment) => (payment.kind === 'refund' ? -payment.amount_micro : payment.amount_micro))
  const totals = computeInvoiceTotals({ lines: [], invoiceDiscount: 0, payments: signed })
  const status = invoiceStatusFor(row.total_micro, totals.paid - totals.refunded, row.status === 'void')

  ctx.db
    .prepare('UPDATE invoices SET paid_micro = ?, refunded_micro = ?, due_micro = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(totals.paid, totals.refunded, Math.max(0, row.total_micro - (totals.paid - totals.refunded)), status, ctx.now(), invoiceId)
  return getInvoice(ctx, invoiceId)
}

function writeLines(ctx: ServiceContext, invoiceId: number, lines: InvoiceLineInput[]): void {
  ctx.db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId)
  const insert = ctx.db.prepare(
    `INSERT INTO invoice_lines (invoice_id, sort_order, treatment_id, visit_treatment_id, description, tooth_codes, quantity, unit_price_micro, discount_micro, line_total_micro, notes)
     VALUES (@invoiceId, @sortOrder, @treatmentId, @visitTreatmentId, @description, @toothCodes, @quantity, @unitPriceMicro, @discountMicro, @lineTotalMicro, @notes)`
  )
  lines.forEach((line, index) => {
    insert.run({
      invoiceId,
      sortOrder: index,
      treatmentId: line.treatmentId ?? null,
      visitTreatmentId: line.visitTreatmentId ?? null,
      description: line.description,
      toothCodes: JSON.stringify(line.toothCodes ?? []),
      quantity: line.quantity,
      unitPriceMicro: line.unitPriceMicro,
      discountMicro: line.discountMicro,
      lineTotalMicro: lineTotal({ unitPrice: line.unitPriceMicro, quantity: line.quantity, discount: line.discountMicro }),
      notes: line.notes ?? null
    })
  })
}

function applyDiscountPolicy(ctx: ServiceContext, subtotal: Micro, discountBp: number, lineDiscounts: Micro): void {
  const limit = discountLimitFor(ctx.actor)
  if (limit === null) return
  const invoiceDiscount = percent(subtotal - lineDiscounts, discountBp)
  const totalDiscount = lineDiscounts + invoiceDiscount
  if (totalDiscount <= 0) return
  const allowed = percent(subtotal, limit)
  if (totalDiscount > allowed) {
    throw validationError(
      `This discount is above your role limit (${(limit / 100).toFixed(1)} % of the invoice). Ask an owner or manager to approve it.`,
      { discountBp: 'Above the discount limit for your role' }
    )
  }
}

function assertPatient(ctx: ServiceContext, patientId: number): void {
  const row = ctx.db.prepare('SELECT is_deleted, status FROM patients WHERE id = ?').get(patientId) as
    | { is_deleted: number, status: string }
    | undefined
  if (!row) throw notFoundError('patient', patientId)
  if (row.is_deleted === 1) throw stateError('That patient file is archived; financial history stays read-only.')
}

/** Refuse to bill the same visit treatment line twice. */
function assertVisitLinesFree(ctx: ServiceContext, invoiceId: number | null, lines: InvoiceLineInput[]): void {
  const ids = lines.map((line) => line.visitTreatmentId).filter((id): id is number => typeof id === 'number')
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(',')
  const rows = ctx.db
    .prepare(
      `SELECT il.visit_treatment_id AS id, i.invoice_no AS invoice_no
         FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
        WHERE il.visit_treatment_id IN (${placeholders}) AND i.is_deleted = 0 AND i.status <> 'void' AND i.id <> ?`
    )
    .all(...ids, invoiceId ?? -1) as Array<{ id: number, invoice_no: string }>
  if (rows.length > 0) {
    throw stateError(`Treatment line(s) are already on invoice ${rows[0]?.invoice_no}. Void that invoice first if it was a mistake.`)
  }
}

export function saveInvoice(ctx: ServiceContext, input: InvoiceInput): InvoiceRecord {
  assertPermission(ctx, input.id ? 'billing.edit' : 'billing.create')
  assertPatient(ctx, input.patientId)
  assertVisitLinesFree(ctx, input.id ?? null, input.lines)

  const lineAmounts = input.lines.map((line) => ({ unitPrice: line.unitPriceMicro, quantity: line.quantity, discount: line.discountMicro }))
  const provisional = computeInvoiceTotals({ lines: lineAmounts, invoiceDiscount: 0, payments: [] })
  applyDiscountPolicy(ctx, provisional.subtotal, input.discountBp, provisional.discountTotal)
  const invoiceDiscount = percent(provisional.subtotal - provisional.discountTotal, input.discountBp)
  const totals = computeInvoiceTotals({ lines: lineAmounts, invoiceDiscount, payments: [] })

  const now = ctx.now()
  const issueDate = toLocalDate(input.issueAt)

  if (input.id) {
    const existing = getInvoice(ctx, input.id)
    if (existing.status === 'void') throw stateError('A voided invoice cannot be edited. Raise a fresh invoice instead.')
    if (existing.payments.length > 0) {
      throw stateError('Payments have already been recorded against this invoice, so its lines can no longer be changed. Void the payments first.')
    }
    ctx.db.transaction(() => {
      writeLines(ctx, input.id as number, input.lines)
      ctx.db
        .prepare(
          `UPDATE invoices SET patient_id = @patientId, visit_id = @visitId, appointment_id = @appointmentId, issue_at = @issueAt, issue_date = @issueDate,
                  due_date = @dueDate, subtotal_micro = @subtotal, discount_micro = @discount, discount_bp = @discountBp, total_micro = @total,
                  due_micro = @total, notes = @notes, updated_at = @now, updated_by = @userId
            WHERE id = @id`
        )
        .run({
          id: input.id,
          patientId: input.patientId,
          visitId: input.visitId ?? null,
          appointmentId: input.appointmentId ?? null,
          issueAt: input.issueAt,
          issueDate,
          dueDate: input.dueDate ?? null,
          subtotal: totals.subtotal,
          discount: totals.discountTotal,
          discountBp: input.discountBp,
          total: totals.total,
          notes: input.notes ?? null,
          now,
          userId: ctx.actor.userId
        })
      ctx.audit.write({
        module: 'billing',
        action: 'invoice.update',
        entityType: 'invoice',
        entityId: input.id,
        summary: `Updated invoice ${existing.invoiceNo} (${totals.total} µ)`,
        detail: { lines: input.lines.length }
      })
    })()
    return getInvoice(ctx, input.id)
  }

  const id = ctx.db.transaction(() => {
    const invoiceNo = nextCode(ctx.db, 'invoice', input.issueAt, 'INV')
    const result = ctx.db
      .prepare(
        `INSERT INTO invoices (invoice_no, patient_id, visit_id, appointment_id, issue_at, issue_date, due_date, status, subtotal_micro, discount_micro, discount_bp,
                               total_micro, paid_micro, due_micro, refunded_micro, notes, created_by, created_at, updated_at)
         VALUES (@invoiceNo, @patientId, @visitId, @appointmentId, @issueAt, @issueDate, @dueDate, 'unpaid', @subtotal, @discount, @discountBp,
                 @total, 0, @total, 0, @notes, @userId, @now, @now)`
      )
      .run({
        invoiceNo,
        patientId: input.patientId,
        visitId: input.visitId ?? null,
        appointmentId: input.appointmentId ?? null,
        issueAt: input.issueAt,
        issueDate,
        dueDate: input.dueDate ?? null,
        subtotal: totals.subtotal,
        discount: totals.discountTotal,
        discountBp: input.discountBp,
        total: totals.total,
        notes: input.notes ?? null,
        userId: ctx.actor.userId,
        now
      })
    const inserted = Number(result.lastInsertRowid)
    writeLines(ctx, inserted, input.lines)
    ctx.audit.write({
      module: 'billing',
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: inserted,
      summary: `Raised invoice ${invoiceNo} for patient #${input.patientId}`,
      detail: { total: totals.total, lines: input.lines.length }
    })
    return inserted
  })()
  return getInvoice(ctx, id)
}

/**
 * Void an invoice.
 *
 * A voided invoice keeps its number, its lines and the reason, because financial history is never
 * rewritten. Money already received must be returned first (void the payments), so a void invoice never
 * hides an outstanding balance.
 */
export function voidInvoice(ctx: ServiceContext, input: { id: number, reason: string }): InvoiceRecord {
  assertPermission(ctx, 'billing.void')
  const existing = getInvoice(ctx, input.id)
  if (existing.status === 'void') return existing
  if (existing.payments.length > 0) {
    throw stateError('This invoice has payments recorded against it. Void those payments (which creates the refund entries) before voiding the invoice.')
  }
  ctx.db.transaction(() => {
    ctx.db
      .prepare("UPDATE invoices SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ?, updated_at = ? WHERE id = ?")
      .run(input.reason, ctx.now(), ctx.actor.userId, ctx.now(), input.id)
    ctx.audit.write({
      module: 'billing',
      action: 'invoice.void',
      entityType: 'invoice',
      entityId: input.id,
      summary: `Voided invoice ${existing.invoiceNo}`,
      detail: { reason: input.reason, total: existing.totalMicro }
    })
  })()
  return getInvoice(ctx, input.id)
}

/** Remove an invoice that should never have existed: unpaid, never paid, or already void. */
export function deleteInvoice(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'billing.void')
  const existing = getInvoice(ctx, input.id)
  if (existing.payments.length > 0) {
    throw stateError('This invoice has payments recorded against it and cannot be deleted. Void it instead so the record stays.')
  }
  if (existing.status !== 'void' && existing.status !== 'unpaid') {
    throw stateError('Only an unpaid or voided invoice can be deleted.')
  }
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE invoices SET is_deleted = 1, updated_at = ? WHERE id = ?').run(ctx.now(), input.id)
    ctx.audit.write({
      module: 'billing',
      action: 'invoice.delete',
      entityType: 'invoice',
      entityId: input.id,
      summary: `Deleted invoice ${existing.invoiceNo} (${existing.status})`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}

/** Treatment lines of a visit, flagged with whether they are already on a live invoice. */
export function billableLines(ctx: ServiceContext, visitId: number) {
  assertPermission(ctx, 'billing.view')
  const rows = ctx.db
    .prepare(
      `SELECT vt.id, vt.treatment_id, vt.treatment_name, vt.tooth_codes, vt.quantity, vt.unit_price_micro, vt.discount_micro, vt.total_micro,
              (SELECT COUNT(*) FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id
                WHERE il.visit_treatment_id = vt.id AND i.is_deleted = 0 AND i.status <> 'void') AS billed
         FROM visit_treatments vt
        WHERE vt.visit_id = ?
        ORDER BY vt.id`
    )
    .all(visitId) as Array<{
    id: number
    treatment_id: number | null
    treatment_name: string
    tooth_codes: string | null
    quantity: number
    unit_price_micro: number
    discount_micro: number
    total_micro: number
    billed: number
  }>
  return rows.map((row) => ({
    visitTreatmentId: row.id,
    treatmentId: row.treatment_id,
    description: row.treatment_name,
    toothCodes: row.tooth_codes ? (JSON.parse(row.tooth_codes) as string[]) : [],
    quantity: row.quantity,
    unitPriceMicro: row.unit_price_micro,
    discountMicro: row.discount_micro,
    totalMicro: row.total_micro,
    billed: row.billed > 0
  }))
}

export function invoicesForVisit(ctx: ServiceContext, visitId: number): InvoiceRecord[] {
  assertPermission(ctx, 'billing.view')
  const rows = ctx.db.prepare(`${SELECT_INVOICE} WHERE i.visit_id = ? AND i.is_deleted = 0 ORDER BY i.id DESC`).all(visitId) as InvoiceRow[]
  return rows.map((row) => mapInvoice(ctx, row))
}

export function listInvoices(ctx: ServiceContext, filter: InvoiceFilter): {
  items: InvoiceRecord[]
  total: number
  limit: number
  offset: number
  totals: { invoicedMicro: number, paidMicro: number, dueMicro: number, refundedMicro: number }
} {
  assertPermission(ctx, 'billing.view')
  const clauses: string[] = ['i.is_deleted = 0']
  const params: Record<string, unknown> = {}

  if (filter.patientId) {
    clauses.push('i.patient_id = @patientId')
    params.patientId = filter.patientId
  }
  if (filter.visitId) {
    clauses.push('i.visit_id = @visitId')
    params.visitId = filter.visitId
  }
  if (filter.status) {
    clauses.push('i.status = @status')
    params.status = filter.status
  }
  if (filter.hasDue) clauses.push("i.status IN ('unpaid','partial') AND i.due_micro > 0")
  if (filter.range) {
    const { preset, from, to } = filter.range
    if (preset === 'today') {
      clauses.push('i.issue_date = @rangeFrom')
      params.rangeFrom = toLocalDate(ctx.now())
    } else if (preset === 'custom' && (from || to)) {
      if (from) {
        clauses.push('i.issue_date >= @rangeFrom')
        params.rangeFrom = from
      }
      if (to) {
        clauses.push('i.issue_date <= @rangeTo')
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
        clauses.push('i.issue_date >= @rangeFrom AND i.issue_date <= @rangeTo')
        params.rangeFrom = bound[0]
        params.rangeTo = bound[1]
      }
    }
  }
  if (filter.search && filter.search.trim() !== '') {
    const term = `%${filter.search.trim()}%`
    const fold = `%${foldForSearch(filter.search)}%`
    clauses.push('(i.invoice_no LIKE @term OR p.full_name LIKE @term OR p.full_name_bn LIKE @term OR p.phone LIKE @term OR p.code LIKE @term OR p.full_name_fold LIKE @fold)')
    params.term = term
    params.fold = fold
  }

  const where = clauses.join(' AND ')
  const aggregate = ctx.db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.total_micro ELSE 0 END), 0) AS invoiced,
              COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.paid_micro ELSE 0 END), 0) AS paid,
              COALESCE(SUM(CASE WHEN i.status <> 'void' THEN i.due_micro ELSE 0 END), 0) AS due,
              COALESCE(SUM(i.refunded_micro), 0) AS refunded
         FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${where}`
    )
    .get(params) as { count: number, invoiced: number, paid: number, due: number, refunded: number }

  const rows = ctx.db.prepare(`${SELECT_INVOICE} WHERE ${where} ORDER BY i.issue_at DESC, i.id DESC LIMIT @limit OFFSET @offset`).all({
    ...params,
    limit: filter.limit,
    offset: filter.offset
  }) as InvoiceRow[]

  return {
    items: rows.map((row) => mapInvoice(ctx, row)),
    total: aggregate.count,
    limit: filter.limit,
    offset: filter.offset,
    totals: { invoicedMicro: aggregate.invoiced, paidMicro: aggregate.paid, dueMicro: aggregate.due, refundedMicro: aggregate.refunded }
  }
}

/** Amount of money received today, used by the dashboard and the day-close report. */
export function cashCollectedMicro(ctx: ServiceContext, from: string, to: string, method?: string): number {
  const params: Record<string, unknown> = { from: fromLocalDate(from), to: fromLocalDate(to) + 86_400_000 - 1 }
  const methodClause = method ? 'AND pm.method = @method' : ''
  if (method) params.method = method
  const row = ctx.db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN pm.kind = 'refund' THEN -pm.amount_micro ELSE pm.amount_micro END), 0) AS total
         FROM payments pm
        WHERE pm.status = 'active' AND pm.paid_at >= @from AND pm.paid_at <= @to ${methodClause}`
    )
    .get(params) as { total: number }
  return row.total
}

