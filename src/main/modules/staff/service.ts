import { z } from 'zod'
import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, notFoundError, validationError } from '@shared/errors'
import type { zStaffInput } from '@shared/contracts'

export type StaffInput = z.infer<typeof zStaffInput>

export interface StaffRecord {
  id: number
  fullName: string
  fullNameBn: string | null
  dob: string | null
  gender: string
  address: string | null
  phone: string | null
  emergencyContact: string | null
  bloodGroup: string | null
  nationalId: string | null
  photoPath: string | null
  designation: string | null
  department: string | null
  salaryMicro: number | null
  joiningDate: string | null
  employmentStatus: string
  notes: string | null
  linkedUserId: number | null
  linkedUsername: string | null
  createdAt: number
}

interface StaffRow {
  id: number
  full_name: string
  full_name_bn: string | null
  dob: string | null
  gender: string | null
  address: string | null
  phone: string | null
  emergency_contact: string | null
  blood_group: string | null
  national_id: string | null
  photo_path: string | null
  designation: string | null
  department: string | null
  salary_micro: number | null
  joining_date: string | null
  employment_status: string
  notes: string | null
  linked_user_id: number | null
  linked_username: string | null
  created_at: number
}

const STAFF_SELECT = `
  SELECT s.id, s.full_name, s.full_name_bn, s.dob, s.gender, s.address, s.phone, s.emergency_contact, s.blood_group,
         s.national_id, s.photo_path, s.designation, s.department, s.salary_micro, s.joining_date, s.employment_status,
         s.notes, s.created_at,
         u.id AS linked_user_id, u.username AS linked_username
    FROM staff s
    LEFT JOIN users u ON u.staff_id = s.id AND u.is_deleted = 0
   WHERE s.is_deleted = 0`

function mapStaff(row: StaffRow): StaffRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    fullNameBn: row.full_name_bn,
    dob: row.dob,
    gender: row.gender ?? 'unspecified',
    address: row.address,
    phone: row.phone,
    emergencyContact: row.emergency_contact,
    bloodGroup: row.blood_group,
    nationalId: row.national_id,
    photoPath: row.photo_path,
    designation: row.designation,
    department: row.department,
    salaryMicro: row.salary_micro,
    joiningDate: row.joining_date,
    employmentStatus: row.employment_status,
    notes: row.notes,
    linkedUserId: row.linked_user_id,
    linkedUsername: row.linked_username,
    createdAt: row.created_at
  }
}

export function listStaff(
  ctx: ServiceContext,
  filter: { search?: string, status?: string, includeArchived?: boolean, limit?: number, offset?: number } = {}
): { items: StaffRecord[], total: number } {
  assertPermission(ctx, 'staff.view')
  const conditions = ['1 = 1']
  const params: Record<string, unknown> = {}
  if (filter.search) {
    conditions.push('(s.full_name LIKE @search OR COALESCE(s.phone, \'\') LIKE @search OR COALESCE(s.designation, \'\') LIKE @search)')
    params.search = `%${filter.search.replace(/[%_]/g, '')}%`
  }
  if (filter.status) {
    conditions.push('s.employment_status = @status')
    params.status = filter.status
  }
  const where = conditions.join(' AND ')
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM staff s WHERE s.is_deleted = 0 AND ${where}`).get(params) as { count: number }).count
  const limit = filter.limit ?? 100
  const offset = filter.offset ?? 0
  const rows = ctx.db
    .prepare(`${STAFF_SELECT} AND ${where} ORDER BY s.employment_status = 'active' DESC, s.full_name LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as StaffRow[]
  return { items: rows.map(mapStaff), total }
}

export function getStaff(ctx: ServiceContext, id: number): StaffRecord {
  assertPermission(ctx, 'staff.view')
  const row = ctx.db.prepare(`${STAFF_SELECT} AND s.id = ?`).get(id) as StaffRow | undefined
  if (!row) throw notFoundError('staff member', id)
  return mapStaff(row)
}

export function saveStaff(ctx: ServiceContext, input: StaffInput): StaffRecord {
  assertPermission(ctx, 'staff.manage')
  const errors: Record<string, string> = {}
  if (input.fullName.trim().length < 2) errors.fullName = 'Enter the staff member’s full name.'
  if (input.phone && input.phone.replace(/\D/g, '').length < 6) errors.phone = 'Enter a valid phone number.'
  if (input.nationalId && !/^[0-9]{6,20}$/.test(input.nationalId.replace(/[\s-]/g, ''))) errors.nationalId = 'National ID should contain 6–20 digits.'
  if (input.salaryMicro !== null && input.salaryMicro !== undefined && input.salaryMicro < 0) errors.salaryMicro = 'Salary cannot be negative.'
  if (Object.keys(errors).length > 0) throw new AppError('E_VALIDATION', 'Please correct the highlighted staff details.', { fieldErrors: errors })

  const now = ctx.now()
  const payload = {
    id: input.id ?? 0,
    fullName: input.fullName,
    fullNameBn: input.fullNameBn ?? null,
    dob: input.dob ?? null,
    gender: input.gender,
    address: input.address ?? null,
    phone: input.phone ?? null,
    emergencyContact: input.emergencyContact ?? null,
    bloodGroup: input.bloodGroup ?? null,
    nationalId: input.nationalId ?? null,
    designation: input.designation ?? null,
    department: input.department ?? null,
    salaryMicro: input.salaryMicro ?? null,
    joiningDate: input.joiningDate ?? null,
    employmentStatus: input.employmentStatus,
    notes: input.notes ?? null,
    now
  }

  const run = ctx.db.transaction(() => {
    if (payload.id) {
      const exists = ctx.db.prepare('SELECT id FROM staff WHERE id = ? AND is_deleted = 0').get(payload.id) as { id: number } | undefined
      if (!exists) throw notFoundError('staff member', payload.id)
      ctx.db
        .prepare(
          `UPDATE staff SET full_name = @fullName, full_name_bn = @fullNameBn, dob = @dob, gender = @gender, address = @address,
             phone = @phone, emergency_contact = @emergencyContact, blood_group = @bloodGroup, national_id = @nationalId,
             designation = @designation, department = @department, salary_micro = @salaryMicro, joining_date = @joiningDate,
             employment_status = @employmentStatus, notes = @notes, updated_at = @now
           WHERE id = @id`
        )
        .run(payload)
      return payload.id
    }
    const result = ctx.db
      .prepare(
        `INSERT INTO staff (full_name, full_name_bn, dob, gender, address, phone, emergency_contact, blood_group, national_id,
           designation, department, salary_micro, joining_date, employment_status, notes, created_at, updated_at)
         VALUES (@fullName, @fullNameBn, @dob, @gender, @address, @phone, @emergencyContact, @bloodGroup, @nationalId,
           @designation, @department, @salaryMicro, @joiningDate, @employmentStatus, @notes, @now, @now)`
      )
      .run(payload)
    return Number(result.lastInsertRowid)
  })

  const staffId = run()
  ctx.audit.write({
    module: 'staff',
    action: input.id ? 'staff.update' : 'staff.create',
    entityType: 'staff',
    entityId: staffId,
    summary: `${input.id ? 'Updated' : 'Added'} staff member ${input.fullName}`
  })
  return getStaff(ctx, staffId)
}

export function archiveStaff(ctx: ServiceContext, id: number, reason: string | null): void {
  assertPermission(ctx, 'staff.manage')
  const staff = getStaff(ctx, id)
  if (staff.linkedUserId) {
    throw validationError('This staff member has a user account. Deactivate or remove the account first, or mark the staff member as resigned.')
  }
  ctx.db.prepare("UPDATE staff SET is_deleted = 1, employment_status = 'terminated', notes = COALESCE(@reason, notes), updated_at = @now WHERE id = @id").run({
    id,
    reason,
    now: ctx.now()
  })
  ctx.audit.write({ module: 'staff', action: 'staff.archive', entityType: 'staff', entityId: id, summary: `Archived staff member ${staff.fullName}` })
}

export function updateStaffPhoto(ctx: ServiceContext, id: number, photoPath: string | null): StaffRecord {
  assertPermission(ctx, 'staff.manage')
  getStaff(ctx, id)
  ctx.db.prepare('UPDATE staff SET photo_path = ?, updated_at = ? WHERE id = ?').run(photoPath, ctx.now(), id)
  ctx.audit.write({ module: 'staff', action: 'staff.photo', entityType: 'staff', entityId: id, summary: 'Staff photo updated' })
  return getStaff(ctx, id)
}
