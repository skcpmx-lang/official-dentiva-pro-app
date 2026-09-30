import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, notFoundError, stateError, validationError } from '@shared/errors'
import { foldForSearch, normalizeBengali } from '@shared/bengali'
import { rangeFromDates, resolveRange, toLocalDate } from '@shared/datetime'
import { nextCode } from '../../db/counters'
import type { ResolvedRange } from '@shared/datetime'
import type { zMedicineInput, zPrescriptionInput, zPrescriptionTemplateInput } from '@shared/contracts'
import { z } from 'zod'

export type MedicineInput = z.infer<typeof zMedicineInput>
export type PrescriptionInput = z.infer<typeof zPrescriptionInput>
export type PrescriptionTemplateInput = z.infer<typeof zPrescriptionTemplateInput>

export interface MedicineRecord extends MedicineInput {
  id: number
  prescriptionId: number
}

export interface PrescriptionRecord {
  id: number
  rxNo: string
  patientId: number
  patientCode: string
  patientName: string
  patientNameBn: string | null
  patientAgeYears: number | null
  patientGender: string
  patientPhone: string | null
  dentistId: number
  dentistName: string
  dentistNameBn: string | null
  dentistDesignations: string[]
  dentistRegistrationNo: string | null
  dentistSignatureLabel: string | null
  visitId: number | null
  prescriptionAt: number
  diagnosis: string | null
  ccText: string | null
  oeText: string | null
  reText: string | null
  advice: string | null
  followUpDate: string | null
  notes: string | null
  printedCount: number
  lastPrintedAt: number | null
  createdAt: number
  updatedAt: number
  medicines: MedicineRecord[]
}

interface PrescriptionRow {
  id: number
  rx_no: string
  patient_id: number
  dentist_id: number
  visit_id: number | null
  prescription_at: number
  prescription_date: string
  age_snapshot: number | null
  diagnosis: string | null
  cc_text: string | null
  oe_text: string | null
  re_text: string | null
  advice: string | null
  follow_up_date: string | null
  notes: string | null
  printed_count: number
  last_printed_at: number | null
  created_at: number
  updated_at: number
}

/**
 * Prescriptions.
 *
 * A prescription is an immutable clinical document: once saved and printed it is not silently rewritten.
 * Edits are allowed with `prescriptions.edit` and are audited; deletion is a soft delete with a reason.
 * The printed header always comes from the dentist record that signed it (name, degrees, BMDC number),
 * never from whichever dentist happens to be signed in.
 */

function ageFromDob(dob: string | null, ageYears: number | null, atMs: number): number | null {
  if (!dob) return ageYears
  const [year, month, day] = dob.split('-').map((part) => Number.parseInt(part, 10))
  if (!year || !month || !day) return ageYears
  const at = new Date(atMs)
  let age = at.getFullYear() - year
  if (at.getMonth() + 1 < month || (at.getMonth() + 1 === month && at.getDate() < day)) age -= 1
  return age >= 0 && age <= 130 ? age : ageYears
}

function loadPatient(ctx: ServiceContext, patientId: number, forWrite: boolean): {
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
  if (forWrite && (row.is_deleted === 1 || row.status !== 'active')) {
    throw stateError('This patient record is archived. Restore it before writing a prescription.')
  }
  return {
    code: row.code,
    name: row.full_name,
    nameBn: row.full_name_bn,
    ageYears: ageFromDob(row.dob, row.age_years, ctx.now()),
    gender: row.gender,
    phone: row.phone
  }
}

function loadDentist(ctx: ServiceContext, dentistId: number, forWrite: boolean): {
  name: string
  nameBn: string | null
  designations: string[]
  registrationNo: string | null
  signatureLabel: string | null
} {
  const row = ctx.db.prepare('SELECT * FROM dentists WHERE id = ? AND is_deleted = 0').get(dentistId) as
    | { full_name: string, full_name_bn: string | null, registration_no: string | null, signature_label: string | null, is_active: number }
    | undefined
  if (!row) throw notFoundError('dentist', dentistId)
  if (forWrite && row.is_active !== 1) throw stateError('That dentist is inactive. Choose an active dentist for a new prescription.')
  const designations = (
    ctx.db.prepare('SELECT title FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order, id').all(dentistId) as Array<{ title: string }>
  ).map((entry) => entry.title)
  return {
    name: row.full_name,
    nameBn: row.full_name_bn,
    designations,
    registrationNo: row.registration_no,
    signatureLabel: row.signature_label
  }
}

function mapMedicines(ctx: ServiceContext, prescriptionId: number): MedicineRecord[] {
  const rows = ctx.db
    .prepare('SELECT * FROM prescription_medicines WHERE prescription_id = ? ORDER BY sort_order, id')
    .all(prescriptionId) as Array<Record<string, unknown>>
  return rows.map((raw) => ({
    id: raw.id as number,
    prescriptionId: raw.prescription_id as number,
    sortOrder: raw.sort_order as number,
    medicineName: raw.medicine_name as string,
    form: raw.form as MedicineRecord['form'],
    strength: (raw.strength as string | null) ?? null,
    unit: (raw.unit as string | null) ?? null,
    doseMorning: (raw.dose_morning as string | null) ?? null,
    doseAfternoon: (raw.dose_afternoon as string | null) ?? null,
    doseNight: (raw.dose_night as string | null) ?? null,
    timing: ((raw.timing as string | null) ?? 'after_meal') as MedicineRecord['timing'],
    frequency: (raw.frequency as string | null) ?? null,
    durationDays: (raw.duration_days as number | null) ?? null,
    durationText: (raw.duration_text as string | null) ?? null,
    quantity: (raw.quantity as string | null) ?? null,
    isPrn: raw.is_prn === 1,
    instructions: (raw.instructions as string | null) ?? null
  })) as MedicineRecord[]
}

export function getPrescription(ctx: ServiceContext, id: number): PrescriptionRecord {
  assertPermission(ctx, 'prescriptions.view')
  const row = ctx.db.prepare('SELECT * FROM prescriptions WHERE id = ? AND is_deleted = 0').get(id) as PrescriptionRow | undefined
  if (!row) throw notFoundError('prescription', id)
  const patient = loadPatient(ctx, row.patient_id, false)
  const dentist = loadDentist(ctx, row.dentist_id, false)
  return {
    id: row.id,
    rxNo: row.rx_no,
    patientId: row.patient_id,
    patientCode: patient.code,
    patientName: patient.name,
    patientNameBn: patient.nameBn,
    patientAgeYears: row.age_snapshot ?? patient.ageYears,
    patientGender: patient.gender,
    patientPhone: patient.phone,
    dentistId: row.dentist_id,
    dentistName: dentist.name,
    dentistNameBn: dentist.nameBn,
    dentistDesignations: dentist.designations,
    dentistRegistrationNo: dentist.registrationNo,
    dentistSignatureLabel: dentist.signatureLabel,
    visitId: row.visit_id,
    prescriptionAt: row.prescription_at,
    diagnosis: row.diagnosis,
    ccText: row.cc_text,
    oeText: row.oe_text,
    reText: row.re_text,
    advice: row.advice,
    followUpDate: row.follow_up_date,
    notes: row.notes,
    printedCount: row.printed_count,
    lastPrintedAt: row.last_printed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    medicines: mapMedicines(ctx, id)
  }
}

export function listPrescriptions(
  ctx: ServiceContext,
  filter: { patientId?: number, dentistId?: number, search?: string, range?: { preset: string, from?: string | null, to?: string | null }, limit?: number, offset?: number }
): { items: PrescriptionRecord[], total: number, limit: number, offset: number } {
  assertPermission(ctx, 'prescriptions.view')
  const limit = Math.min(Math.max(filter.limit ?? 25, 1), 200)
  const offset = Math.max(filter.offset ?? 0, 0)
  const customRange = filter.range?.from && filter.range?.to ? rangeFromDates(filter.range.from, filter.range.to) : undefined
  const range = resolveRange((filter.range?.preset ?? 'all') as ResolvedRange['preset'], ctx.now(), customRange)

  const clauses = ['rx.is_deleted = 0', 'rx.prescription_at BETWEEN @from AND @to']
  const params: Record<string, unknown> = { from: range.from, to: range.to, limit, offset }
  if (filter.patientId) {
    clauses.push('rx.patient_id = @patientId')
    params.patientId = filter.patientId
  }
  if (filter.dentistId) {
    clauses.push('rx.dentist_id = @dentistId')
    params.dentistId = filter.dentistId
  }
  if (filter.search && filter.search.trim().length > 0) {
    const term = `%${filter.search.trim()}%`
    const fold = `%${foldForSearch(filter.search.trim())}%`
    clauses.push(`(rx.rx_no LIKE @term OR p.code LIKE @term OR p.full_name_fold LIKE @fold OR p.full_name LIKE @term
      OR COALESCE(p.full_name_bn, '') LIKE @term OR rx.diagnosis LIKE @term
      OR EXISTS (SELECT 1 FROM prescription_medicines m WHERE m.prescription_id = rx.id AND m.medicine_fold LIKE @fold))`)
    params.term = term
    params.fold = fold
  }
  const where = clauses.join(' AND ')
  const total = (
    ctx.db.prepare(`SELECT COUNT(*) AS count FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id WHERE ${where}`).get(params) as { count: number }
  ).count
  const ids = ctx.db
    .prepare(`SELECT rx.id FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id WHERE ${where} ORDER BY rx.prescription_at DESC, rx.id DESC LIMIT @limit OFFSET @offset`)
    .all(params) as Array<{ id: number }>
  return { items: ids.map((row) => getPrescription(ctx, row.id)), total, limit, offset }
}

function insertMedicines(ctx: ServiceContext, prescriptionId: number, medicines: MedicineInput[]): void {
  const insert = ctx.db.prepare(
    `INSERT INTO prescription_medicines (prescription_id, sort_order, medicine_name, medicine_fold, form, strength, unit,
       dose_morning, dose_afternoon, dose_night, timing, frequency, duration_days, duration_text, quantity, is_prn, instructions)
     VALUES (@prescriptionId, @sortOrder, @medicineName, @medicineFold, @form, @strength, @unit,
       @doseMorning, @doseAfternoon, @doseNight, @timing, @frequency, @durationDays, @durationText, @quantity, @isPrn, @instructions)`
  )
  medicines.forEach((medicine, index) => {
    insert.run({
      prescriptionId,
      sortOrder: medicine.sortOrder || index + 1,
      medicineName: normalizeBengali(medicine.medicineName).trim(),
      medicineFold: foldForSearch(medicine.medicineName.trim()),
      form: medicine.form,
      strength: medicine.strength ?? null,
      unit: medicine.unit ?? null,
      doseMorning: medicine.doseMorning ?? null,
      doseAfternoon: medicine.doseAfternoon ?? null,
      doseNight: medicine.doseNight ?? null,
      timing: medicine.timing,
      frequency: medicine.frequency ?? null,
      durationDays: medicine.durationDays ?? null,
      durationText: medicine.durationText ?? null,
      quantity: medicine.quantity ?? null,
      isPrn: medicine.isPrn ? 1 : 0,
      instructions: medicine.instructions ?? null
    })
  })
}

function validatePrescription(input: PrescriptionInput): void {
  const errors: Record<string, string> = {}
  if (input.prescriptionAt > Date.now() + 86_400_000) errors.prescriptionAt = 'A prescription cannot be dated in the future.'
  for (const [index, medicine] of input.medicines.entries()) {
    if (normalizeBengali(medicine.medicineName).trim().length === 0) errors[`medicines.${index}.medicineName`] = 'Enter the medicine name.'
    const hasDose = Boolean(medicine.doseMorning || medicine.doseAfternoon || medicine.doseNight || medicine.isPrn || medicine.frequency)
    if (!hasDose) errors[`medicines.${index}.dose`] = 'Record a dose or mark the medicine as PRN.'
    if (medicine.durationDays === null || medicine.durationDays === undefined) {
      if (!medicine.durationText) errors[`medicines.${index}.duration`] = 'Enter the duration (for example “5 days”) or a number of days.'
    }
  }
  if (Object.keys(errors).length > 0) {
    throw new AppError('E_VALIDATION', 'Please complete the prescription before saving it.', { fieldErrors: errors })
  }
}

export function savePrescription(ctx: ServiceContext, input: PrescriptionInput): PrescriptionRecord {
  const creating = !input.id
  assertPermission(ctx, creating ? 'prescriptions.create' : 'prescriptions.edit')
  validatePrescription(input)

  const patient = loadPatient(ctx, input.patientId, true)
  loadDentist(ctx, input.dentistId, true)
  if (input.visitId) {
    const visit = ctx.db.prepare('SELECT patient_id FROM visits WHERE id = ? AND is_deleted = 0').get(input.visitId) as
      | { patient_id: number }
      | undefined
    if (!visit) throw notFoundError('visit', input.visitId)
    if (visit.patient_id !== input.patientId) throw validationError('The selected visit belongs to a different patient.')
  }

  const now = ctx.now()
  return ctx.db.transaction(() => {
    if (creating) {
      const rxNo = nextCode(ctx.db, 'prescription', input.prescriptionAt)
      const result = ctx.db
        .prepare(
          `INSERT INTO prescriptions (rx_no, patient_id, dentist_id, visit_id, prescription_at, prescription_date, age_snapshot, diagnosis,
             cc_text, oe_text, re_text, advice, follow_up_date, notes, printed_count, created_by, created_at, updated_at)
           VALUES (@rxNo, @patientId, @dentistId, @visitId, @prescriptionAt, @prescriptionDate, @ageSnapshot, @diagnosis,
             @ccText, @oeText, @reText, @advice, @followUpDate, @notes, 0, @createdBy, @now, @now)`
        )
        .run({
          rxNo,
          patientId: input.patientId,
          dentistId: input.dentistId,
          visitId: input.visitId ?? null,
          prescriptionAt: input.prescriptionAt,
          prescriptionDate: toLocalDate(input.prescriptionAt),
          ageSnapshot: patient.ageYears,
          diagnosis: input.diagnosis ?? null,
          ccText: input.ccText ?? null,
          oeText: input.oeText ?? null,
          reText: input.reText ?? null,
          advice: input.advice ?? null,
          followUpDate: input.followUpDate ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.actor.userId,
          now
        })
      const id = Number(result.lastInsertRowid)
      insertMedicines(ctx, id, input.medicines)
      ctx.audit.write({
        module: 'prescriptions',
        action: 'create',
        entityType: 'prescription',
        entityId: id,
        summary: `Wrote prescription ${rxNo} (${input.medicines.length} medicine(s)) for ${patient.name}`,
        detail: { patientId: input.patientId, dentistId: input.dentistId }
      })
      return getPrescription(ctx, id)
    }

    const existing = ctx.db.prepare('SELECT * FROM prescriptions WHERE id = ? AND is_deleted = 0').get(input.id as number) as PrescriptionRow | undefined
    if (!existing) throw notFoundError('prescription', input.id)
    const changedFields: string[] = []
    if (existing.diagnosis !== (input.diagnosis ?? null)) changedFields.push('diagnosis')
    if (existing.cc_text !== (input.ccText ?? null)) changedFields.push('ccText')
    if (existing.oe_text !== (input.oeText ?? null)) changedFields.push('oeText')
    if (existing.re_text !== (input.reText ?? null)) changedFields.push('reText')
    if (existing.advice !== (input.advice ?? null)) changedFields.push('advice')

    ctx.db
      .prepare(
        `UPDATE prescriptions SET dentist_id = @dentistId, visit_id = @visitId, prescription_at = @prescriptionAt,
           prescription_date = @prescriptionDate, diagnosis = @diagnosis, cc_text = @ccText, oe_text = @oeText, re_text = @reText,
           advice = @advice, follow_up_date = @followUpDate, notes = @notes, updated_at = @now, updated_by = @updatedBy
         WHERE id = @id`
      )
      .run({
        id: input.id,
        dentistId: input.dentistId,
        visitId: input.visitId ?? null,
        prescriptionAt: input.prescriptionAt,
        prescriptionDate: toLocalDate(input.prescriptionAt),
        diagnosis: input.diagnosis ?? null,
        ccText: input.ccText ?? null,
        oeText: input.oeText ?? null,
        reText: input.reText ?? null,
        advice: input.advice ?? null,
        followUpDate: input.followUpDate ?? null,
        notes: input.notes ?? null,
        updatedBy: ctx.actor.userId,
        now
      })
    ctx.db.prepare('DELETE FROM prescription_medicines WHERE prescription_id = ?').run(input.id)
    insertMedicines(ctx, input.id as number, input.medicines)
    changedFields.push('medicines')
    ctx.audit.write({
      module: 'prescriptions',
      action: 'update',
      entityType: 'prescription',
      entityId: input.id,
      summary: `Amended prescription ${existing.rx_no}`,
      detail: { changedFields, printedBefore: existing.printed_count > 0 }
    })
    return getPrescription(ctx, input.id as number)
  })()
}

export function deletePrescription(ctx: ServiceContext, input: { id: number, reason: string }): { ok: true } {
  assertPermission(ctx, 'prescriptions.edit')
  const row = ctx.db.prepare('SELECT * FROM prescriptions WHERE id = ? AND is_deleted = 0').get(input.id) as PrescriptionRow | undefined
  if (!row) throw notFoundError('prescription', input.id)
  if (row.printed_count > 0) {
    throw stateError('This prescription has been printed and forms part of the clinical record. It cannot be deleted.')
  }
  const now = ctx.now()
  ctx.db.transaction(() => {
    ctx.db.prepare('UPDATE prescriptions SET is_deleted = 1, updated_at = ? WHERE id = ?').run(now, input.id)
    ctx.audit.write({
      module: 'prescriptions',
      action: 'delete',
      entityType: 'prescription',
      entityId: input.id,
      summary: `Deleted unprinted prescription ${row.rx_no}`,
      detail: { reason: input.reason }
    })
  })()
  return { ok: true }
}

export function duplicatePrescription(ctx: ServiceContext, id: number): PrescriptionRecord {
  assertPermission(ctx, 'prescriptions.create')
  const source = getPrescription(ctx, id)
  return savePrescription(ctx, {
    id: null,
    patientId: source.patientId,
    dentistId: source.dentistId,
    visitId: null,
    prescriptionAt: ctx.now(),
    diagnosis: source.diagnosis,
    ccText: source.ccText,
    oeText: source.oeText,
    reText: source.reText,
    advice: source.advice,
    followUpDate: null,
    notes: source.notes,
    medicines: source.medicines.map((medicine, index) => ({ ...medicine, sortOrder: index + 1 }))
  })
}

export function medicineHistory(ctx: ServiceContext, input: { search?: string, limit?: number }): Array<{
  medicineName: string
  form: string
  strength: string | null
  lastUsedAt: number
  useCount: number
}> {
  assertPermission(ctx, 'prescriptions.view')
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100)
  const params: Record<string, unknown> = { limit }
  let searchClause = ''
  if (input.search && input.search.trim().length > 0) {
    searchClause = 'AND m.medicine_fold LIKE @fold'
    params.fold = `%${foldForSearch(input.search.trim())}%`
  }
  return ctx.db
    .prepare(
      `SELECT m.medicine_name AS medicineName, m.form AS form, MAX(m.strength) AS strength,
              MAX(rx.prescription_at) AS lastUsedAt, COUNT(*) AS useCount
       FROM prescription_medicines m
       JOIN prescriptions rx ON rx.id = m.prescription_id AND rx.is_deleted = 0
       WHERE 1 = 1 ${searchClause}
       GROUP BY m.medicine_fold
       ORDER BY useCount DESC, lastUsedAt DESC
       LIMIT @limit`
    )
    .all(params) as Array<{ medicineName: string, form: string, strength: string | null, lastUsedAt: number, useCount: number }>
}

/**
 * Advice library: the most frequently written advice lines, offered as one-click snippets.
 * Derived from real prescriptions, so the library learns from this clinic's own practice.
 */
export function adviceLibrary(ctx: ServiceContext): string[] {
  assertPermission(ctx, 'prescriptions.view')
  const rows = ctx.db
    .prepare(
      `SELECT advice, COUNT(*) AS useCount FROM prescriptions
       WHERE is_deleted = 0 AND advice IS NOT NULL AND length(trim(advice)) BETWEEN 3 AND 400
       GROUP BY advice ORDER BY useCount DESC, MAX(prescription_at) DESC LIMIT 30`
    )
    .all() as Array<{ advice: string, useCount: number }>
  return rows.map((row) => row.advice)
}

/* -------------------------------------------------------------------- templates */

export function listTemplates(ctx: ServiceContext): Array<{
  id: number
  name: string
  dentistId: number | null
  isActive: boolean
  medicines: MedicineInput[]
  createdBy: string | null
  createdAt: number
  usageCount: number
}> {
  assertPermission(ctx, 'prescriptions.view')
  const rows = ctx.db.prepare('SELECT * FROM prescription_templates WHERE is_active = 1 ORDER BY name').all() as Array<{
    id: number
    name: string
    dentist_id: number | null
    is_active: number
    created_by: number | null
    created_at: number
  }>
  return rows.map((row) => {
    const medicines = ctx.db
      .prepare('SELECT * FROM prescription_template_medicines WHERE template_id = ? ORDER BY sort_order, id')
      .all(row.id) as Array<Record<string, unknown>>
    const creator = row.created_by
      ? ((ctx.db.prepare('SELECT full_name FROM users WHERE id = ?').get(row.created_by) as { full_name: string } | undefined)?.full_name ?? null)
      : null
    const usage = ctx.db
      .prepare('SELECT COUNT(*) AS count FROM prescriptions WHERE is_deleted = 0 AND notes LIKE ?')
      .get(`%[template:${row.id}]%`) as { count: number }
    return {
      id: row.id,
      name: row.name,
      dentistId: row.dentist_id,
      isActive: row.is_active === 1,
      createdBy: creator,
      createdAt: row.created_at,
      usageCount: usage.count,
      medicines: medicines.map((raw) => ({
        sortOrder: raw.sort_order as number,
        medicineName: raw.medicine_name as string,
        form: raw.form as MedicineInput['form'],
        strength: (raw.strength as string | null) ?? null,
        unit: (raw.unit as string | null) ?? null,
        doseMorning: (raw.dose_morning as string | null) ?? null,
        doseAfternoon: (raw.dose_afternoon as string | null) ?? null,
        doseNight: (raw.dose_night as string | null) ?? null,
        timing: ((raw.timing as string | null) ?? 'after_meal') as MedicineInput['timing'],
        frequency: (raw.frequency as string | null) ?? null,
        durationDays: (raw.duration_days as number | null) ?? null,
        durationText: (raw.duration_text as string | null) ?? null,
        quantity: (raw.quantity as string | null) ?? null,
        isPrn: raw.is_prn === 1,
        instructions: (raw.instructions as string | null) ?? null
      }))
    }
  })
}

export function saveTemplate(ctx: ServiceContext, input: PrescriptionTemplateInput): ReturnType<typeof listTemplates>[number] {
  assertPermission(ctx, 'prescriptions.templates')
  if (input.medicines.length === 0) throw validationError('A template needs at least one medicine.')
  const now = ctx.now()
  const id = ctx.db.transaction(() => {
    if (input.id) {
      const existing = ctx.db.prepare('SELECT id FROM prescription_templates WHERE id = ?').get(input.id) as { id: number } | undefined
      if (!existing) throw notFoundError('prescription template', input.id)
      ctx.db
        .prepare('UPDATE prescription_templates SET name = ?, dentist_id = ?, is_active = ?, updated_at = ? WHERE id = ?')
        .run(input.name.trim(), input.dentistId ?? null, input.isActive ? 1 : 0, now, input.id)
      ctx.db.prepare('DELETE FROM prescription_template_medicines WHERE template_id = ?').run(input.id)
      insertTemplateMedicines(ctx, input.id, input.medicines)
      return input.id
    }
    const result = ctx.db
      .prepare('INSERT INTO prescription_templates (name, dentist_id, created_by, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.name.trim(), input.dentistId ?? null, ctx.actor.userId, input.isActive ? 1 : 0, now, now)
    const newId = Number(result.lastInsertRowid)
    insertTemplateMedicines(ctx, newId, input.medicines)
    return newId
  })()
  ctx.audit.write({
    module: 'prescriptions',
    action: 'template.save',
    entityType: 'prescription_template',
    entityId: id,
    summary: `${input.id ? 'Updated' : 'Created'} prescription template “${input.name}”`,
    detail: { medicines: input.medicines.length }
  })
  const template = listTemplates(ctx).find((entry) => entry.id === id)
  if (!template) throw notFoundError('prescription template', id)
  return template
}

function insertTemplateMedicines(ctx: ServiceContext, templateId: number, medicines: MedicineInput[]): void {
  const insert = ctx.db.prepare(
    `INSERT INTO prescription_template_medicines (template_id, sort_order, medicine_name, form, strength, unit, dose_morning,
       dose_afternoon, dose_night, timing, frequency, duration_days, duration_text, quantity, is_prn, instructions)
     VALUES (@templateId, @sortOrder, @medicineName, @form, @strength, @unit, @doseMorning, @doseAfternoon, @doseNight, @timing,
       @frequency, @durationDays, @durationText, @quantity, @isPrn, @instructions)`
  )
  medicines.forEach((medicine, index) => {
    insert.run({
      templateId,
      sortOrder: medicine.sortOrder || index + 1,
      medicineName: normalizeBengali(medicine.medicineName).trim(),
      form: medicine.form,
      strength: medicine.strength ?? null,
      unit: medicine.unit ?? null,
      doseMorning: medicine.doseMorning ?? null,
      doseAfternoon: medicine.doseAfternoon ?? null,
      doseNight: medicine.doseNight ?? null,
      timing: medicine.timing,
      frequency: medicine.frequency ?? null,
      durationDays: medicine.durationDays ?? null,
      durationText: medicine.durationText ?? null,
      quantity: medicine.quantity ?? null,
      isPrn: medicine.isPrn ? 1 : 0,
      instructions: medicine.instructions ?? null
    })
  })
}

export function deleteTemplate(ctx: ServiceContext, id: number): { ok: true } {
  assertPermission(ctx, 'prescriptions.templates')
  const row = ctx.db.prepare('SELECT id, name FROM prescription_templates WHERE id = ?').get(id) as { id: number, name: string } | undefined
  if (!row) throw notFoundError('prescription template', id)
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM prescription_template_medicines WHERE template_id = ?').run(id)
    ctx.db.prepare('DELETE FROM prescription_templates WHERE id = ?').run(id)
    ctx.audit.write({
      module: 'prescriptions',
      action: 'template.delete',
      entityType: 'prescription_template',
      entityId: id,
      summary: `Deleted prescription template “${row.name}”`
    })
  })()
  return { ok: true }
}

export function applyTemplate(
  ctx: ServiceContext,
  input: { templateId: number, patientId: number, dentistId: number, visitId?: number | null }
): PrescriptionRecord {
  assertPermission(ctx, 'prescriptions.create')
  const template = listTemplates(ctx).find((entry) => entry.id === input.templateId)
  if (!template) throw notFoundError('prescription template', input.templateId)
  return savePrescription(ctx, {
    id: null,
    patientId: input.patientId,
    dentistId: input.dentistId,
    visitId: input.visitId ?? null,
    prescriptionAt: ctx.now(),
    diagnosis: null,
    ccText: null,
    oeText: null,
    reText: null,
    advice: null,
    followUpDate: null,
    notes: `[template:${template.id}] ${template.name}`,
    medicines: template.medicines
  })
}

/** Called by the printing service; a printed prescription is part of the clinical record. */
export function markPrescriptionPrinted(ctx: ServiceContext, id: number, printerName: string): void {
  const now = ctx.now()
  ctx.db
    .prepare('UPDATE prescriptions SET printed_count = printed_count + 1, last_printed_at = ?, updated_at = ? WHERE id = ?')
    .run(now, now, id)
  ctx.audit.write({
    module: 'prescriptions',
    action: 'print',
    entityType: 'prescription',
    entityId: id,
    summary: `Printed prescription #${id} on ${printerName}`,
    detail: { printerName }
  })
}

export function countPrescriptions(ctx: ServiceContext): number {
  const row = ctx.db.prepare('SELECT COUNT(*) AS count FROM prescriptions WHERE is_deleted = 0').get() as { count: number }
  return row.count
}
