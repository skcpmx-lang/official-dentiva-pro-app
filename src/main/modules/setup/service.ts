import type { ServiceContext } from '../../context'
import { AppError, stateError, validationError } from '@shared/errors'
import { applySettings, getClinicProfile, getNumberSetting, readSettings, writeClinicProfile, type ClinicProfileInput } from '../settings/service'
import { listDentists, upsertDentist, type DentistInput, type DentistRecord } from '../dentists/service'
import { hashPassword, validatePasswordStrength, DEFAULT_POLICY } from '../../auth/password'
import { expandRolePermissions } from '@shared/permissions'
import { isActivated } from '../../activation/service'
import { normalizeBengali } from '@shared/bengali'
import { SETTING_DEFAULTS } from '../settings/defaults'

export interface SetupStatus {
  activated: boolean
  needsSetup: boolean
  hasClinic: boolean
  dentistCount: number
  hasAdministrator: boolean
  adminUsername: string | null
}

export interface SetupAdministratorInput {
  fullName: string
  username: string
  password: string
  confirmPassword: string
  dentistId?: number | null
}

/** Settings the wizard is allowed to write before an administrator exists. */
const SETUP_SETTING_KEYS = new Set(
  Object.keys(SETTING_DEFAULTS).filter((key) => !key.startsWith('setup.') && !key.startsWith('security.') && key !== 'backup.lastRunAt')
)

function setupCompletedAt(ctx: ServiceContext): string {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE key = 'setup.completedAt'").get() as { value: string } | undefined
  return row?.value ?? ''
}

export function isSetupComplete(ctx: ServiceContext): boolean {
  return setupCompletedAt(ctx).length > 0
}

function assertSetupPending(ctx: ServiceContext): void {
  if (isSetupComplete(ctx)) {
    throw stateError('The clinic setup has already been completed. Change these details in Settings instead.')
  }
}

export function getSetupStatus(ctx: ServiceContext): SetupStatus {
  const clinic = getClinicProfile(ctx)
  const admin = ctx.db.prepare('SELECT username FROM users WHERE is_deleted = 0 ORDER BY id LIMIT 1').get() as { username: string } | undefined
  const dentistCount = (ctx.db.prepare('SELECT COUNT(*) AS count FROM dentists WHERE is_deleted = 0').get() as { count: number }).count
  const hasClinic = clinic.name.trim().length > 0
  return {
    activated: isActivated(ctx.db),
    needsSetup: !isSetupComplete(ctx),
    hasClinic,
    dentistCount,
    hasAdministrator: Boolean(admin),
    adminUsername: admin?.username ?? null
  }
}

export function saveClinicStep(ctx: ServiceContext, input: ClinicProfileInput): ReturnType<typeof writeClinicProfile> {
  assertSetupPending(ctx)
  if (!isActivated(ctx.db)) throw new AppError('E_LICENSE', 'Activate Dentiva Pro before running the setup wizard.')
  return writeClinicProfile(ctx, input)
}

export function saveDentistsStep(ctx: ServiceContext, dentists: DentistInput[]): DentistRecord[] {
  assertSetupPending(ctx)
  if (dentists.length === 0) throw validationError('Add at least one dentist to continue.', { dentists: 'At least one dentist is required.' })
  const saved: DentistRecord[] = []
  for (const dentist of dentists) {
    const existing = listDentists(ctx, { includeInactive: true }).find((entry) => entry.fullName.toLowerCase() === dentist.fullName.trim().toLowerCase())
    saved.push(upsertDentist(ctx, { ...dentist, id: dentist.id ?? existing?.id ?? null }))
  }
  return saved
}

export function saveAdministratorStep(ctx: ServiceContext, input: SetupAdministratorInput): { userId: number, username: string } {
  assertSetupPending(ctx)
  const errors: Record<string, string> = {}
  const fullName = normalizeBengali(input.fullName).trim()
  if (fullName.length < 2) errors.fullName = 'Enter the administrator’s full name.'
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(input.username)) errors.username = 'Use 3–32 characters: letters, numbers, dot, dash or underscore.'
  if (input.password !== input.confirmPassword) errors.confirmPassword = 'Passwords do not match.'
  const problems = validatePasswordStrength(input.password, { ...DEFAULT_POLICY, minLength: 8 })
  if (problems.length > 0) errors.password = problems.join(' ')
  if (Object.keys(errors).length > 0) throw new AppError('E_VALIDATION', 'Please correct the administrator details.', { fieldErrors: errors })

  const existing = ctx.db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  if (existing.count > 0) throw stateError('An administrator already exists. Sign in and add further users from Settings → Users.')

  const ownerRole = ctx.db.prepare("SELECT id FROM roles WHERE code = 'owner'").get() as { id: number } | undefined
  const roleId = ownerRole?.id ?? (ctx.db.prepare('SELECT id FROM roles ORDER BY id LIMIT 1').get() as { id: number }).id

  // Guarantee the owner role actually carries the full permission set, whatever happened to seeds.
  const linkCount = ctx.db.prepare('SELECT COUNT(*) AS count FROM role_permissions WHERE role_id = ?').get(roleId) as { count: number }
  if (linkCount.count === 0) {
    const insert = ctx.db.prepare('INSERT OR IGNORE INTO role_permissions (role_id, permission_code) VALUES (?, ?)')
    for (const code of expandRolePermissions({ permissions: '*' })) insert.run(roleId, code)
  }

  const now = ctx.now()
  const result = ctx.db
    .prepare(
      `INSERT INTO users (username, password_hash, password_algo, password_updated_at, must_change_password, staff_id, dentist_id, role_id, full_name, is_active, created_at, updated_at)
       VALUES (@username, @passwordHash, 'scrypt', @now, 0, NULL, @dentistId, @roleId, @fullName, 1, @now, @now)`
    )
    .run({
      username: input.username,
      passwordHash: hashPassword(input.password),
      dentistId: input.dentistId ?? null,
      roleId,
      fullName,
      now
    })

  const userId = Number(result.lastInsertRowid)
  ctx.audit.write({
    module: 'setup',
    action: 'setup.administrator',
    entityType: 'user',
    entityId: userId,
    summary: `Administrator account created (${input.username})`
  })
  return { userId, username: input.username }
}

export function savePreferencesStep(ctx: ServiceContext, values: Record<string, string>): Record<string, string> {
  assertSetupPending(ctx)
  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!SETUP_SETTING_KEYS.has(key)) continue
    filtered[key] = value
  }
  if (Object.keys(filtered).length === 0) return readSettings(ctx)
  return applySettings(ctx, filtered)
}

export interface SetupSummary {
  clinic: ReturnType<typeof getClinicProfile>
  dentists: DentistRecord[]
  administrator: { fullName: string, username: string }
  preferences: Record<string, string>
  dataDirectory: string
  backupDirectory: string
}

export function getSetupSummary(ctx: ServiceContext): SetupSummary {
  const dentistRows = ctx.db.prepare('SELECT id FROM dentists WHERE is_deleted = 0 ORDER BY sort_order, full_name').all() as Array<{ id: number }>
  const admin = ctx.db.prepare('SELECT full_name, username FROM users WHERE is_deleted = 0 ORDER BY id LIMIT 1').get() as { full_name: string, username: string } | undefined
  const settings = readSettings(ctx)
  const selectedKeys = ['practice.dateFormat', 'practice.timeFormat', 'practice.appointmentDuration', 'practice.autoLockMinutes', 'print.defaultPaperClass', 'invoice.numberPrefix', 'backup.frequencyDays', 'backup.folder']
  const preferences: Record<string, string> = {}
  for (const key of selectedKeys) preferences[key] = settings[key] ?? ''
  return {
    clinic: getClinicProfile(ctx),
    dentists: dentistRows.map((row) => listDentists(ctx, { includeInactive: true }).find((dentist) => dentist.id === row.id)!).filter(Boolean),
    administrator: { fullName: admin?.full_name ?? '', username: admin?.username ?? '' },
    preferences,
    dataDirectory: ctx.host.paths.dataDir,
    backupDirectory: settings['backup.folder']?.trim() ? settings['backup.folder'].trim() : ctx.host.paths.defaultBackupDir
  }
}

export function completeSetup(ctx: ServiceContext, confirmation: string): { completed: true, completedAt: number } {
  assertSetupPending(ctx)
  const status = getSetupStatus(ctx)
  if (!status.hasClinic) throw validationError('Complete the clinic information step before finishing setup.', { step: 'Clinic information' })
  if (status.dentistCount === 0) throw validationError('Add at least one dentist before finishing setup.', { step: 'Dentists' })
  if (!status.hasAdministrator) throw validationError('Create the administrator account before finishing setup.', { step: 'Administrator' })

  const clinic = getClinicProfile(ctx)
  const expected = clinic.name.trim()
  if (confirmation.trim().toLowerCase() !== expected.toLowerCase()) {
    throw validationError('Type the clinic name exactly as entered to confirm the setup.', { confirmation: `Type “${expected}” to confirm.` })
  }

  const now = ctx.now()
  const run = ctx.db.transaction(() => {
    const upsert = ctx.db.prepare(
      `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, NULL)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    upsert.run('setup.completedAt', String(now), now)
    upsert.run('setup.appVersion', ctx.host.build.version, now)
  })
  run()

  ctx.audit.write({ module: 'setup', action: 'setup.complete', summary: `Clinic setup completed for “${expected}”` })
  ctx.db
    .prepare('INSERT INTO system_events (at, level, source, code, message, detail_json) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now, 'info', 'setup', 'SETUP_COMPLETE', 'Initial clinic setup completed', JSON.stringify({ version: ctx.host.build.version }))
  return { completed: true, completedAt: now }
}

/** Used by the sign-in screen and the router to decide which stage of the app to show. */
export function resolveStage(ctx: ServiceContext): 'activation' | 'setup' | 'login' | 'ready' {
  if (!isActivated(ctx.db)) return 'activation'
  if (!isSetupComplete(ctx)) return 'setup'
  return 'login'
}

export function autoLockMinutes(ctx: ServiceContext): number {
  const minutes = getNumberSetting(ctx, 'practice.autoLockMinutes')
  return Number.isFinite(minutes) ? minutes : 10
}

