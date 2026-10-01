import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import {AppError, notFoundError } from '@shared/errors'
import { z } from 'zod'
import type { zDentistInput } from '@shared/contracts'
import { normalizeBengali } from '@shared/bengali'

export type DentistInput = z.infer<typeof zDentistInput>

export interface DentistRecord {
  id: number
  fullName: string
  fullNameBn: string | null
  photoPath: string | null
  phone: string | null
  email: string | null
  registrationNo: string | null
  signatureLabel: string | null
  color: string | null
  isActive: boolean
  sortOrder: number
  designations: string[]
  qualifications: Array<{ title: string, institution: string | null, year: number | null }>
  schedules: Array<{ weekday: number, startTime: string, endTime: string, slotMinutes: number, isActive: boolean }>
}

interface DentistRow {
  id: number
  full_name: string
  full_name_bn: string | null
  photo_path: string | null
  phone: string | null
  email: string | null
  registration_no: string | null
  signature_label: string | null
  color: string | null
  is_active: number
  sort_order: number
}

function loadDentist(ctx: ServiceContext, id: number): DentistRecord | null {
  const row = ctx.db.prepare('SELECT * FROM dentists WHERE id = ? AND is_deleted = 0').get(id) as DentistRow | undefined
  if (!row) return null
  const designations = (
    ctx.db.prepare('SELECT title FROM dentist_designations WHERE dentist_id = ? ORDER BY sort_order, id').all(id) as Array<{ title: string }>
  ).map((entry) => entry.title)
  const qualifications = ctx.db
    .prepare('SELECT title, institution, year FROM dentist_qualifications WHERE dentist_id = ? ORDER BY sort_order, id')
    .all(id) as Array<{ title: string, institution: string | null, year: number | null }>
  const schedules = ctx.db
    .prepare('SELECT weekday, start_time, end_time, slot_minutes, is_active FROM dentist_schedules WHERE dentist_id = ? ORDER BY weekday, start_time')
    .all(id) as Array<{ weekday: number, start_time: string, end_time: string, slot_minutes: number, is_active: number }>
  return {
    id: row.id,
    fullName: row.full_name,
    fullNameBn: row.full_name_bn,
    photoPath: row.photo_path,
    phone: row.phone,
    email: row.email,
    registrationNo: row.registration_no,
    signatureLabel: row.signature_label,
    color: row.color,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
    designations,
    qualifications,
    schedules: schedules.map((schedule) => ({
      weekday: schedule.weekday,
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      slotMinutes: schedule.slot_minutes,
      isActive: schedule.is_active === 1
    }))
  }
}

/**
 * The dentist as the IPC contract describes it (`zDentist`): the record plus the two list fields the
 * screens render. Two callers need this shape — the dentist channels and the setup wizard's summary —
 * which is why it lives with the domain type instead of in one handler.
 */
export function dentistForContract(dentist: DentistRecord): DentistRecord & { designationList: string[], qualificationList: string[] } {
  return {
    ...dentist,
    designationList: dentist.designations,
    qualificationList: dentist.qualifications.map((qualification) => qualification.title)
  }
}

export function listDentists(ctx: ServiceContext, options: { includeInactive?: boolean } = {}): DentistRecord[] {
  const rows = ctx.db
    .prepare(`SELECT id FROM dentists WHERE is_deleted = 0 ${options.includeInactive ? '' : 'AND is_active = 1'} ORDER BY sort_order, full_name`)
    .all() as Array<{ id: number }>
  return rows.map((row) => loadDentist(ctx, row.id)).filter((dentist): dentist is DentistRecord => dentist !== null)
}

export function getDentist(ctx: ServiceContext, id: number): DentistRecord {
  const dentist = loadDentist(ctx, id)
  if (!dentist) throw notFoundError('dentist', id)
  return dentist
}

/**
 * Create or update a dentist together with all designations, qualifications and schedule rows.
 * Designations/qualifications are multi-entry by design (a dentist typically lists several).
 */
export function saveDentist(ctx: ServiceContext, input: DentistInput): DentistRecord {
  assertPermission(ctx, 'settings.modify')
  return upsertDentist(ctx, input)
}

/**
 * Create or update a dentist without a permission check.
 *
 * The setup wizard's dentist step runs before any operator account exists; it is guarded by
 * `assertSetupPending` in `setup/service.ts`. The Settings screen and every other caller go through
 * `saveDentist`, which asserts `settings.modify` first.
 */
export function upsertDentist(ctx: ServiceContext, input: DentistInput): DentistRecord {
  const errors: Record<string, string> = {}
  const fullName = normalizeBengali(input.fullName).trim()
  if (fullName.length < 2) errors.fullName = 'Enter the dentist’s full name.'
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.email = 'Enter a valid email address.'
  if (input.phone && input.phone.replace(/\D/g, '').length < 6) errors.phone = 'Enter a valid phone number.'
  for (const schedule of input.schedules) {
    if (schedule.startTime >= schedule.endTime) errors.schedules = `${schedule.startTime}–${schedule.endTime} is not a valid schedule window.`
  }
  if (Object.keys(errors).length > 0) throw new AppError('E_VALIDATION', 'Please correct the highlighted dentist details.', { fieldErrors: errors })

  const now = ctx.now()
  const run = ctx.db.transaction(() => {
    let dentistId = input.id ?? 0
    if (dentistId) {
      const exists = ctx.db.prepare('SELECT id FROM dentists WHERE id = ? AND is_deleted = 0').get(dentistId) as { id: number } | undefined
      if (!exists) throw notFoundError('dentist', dentistId)
      ctx.db
        .prepare(
          `UPDATE dentists SET full_name = @fullName, full_name_bn = @fullNameBn, phone = @phone, email = @email,
             registration_no = @registrationNo, signature_label = @signatureLabel, color = @color,
             is_active = @isActive, sort_order = @sortOrder, updated_at = @now WHERE id = @id`
        )
        .run({
          id: dentistId,
          fullName,
          fullNameBn: input.fullNameBn ? normalizeBengali(input.fullNameBn) : null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          registrationNo: input.registrationNo ?? null,
          signatureLabel: input.signatureLabel ?? null,
          color: input.color ?? null,
          isActive: input.isActive ? 1 : 0,
          sortOrder: input.sortOrder,
          now
        })
    } else {
      const result = ctx.db
        .prepare(
          `INSERT INTO dentists (full_name, full_name_bn, phone, email, registration_no, signature_label, color, is_active, sort_order, created_at, updated_at)
           VALUES (@fullName, @fullNameBn, @phone, @email, @registrationNo, @signatureLabel, @color, @isActive, @sortOrder, @now, @now)`
        )
        .run({
          fullName,
          fullNameBn: input.fullNameBn ? normalizeBengali(input.fullNameBn) : null,
          phone: input.phone ?? null,
          email: input.email ?? null,
          registrationNo: input.registrationNo ?? null,
          signatureLabel: input.signatureLabel ?? null,
          color: input.color ?? null,
          isActive: input.isActive ? 1 : 0,
          sortOrder: input.sortOrder,
          now
        })
      dentistId = Number(result.lastInsertRowid)
    }

    ctx.db.prepare('DELETE FROM dentist_designations WHERE dentist_id = ?').run(dentistId)
    const insertDesignation = ctx.db.prepare('INSERT INTO dentist_designations (dentist_id, title, sort_order) VALUES (?, ?, ?)')
    input.designations.forEach((title, index) => insertDesignation.run(dentistId, normalizeBengali(title).trim(), index))

    ctx.db.prepare('DELETE FROM dentist_qualifications WHERE dentist_id = ?').run(dentistId)
    const insertQualification = ctx.db.prepare('INSERT INTO dentist_qualifications (dentist_id, title, institution, year, sort_order) VALUES (?, ?, ?, ?, ?)')
    input.qualifications.forEach((qualification, index) =>
      insertQualification.run(dentistId, normalizeBengali(qualification.title).trim(), qualification.institution ?? null, qualification.year ?? null, index)
    )

    ctx.db.prepare('DELETE FROM dentist_schedules WHERE dentist_id = ?').run(dentistId)
    const insertSchedule = ctx.db.prepare(
      'INSERT OR REPLACE INTO dentist_schedules (dentist_id, weekday, start_time, end_time, slot_minutes, is_active) VALUES (?, ?, ?, ?, ?, ?)'
    )
    for (const schedule of input.schedules) {
      insertSchedule.run(dentistId, schedule.weekday, schedule.startTime, schedule.endTime, schedule.slotMinutes, schedule.isActive ? 1 : 0)
    }
    return dentistId
  })

  const dentistId = run()
  ctx.audit.write({
    module: 'dentists',
    action: input.id ? 'dentist.update' : 'dentist.create',
    entityType: 'dentist',
    entityId: dentistId,
    summary: `${input.id ? 'Updated' : 'Added'} dentist ${fullName}`,
    detail: { designations: input.designations.length, qualifications: input.qualifications.length }
  })
  return getDentist(ctx, dentistId)
}

export function setDentistActive(ctx: ServiceContext, id: number, isActive: boolean): DentistRecord {
  assertPermission(ctx, 'settings.modify')
  getDentist(ctx, id)
  ctx.db.prepare('UPDATE dentists SET is_active = ?, updated_at = ? WHERE id = ?').run(isActive ? 1 : 0, ctx.now(), id)
  ctx.audit.write({
    module: 'dentists',
    action: isActive ? 'dentist.activate' : 'dentist.deactivate',
    entityType: 'dentist',
    entityId: id,
    summary: `Dentist ${isActive ? 'activated' : 'deactivated'}`
  })
  return getDentist(ctx, id)
}

export function updateDentistPhoto(ctx: ServiceContext, id: number, photoPath: string | null): DentistRecord {
  assertPermission(ctx, 'settings.modify')
  getDentist(ctx, id)
  ctx.db.prepare('UPDATE dentists SET photo_path = ?, updated_at = ? WHERE id = ?').run(photoPath, ctx.now(), id)
  ctx.audit.write({ module: 'dentists', action: 'dentist.photo', entityType: 'dentist', entityId: id, summary: 'Dentist photo updated' })
  return getDentist(ctx, id)
}

/**
 * Dentists referenced by clinical history can never be deleted; they are deactivated so historical
 * documents keep a valid, resolvable author.
 */
export function archiveDentist(ctx: ServiceContext, id: number): { archived: boolean, deactivatedOnly: boolean } {
  assertPermission(ctx, 'settings.modify')
  getDentist(ctx, id)
  const references = ctx.db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM visits WHERE dentist_id = @id)
            + (SELECT COUNT(*) FROM prescriptions WHERE dentist_id = @id)
            + (SELECT COUNT(*) FROM appointments WHERE dentist_id = @id) AS count`
    )
    .get({ id }) as { count: number }
  if (references.count > 0) {
    ctx.db.prepare('UPDATE dentists SET is_active = 0, updated_at = ? WHERE id = ?').run(ctx.now(), id)
    ctx.audit.write({
      module: 'dentists',
      action: 'dentist.deactivate',
      entityType: 'dentist',
      entityId: id,
      summary: 'Dentist deactivated (kept for clinical history)',
      detail: { references: references.count }
    })
    return { archived: false, deactivatedOnly: true }
  }
  ctx.db.prepare('UPDATE dentists SET is_deleted = 1, is_active = 0, updated_at = ? WHERE id = ?').run(ctx.now(), id)
  ctx.audit.write({ module: 'dentists', action: 'dentist.delete', entityType: 'dentist', entityId: id, summary: 'Dentist removed' })
  return { archived: true, deactivatedOnly: false }
}

/** Dentists allowed to see appointments on a given weekday, used by the appointment scheduler. */
export function dentistsOnDuty(ctx: ServiceContext, weekday: number): DentistRecord[] {
  return listDentists(ctx).filter((dentist) =>
    dentist.schedules.some((schedule) => schedule.weekday === weekday && schedule.isActive)
  )
}

