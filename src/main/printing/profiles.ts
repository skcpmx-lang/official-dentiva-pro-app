import type { ServiceContext } from '../context'
import { assertPermission } from '../context'
import { conflictError, notFoundError, validationError } from '@shared/errors'
import type { zPrintProfileInput } from '@shared/contracts'
import type { z } from 'zod'
import type { ResolvedProfileLike } from './documents'

/**
 * Printer profiles.
 *
 * A profile binds a document type to a printer and a paper layout (class, custom millimetres, thermal
 * width, orientation, margins, scale and copies). Each document type has at most one default profile, so
 * the print dialog opens with the layout the clinic actually uses, and the profile can be exercised with
 * a test page before a patient is waiting for a prescription.
 */

export type PrintProfileInput = z.infer<typeof zPrintProfileInput>

export interface PrintProfileRecord {
  id: number
  name: string
  documentType: string
  printerName: string | null
  paperClass: string
  customWidthMm: number | null
  customHeightMm: number | null
  thermalWidthMm: number
  orientation: string
  marginsMm: { top: number, right: number, bottom: number, left: number }
  scaleBp: number
  copies: number
  isDefault: boolean
  isActive: boolean
  notes: string | null
  createdByName: string | null
  createdAt: number
  updatedAt: number
}

interface ProfileRow {
  id: number
  name: string
  document_type: string
  printer_name: string | null
  paper_class: string
  custom_width_mm: number | null
  custom_height_mm: number | null
  thermal_width_mm: number | null
  orientation: string
  margin_top_mm: number
  margin_right_mm: number
  margin_bottom_mm: number
  margin_left_mm: number
  scale_bp: number
  copies: number
  is_default: number
  is_active: number
  notes: string | null
  created_by_name: string | null
  created_at: number
  updated_at: number
}

const PROFILE_SELECT = `
  SELECT p.id, p.name, p.document_type, p.printer_name, p.paper_class, p.custom_width_mm, p.custom_height_mm,
         p.thermal_width_mm, p.orientation, p.margin_top_mm, p.margin_right_mm, p.margin_bottom_mm,
         p.margin_left_mm, p.scale_bp, p.copies, p.is_default, p.is_active, p.notes,
         u.full_name AS created_by_name, p.created_at, p.updated_at
    FROM print_profiles p
    LEFT JOIN users u ON u.id = p.created_by
   WHERE p.is_deleted = 0`

function mapProfile(row: ProfileRow): PrintProfileRecord {
  return {
    id: row.id,
    name: row.name,
    documentType: row.document_type,
    printerName: row.printer_name,
    paperClass: row.paper_class,
    customWidthMm: row.custom_width_mm,
    customHeightMm: row.custom_height_mm,
    thermalWidthMm: row.thermal_width_mm ?? 80,
    orientation: row.orientation,
    marginsMm: {
      top: row.margin_top_mm,
      right: row.margin_right_mm,
      bottom: row.margin_bottom_mm,
      left: row.margin_left_mm
    },
    scaleBp: row.scale_bp,
    copies: row.copies,
    isDefault: row.is_default === 1,
    isActive: row.is_active === 1,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listPrintProfiles(ctx: ServiceContext, includeInactive = false): PrintProfileRecord[] {
  assertPermission(ctx, 'printing.configure')
  const rows = ctx.db
    .prepare(`${PROFILE_SELECT} ${includeInactive ? '' : 'AND p.is_active = 1'} ORDER BY p.document_type, p.is_default DESC, p.name`)
    .all() as ProfileRow[]
  return rows.map(mapProfile)
}

export function getPrintProfile(ctx: ServiceContext, id: number): PrintProfileRecord {
  assertPermission(ctx, 'printing.configure')
  const row = ctx.db.prepare(`${PROFILE_SELECT} AND p.id = ?`).get(id) as ProfileRow | undefined
  if (!row) throw notFoundError('printer profile', id)
  return mapProfile(row)
}

/** The default profile for a document type, if the clinic defined one. */
export function defaultProfileFor(ctx: ServiceContext, documentType: string): PrintProfileRecord | null {
  const row = ctx.db
    .prepare(`${PROFILE_SELECT} AND p.document_type = ? AND p.is_active = 1 ORDER BY p.is_default DESC, p.id LIMIT 1`)
    .get(documentType) as ProfileRow | undefined
  return row ? mapProfile(row) : null
}

export function resolveProfileFor(ctx: ServiceContext, documentType: string, profileId: number | null | undefined): ResolvedProfileLike | null {
  if (profileId) {
    const profile = getPrintProfile(ctx, profileId)
    if (!profile.isActive) throw validationError('That printer profile is inactive. Activate it or choose another.')
    if (profile.documentType !== documentType && profile.documentType !== 'test') {
      throw validationError(`Profile “${profile.name}” is set up for ${profile.documentType.replace('_', ' ')} documents, not this one.`)
    }
    return profile
  }
  return defaultProfileFor(ctx, documentType)
}

export function savePrintProfile(ctx: ServiceContext, input: PrintProfileInput): PrintProfileRecord {
  assertPermission(ctx, 'printing.configure')
  const id = input.id ?? null
  const duplicate = ctx.db
    .prepare('SELECT id FROM print_profiles WHERE name = ? COLLATE NOCASE AND is_deleted = 0 AND id <> ?')
    .get(input.name, id ?? 0) as { id: number } | undefined
  if (duplicate) throw conflictError('A printer profile with that name already exists.')

  const now = ctx.now()
  const payload = {
    id: id ?? 0,
    name: input.name,
    documentType: input.documentType,
    printerName: input.printerName ?? null,
    paperClass: input.paperClass,
    customWidthMm: input.customWidthMm ?? null,
    customHeightMm: input.customHeightMm ?? null,
    thermalWidthMm: input.thermalWidthMm,
    orientation: input.orientation,
    top: input.marginsMm.top,
    right: input.marginsMm.right,
    bottom: input.marginsMm.bottom,
    left: input.marginsMm.left,
    scaleBp: input.scaleBp,
    copies: input.copies,
    isDefault: input.isDefault ? 1 : 0,
    isActive: input.isActive ? 1 : 0,
    notes: input.notes ?? null,
    userId: ctx.actor.userId,
    now
  }

  const run = ctx.db.transaction(() => {
    let profileId = payload.id
    if (profileId) {
      const exists = ctx.db.prepare('SELECT id FROM print_profiles WHERE id = ? AND is_deleted = 0').get(profileId) as { id: number } | undefined
      if (!exists) throw notFoundError('printer profile', profileId)
      ctx.db
        .prepare(
          `UPDATE print_profiles SET name = @name, document_type = @documentType, printer_name = @printerName,
             paper_class = @paperClass, custom_width_mm = @customWidthMm, custom_height_mm = @customHeightMm,
             thermal_width_mm = @thermalWidthMm, orientation = @orientation, margin_top_mm = @top,
             margin_right_mm = @right, margin_bottom_mm = @bottom, margin_left_mm = @left, scale_bp = @scaleBp,
             copies = @copies, is_default = @isDefault, is_active = @isActive, notes = @notes, updated_at = @now
           WHERE id = @id`
        )
        .run(payload)
    } else {
      const result = ctx.db
        .prepare(
          `INSERT INTO print_profiles (name, document_type, printer_name, paper_class, custom_width_mm,
             custom_height_mm, thermal_width_mm, orientation, margin_top_mm, margin_right_mm, margin_bottom_mm,
             margin_left_mm, scale_bp, copies, is_default, is_active, notes, created_by, created_at, updated_at)
           VALUES (@name, @documentType, @printerName, @paperClass, @customWidthMm, @customHeightMm,
             @thermalWidthMm, @orientation, @top, @right, @bottom, @left, @scaleBp, @copies, @isDefault,
             @isActive, @notes, @userId, @now, @now)`
        )
        .run(payload)
      profileId = Number(result.lastInsertRowid)
    }
    /* Only one default per document type: making a profile default clears the previous one. */
    if (input.isDefault) {
      ctx.db
        .prepare('UPDATE print_profiles SET is_default = 0, updated_at = @now WHERE document_type = @documentType AND id <> @id AND is_deleted = 0')
        .run({ now, documentType: input.documentType, id: profileId })
    }
    return profileId
  })

  const profileId = run()
  ctx.audit.write({
    module: 'printing',
    action: id ? 'profile.update' : 'profile.create',
    entityType: 'print_profile',
    entityId: profileId,
    summary: `${id ? 'Updated' : 'Created'} printer profile ${input.name}`,
    detail: { documentType: input.documentType, paperClass: input.paperClass }
  })
  return getPrintProfile(ctx, profileId)
}

export function archivePrintProfile(ctx: ServiceContext, id: number, reason: string | null): void {
  assertPermission(ctx, 'printing.configure')
  const profile = getPrintProfile(ctx, id)
  ctx.db
    .prepare('UPDATE print_profiles SET is_deleted = 1, is_active = 0, is_default = 0, notes = COALESCE(@reason, notes), updated_at = @now WHERE id = @id')
    .run({ id, reason, now: ctx.now() })
  ctx.audit.write({
    module: 'printing',
    action: 'profile.archive',
    entityType: 'print_profile',
    entityId: id,
    summary: `Archived printer profile ${profile.name}`,
    detail: { reason }
  })
}
