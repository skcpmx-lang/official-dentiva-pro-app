import { z } from 'zod'
import { channel, zExportResult, zLocalDate, zOptionalText, zRangePreset, zTrimmed } from '../ipc'

/* -------------------------------------------------------------------------- */
/* Shared value objects                                                       */
/* -------------------------------------------------------------------------- */

export const zBuildInfo = z.object({
  version: z.string(),
  buildNumber: z.string(),
  gitSha: z.string(),
  builtAt: z.string(),
  electron: z.string(),
  chromium: z.string(),
  node: z.string()
})

export const zMachineInfo = z.object({
  hostname: z.string(),
  platform: z.string(),
  osVersion: z.string(),
  arch: z.string(),
  machineId: z.string(),
  totalMemoryBytes: z.number(),
  cpuCount: z.number(),
  locale: z.string(),
  timezone: z.string(),
  displays: z.array(z.object({ width: z.number(), height: z.number(), scaleFactor: z.number() })),
  printersAvailable: z.boolean()
})

export const zActionResult = z.object({ ok: z.literal(true) })
export const zCountResult = z.object({ count: z.number() })

export const zSessionSummary = z.object({
  id: z.string(),
  userId: z.number(),
  username: z.string(),
  fullName: z.string(),
  roleCode: z.string(),
  permissions: z.array(z.string()),
  locked: z.boolean(),
  lastActivityAt: z.number(),
  autoLockMinutes: z.number(),
  mustChangePassword: z.boolean()
})

/* -------------------------------------------------------------------------- */
/* Activation                                                                 */
/* -------------------------------------------------------------------------- */

export const zActivationState = z.object({
  activated: z.boolean(),
  activatedAt: z.number().nullable(),
  attempts: z.number(),
  lastAttemptAt: z.number().nullable(),
  cooldownRemainingMs: z.number(),
  verifierIntact: z.boolean(),
  codeHint: z.object({ min: z.number(), max: z.number() })
})

/* -------------------------------------------------------------------------- */
/* Setup wizard                                                               */
/* -------------------------------------------------------------------------- */

export const zDentistInput = z.object({
  id: z.number().int().positive().nullish(),
  fullName: zTrimmed(2, 120, 'Dentist name'),
  fullNameBn: zOptionalText(120),
  phone: zOptionalText(40),
  email: zOptionalText(160),
  registrationNo: zOptionalText(60),
  signatureLabel: zOptionalText(120),
  color: zOptionalText(20),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
  designations: z.array(zTrimmed(1, 80, 'Designation')).max(12).default([]),
  qualifications: z
    .array(
      z.object({
        title: zTrimmed(1, 120, 'Qualification'),
        institution: zOptionalText(160),
        year: z.number().int().min(1900).max(2100).nullish()
      })
    )
    .max(20)
    .default([]),
  schedules: z
    .array(
      z.object({
        weekday: z.number().int().min(0).max(6),
        startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        slotMinutes: z.number().int().min(5).max(240).default(20),
        isActive: z.boolean().default(true)
      })
    )
    .max(21)
    .default([])
})

export const zDentist = zDentistInput.extend({ id: z.number(), photoPath: z.string().nullable(), designationList: z.array(z.string()), qualificationList: z.array(z.string()) })

export const zClinicProfileInput = z.object({
  name: zTrimmed(2, 120, 'Clinic name'),
  nameBn: zOptionalText(120),
  logoPath: zOptionalText(400),
  address: zOptionalText(300),
  addressBn: zOptionalText(300),
  phone: zOptionalText(40),
  altPhone: zOptionalText(40),
  email: zOptionalText(160),
  website: zOptionalText(160),
  openingTime: zOptionalText(10),
  closingTime: zOptionalText(10),
  weeklyClosedDays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  footerMessage: zOptionalText(400),
  invoiceFooter: zOptionalText(400),
  prescriptionFooter: zOptionalText(400),
  emergencyInstruction: zOptionalText(400)
})

export const zClinicProfile = zClinicProfileInput.extend({ weeklyClosedDays: z.array(z.number()), logoPath: z.string().nullable() })

export const zSetupStatus = z.object({
  activated: z.boolean(),
  needsSetup: z.boolean(),
  hasClinic: z.boolean(),
  dentistCount: z.number(),
  hasAdministrator: z.boolean(),
  adminUsername: z.string().nullable()
})

export const zSetupAdministratorInput = z.object({
  fullName: zTrimmed(2, 120, 'Full name'),
  username: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .refine((value) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value), {
      message: 'Use 3–32 characters: letters, numbers, dot, dash or underscore.'
    }),
  password: z.string().min(6).max(128),
  confirmPassword: z.string().min(6).max(128),
  dentistId: z.number().int().positive().nullish()
})

export const zSetupSummary = z.object({
  clinic: zClinicProfile,
  dentists: z.array(zDentist),
  administrator: z.object({ fullName: z.string(), username: z.string() }),
  preferences: z.record(z.string(), z.string()),
  dataDirectory: z.string(),
  backupDirectory: z.string()
})

/* -------------------------------------------------------------------------- */
/* Authentication & session                                                   */
/* -------------------------------------------------------------------------- */

export const zLoginInput = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256)
})

export const zLoginResult = z.object({
  session: zSessionSummary,
  mustChangePassword: z.boolean(),
  passwordExpired: z.boolean()
})

export const zChangePasswordInput = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(6).max(128),
  confirmPassword: z.string().min(6).max(128)
})

export const zSessionState = z.object({
  authenticated: z.boolean(),
  locked: z.boolean(),
  session: zSessionSummary.nullable()
})

/* -------------------------------------------------------------------------- */
/* Audit, system events, diagnostics                                          */
/* -------------------------------------------------------------------------- */

export const zAuditFilter = z.object({
  search: z.string().max(120).optional(),
  module: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.number().int().positive().optional(),
  userId: z.number().int().positive().optional(),
  result: z.enum(['success', 'failure']).optional(),
  range: z.object({ preset: zRangePreset, from: zLocalDate.optional(), to: zLocalDate.optional() }).optional(),
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0)
})

export const zAuditEntry = z.object({
  id: z.number(),
  at: z.number(),
  userId: z.number().nullable(),
  username: z.string().nullable(),
  module: z.string(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.number().nullable(),
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  result: z.string(),
  sessionId: z.string().nullable()
})

export const zAuditPage = z.object({ entries: z.array(zAuditEntry), total: z.number(), limit: z.number(), offset: z.number() })
export const zAuditFacets = z.object({
  modules: z.array(z.string()),
  actions: z.array(z.string()),
  users: z.array(z.object({ userId: z.number().nullable(), username: z.string().nullable() }))
})

export const zSystemEvent = z.object({
  id: z.number(),
  at: z.number(),
  level: z.string(),
  source: z.string(),
  code: z.string(),
  message: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable()
})

export const zDiagnostics = z.object({
  appVersion: z.string(),
  schemaVersion: z.number(),
  databaseSizeBytes: z.number(),
  attachmentCount: z.number(),
  attachmentBytes: z.number(),
  patientCount: z.number(),
  visitCount: z.number(),
  invoiceCount: z.number(),
  auditEntryCount: z.number(),
  lastBackupAt: z.number().nullable(),
  logDirectory: z.string(),
  dataDirectory: z.string(),
  integrityOk: z.boolean(),
  foreignKeysOk: z.boolean(),
  uptimeMs: z.number(),
  tableSizes: z.array(z.object({ table: z.string(), rows: z.number() }))
})

export const zAboutInfo = z.object({
  product: z.string(),
  version: z.string(),
  build: zBuildInfo,
  author: z.object({ name: z.string(), email: z.string() }),
  schemaVersion: z.number(),
  licence: z.object({ activatedAt: z.number().nullable(), machineId: z.string(), activatedBy: z.string().nullable() }),
  dependencies: z.array(z.object({ name: z.string(), version: z.string(), licence: z.string(), purpose: z.string() })),
  notices: z.array(z.object({ name: z.string(), licence: z.string(), text: z.string() }))
})

/* -------------------------------------------------------------------------- */
/* Channel registry                                                           */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Exported value-object types                                                */
/* -------------------------------------------------------------------------- */

export type BuildInfo = z.output<typeof zBuildInfo>
export type ClinicProfile = z.output<typeof zClinicProfile>
export type ActivationState = z.output<typeof zActivationState>
export type SetupStatus = z.output<typeof zSetupStatus>
export type SetupSummary = z.output<typeof zSetupSummary>
export type Dentist = z.output<typeof zDentist>
export type LoginResult = z.output<typeof zLoginResult>
export type DiagnosticsReport = z.output<typeof zDiagnostics>
export type MachineInfo = z.output<typeof zMachineInfo>
export type SessionSummary = z.output<typeof zSessionSummary>
export type SessionState = z.output<typeof zSessionState>
export type AuditEntry = z.output<typeof zAuditEntry>
export type AuditFilter = z.input<typeof zAuditFilter>
export type SystemEvent = z.output<typeof zSystemEvent>
export type Diagnostics = z.output<typeof zDiagnostics>
export type AboutInfo = z.output<typeof zAboutInfo>

export const systemChannels = {
  'app.bootstrap': channel(
    z.object({}).default({}),
    z.object({
      stage: z.enum(['activation', 'setup', 'login', 'ready']),
      build: zBuildInfo,
      machine: zMachineInfo,
      clinic: zClinicProfile.nullable(),
      activation: zActivationState,
      setup: zSetupStatus,
      maintenanceMode: z.boolean(),
      /** Display-only settings, readable before sign-in (formats, density, landing page). */
      settings: z.record(z.string(), z.string()),
      /** Present when a session already exists for this window (unlock screen, reload). */
      session: zSessionSummary.nullable()
    })
  ),
  'app.environment': channel(
    z.object({}).default({}),
    z.object({
      build: zBuildInfo,
      machine: zMachineInfo,
      dataDirectory: z.string(),
      exportsDirectory: z.string(),
      defaultBackupDirectory: z.string(),
      logDirectory: z.string(),
      isDevelopment: z.boolean()
    })
  ),
  'app.openDataFolder': channel(z.object({ kind: z.enum(['data', 'logs', 'exports', 'backups', 'attachments']) }), zActionResult),
  'app.openPath': channel(z.object({ path: z.string().min(1).max(500) }), zActionResult),
  'app.revealPath': channel(z.object({ path: z.string().min(1).max(500) }), zActionResult),
  'app.systemEvents': channel(z.object({ limit: z.number().int().min(1).max(500).default(100) }), z.array(zSystemEvent)),
  'app.diagnostics': channel(z.object({}).default({}), zDiagnostics),
  'app.about': channel(z.object({}).default({}), zAboutInfo),
  'app.relaunch': channel(z.object({}).default({}), zActionResult),

  'activation.state': channel(z.object({}).default({}), zActivationState),
  'activation.submit': channel(z.object({ code: z.string().min(1).max(128) }), z.object({ activated: z.literal(true), activatedAt: z.number() })),

  'setup.status': channel(z.object({}).default({}), zSetupStatus),
  'setup.clinic': channel(zClinicProfileInput, zClinicProfile),
  'setup.dentists': channel(z.object({ dentists: z.array(zDentistInput).min(1).max(50) }), z.array(zDentist)),
  'setup.administrator': channel(zSetupAdministratorInput, z.object({ userId: z.number(), username: z.string() })),
  'setup.preferences': channel(z.object({ values: z.record(z.string(), z.string()) }), z.record(z.string(), z.string())),
  'setup.summary': channel(z.object({}).default({}), zSetupSummary),
  'setup.complete': channel(z.object({ confirmation: z.string().min(1) }), z.object({ completed: z.literal(true), completedAt: z.number() })),

  'auth.login': channel(zLoginInput, zLoginResult),
  'auth.logout': channel(z.object({}).default({}), zActionResult),
  'auth.lock': channel(z.object({}).default({}), zActionResult),
  'auth.unlock': channel(z.object({ password: z.string().min(1).max(256) }), zSessionSummary),
  'auth.changePassword': channel(zChangePasswordInput, zActionResult),
  'auth.rememberedUsername': channel(z.object({}).default({}), z.object({ username: z.string().nullable() })),

  'session.state': channel(z.object({}).default({}), zSessionState),
  'session.touch': channel(z.object({}).default({}), zActionResult),
  'session.refresh': channel(z.object({}).default({}), zSessionSummary),

  'audit.list': channel(zAuditFilter, zAuditPage),
  'audit.facets': channel(z.object({}).default({}), zAuditFacets),
  'audit.export': channel(zAuditFilter, zExportResult),
  'audit.forEntity': channel(
    z.object({ entityType: z.string().min(1).max(40), entityId: z.number().int().positive(), limit: z.number().int().min(1).max(200).default(20) }),
    z.array(zAuditEntry)
  )
} as const
