import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, conflictError, notFoundError, validationError } from '@shared/errors'
import { foldForSearch, normalizeBengali, normalizePhone } from '@shared/bengali'
import { ageAt, toLocalDate } from '@shared/datetime'
import { nextCode } from '../../db/counters'
import { clampPage, foldLike, rangeCondition, rangeConditionEpoch, resolveRange } from '../shared/query'
import { readAttachment, removeAttachment, storeAttachment } from '../../files/attachments'
import { resolveStoredPath } from '../../files/storage'
import type { zPatientInput, zReferralInput } from '@shared/contracts'
import type { z } from 'zod'

/**
 * Patients module.
 *
 * Responsibilities: registration with duplicate detection, unlimited clinical background, per-patient
 * financial position, a chronological timeline assembled from every module, attachments with
 * path-traversal-safe storage, and referral tracking with follow-up status.
 *
 * Soft deletion only: `patients.archive` hides the record from daily lists while visits, invoices and
 * prescriptions stay readable for audit and reporting. History is never rewritten.
 */

export type PatientInput = z.infer<typeof zPatientInput>
export type ReferralInput = z.infer<typeof zReferralInput>

export interface PatientRecord {
  id: number
  code: string
  fullName: string
  fullNameBn: string | null
  dob: string | null
  ageYears: number | null
  gender: string
  bloodGroup: string | null
  phone: string | null
  altPhone: string | null
  emergencyPhone: string | null
  address: string | null
  addressBn: string | null
  city: string | null
  occupation: string | null
  maritalStatus: string | null
  chiefComplaint: string | null
  pastHistory: string | null
  allergies: string | null
  medicalHistory: string | null
  dentalHistory: string | null
  currentMedications: string | null
  notes: string | null
  tags: string[]
  status: string
  registrationDate: string
  ageLabel: string | null
  ageAtRegistration: number | null
  dueMicro: number
  invoicedMicro: number
  paidMicro: number
  lastVisitAt: number | null
  visitCount: number
  createdAt: number
  updatedAt: number
}

interface PatientRow {
  id: number
  code: string
  full_name: string
  full_name_fold: string
  full_name_bn: string | null
  dob: string | null
  age_years: number | null
  gender: string
  blood_group: string | null
  phone: string | null
  phone_fold: string | null
  alt_phone: string | null
  emergency_phone: string | null
  address: string | null
  address_bn: string | null
  city: string | null
  occupation: string | null
  marital_status: string | null
  chief_complaint: string | null
  past_history: string | null
  allergies: string | null
  medical_history: string | null
  dental_history: string | null
  current_medications: string | null
  notes: string | null
  tags: string | null
  status: string
  registration_date: string
  created_at: number
  updated_at: number
  due_micro?: number
  invoiced_micro?: number
  paid_micro?: number
  last_visit_at?: number | null
  visit_count?: number
}

const PATIENT_SELECT = /* sql */ `
  SELECT p.*,
         COALESCE(f.invoiced_micro, 0) AS invoiced_micro,
         COALESCE(f.paid_micro, 0) AS paid_micro,
         COALESCE(f.due_micro, 0) AS due_micro,
         (SELECT MAX(v.visit_at) FROM visits v WHERE v.patient_id = p.id AND v.is_deleted = 0) AS last_visit_at,
         (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id AND v.is_deleted = 0) AS visit_count
  FROM patients p
  LEFT JOIN patient_financials f ON f.patient_id = p.id
`

/** Completed years between a stored `YYYY-MM-DD` date of birth and an instant; null when unknown. */
function ageInYears(dobLocalDate: string, atMs: number): number | null {
  const dobMs = Date.parse(`${dobLocalDate}T00:00:00`)
  if (Number.isNaN(dobMs) || dobMs > atMs) return null
  return ageAt(dobMs, atMs).years
}

function parseTags(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/** Age label shown in lists: exact age from DOB when available, otherwise the recorded age. */
function ageLabelFor(row: PatientRow, now: number): string | null {
  if (row.dob) {
    const years = ageInYears(row.dob, now)
    return years === null ? null : `${years} y`
  }
  if (row.age_years !== null && row.age_years !== undefined) return `${row.age_years} y`
  return null
}

function mapPatient(row: PatientRow, now: number): PatientRecord {
  return {
    id: row.id,
    code: row.code,
    fullName: row.full_name,
    fullNameBn: row.full_name_bn,
    dob: row.dob,
    ageYears: row.age_years,
    gender: row.gender,
    bloodGroup: row.blood_group,
    phone: row.phone,
    altPhone: row.alt_phone,
    emergencyPhone: row.emergency_phone,
    address: row.address,
    addressBn: row.address_bn,
    city: row.city,
    occupation: row.occupation,
    maritalStatus: row.marital_status,
    chiefComplaint: row.chief_complaint,
    pastHistory: row.past_history,
    allergies: row.allergies,
    medicalHistory: row.medical_history,
    dentalHistory: row.dental_history,
    currentMedications: row.current_medications,
    notes: row.notes,
    tags: parseTags(row.tags),
    status: row.status,
    registrationDate: row.registration_date,
    ageLabel: ageLabelFor(row, now),
    ageAtRegistration: row.dob ? ageInYears(row.dob, Date.parse(`${row.registration_date}T00:00:00`)) : (row.age_years ?? null),
    dueMicro: row.due_micro ?? 0,
    invoicedMicro: row.invoiced_micro ?? 0,
    paidMicro: row.paid_micro ?? 0,
    lastVisitAt: row.last_visit_at ?? null,
    visitCount: row.visit_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function loadPatientRow(ctx: ServiceContext, id: number): PatientRow | null {
  const row = ctx.db.prepare(`${PATIENT_SELECT} WHERE p.id = ? AND p.is_deleted = 0`).get(id) as PatientRow | undefined
  return row ?? null
}

export function getPatient(ctx: ServiceContext, id: number): PatientRecord {
  assertPermission(ctx, 'patients.view')
  const row = loadPatientRow(ctx, id)
  if (!row) throw notFoundError('patient', id)
  return mapPatient(row, ctx.now())
}

export function findPatientByCode(ctx: ServiceContext, code: string): PatientRecord | null {
  const row = ctx.db.prepare(`${PATIENT_SELECT} WHERE p.code = ? AND p.is_deleted = 0`).get(code.trim().toUpperCase()) as PatientRow | undefined
  return row ? mapPatient(row, ctx.now()) : null
}

export interface PatientFilter {
  search?: string
  status?: 'active' | 'archived' | 'deceased' | 'all'
  range?: { preset: string, from?: string | null, to?: string | null }
  tags?: string[]
  hasDue?: boolean
  sortBy?: 'recent' | 'name' | 'code' | 'due'
  limit: number
  offset: number
}

export interface PatientPage {
  items: PatientRecord[]
  total: number
  limit: number
  offset: number
}

export function listPatients(ctx: ServiceContext, filter: PatientFilter): PatientPage {
  assertPermission(ctx, 'patients.view')
  const { limit, offset } = clampPage(filter)
  const conditions: string[] = ['p.is_deleted = 0']
  const params: Array<string | number> = []

  const status = filter.status ?? 'active'
  if (status !== 'all') {
    conditions.push('p.status = ?')
    params.push(status)
  }

  if (filter.search && filter.search.trim()) {
    const folded = foldLike(foldForSearch(filter.search))
    conditions.push(`(
      p.full_name_fold LIKE ? ESCAPE '\\'
      OR COALESCE(p.full_name_bn, '') LIKE ? ESCAPE '\\'
      OR COALESCE(p.phone_fold, '') LIKE ? ESCAPE '\\'
      OR p.code LIKE ? ESCAPE '\\'
      OR COALESCE(p.address, '') LIKE ? ESCAPE '\\'
    )`)
    const raw = `%${filter.search.trim()}%`
    params.push(folded, raw, folded, `%${filter.search.trim().toUpperCase()}%`, raw)
  }

  const range = resolveRange(filter.range)
  const rangeClause = rangeCondition('p.registration_date', range)
  if (rangeClause.sql) {
    conditions.push(rangeClause.sql.replace(/^ AND /, ''))
    params.push(...rangeClause.params)
  }

  for (const tag of filter.tags ?? []) {
    conditions.push('p.tags LIKE ?')
    params.push(`%${JSON.stringify(tag).slice(1, -1)}%`)
  }

  if (filter.hasDue) {
    conditions.push('EXISTS (SELECT 1 FROM invoices i WHERE i.patient_id = p.id AND i.is_deleted = 0 AND i.status <> \'void\' AND i.due_micro > 0)')
  }

  const orderBy =
    filter.sortBy === 'name'
      ? 'p.full_name_fold ASC, p.id ASC'
      : filter.sortBy === 'code'
        ? 'p.code DESC'
        : filter.sortBy === 'due'
          ? 'due_micro DESC, p.id DESC'
          : 'p.registration_date DESC, p.id DESC'

  const where = conditions.join(' AND ')
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM patients p WHERE ${where}`).get(...params) as { count: number }).count
  const rows = ctx.db
    .prepare(
      `${PATIENT_SELECT} WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as PatientRow[]

  return { items: rows.map((row) => mapPatient(row, ctx.now())), total, limit, offset }
}

export function checkDuplicates(
  ctx: ServiceContext,
  input: { fullName: string, phone?: string | null, excludeId?: number | null }
): Array<{ id: number, code: string, fullName: string, phone: string | null, registrationDate: string }> {
  assertPermission(ctx, 'patients.view')
  const nameFold = foldForSearch(input.fullName)
  const phoneFold = input.phone ? foldForSearch(normalizePhone(input.phone)) : null
  const conditions: string[] = ['p.is_deleted = 0']
  const params: Array<string | number> = []

  if (phoneFold) {
    conditions.push('(p.full_name_fold = ? OR (p.phone_fold IS NOT NULL AND p.phone_fold = ?))')
    params.push(nameFold, phoneFold)
  } else {
    conditions.push('p.full_name_fold = ?')
    params.push(nameFold)
  }
  if (input.excludeId) {
    conditions.push('p.id <> ?')
    params.push(input.excludeId)
  }

  return ctx.db
    .prepare(
      `SELECT p.id, p.code, p.full_name AS fullName, p.phone, p.registration_date AS registrationDate
       FROM patients p WHERE ${conditions.join(' AND ')} ORDER BY p.id DESC LIMIT 10`
    )
    .all(...params) as Array<{ id: number, code: string, fullName: string, phone: string | null, registrationDate: string }>
}

export function listPatientTags(ctx: ServiceContext): Array<{ tag: string, count: number }> {
  assertPermission(ctx, 'patients.view')
  const rows = ctx.db.prepare("SELECT tags FROM patients WHERE is_deleted = 0 AND tags IS NOT NULL AND tags <> '[]'").all() as Array<{ tags: string }>
  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const tag of parseTags(row.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Create or update a patient. Everything happens in one transaction, including the audit row. */
export function savePatient(ctx: ServiceContext, input: PatientInput): PatientRecord {
  const existing = input.id ? loadPatientRow(ctx, input.id) : null
  if (input.id && !existing) throw notFoundError('patient', input.id)
  assertPermission(ctx, existing ? 'patients.edit' : 'patients.create')

  if (!existing && input.status !== 'active') {
    throw validationError('A new patient record must start as active.')
  }
  if (input.dob && input.dob > toLocalDate(ctx.now())) {
    throw validationError('Date of birth cannot be in the future.', { dob: 'Date of birth cannot be in the future.' })
  }

  const now = ctx.now()
  const fullName = normalizeBengali(input.fullName).trim()
  const fullNameBn = input.fullNameBn ? normalizeBengali(input.fullNameBn).trim() : null
  const phone = input.phone ? normalizePhone(input.phone) : null
  const phoneFold = phone ? foldForSearch(phone) : null
  const tags = [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))]

  const duplicates = checkDuplicates(ctx, { fullName, phone, excludeId: input.id ?? null })
  if (duplicates.length > 0 && (!existing || existing.full_name_fold !== foldForSearch(fullName) || existing.phone_fold !== phoneFold)) {
    const sameName = duplicates[0]!
    throw conflictError(
      `A patient named “${sameName.fullName}” (${sameName.code}) already exists${sameName.phone ? ` with phone ${sameName.phone}` : ''}. Open that record or change the name to continue.`,
      { duplicatePatientId: sameName.id, duplicateCode: sameName.code }
    )
  }

  const write = ctx.db.transaction(() => {
    if (existing) {
      ctx.db
        .prepare(
          `UPDATE patients SET
             full_name = @fullName, full_name_fold = @fullNameFold, full_name_bn = @fullNameBn,
             dob = @dob, age_years = @ageYears, gender = @gender, blood_group = @bloodGroup,
             phone = @phone, phone_fold = @phoneFold, alt_phone = @altPhone, emergency_phone = @emergencyPhone,
             address = @address, address_bn = @addressBn, city = @city, occupation = @occupation,
             marital_status = @maritalStatus, chief_complaint = @chiefComplaint, past_history = @pastHistory,
             allergies = @allergies, medical_history = @medicalHistory, dental_history = @dentalHistory,
             current_medications = @currentMedications, notes = @notes, tags = @tags, status = @status,
             updated_at = @now
           WHERE id = @id`
        )
        .run({
          id: existing.id,
          fullName,
          fullNameFold: foldForSearch(fullName),
          fullNameBn,
          dob: input.dob ?? null,
          ageYears: input.dob ? null : (input.ageYears ?? null),
          gender: input.gender,
          bloodGroup: input.bloodGroup ?? null,
          phone,
          phoneFold,
          altPhone: input.altPhone ?? null,
          emergencyPhone: input.emergencyPhone ?? null,
          address: input.address ?? null,
          addressBn: input.addressBn ?? null,
          city: input.city ?? null,
          occupation: input.occupation ?? null,
          maritalStatus: input.maritalStatus ?? null,
          chiefComplaint: input.chiefComplaint ?? null,
          pastHistory: input.pastHistory ?? null,
          allergies: input.allergies ?? null,
          medicalHistory: input.medicalHistory ?? null,
          dentalHistory: input.dentalHistory ?? null,
          currentMedications: input.currentMedications ?? null,
          notes: input.notes ?? null,
          tags: JSON.stringify(tags),
          status: input.status,
          now
        })

      const changedFields = diffPatient(existing, input)
      ctx.audit.write({
        module: 'patients',
        action: 'update',
        entityType: 'patient',
        entityId: existing.id,
        summary: `Updated patient ${existing.code} (${fullName})`,
        detail: { fields: changedFields }
      })
      return existing.id
    }

    const code = nextCode(ctx.db, 'patient', now)
    const result = ctx.db
      .prepare(
        `INSERT INTO patients (
           code, full_name, full_name_fold, full_name_bn, dob, age_years, gender, blood_group,
           phone, phone_fold, alt_phone, emergency_phone, address, address_bn, city, occupation,
           marital_status, chief_complaint, past_history, allergies, medical_history, dental_history,
           current_medications, notes, tags, status, registration_date, created_by, created_at, updated_at
         ) VALUES (
           @code, @fullName, @fullNameFold, @fullNameBn, @dob, @ageYears, @gender, @bloodGroup,
           @phone, @phoneFold, @altPhone, @emergencyPhone, @address, @addressBn, @city, @occupation,
           @maritalStatus, @chiefComplaint, @pastHistory, @allergies, @medicalHistory, @dentalHistory,
           @currentMedications, @notes, @tags, 'active', @registrationDate, @createdBy, @now, @now
         )`
      )
      .run({
        code,
        fullName,
        fullNameFold: foldForSearch(fullName),
        fullNameBn,
        dob: input.dob ?? null,
        ageYears: input.dob ? null : (input.ageYears ?? null),
        gender: input.gender,
        bloodGroup: input.bloodGroup ?? null,
        phone,
        phoneFold,
        altPhone: input.altPhone ?? null,
        emergencyPhone: input.emergencyPhone ?? null,
        address: input.address ?? null,
        addressBn: input.addressBn ?? null,
        city: input.city ?? null,
        occupation: input.occupation ?? null,
        maritalStatus: input.maritalStatus ?? null,
        chiefComplaint: input.chiefComplaint ?? null,
        pastHistory: input.pastHistory ?? null,
        allergies: input.allergies ?? null,
        medicalHistory: input.medicalHistory ?? null,
        dentalHistory: input.dentalHistory ?? null,
        currentMedications: input.currentMedications ?? null,
        notes: input.notes ?? null,
        tags: JSON.stringify(tags),
        registrationDate: toLocalDate(now),
        createdBy: ctx.actor.userId || null,
        now
      })

    const id = Number(result.lastInsertRowid)
    ctx.audit.write({
      module: 'patients',
      action: 'create',
      entityType: 'patient',
      entityId: id,
      summary: `Registered patient ${code} (${fullName})`,
      detail: { phone, gender: input.gender }
    })
    return id
  })

  const id = write()
  return getPatient(ctx, id)
}

function diffPatient(row: PatientRow, input: PatientInput): string[] {
  const changed: string[] = []
  const compare: Array<[string, string | null | undefined, string | null | undefined]> = [
    ['fullName', row.full_name, input.fullName],
    ['fullNameBn', row.full_name_bn, input.fullNameBn],
    ['dob', row.dob, input.dob],
    ['gender', row.gender, input.gender],
    ['bloodGroup', row.blood_group, input.bloodGroup],
    ['phone', row.phone, input.phone ? normalizePhone(input.phone) : null],
    ['address', row.address, input.address],
    ['allergies', row.allergies, input.allergies],
    ['medicalHistory', row.medical_history, input.medicalHistory],
    ['notes', row.notes, input.notes],
    ['status', row.status, input.status]
  ]
  for (const [name, before, after] of compare) {
    const left = before ?? null
    const right = after ?? null
    if (left !== right) changed.push(name)
  }
  return changed
}

export function archivePatient(ctx: ServiceContext, input: { id: number, reason?: string | null }): PatientRecord {
  assertPermission(ctx, 'patients.archive')
  const row = loadPatientRow(ctx, input.id)
  if (!row) throw notFoundError('patient', input.id)
  const now = ctx.now()
  ctx.db
    .prepare('UPDATE patients SET is_deleted = 1, deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ? WHERE id = ?')
    .run(now, ctx.actor.userId || null, input.reason ?? null, now, row.id)
  ctx.audit.write({
    module: 'patients',
    action: 'archive',
    entityType: 'patient',
    entityId: row.id,
    summary: `Archived patient ${row.code} (${row.full_name})`,
    detail: { reason: input.reason ?? null }
  })
  return { ...mapPatient(row, now), status: 'archived' }
}

export function restorePatient(ctx: ServiceContext, id: number): PatientRecord {
  assertPermission(ctx, 'patients.archive')
  const row = ctx.db.prepare('SELECT * FROM patients WHERE id = ? AND is_deleted = 1').get(id) as PatientRow | undefined
  if (!row) throw notFoundError('patient', id)
  const now = ctx.now()
  ctx.db.prepare("UPDATE patients SET is_deleted = 0, deleted_at = NULL, deleted_by = NULL, deleted_reason = NULL, status = 'active', updated_at = ? WHERE id = ?").run(now, id)
  ctx.audit.write({
    module: 'patients',
    action: 'restore',
    entityType: 'patient',
    entityId: id,
    summary: `Restored patient ${row.code} (${row.full_name})`
  })
  return getPatient(ctx, id)
}

export interface PatientFinancialSummary {
  invoicedMicro: number
  paidMicro: number
  dueMicro: number
  refundedMicro: number
  invoiceCount: number
  lastPaymentAt: number | null
  aging: { current: number, days30: number, days60: number, days90: number, older: number }
}

export function getPatientFinancials(ctx: ServiceContext, patientId: number): PatientFinancialSummary {
  assertPermission(ctx, 'patients.view')
  const row = ctx.db
    .prepare(
      `SELECT
         COALESCE(SUM(total_micro), 0) AS invoiced_micro,
         COALESCE(SUM(paid_micro + refunded_micro), 0) AS paid_micro,
         COALESCE(SUM(due_micro), 0) AS due_micro,
         COALESCE(SUM(refunded_micro), 0) AS refunded_micro,
         COUNT(*) AS invoice_count
       FROM invoices
       WHERE patient_id = ? AND is_deleted = 0 AND status <> 'void'`
    )
    .get(patientId) as { invoiced_micro: number, paid_micro: number, due_micro: number, refunded_micro: number, invoice_count: number }

  const openInvoices = ctx.db
    .prepare(
      `SELECT due_micro, COALESCE(due_date, issue_date) AS due_date_local, issue_date
       FROM invoices
       WHERE patient_id = ? AND is_deleted = 0 AND status <> 'void' AND due_micro > 0`
    )
    .all(patientId) as Array<{ due_micro: number, due_date_local: string, issue_date: string }>

  const todayMs = ctx.now()
  const aging = { current: 0, days30: 0, days60: 0, days90: 0, older: 0 }
  for (const invoice of openInvoices) {
    const reference = Date.parse(`${invoice.due_date_local}T00:00:00`)
    const days = Math.floor((todayMs - reference) / 86_400_000)
    if (days <= 0) aging.current += invoice.due_micro
    else if (days <= 30) aging.days30 += invoice.due_micro
    else if (days <= 60) aging.days60 += invoice.due_micro
    else if (days <= 90) aging.days90 += invoice.due_micro
    else aging.older += invoice.due_micro
  }

  const lastPayment = ctx.db
    .prepare("SELECT MAX(paid_at) AS at FROM payments WHERE patient_id = ? AND status = 'active'")
    .get(patientId) as { at: number | null }

  return {
    invoicedMicro: row.invoiced_micro,
    paidMicro: row.paid_micro,
    dueMicro: row.due_micro,
    refundedMicro: row.refunded_micro,
    invoiceCount: row.invoice_count,
    lastPaymentAt: lastPayment.at ?? null,
    aging
  }
}

/* ------------------------------------------------------------------- Timeline */

export interface TimelineEntry {
  id: string
  at: number
  kind: 'registration' | 'visit' | 'treatment' | 'prescription' | 'invoice' | 'payment' | 'appointment' | 'referral' | 'attachment' | 'chart' | 'note'
  title: string
  description: string | null
  dentistId: number | null
  dentistName: string | null
  amountMicro: number | null
  entityId: number
  route: string | null
  requiresPermission: string | null
}

export interface TimelineFilter {
  patientId: number
  kinds?: string[]
  dentistId?: number
  range?: { preset?: string, from?: string | null, to?: string | null }
  limit: number
  offset: number
}

/**
 * Timeline merges every module's history for a patient. Each source is queried with its own
 * permission-scoped filter so the feed can never reveal data the operator is not allowed to see
 * (for example, a receptionist reads invoices but not clinical notes).
 */
export function getPatientTimeline(ctx: ServiceContext, filter: TimelineFilter): { items: TimelineEntry[], total: number } {
  assertPermission(ctx, 'patients.view')
  const { limit, offset } = clampPage(filter, 100, 500)
  const range = resolveRange(filter.range)
  const kinds = filter.kinds && filter.kinds.length > 0 ? new Set(filter.kinds) : null
  const canClinical = ctx.actor.permissions.has('clinical.view')
  const canPrescriptions = ctx.actor.permissions.has('prescriptions.view')
  const canBilling = ctx.actor.permissions.has('billing.view')
  const canPayments = ctx.actor.permissions.has('payments.view')
  const canAppointments = ctx.actor.permissions.has('appointments.view')

  const entries: TimelineEntry[] = []
  const push = (entry: TimelineEntry): void => {
    if (kinds && !kinds.has(entry.kind)) return
    if (filter.dentistId && entry.dentistId !== filter.dentistId) return
    entries.push(entry)
  }

  const patient = ctx.db.prepare('SELECT registration_date FROM patients WHERE id = ?').get(filter.patientId) as { registration_date: string } | undefined
  if (!patient) throw notFoundError('patient', filter.patientId)

  if (canClinical) {
    const visits = ctx.db
      .prepare(
        `SELECT v.id, v.visit_no, v.visit_at, v.visit_date, v.diagnosis, v.status, v.dentist_id, d.full_name AS dentist_name
         FROM visits v JOIN dentists d ON d.id = v.dentist_id
         WHERE v.patient_id = ? AND v.is_deleted = 0
           ${rangeCondition('v.visit_date', range).sql}`
      )
      .all(filter.patientId, ...rangeCondition('v.visit_date', range).params) as Array<{
        id: number, visit_no: string, visit_at: number, visit_date: string, diagnosis: string | null, status: string, dentist_id: number, dentist_name: string
      }>
    for (const visit of visits) {
      push({
        id: `visit-${visit.id}`,
        at: visit.visit_at,
        kind: 'visit',
        title: `Visit ${visit.visit_no}`,
        description: visit.diagnosis ?? (visit.status === 'draft' ? 'Draft visit' : null),
        dentistId: visit.dentist_id,
        dentistName: visit.dentist_name,
        amountMicro: null,
        entityId: visit.id,
        route: `/patients/${filter.patientId}/visits/${visit.id}`,
        requiresPermission: 'clinical.view'
      })
    }

    const treatments = ctx.db
      .prepare(
        `SELECT t.id, t.treatment_name, t.total_micro, t.created_at, t.status, v.dentist_id, d.full_name AS dentist_name, v.id AS visit_id
         FROM visit_treatments t
         JOIN visits v ON v.id = t.visit_id
         JOIN dentists d ON d.id = v.dentist_id
         WHERE v.patient_id = ? AND v.is_deleted = 0 ${rangeCondition('v.visit_date', range).sql}`
      )
      .all(filter.patientId, ...rangeCondition('v.visit_date', range).params) as Array<{
        id: number, treatment_name: string, total_micro: number, created_at: number, status: string, dentist_id: number, dentist_name: string, visit_id: number
      }>
    for (const treatment of treatments) {
      push({
        id: `treatment-${treatment.id}`,
        at: treatment.created_at,
        kind: 'treatment',
        title: treatment.treatment_name,
        description: treatment.status === 'planned' ? 'Planned treatment' : null,
        dentistId: treatment.dentist_id,
        dentistName: treatment.dentist_name,
        amountMicro: treatment.total_micro,
        entityId: treatment.visit_id,
        route: `/patients/${filter.patientId}/visits/${treatment.visit_id}`,
        requiresPermission: 'clinical.view'
      })
    }

    const chartRange = rangeConditionEpoch('recorded_at', range)
    const chart = ctx.db
      .prepare(
        `SELECT id, tooth_code, condition_code, status, note, recorded_at, visit_id
         FROM dental_chart_entries WHERE patient_id = ? ${chartRange.sql}`
      )
      .all(filter.patientId, ...chartRange.params) as Array<{ id: number, tooth_code: string, condition_code: string, status: string, note: string | null, recorded_at: number, visit_id: number | null }>
    for (const entry of chart) {
      push({
        id: `chart-${entry.id}`,
        at: entry.recorded_at,
        kind: 'chart',
        title: `Tooth ${entry.tooth_code}: ${entry.condition_code}`,
        description: entry.note,
        dentistId: null,
        dentistName: null,
        amountMicro: null,
        entityId: entry.id,
        route: `/patients/${filter.patientId}/chart`,
        requiresPermission: 'clinical.view'
      })
    }
  }

  if (canPrescriptions) {
    const prescriptions = ctx.db
      .prepare(
        `SELECT p.id, p.rx_no, p.prescription_at, p.diagnosis, p.dentist_id, d.full_name AS dentist_name,
                (SELECT COUNT(*) FROM prescription_medicines m WHERE m.prescription_id = p.id) AS medicine_count
         FROM prescriptions p JOIN dentists d ON d.id = p.dentist_id
         WHERE p.patient_id = ? AND p.is_deleted = 0 ${rangeCondition('p.prescription_date', range).sql}`
      )
      .all(filter.patientId, ...rangeCondition('p.prescription_date', range).params) as Array<{
        id: number, rx_no: string, prescription_at: number, diagnosis: string | null, dentist_id: number, dentist_name: string, medicine_count: number
      }>
    for (const prescription of prescriptions) {
      push({
        id: `rx-${prescription.id}`,
        at: prescription.prescription_at,
        kind: 'prescription',
        title: `Prescription ${prescription.rx_no}`,
        description: `${prescription.medicine_count} medicine(s)${prescription.diagnosis ? ` · ${prescription.diagnosis}` : ''}`,
        dentistId: prescription.dentist_id,
        dentistName: prescription.dentist_name,
        amountMicro: null,
        entityId: prescription.id,
        route: `/patients/${filter.patientId}/prescriptions/${prescription.id}`,
        requiresPermission: 'prescriptions.view'
      })
    }
  }

  if (canBilling) {
    const invoices = ctx.db
      .prepare(
        `SELECT id, invoice_no, issue_at, total_micro, due_micro, status
         FROM invoices WHERE patient_id = ? AND is_deleted = 0 ${rangeCondition('issue_date', range).sql}`
      )
      .all(filter.patientId, ...rangeCondition('issue_date', range).params) as Array<{
        id: number, invoice_no: string, issue_at: number, total_micro: number, due_micro: number, status: string
      }>
    for (const invoice of invoices) {
      push({
        id: `invoice-${invoice.id}`,
        at: invoice.issue_at,
        kind: 'invoice',
        title: `Invoice ${invoice.invoice_no}`,
        description: invoice.status === 'void' ? 'Voided' : invoice.due_micro > 0 ? 'Outstanding balance' : 'Settled',
        dentistId: null,
        dentistName: null,
        amountMicro: invoice.total_micro,
        entityId: invoice.id,
        route: `/invoices/${invoice.id}`,
        requiresPermission: 'billing.view'
      })
    }
  }

  if (canPayments) {
    const payments = ctx.db
      .prepare(
        `SELECT p.id, p.receipt_no, p.paid_at, p.amount_micro, p.kind, p.method, i.invoice_no
         FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
         WHERE p.patient_id = ? AND p.status = 'active' ${rangeCondition('p.paid_date', range).sql}`
      )
      .all(filter.patientId, ...rangeCondition('p.paid_date', range).params) as Array<{
        id: number, receipt_no: string, paid_at: number, amount_micro: number, kind: string, method: string, invoice_no: string | null
      }>
    for (const payment of payments) {
      const refund = payment.kind === 'refund'
      push({
        id: `payment-${payment.id}`,
        at: payment.paid_at,
        kind: 'payment',
        title: `${refund ? 'Refund' : 'Payment'} ${payment.receipt_no}`,
        description: `${payment.method.replace(/_/g, ' ')}${payment.invoice_no ? ` · ${payment.invoice_no}` : ''}`,
        dentistId: null,
        dentistName: null,
        amountMicro: refund ? -payment.amount_micro : payment.amount_micro,
        entityId: payment.id,
        route: `/payments/${payment.id}`,
        requiresPermission: 'payments.view'
      })
    }
  }

  if (canAppointments) {
    const appointments = ctx.db
      .prepare(
        `SELECT a.id, a.scheduled_at, a.scheduled_date, a.status, a.reason, a.dentist_id, d.full_name AS dentist_name
         FROM appointments a JOIN dentists d ON d.id = a.dentist_id
         WHERE a.patient_id = ? AND a.is_deleted = 0 ${rangeCondition('a.scheduled_date', range).sql}`
      )
      .all(filter.patientId, ...rangeCondition('a.scheduled_date', range).params) as Array<{
        id: number, scheduled_at: number, scheduled_date: string, status: string, reason: string | null, dentist_id: number, dentist_name: string
      }>
    for (const appointment of appointments) {
      push({
        id: `appointment-${appointment.id}`,
        at: appointment.scheduled_at,
        kind: 'appointment',
        title: `Appointment · ${appointment.status.replace(/_/g, ' ')}`,
        description: appointment.reason,
        dentistId: appointment.dentist_id,
        dentistName: appointment.dentist_name,
        amountMicro: null,
        entityId: appointment.id,
        route: `/appointments/${appointment.id}`,
        requiresPermission: 'appointments.view'
      })
    }
  }

  const referrals = ctx.db
    .prepare(
      `SELECT r.id, r.created_at, r.referral_date, r.reason, r.specialty, r.external_doctor, r.organization, r.follow_up_status
       FROM referrals r WHERE r.patient_id = ? AND r.is_deleted = 0 ${rangeCondition('r.referral_date', range).sql}`
    )
    .all(filter.patientId, ...rangeCondition('r.referral_date', range).params) as Array<{
      id: number, created_at: number, referral_date: string, reason: string | null, specialty: string | null, external_doctor: string | null, organization: string | null, follow_up_status: string
    }>
  for (const referral of referrals) {
    push({
      id: `referral-${referral.id}`,
      at: referral.created_at,
      kind: 'referral',
      title: `Referral · ${referral.specialty ?? 'external'}`,
      description: [referral.external_doctor, referral.organization, referral.follow_up_status].filter(Boolean).join(' · ') || referral.reason,
      dentistId: null,
      dentistName: null,
      amountMicro: null,
      entityId: referral.id,
      route: `/patients/${filter.patientId}/referrals`,
      requiresPermission: 'patients.view'
    })
  }

  const attachments = ctx.db
    .prepare(
      `SELECT id, file_name, kind, description, attachment_date, created_at
       FROM patient_attachments WHERE patient_id = ? AND is_deleted = 0 ${rangeCondition('attachment_date', range).sql}`
    )
    .all(filter.patientId, ...rangeCondition('attachment_date', range).params) as Array<{
      id: number, file_name: string, kind: string, description: string | null, attachment_date: string, created_at: number
    }>
  for (const attachment of attachments) {
    push({
      id: `attachment-${attachment.id}`,
      at: attachment.created_at,
      kind: 'attachment',
      title: attachment.file_name,
      description: attachment.description ?? attachment.kind,
      dentistId: null,
      dentistName: null,
      amountMicro: null,
      entityId: attachment.id,
      route: `/patients/${filter.patientId}/attachments`,
      requiresPermission: 'patients.view'
    })
  }

  push({
    id: `registration-${filter.patientId}`,
    at: Date.parse(`${patient.registration_date}T00:00:00`),
    kind: 'registration',
    title: 'Patient registered',
    description: null,
    dentistId: null,
    dentistName: null,
    amountMicro: null,
    entityId: filter.patientId,
    route: `/patients/${filter.patientId}`,
    requiresPermission: 'patients.view'
  })

  entries.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
  return { items: entries.slice(offset, offset + limit), total: entries.length }
}

/* ---------------------------------------------------------------- Attachments */

export interface AttachmentRecord {
  id: number
  patientId: number
  visitId: number | null
  fileName: string
  mime: string
  sizeBytes: number
  kind: string
  description: string | null
  attachmentDate: string
  createdAt: number
  uploadedBy: number | null
}

interface AttachmentRow {
  id: number
  patient_id: number
  visit_id: number | null
  file_name: string
  stored_path: string
  mime: string
  size_bytes: number
  kind: string
  description: string | null
  attachment_date: string
  uploaded_by: number | null
  created_at: number
}

function mapAttachment(row: AttachmentRow): AttachmentRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    fileName: row.file_name,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    kind: row.kind,
    description: row.description,
    attachmentDate: row.attachment_date,
    createdAt: row.created_at,
    uploadedBy: row.uploaded_by
  }
}

export function listAttachments(ctx: ServiceContext, patientId: number): AttachmentRecord[] {
  assertPermission(ctx, 'patients.view')
  const rows = ctx.db
    .prepare('SELECT * FROM patient_attachments WHERE patient_id = ? AND is_deleted = 0 ORDER BY created_at DESC')
    .all(patientId) as AttachmentRow[]
  return rows.map(mapAttachment)
}

export function uploadAttachment(
  ctx: ServiceContext,
  input: {
    patientId: number
    visitId?: number | null
    fileName: string
    dataBase64: string
    description?: string | null
    kind: string
    attachmentDate?: string
  }
): AttachmentRecord {
  assertPermission(ctx, 'patients.edit')
  getPatient(ctx, input.patientId)
  if (input.visitId) {
    const visit = ctx.db.prepare('SELECT patient_id FROM visits WHERE id = ? AND is_deleted = 0').get(input.visitId) as { patient_id: number } | undefined
    if (!visit || visit.patient_id !== input.patientId) throw validationError('The selected visit does not belong to this patient.')
  }

  const now = ctx.now()
  const saved = storeAttachment(ctx.host.paths.attachmentsDir, input.patientId, {
    fileName: input.fileName,
    dataBase64: input.dataBase64
  })

  const result = ctx.db
    .prepare(
      `INSERT INTO patient_attachments
         (patient_id, visit_id, file_name, stored_path, mime, size_bytes, kind, description, attachment_date, sha256, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.patientId,
      input.visitId ?? null,
      saved.fileName,
      saved.relativePath,
      saved.mime,
      saved.bytes,
      input.kind,
      input.description ?? null,
      input.attachmentDate ?? toLocalDate(now),
      saved.sha256,
      ctx.actor.userId || null,
      now
    )

  const id = Number(result.lastInsertRowid)
  ctx.audit.write({
    module: 'patients',
    action: 'attachment_add',
    entityType: 'patient_attachment',
    entityId: id,
    summary: `Attached “${saved.fileName}” to patient #${input.patientId}`,
    detail: { bytes: saved.bytes, kind: input.kind }
  })
  const row = ctx.db.prepare('SELECT * FROM patient_attachments WHERE id = ?').get(id) as AttachmentRow
  return mapAttachment(row)
}

export function updateAttachment(
  ctx: ServiceContext,
  input: { id: number, description?: string | null, kind?: string, attachmentDate?: string }
): AttachmentRecord {
  assertPermission(ctx, 'patients.edit')
  const row = ctx.db.prepare('SELECT * FROM patient_attachments WHERE id = ? AND is_deleted = 0').get(input.id) as AttachmentRow | undefined
  if (!row) throw notFoundError('attachment', input.id)
  ctx.db
    .prepare('UPDATE patient_attachments SET description = ?, kind = COALESCE(?, kind), attachment_date = COALESCE(?, attachment_date) WHERE id = ?')
    .run(input.description ?? null, input.kind ?? null, input.attachmentDate ?? null, input.id)
  ctx.audit.write({
    module: 'patients',
    action: 'attachment_update',
    entityType: 'patient_attachment',
    entityId: input.id,
    summary: `Updated attachment “${row.file_name}” of patient #${row.patient_id}`
  })
  return mapAttachment(ctx.db.prepare('SELECT * FROM patient_attachments WHERE id = ?').get(input.id) as AttachmentRow)
}

export function deleteAttachment(ctx: ServiceContext, id: number): { ok: true } {
  assertPermission(ctx, 'patients.edit')
  const row = ctx.db.prepare('SELECT * FROM patient_attachments WHERE id = ? AND is_deleted = 0').get(id) as AttachmentRow | undefined
  if (!row) throw notFoundError('attachment', id)
  const now = ctx.now()
  ctx.db
    .prepare('UPDATE patient_attachments SET is_deleted = 1, deleted_at = ?, deleted_by = ? WHERE id = ?')
    .run(now, ctx.actor.userId || null, id)
  removeAttachment(ctx.host.paths.dataDir, row.stored_path)
  ctx.audit.write({
    module: 'patients',
    action: 'attachment_delete',
    entityType: 'patient_attachment',
    entityId: id,
    summary: `Deleted attachment “${row.file_name}” of patient #${row.patient_id}`
  })
  return { ok: true }
}

export function readAttachmentData(ctx: ServiceContext, id: number): { mime: string, dataBase64: string, fileName: string } {
  assertPermission(ctx, 'patients.view')
  const row = ctx.db.prepare('SELECT * FROM patient_attachments WHERE id = ? AND is_deleted = 0').get(id) as AttachmentRow | undefined
  if (!row) throw notFoundError('attachment', id)
  const buffer = readAttachment(ctx.host.paths.dataDir, row.stored_path)
  return { mime: row.mime, dataBase64: buffer.toString('base64'), fileName: row.file_name }
}

export function attachmentAbsolutePath(ctx: ServiceContext, id: number): { absolutePath: string, fileName: string, patientId: number } {
  assertPermission(ctx, 'patients.view')
  const row = ctx.db.prepare('SELECT * FROM patient_attachments WHERE id = ? AND is_deleted = 0').get(id) as AttachmentRow | undefined
  if (!row) throw notFoundError('attachment', id)
  return { absolutePath: resolveStoredPath(ctx.host.paths.dataDir, row.stored_path), fileName: row.file_name, patientId: row.patient_id }
}

/* ------------------------------------------------------------------ Referrals */

export interface ReferralRecord {
  id: number
  patientId: number
  visitId: number | null
  referredByDentistId: number | null
  externalDoctor: string | null
  specialty: string | null
  organization: string | null
  address: string | null
  phone: string | null
  reason: string | null
  notes: string | null
  referralDate: string
  followUpStatus: string
  followUpDate: string | null
  createdAt: number
  createdByName: string | null
}

interface ReferralRow {
  id: number
  patient_id: number
  visit_id: number | null
  referred_by_dentist_id: number | null
  external_doctor: string | null
  specialty: string | null
  organization: string | null
  address: string | null
  phone: string | null
  reason: string | null
  notes: string | null
  referral_date: string
  follow_up_status: string
  follow_up_date: string | null
  created_at: number
  created_by: number | null
  created_by_name?: string | null
}

function mapReferral(row: ReferralRow): ReferralRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    referredByDentistId: row.referred_by_dentist_id,
    externalDoctor: row.external_doctor,
    specialty: row.specialty,
    organization: row.organization,
    address: row.address,
    phone: row.phone,
    reason: row.reason,
    notes: row.notes,
    referralDate: row.referral_date,
    followUpStatus: row.follow_up_status,
    followUpDate: row.follow_up_date,
    createdAt: row.created_at,
    createdByName: row.created_by_name ?? null
  }
}

export function listReferrals(ctx: ServiceContext, patientId: number): ReferralRecord[] {
  assertPermission(ctx, 'patients.view')
  const rows = ctx.db
    .prepare(
      `SELECT r.*, u.full_name AS created_by_name
       FROM referrals r LEFT JOIN users u ON u.id = r.created_by
       WHERE r.patient_id = ? AND r.is_deleted = 0 ORDER BY r.referral_date DESC, r.id DESC`
    )
    .all(patientId) as ReferralRow[]
  return rows.map(mapReferral)
}

export function saveReferral(ctx: ServiceContext, input: ReferralInput): ReferralRecord {
  assertPermission(ctx, 'patients.edit')
  getPatient(ctx, input.patientId)
  if (!input.externalDoctor && !input.specialty && !input.organization) {
    throw validationError('Record the doctor, specialty or organization the patient is referred to.', {
      externalDoctor: 'Enter the receiving doctor, specialty or organization.'
    })
  }
  const now = ctx.now()

  if (input.id) {
    const existing = ctx.db.prepare('SELECT * FROM referrals WHERE id = ? AND is_deleted = 0').get(input.id) as ReferralRow | undefined
    if (!existing) throw notFoundError('referral', input.id)
    ctx.db
      .prepare(
        `UPDATE referrals SET visit_id = @visitId, referred_by_dentist_id = @dentistId, external_doctor = @doctor,
           specialty = @specialty, organization = @organization, address = @address, phone = @phone,
           reason = @reason, notes = @notes, referral_date = @referralDate, follow_up_status = @followUpStatus,
           follow_up_date = @followUpDate, updated_at = @now
         WHERE id = @id`
      )
      .run({
        id: input.id,
        visitId: input.visitId ?? null,
        dentistId: input.referredByDentistId ?? null,
        doctor: input.externalDoctor ?? null,
        specialty: input.specialty ?? null,
        organization: input.organization ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        reason: input.reason ?? null,
        notes: input.notes ?? null,
        referralDate: input.referralDate,
        followUpStatus: input.followUpStatus,
        followUpDate: input.followUpDate ?? null,
        now
      })
    ctx.audit.write({
      module: 'patients',
      action: 'referral_update',
      entityType: 'referral',
      entityId: input.id,
      summary: `Updated referral of patient #${input.patientId}`,
      detail: { specialty: input.specialty ?? null, organization: input.organization ?? null }
    })
    const row = ctx.db.prepare('SELECT * FROM referrals WHERE id = ?').get(input.id) as ReferralRow
    return mapReferral(row)
  }

  const result = ctx.db
    .prepare(
      `INSERT INTO referrals (patient_id, visit_id, referred_by_dentist_id, external_doctor, specialty, organization,
         address, phone, reason, notes, referral_date, follow_up_status, follow_up_date, created_by, created_at, updated_at)
       VALUES (@patientId, @visitId, @dentistId, @doctor, @specialty, @organization, @address, @phone, @reason, @notes,
         @referralDate, @followUpStatus, @followUpDate, @createdBy, @now, @now)`
    )
    .run({
      patientId: input.patientId,
      visitId: input.visitId ?? null,
      dentistId: input.referredByDentistId ?? null,
      doctor: input.externalDoctor ?? null,
      specialty: input.specialty ?? null,
      organization: input.organization ?? null,
      address: input.address ?? null,
      phone: input.phone ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      referralDate: input.referralDate,
      followUpStatus: input.followUpStatus,
      followUpDate: input.followUpDate ?? null,
      createdBy: ctx.actor.userId || null,
      now
    })

  const id = Number(result.lastInsertRowid)
  ctx.audit.write({
    module: 'patients',
    action: 'referral_create',
    entityType: 'referral',
    entityId: id,
    summary: `Referred patient #${input.patientId} to ${input.organization ?? input.externalDoctor ?? input.specialty ?? 'external provider'}`,
    detail: { referralDate: input.referralDate }
  })
  const row = ctx.db.prepare('SELECT * FROM referrals WHERE id = ?').get(id) as ReferralRow
  return mapReferral(row)
}

export function deleteReferral(ctx: ServiceContext, id: number): { ok: true } {
  assertPermission(ctx, 'patients.edit')
  const row = ctx.db.prepare('SELECT * FROM referrals WHERE id = ? AND is_deleted = 0').get(id) as ReferralRow | undefined
  if (!row) throw notFoundError('referral', id)
  ctx.db.prepare('UPDATE referrals SET is_deleted = 1, updated_at = ? WHERE id = ?').run(ctx.now(), id)
  ctx.audit.write({
    module: 'patients',
    action: 'referral_delete',
    entityType: 'referral',
    entityId: id,
    summary: `Deleted referral of patient #${row.patient_id}`
  })
  return { ok: true }
}

export function listReferralFollowUps(
  ctx: ServiceContext,
  input: { status: string, limit: number }
): Array<ReferralRecord & { patientName: string, patientCode: string }> {
  assertPermission(ctx, 'patients.view')
  const params: string[] = []
  const clauses = ['r.is_deleted = 0', 'p.is_deleted = 0']
  if (input.status !== 'all') {
    clauses.push('r.follow_up_status = ?')
    params.push(input.status)
  }
  const rows = ctx.db
    .prepare(
      `SELECT r.*, p.full_name AS patient_name, p.code AS patient_code, u.full_name AS created_by_name
       FROM referrals r
       JOIN patients p ON p.id = r.patient_id
       LEFT JOIN users u ON u.id = r.created_by
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(r.follow_up_date, r.referral_date) ASC, r.id ASC
       LIMIT ?`
    )
    .all(...params, Math.min(Math.max(input.limit, 1), 200)) as Array<ReferralRow & { patient_name: string, patient_code: string }>
  return rows.map((row) => ({ ...mapReferral(row), patientName: row.patient_name, patientCode: row.patient_code }))
}

/* ------------------------------------------------------------------- Summary */

export interface PatientSummaryRecord {
  patient: PatientRecord
  financials: PatientFinancialSummary
  lastVisit: { id: number, visitNo: string, at: number, diagnosis: string | null, dentistName: string } | null
  allergies: string | null
  medicalHistory: string | null
  activeChartFindings: Array<{ toothCode: string, conditionCode: string, note: string | null }>
}

export function getPatientSummary(ctx: ServiceContext, id: number): PatientSummaryRecord {
  const patient = getPatient(ctx, id)
  const financials = getPatientFinancials(ctx, id)

  const lastVisit = ctx.actor.permissions.has('clinical.view')
    ? (ctx.db
        .prepare(
          `SELECT v.id, v.visit_no AS visitNo, v.visit_at AS at, v.diagnosis, d.full_name AS dentistName
           FROM visits v JOIN dentists d ON d.id = v.dentist_id
           WHERE v.patient_id = ? AND v.is_deleted = 0 ORDER BY v.visit_at DESC LIMIT 1`
        )
        .get(id) as { id: number, visitNo: string, at: number, diagnosis: string | null, dentistName: string } | undefined) ?? null
    : null

  const activeChartFindings = ctx.actor.permissions.has('clinical.view')
    ? (ctx.db
        .prepare(
          `SELECT tooth_code AS toothCode, condition_code AS conditionCode, note
           FROM dental_chart_entries WHERE patient_id = ? AND status = 'active' ORDER BY tooth_code`
        )
        .all(id) as Array<{ toothCode: string, conditionCode: string, note: string | null }>)
    : []

  return {
    patient,
    financials,
    lastVisit,
    allergies: patient.allergies,
    medicalHistory: patient.medicalHistory,
    activeChartFindings
  }
}

/** Guard used by other modules: throws unless the patient exists and is not archived. */
export function assertPatientActive(ctx: ServiceContext, patientId: number): void {
  const row = ctx.db.prepare('SELECT status, is_deleted FROM patients WHERE id = ?').get(patientId) as { status: string, is_deleted: number } | undefined
  if (!row || row.is_deleted === 1) throw notFoundError('patient', patientId)
  if (row.status === 'archived') {
    throw new AppError('E_STATE', 'This patient is archived. Restore the record before adding new activity.', { detail: { patientId } })
  }
}

/** Bulk counts used by the dashboard, reports and integrity checks. */
export function countPatients(ctx: ServiceContext, includeArchived = false): number {
  const row = ctx.db
    .prepare(`SELECT COUNT(*) AS count FROM patients WHERE ${includeArchived ? '1 = 1' : 'is_deleted = 0'}`)
    .get() as { count: number }
  return row.count
}

export function patientsAddedBetween(ctx: ServiceContext, fromDate: string, toDate: string): number {
  const row = ctx.db
    .prepare('SELECT COUNT(*) AS count FROM patients WHERE is_deleted = 0 AND registration_date BETWEEN ? AND ?')
    .get(fromDate, toDate) as { count: number }
  return row.count
}
