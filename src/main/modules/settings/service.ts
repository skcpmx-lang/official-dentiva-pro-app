import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { AppError, notFoundError, validationError } from '@shared/errors'
import { SETTING_DEFS, SETTING_DEFAULTS, displaySettings, isKnownSetting, settingDef } from './defaults'
import { sanitizePrefix } from '@shared/identifiers'
import { normalizeBengali } from '@shared/bengali'

export type SettingsMap = Record<string, string>

export interface ClinicProfile {
  name: string
  nameBn: string | null
  logoPath: string | null
  address: string | null
  addressBn: string | null
  phone: string | null
  altPhone: string | null
  email: string | null
  website: string | null
  openingTime: string | null
  closingTime: string | null
  weeklyClosedDays: number[]
  footerMessage: string | null
  invoiceFooter: string | null
  prescriptionFooter: string | null
  emergencyInstruction: string | null
}

/** All settings, defaults applied, with types left as strings for the IPC boundary. */
export function getAllSettings(ctx: ServiceContext): SettingsMap {
  assertPermission(ctx, 'settings.view')
  const rows = ctx.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string, value: string }>
  const result: SettingsMap = { ...SETTING_DEFAULTS }
  for (const row of rows) {
    if (isKnownSetting(row.key)) result[row.key] = row.value
  }
  return result
}

export function getSetting(ctx: ServiceContext, key: string): string {
  if (!isKnownSetting(key)) throw validationError(`Unknown setting: ${key}`)
  const row = ctx.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? SETTING_DEFAULTS[key] ?? ''
}

/**
 * Display-only settings for the renderer bootstrap: formats, density, working hours. Readable before
 * sign-in and by every role, because the interface cannot render a date or a table without them.
 */
export function getDisplaySettings(ctx: ServiceContext): SettingsMap {
  const defaults = displaySettings(SETTING_DEFAULTS)
  const rows = ctx.db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string, value: string }>
  const stored: SettingsMap = {}
  for (const row of rows) {
    if (row.key in defaults) stored[row.key] = row.value
  }
  return { ...defaults, ...stored }
}

export function getSettingSafe(ctx: ServiceContext, key: string, fallback = ''): string {
  try {
    return getSetting(ctx, key)
  } catch {
    return fallback
  }
}

export function getNumberSetting(ctx: ServiceContext, key: string): number {
  const value = Number(getSettingSafe(ctx, key))
  const def = settingDef(key)
  if (!Number.isFinite(value)) return def ? Number(def.default) : 0
  return value
}

export function getBooleanSetting(ctx: ServiceContext, key: string): boolean {
  return getSettingSafe(ctx, key) === 'true'
}

function validateSettingValue(key: string, value: string): string {
  const def = settingDef(key)
  if (!def) throw validationError(`Unknown setting: ${key}`)
  switch (def.type) {
    case 'number': {
      const numeric = Number(value)
      if (!Number.isFinite(numeric)) throw validationError(`${def.label} must be a number.`, { [key]: 'Enter a number.' })
      if (def.min !== undefined && numeric < def.min) throw validationError(`${def.label} must be at least ${def.min}.`, { [key]: `Minimum is ${def.min}.` })
      if (def.max !== undefined && numeric > def.max) throw validationError(`${def.label} must not exceed ${def.max}.`, { [key]: `Maximum is ${def.max}.` })
      return String(Math.round(numeric))
    }
    case 'boolean': {
      const normalized = value === 'true' ? 'true' : value === 'false' ? 'false' : null
      if (normalized === null) throw validationError(`${def.label} must be yes or no.`, { [key]: 'Choose yes or no.' })
      return normalized
    }
    case 'json': {
      try {
        const parsed = JSON.parse(value) as unknown
        const serialized = JSON.stringify(parsed)
        if (def.key === 'practice.weeklyClosedDays') {
          if (!Array.isArray(parsed) || parsed.some((day) => typeof day !== 'number' || day < 0 || day > 6)) {
            throw validationError('Weekly closed days must contain weekday numbers 0–6.', { [key]: 'Invalid weekday list.' })
          }
        }
        return serialized
      } catch {
        throw validationError(`${def.label} must be valid JSON.`, { [key]: 'Invalid value.' })
      }
    }
    case 'time': {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw validationError(`${def.label} must use HH:mm.`, { [key]: 'Use HH:mm.' })
      return value
    }
    case 'dateFormat':
    case 'timeFormat':
    case 'enum': {
      if (def.values && !def.values.includes(value)) {
        throw validationError(`${def.label} value is not allowed.`, { [key]: 'Choose one of the listed options.' })
      }
      return value
    }
    case 'string': {
      const trimmed = normalizeBengali(value).trim()
      if (def.key === 'invoice.numberPrefix') return sanitizePrefix(trimmed, 'INV')
      return trimmed.slice(0, 500)
    }
    default: {
      const exhaustive: never = def.type
      throw validationError(`Unsupported setting type: ${String(exhaustive)}`)
    }
  }
}

export function updateSettings(ctx: ServiceContext, values: SettingsMap): SettingsMap {
  assertPermission(ctx, 'settings.modify')
  const now = ctx.now()
  const upsert = ctx.db.prepare(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (@key, @value, @at, @userId)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  )
  const validated: SettingsMap = {}
  const apply = ctx.db.transaction(() => {
    for (const [key, raw] of Object.entries(values)) {
      const value = validateSettingValue(key, raw)
      upsert.run({ key, value, at: now, userId: ctx.actor.userId || null })
      validated[key] = value
    }
  })
  apply()
  ctx.audit.write({
    module: 'settings',
    action: 'settings.update',
    summary: `Updated ${Object.keys(values).length} setting(s)`,
    detail: { keys: Object.keys(values) }
  })
  return validated
}

/** Internal helper for services that must persist bookkeeping values without a permission check. */
export function setInternalSetting(ctx: ServiceContext, key: string, value: string): void {
  if (!isKnownSetting(key)) throw validationError(`Unknown setting: ${key}`)
  ctx.db
    .prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (@key, @value, @at, NULL)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run({ key, value, at: ctx.now() })
}

/* -------------------------------------------------------------------------- */
/* Clinic profile                                                             */
/* -------------------------------------------------------------------------- */

interface ClinicRow {
  name: string
  name_bn: string | null
  logo_path: string | null
  address: string | null
  address_bn: string | null
  phone: string | null
  alt_phone: string | null
  email: string | null
  website: string | null
  opening_time: string | null
  closing_time: string | null
  weekly_closed_days: string | null
  footer_message: string | null
  invoice_footer: string | null
  prescription_footer: string | null
  emergency_instruction: string | null
}

function mapClinic(row: ClinicRow): ClinicProfile {
  let weeklyClosedDays: number[] = []
  try {
    const parsed = JSON.parse(row.weekly_closed_days ?? '[]') as unknown
    if (Array.isArray(parsed)) weeklyClosedDays = parsed.filter((day): day is number => typeof day === 'number')
  } catch {
    weeklyClosedDays = []
  }
  return {
    name: row.name,
    nameBn: row.name_bn,
    logoPath: row.logo_path,
    address: row.address,
    addressBn: row.address_bn,
    phone: row.phone,
    altPhone: row.alt_phone,
    email: row.email,
    website: row.website,
    openingTime: row.opening_time,
    closingTime: row.closing_time,
    weeklyClosedDays,
    footerMessage: row.footer_message,
    invoiceFooter: row.invoice_footer,
    prescriptionFooter: row.prescription_footer,
    emergencyInstruction: row.emergency_instruction
  }
}

export function getClinicProfile(ctx: ServiceContext): ClinicProfile {
  const row = ctx.db.prepare('SELECT * FROM clinic WHERE id = 1').get() as ClinicRow | undefined
  if (!row) throw notFoundError('clinic profile', 1)
  return mapClinic(row)
}

export function getClinicProfileSafe(ctx: ServiceContext): ClinicProfile | null {
  try {
    return getClinicProfile(ctx)
  } catch {
    return null
  }
}

export interface ClinicProfileInput {
  name: string
  nameBn?: string | null
  logoPath?: string | null
  address?: string | null
  addressBn?: string | null
  phone?: string | null
  altPhone?: string | null
  email?: string | null
  website?: string | null
  openingTime?: string | null
  closingTime?: string | null
  weeklyClosedDays?: number[]
  footerMessage?: string | null
  invoiceFooter?: string | null
  prescriptionFooter?: string | null
  emergencyInstruction?: string | null
}

export function updateClinicProfile(ctx: ServiceContext, input: ClinicProfileInput): ClinicProfile {
  assertPermission(ctx, 'settings.modify')
  const errors: Record<string, string> = {}
  const name = normalizeBengali(input.name ?? '').trim()
  if (name.length < 2) errors['clinic.name'] = 'Enter the clinic name (at least 2 characters).'
  if (name.length > 120) errors['clinic.name'] = 'Clinic name is too long.'
  if (input.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors['clinic.email'] = 'Enter a valid email address.'
  if (input.website && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(input.website)) errors['clinic.website'] = 'Enter a valid website address.'
  for (const [key, value] of [['clinic.openingTime', input.openingTime], ['clinic.closingTime', input.closingTime]] as const) {
    if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) errors[key] = 'Use HH:mm (24-hour).'
  }
  if (input.weeklyClosedDays) {
    for (const day of input.weeklyClosedDays) {
      if (!Number.isInteger(day) || day < 0 || day > 6) errors['clinic.weeklyClosedDays'] = 'Weekday values must be between Sunday (0) and Saturday (6).'
    }
  }
  if (Object.keys(errors).length > 0) throw new AppError('E_VALIDATION', 'Please correct the highlighted clinic details.', { fieldErrors: errors })

  const now = ctx.now()
  ctx.db
    .prepare(
      `UPDATE clinic SET
         name = @name, name_bn = @nameBn, logo_path = @logoPath, address = @address, address_bn = @addressBn,
         phone = @phone, alt_phone = @altPhone, email = @email, website = @website,
         opening_time = @openingTime, closing_time = @closingTime, weekly_closed_days = @weeklyClosedDays,
         footer_message = @footerMessage, invoice_footer = @invoiceFooter, prescription_footer = @prescriptionFooter,
         emergency_instruction = @emergencyInstruction, updated_at = @now
       WHERE id = 1`
    )
    .run({
      name,
      nameBn: input.nameBn ? normalizeBengali(input.nameBn).trim() : null,
      logoPath: input.logoPath ?? null,
      address: input.address ?? null,
      addressBn: input.addressBn ? normalizeBengali(input.addressBn).trim() : null,
      phone: input.phone ?? null,
      altPhone: input.altPhone ?? null,
      email: input.email ?? null,
      website: input.website ?? null,
      openingTime: input.openingTime ?? null,
      closingTime: input.closingTime ?? null,
      weeklyClosedDays: JSON.stringify(input.weeklyClosedDays ?? []),
      footerMessage: input.footerMessage ?? null,
      invoiceFooter: input.invoiceFooter ?? null,
      prescriptionFooter: input.prescriptionFooter ?? null,
      emergencyInstruction: input.emergencyInstruction ?? null,
      now
    })

  ctx.audit.write({ module: 'settings', action: 'clinic.update', entityType: 'clinic', entityId: 1, summary: 'Clinic profile updated' })
  return getClinicProfile(ctx)
}

export { SETTING_DEFS }
