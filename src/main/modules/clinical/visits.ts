import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch, normalizeBengali } from '@shared/bengali'
import { rangeFromDates, resolveRange, toLocalDate, type ResolvedRange } from '@shared/datetime'
import { parseToothList } from '@shared/dental'
import { nextCode } from '../../db/counters'
import { getChartForVisit, type ChartEntryRecord } from './chart'
import type { zVisitInput, zVisitTreatmentInput } from '@shared/contracts'
import { z } from 'zod'

export type VisitInput = z.infer<typeof zVisitInput>
export type VisitTreatmentInput = z.infer<typeof zVisitTreatmentInput>

export type VisitStatus = 'draft' | 'final' | 'cancelled'
export type VisitTreatmentStatus = 'planned' | 'in_progress' | 'completed' | 'deferred' | 'cancelled'

export interface VisitTreatmentRecord {
  id: number
  treatmentId: number | null
  treatmentName: string
  toothCodes: string[]
  quantity: number
  unitPriceMicro: number
  discountMicro: number
  totalMicro: number
  status: VisitTreatmentStatus
  notes: string | null
}

export interface VisitFindingRecord {
  id: number
  findingId: number | null
  findingCode: string
  findingName: string
  toothCode: string | null
  severity: string | null
  notes: string | null
}

export interface VisitSummaryRecord {
  id: number
  visitNo: string
  patientId: number
  patientCode: string
  patientName: string
  patientNameBn: string | null
  patientAgeYears: number | null
  patientGender: string
  patientPhone: string | null
  dentistId: number
  dentistName: string
  dentistDesignations: string[]
  visitAt: number
  status: VisitStatus
  chiefComplaint: string | null
  history: string | null
  examination: string | null
  diagnosis: string | null
  findingsSummary: string | null
  advice: string | null
  treatmentPlan: string | null
  nextAppointmentAt: number | null
  notes: string | null
  createdAt: number
  updatedAt: number
  treatments: VisitTreatmentRecord[]
  findings: VisitFindingRecord[]
  chart: ChartEntryRecord[]
  totals: { subtotalMicro: number, discountMicro: number, totalMicro: number, treatmentCount: number }
  invoices: Array<{ id: number, invoiceNo: string, totalMicro: number, paidMicro: number, dueMicro: number, status: string }>
  prescriptions: Array<{ id: number, rxNo: string, prescriptionAt: number }>
}

interface VisitRow {
  id: number
  visit_no: string
  patient_id: number
  dentist_id: number
  appointment_id: number | null
  visit_at: number
  visit_date: string
  chief_complaint: string | null
  history: string | null
  examination: string | null
  diagnosis: string | null
  findings_summary: string | null
  advice: string | null
  treatment_plan: string | null
  next_appointment_at: number | null
  notes: string | null
  status: string
  created_by: number | null
  created_at: number
  updated_at: number
}

function patientHeader(ctx: ServiceContext, patientId: number): {
  code: string
  name: string
  nameBn: string | null
  ageYears: number | null
  gender: string
  phone: string | null
} {
  const row = ctx.db
    .prepare('SELECT code, full_name, full_name_bn, dob, age_years, gender, phone, status, is_deleted FROM patients WHERE id = ?')
    .get(patientId) as
    | {
        code: string
        full_name: string
        full_name_bn: string | null
        dob: string | null
        age_years: number | null
        gender: string
        phone: string | null
        status: string
        is_deleted: number
      }
    | undefined
  if (!row) throw notFoundError('patient', patientId)
  // Archiving is a soft delete: `is_deleted = 1` while the row (and its history) stays in place.
  if (row.is_deleted === 1 || row.status !== 'active') {
    throw stateError('This patient record is archived. Restore it before recording new clinical work.')
  }
  const ageYears = row.dob ? ageFromDob(row.dob, ctx.now()) : row.age_years
  return { code: row.code, name: row.full_name, nameBn: row.full_name_bn, ageYears, gender: row.gender, phone: row.phone }
}

function ageFromDob(dob: string, atMs: number): number | null {
  const [year, month, day] = dob.split('-').map((part) => Number.parseInt(part, 10))
  if (!year || !month || !day) return null
  const at = new Date(atMs)
  let age = at.getFullYear() - year
  const beforeBirthday = at.getMonth() + 1 < month || (at.getMonth() + 1 === month && at.getDate() < day)
  if (beforeBirthday) age -= 1
  return age >= 0 && age <= 130 ? age : null
}

function dentistHeader(ctx: ServiceContext, dentistId: number): { name: string, designations: string[] } {
  const row = ctx.db.prepare('SELECT full_name FROM dentists WHERE id = ? AND is_deleted = 0').get(dentistId) as
    | { full_name: string }
    | undefined
  if (!row) throw notFoundError('dentist', dentistId)
  const designations = (
    ctx.db.prepare('SELECT title FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order, id').all(dentistId) as Array<{ title: string }>
  ).map((entry) => entry.title)
  return { name: row.full_name, designations }
}

function mapTreatments(ctx: ServiceContext, visitId: number): VisitTreatmentRecord[] {
  const rows = ctx.db
    .prepare('SELECT * FROM visit_treatments WHERE visit_id = ? ORDER BY id')
    .all(visitId) as Array<{
    id: number
    treatment_id: number | null
    treatment_name: string
    tooth_codes: string | null
    quantity: number
    unit_price_micro: number
    discount_micro: number
    total_micro: number
    status: string
    notes: string | null
  }>
  return rows.map((row) => ({
    id: row.id,
    treatmentId: row.treatment_id,
    treatmentName: row.treatment_name,
    toothCodes: parseToothList(row.tooth_codes ?? ''),
    quantity: row.quantity,
    unitPriceMicro: row.unit_price_micro,
    discountMicro: row.discount_micro,
    totalMicro: row.total_micro,
    status: row.status as VisitTreatmentStatus,
    notes: row.notes
  }))
}

function mapFindings(ctx: ServiceContext, visitId: number): VisitFindingRecord[] {
  const rows = ctx.db
    .prepare(
      `SELECT vf.id, vf.finding_id, vf.finding_code, vf.tooth_code, vf.severity, vf.notes,
              COALESCE(cf.name, vf.finding_code) AS finding_name
       FROM visit_findings vf
       LEFT JOIN clinical_findings cf ON cf.id = vf.finding_id
       WHERE vf.visit_id = ? ORDER BY vf.id`
    )
    .all(visitId) as Array<{
    id: number
    finding_id: number | null
    finding_code: string
    tooth_code: string | null
    severity: string | null
    notes: string | null
    finding_name: string
  }>
  return rows.map((row) => ({
    id: row.id,
    findingId: row.finding_id,
    findingCode: row.finding_code,
    findingName: row.finding_name,
    toothCode: row.tooth_code,
    severity: row.severity,
    notes: row.notes
  }))
}

export function getVisitRow(ctx: ServiceContext, id: number): VisitRow {
  const row = ctx.db.prepare('SELECT * FROM visits WHERE id = ? AND is_deleted = 0').get(id) as VisitRow | undefined
  if (!row) throw notFoundError('visit', id)
  return row
}

export function getVisitSummary(ctx: ServiceContext, id: number): VisitSummaryRecord {
  assertPermission(ctx, 'clinical.view')
  const row = getVisitRow(ctx, id)
  const patient = patientHeaderForRead(ctx, row.patient_id)
  const dentist = dentistHeader(ctx, row.dentist_id)
  const treatments = mapTreatments(ctx, id)
  const findings = mapFindings(ctx, id)
  const subtotalMicro = treatments.reduce((sum, entry) => sum + Math.round(entry.quantity * entry.unitPriceMicro) - entry.discountMicro, 0)
  const discountMicro = treatments.reduce((sum, entry) => sum + entry.discountMicro, 0)
  const invoices = ctx.db
    .prepare(
      `SELECT id, invoice_no, total_micro, paid_micro, due_micro, status FROM invoices
       WHERE visit_id = ? AND is_deleted = 0 ORDER BY id`
    )
    .all(id) as Array<{ id: number, invoice_no: string, total_micro: number, paid_micro: number, due_micro: number, status: string }>
  const prescriptions = ctx.db
    .prepare('SELECT id, rx_no, prescription_at FROM prescriptions WHERE visit_id = ? AND is_deleted = 0 ORDER BY id')
    .all(id) as Array<{ id: number, rx_no: string, prescription_at: number }>

  return {
    id: row.id,
    visitNo: row.visit_no,
    patientId: row.patient_id,
    patientCode: patient.code,
    patientName: patient.name,
    patientNameBn: patient.nameBn,
    patientAgeYears: patient.ageYears,
    patientGender: patient.gender,
    patientPhone: patient.phone,
    dentistId: row.dentist_id,
    dentistName: dentist.name,
    dentistDesignations: dentist.designations,
    visitAt: row.visit_at,
    status: row.status as VisitStatus,
    chiefComplaint: row.chief_complaint,
    history: row.history,
    examination: row.examination,
    diagnosis: row.diagnosis,
    findingsSummary: row.findings_summary,
    advice: row.advice,
    treatmentPlan: row.treatment_plan,
    nextAppointmentAt: row.next_appointment_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    treatments,
    findings,
    chart: getChartForVisit(ctx, id),
    totals: {
      subtotalMicro,
      discountMicro,
      totalMicro: subtotalMicro,
      treatmentCount: treatments.length
    },
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      invoiceNo: invoice.invoice_no,
      totalMicro: invoice.total_micro,
      paidMicro: invoice.paid_micro,
      dueMicro: invoice.due_micro,
      status: invoice.status
    })),
    prescriptions: prescriptions.map((prescription) => ({ id: prescription.id, rxNo: prescription.rx_no, prescriptionAt: prescription.prescription_at }))
  }
}

/** Read-only header lookup (does not complain about archived patients, unlike the write path). */
function patientHeaderForRead(ctx: ServiceContext, patientId: number): {
  code: string
  name: string
  nameBn: string | null
  ageYears: number | null
  gender: string
  phone: string | null
} {
  const row = ctx.db
    .prepare('SELECT code, full_name, full_name_bn, dob, age_years, gender, phone FROM patients WHERE id = ?')
    .get(patientId) as
    | { code: string, full_name: string, full_name_bn: string | null, dob: string | null, age_years: number | null, gender: string, phone: string | null }
    | undefined
  if (!row) throw notFoundError('patient', patientId)
  return {
    code: row.code,
    name: row.full_name,
    nameBn: row.full_name_bn,
    ageYears: row.dob ? ageFromDob(row.dob, ctx.now()) : row.age_years,
    gender: row.gender,
    phone: row.phone
  }
}

/** The dentist record linked to a user account, if any (used by “my visits” filters). */
function dentistIdForUser(ctx: ServiceContext, userId: number): number | null {
  const row = ctx.db.prepare('SELECT dentist_id FROM users WHERE id = ?').get(userId) as { dentist_id: number | null } | undefined
  return row?.dentist_id ?? null
}

export function listVisits(
  ctx: ServiceContext,
  filter: {
    patientId?: number
    dentistId?: number
    search?: string
    status?: VisitStatus
    range?: { preset: string, from?: string | null, to?: string | null }
    mine?: boolean
    limit?: number
    offset?: number
  }
): { items: VisitSummaryRecord[], total: number, limit: number, offset: number } {
  assertPermission(ctx, 'clinical.view')
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const customRange = filter.range?.from && filter.range?.to ? rangeFromDates(filter.range.from, filter.range.to) : undefined
  const range = resolveRange((filter.range?.preset ?? 'all') as ResolvedRange['preset'], ctx.now(), customRange)

  const clauses = ['v.is_deleted = 0']
  const params: Record<string, unknown> = { limit, offset, rangeFrom: range.from, rangeTo: range.to }
  clauses.push('v.visit_at BETWEEN @rangeFrom AND @rangeTo')
  if (filter.patientId) {
    clauses.push('v.patient_id = @patientId')
    params.patientId = filter.patientId
  }
  if (filter.dentistId) {
    clauses.push('v.dentist_id = @dentistId')
    params.dentistId = filter.dentistId
  }
  if (filter.mine) {
    clauses.push('v.dentist_id = @mineDentistId')
    params.mineDentistId = dentistIdForUser(ctx, ctx.actor.userId) ?? -1
  }
  if (filter.status) {
    clauses.push('v.status = @status')
    params.status = filter.status
  }
  if (filter.search && filter.search.trim().length > 0) {
    const term = `%${filter.search.trim()}%`
    const fold = `%${foldForSearch(filter.search.trim())}%`
    // Bangla names are matched literally (they are stored as typed); Latin names use the search fold.
    clauses.push(
      `(v.visit_no LIKE @term OR p.code LIKE @term OR p.full_name_fold LIKE @fold OR p.full_name LIKE @term
        OR COALESCE(p.full_name_bn, '') LIKE @term OR p.phone LIKE @term
        OR v.diagnosis LIKE @term OR COALESCE(v.chief_complaint, '') LIKE @term)`
    )
    params.term = term
    params.fold = fold
  }

  const where = clauses.join(' AND ')
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM visits v JOIN patients p ON p.id = v.patient_id WHERE ${where}`).get(params) as { count: number }).count
  const ids = ctx.db
    .prepare(`SELECT v.id FROM visits v JOIN patients p ON p.id = v.patient_id WHERE ${where} ORDER BY v.visit_at DESC, v.id DESC LIMIT @limit OFFSET @offset`)
    .all(params) as Array<{ id: number }>
  return { items: ids.map((row) => getVisitSummary(ctx, row.id)), total, limit, offset }
}

export function saveVisit(ctx: ServiceContext, input: VisitInput): VisitSummaryRecord {
  const creating = !input.id
  assertPermission(ctx, creating ? 'clinical.create' : 'clinical.edit')
  const errors: Record<string, string> = {}
  if (input.visitAt > ctx.now() + 86_400_000) errors.visitAt = 'A visit cannot be recorded more than a day in the future.'
  if (input.nextAppointmentAt && input.nextAppointmentAt <= input.visitAt) errors.nextAppointmentAt = 'The follow-up date must be after the visit date.'
  if (Object.keys(errors).length > 0) throw new AppError('E_VALIDATION', 'Please correct the highlighted visit details.', { fieldErrors: errors })

  const now = ctx.now()
  return ctx.db.transaction(() => {
    patientHeader(ctx, input.patientId)
    dentistHeader(ctx, input.dentistId)

    const text = {
      chiefComplaint: input.chiefComplaint ?? null,
      history: input.history ?? null,
      examination: input.examination ?? null,
      diagnosis: input.diagnosis ?? null,
      findingsSummary: input.findingsSummary ?? null,
      advice: input.advice ?? null,
      treatmentPlan: input.treatmentPlan ?? null,
      notes: input.notes ?? null
    }

    if (creating) {
      const visitNo = nextCode(ctx.db, 'visit', input.visitAt)
      const result = ctx.db
        .prepare(
          `INSERT INTO visits (visit_no, patient_id, dentist_id, appointment_id, visit_at, visit_date, chief_complaint, history,
             examination, diagnosis, findings_summary, advice, treatment_plan, next_appointment_at, notes, status, created_by, created_at, updated_at)
           VALUES (@visitNo, @patientId, @dentistId, @appointmentId, @visitAt, @visitDate, @chiefComplaint, @history,
             @examination, @diagnosis, @findingsSummary, @advice, @treatmentPlan, @nextAppointmentAt, @notes, @status, @createdBy, @now, @now)`
        )
        .run({
          visitNo,
          patientId: input.patientId,
          dentistId: input.dentistId,
          appointmentId: input.appointmentId ?? null,
          visitAt: input.visitAt,
          visitDate: toLocalDate(input.visitAt),
          ...text,
          nextAppointmentAt: input.nextAppointmentAt ?? null,
          status: input.status,
          createdBy: ctx.actor.userId,
          now
        })
      const id = Number(result.lastInsertRowid)
      if (input.appointmentId) {
        ctx.db.prepare('UPDATE appointments SET visit_id = ?, status = ?, updated_at = ? WHERE id = ?').run(id, 'completed', now, input.appointmentId)
      }
      ctx.audit.write({
        module: 'clinical',
        action: 'visit.create',
        entityType: 'visit',
        entityId: id,
        summary: `Recorded visit ${visitNo} for patient #${input.patientId}`,
        detail: { dentistId: input.dentistId, status: input.status }
      })
      return getVisitSummary(ctx, id)
    }

    const existing = getVisitRow(ctx, input.id as number)
    if (existing.status === 'cancelled') throw stateError('A cancelled visit cannot be edited. Create a new visit instead.')
    ctx.db
      .prepare(
        `UPDATE visits SET dentist_id = @dentistId, visit_at = @visitAt, visit_date = @visitDate, chief_complaint = @chiefComplaint,
           history = @history, examination = @examination, diagnosis = @diagnosis, findings_summary = @findingsSummary,
           advice = @advice, treatment_plan = @treatmentPlan, next_appointment_at = @nextAppointmentAt, notes = @notes,
           status = @status, updated_at = @now, updated_by = @updatedBy WHERE id = @id`
      )
      .run({
        id: input.id,
        dentistId: input.dentistId,
        visitAt: input.visitAt,
        visitDate: toLocalDate(input.visitAt),
        ...text,
        nextAppointmentAt: input.nextAppointmentAt ?? null,
        status: input.status,
        updatedBy: ctx.actor.userId,
        now
      })
    ctx.audit.write({
      module: 'clinical',
      action: 'visit.update',
      entityType: 'visit',
      entityId: input.id,
      summary: `Updated visit ${existing.visit_no}`,
      detail: { status: input.status }
    })
    return getVisitSummary(ctx, input.id as number)
  })()
}

export function setVisitStatus(ctx: ServiceContext, input: { id: number, status: VisitStatus, reason?: string | null }): VisitSummaryRecord {
  assertPermission(ctx, 'clinical.edit')
  const row = getVisitRow(ctx, input.id)
  if (input.status === 'cancelled' && (!input.reason || input.reason.trim().length < 3)) {
    throw validationError('A reason is required to cancel a visit.', { reason: 'Enter the reason for cancelling.' })
  }
  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE visits SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(input.status, now, ctx.actor.userId, input.id)
    ctx.audit.write({
      module: 'clinical',
      action: 'visit.status',
      entityType: 'visit',
      entityId: input.id,
      summary: `Visit ${row.visit_no} marked ${input.status}`,
      detail: { from: row.status, to: input.status, reason: input.reason ?? null }
    })
  })()
  return getVisitSummary(ctx, input.id)
}

export function deleteVisit(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'clinical.delete')
  const row = getVisitRow(ctx, input.id)
  const invoiceCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM invoices WHERE visit_id = ? AND is_deleted = 0').get(input.id) as { count: number }).count
  if (invoiceCount > 0) {
    throw stateError('This visit has invoices. Void the invoices first — clinical and financial history must stay consistent.')
  }
  const prescriptionCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM prescriptions WHERE visit_id = ? AND is_deleted = 0').get(input.id) as { count: number }).count
  if (prescriptionCount > 0) throw stateError('This visit has prescriptions. Cancel them before deleting the visit.')
  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE visits SET is_deleted = 1, status = ?, updated_at = ?, updated_by = ? WHERE id = ?').run('cancelled', now, ctx.actor.userId, input.id)
    ctx.db.prepare('UPDATE dental_chart_entries SET visit_id = NULL WHERE visit_id = ?').run(input.id)
    ctx.audit.write({
      module: 'clinical',
      action: 'visit.delete',
      entityType: 'visit',
      entityId: input.id,
      summary: `Deleted visit ${row.visit_no}`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}

/* -------------------------------------------------------------- visit treatments */

function recalculateVisitTotals(ctx: ServiceContext, treatmentId: number): void {
  const row = ctx.db
    .prepare('SELECT quantity, unit_price_micro, discount_micro FROM visit_treatments WHERE id = ?')
    .get(treatmentId) as { quantity: number, unit_price_micro: number, discount_micro: number } | undefined
  if (!row) return
  const gross = Math.round(row.quantity * row.unit_price_micro)
  const total = gross - row.discount_micro
  if (total < 0) throw validationError('The discount cannot be larger than the line amount.')
  ctx.db.prepare('UPDATE visit_treatments SET total_micro = ? WHERE id = ?').run(total, treatmentId)
}

export function addVisitTreatment(ctx: ServiceContext, input: VisitTreatmentInput, treatmentRowId?: number): VisitSummaryRecord {
  assertPermission(ctx, treatmentRowId ? 'clinical.edit' : 'clinical.create')
  const visit = getVisitRow(ctx, input.visitId)
  if (visit.status === 'cancelled') throw stateError('Treatments cannot be added to a cancelled visit.')
  const teeth = input.toothCodes.map((code) => code.trim().toUpperCase()).filter((code) => code.length > 0)
  const now = ctx.now()

  return ctx.db.transaction(() => {
    if (treatmentRowId) {
      const existing = ctx.db.prepare('SELECT visit_id FROM visit_treatments WHERE id = ?').get(treatmentRowId) as { visit_id: number } | undefined
      if (!existing) throw notFoundError('visit treatment', treatmentRowId)
      if (existing.visit_id !== input.visitId) throw validationError('That treatment line belongs to a different visit.')
      ctx.db
        .prepare(
          `UPDATE visit_treatments SET treatment_id = @treatmentId, treatment_name = @name, tooth_codes = @teeth, quantity = @quantity,
             unit_price_micro = @unitPrice, discount_micro = @discount, status = @status, notes = @notes WHERE id = @id`
        )
        .run({
          id: treatmentRowId,
          treatmentId: input.treatmentId ?? null,
          name: normalizeBengali(input.treatmentName).trim(),
          teeth: teeth.join(','),
          quantity: input.quantity,
          unitPrice: input.unitPriceMicro,
          discount: input.discountMicro,
          status: input.status,
          notes: input.notes ?? null
        })
      recalculateVisitTotals(ctx, treatmentRowId)
      ctx.audit.write({
        module: 'clinical',
        action: 'treatment.update',
        entityType: 'visit_treatment',
        entityId: treatmentRowId,
        summary: `Updated treatment line “${input.treatmentName}” on visit ${visit.visit_no}`,
        detail: { totalMicro: input.quantity * input.unitPriceMicro - input.discountMicro }
      })
      return getVisitSummary(ctx, input.visitId)
    }

    const result = ctx.db
      .prepare(
        `INSERT INTO visit_treatments (visit_id, treatment_id, treatment_name, tooth_codes, quantity, unit_price_micro, discount_micro,
           total_micro, status, notes, created_at)
         VALUES (@visitId, @treatmentId, @name, @teeth, @quantity, @unitPrice, @discount, @total, @status, @notes, @now)`
      )
      .run({
        visitId: input.visitId,
        treatmentId: input.treatmentId ?? null,
        name: normalizeBengali(input.treatmentName).trim(),
        teeth: teeth.join(','),
        quantity: input.quantity,
        unitPrice: input.unitPriceMicro,
        discount: input.discountMicro,
        total: Math.round(input.quantity * input.unitPriceMicro) - input.discountMicro,
        status: input.status,
        notes: input.notes ?? null,
        now
      })
    const id = Number(result.lastInsertRowid)
    ctx.audit.write({
      module: 'clinical',
      action: 'treatment.add',
      entityType: 'visit_treatment',
      entityId: id,
      summary: `Added “${input.treatmentName}” to visit ${visit.visit_no}`,
      detail: { teeth, quantity: input.quantity, unitPriceMicro: input.unitPriceMicro }
    })
    return getVisitSummary(ctx, input.visitId)
  })()
}

export function removeVisitTreatment(ctx: ServiceContext, id: number): VisitSummaryRecord {
  assertPermission(ctx, 'clinical.edit')
  const row = ctx.db.prepare('SELECT visit_id, treatment_name FROM visit_treatments WHERE id = ?').get(id) as
    | { visit_id: number, treatment_name: string }
    | undefined
  if (!row) throw notFoundError('visit treatment', id)
  const invoiced = (ctx.db.prepare('SELECT COUNT(*) AS count FROM invoice_lines WHERE visit_treatment_id = ?').get(id) as { count: number }).count
  if (invoiced > 0) throw stateError('This treatment line has been invoiced. Void the invoice before removing it.')
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM visit_treatments WHERE id = ?').run(id)
    ctx.audit.write({
      module: 'clinical',
      action: 'treatment.remove',
      entityType: 'visit_treatment',
      entityId: id,
      summary: `Removed treatment line “${row.treatment_name}” from visit #${row.visit_id}`
    })
  })()
  return getVisitSummary(ctx, row.visit_id)
}

/* ---------------------------------------------------------------- visit findings */

export function setVisitFindings(
  ctx: ServiceContext,
  input: { visitId: number, findings: Array<{ findingId?: number | null, findingCode: string, toothCode?: string | null, severity?: string | null, notes?: string | null }> }
): VisitSummaryRecord {
  assertPermission(ctx, 'clinical.edit')
  const visit = getVisitRow(ctx, input.visitId)
  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM visit_findings WHERE visit_id = ?').run(input.visitId)
    const insert = ctx.db.prepare(
      `INSERT INTO visit_findings (visit_id, finding_id, finding_code, tooth_code, notes, severity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    for (const finding of input.findings) {
      insert.run(
        input.visitId,
        finding.findingId ?? null,
        finding.findingCode,
        finding.toothCode ?? null,
        finding.notes ?? null,
        finding.severity ?? null,
        now
      )
    }
    ctx.audit.write({
      module: 'clinical',
      action: 'findings.set',
      entityType: 'visit',
      entityId: input.visitId,
      summary: `Recorded ${input.findings.length} finding(s) on visit ${visit.visit_no}`,
      detail: { codes: input.findings.map((finding) => finding.findingCode) }
    })
  })()
  return getVisitSummary(ctx, input.visitId)
}

