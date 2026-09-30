import { z } from 'zod'
import { channel, zOptionalText, zTrimmed } from '../ipc'
import { zActionResult, zClinicProfile, zClinicProfileInput, zDentist, zDentistInput } from './system'

export const zSettingDef = z.object({
  key: z.string(),
  group: z.string(),
  type: z.enum(['string', 'number', 'boolean', 'json', 'time', 'dateFormat', 'timeFormat', 'enum']),
  default: z.string(),
  label: z.string(),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional()
})

export const zSettingsMap = z.record(z.string(), z.string())

export const zStaffInput = z.object({
  id: z.number().int().positive().nullish(),
  fullName: zTrimmed(2, 120, 'Staff name'),
  fullNameBn: zOptionalText(120),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  gender: z.enum(['male', 'female', 'other', 'unspecified']).default('unspecified'),
  address: zOptionalText(300),
  phone: zOptionalText(40),
  emergencyContact: zOptionalText(120),
  bloodGroup: zOptionalText(6),
  nationalId: zOptionalText(40),
  designation: zOptionalText(80),
  department: zOptionalText(80),
  salaryMicro: z.number().int().min(0).max(999_999_999).nullish(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  employmentStatus: z.enum(['active', 'probation', 'resigned', 'terminated']).default('active'),
  notes: zOptionalText(1000)
})

export const zStaff = zStaffInput.extend({
  id: z.number(),
  photoPath: z.string().nullable(),
  linkedUserId: z.number().nullable(),
  linkedUsername: z.string().nullable(),
  createdAt: z.number()
})

export const zUserInput = z.object({
  id: z.number().int().positive().nullish(),
  username: z
    .string()
    .transform((value) => value.trim().toLowerCase())
    .refine((value) => /^[a-z0-9][a-z0-9._-]{2,31}$/.test(value), { message: 'Use 3–32 characters: letters, numbers, dot, dash or underscore.' }),
  fullName: zTrimmed(2, 120, 'Full name'),
  phone: zOptionalText(40),
  roleId: z.number().int().positive(),
  staffId: z.number().int().positive().nullish(),
  dentistId: z.number().int().positive().nullish(),
  isActive: z.boolean().default(true),
  password: z.string().min(6).max(128).optional(),
  requirePasswordChange: z.boolean().default(false)
})

export const zUser = z.object({
  id: z.number(),
  username: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  roleId: z.number(),
  roleName: z.string(),
  roleCode: z.string(),
  staffId: z.number().nullable(),
  staffName: z.string().nullable(),
  dentistId: z.number().nullable(),
  isActive: z.boolean(),
  isLocked: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.number().nullable(),
  createdAt: z.number(),
  failedAttempts: z.number()
})

export const zRoleInput = z.object({
  id: z.number().int().positive().nullish(),
  name: zTrimmed(2, 60, 'Role name'),
  code: z
    .string()
    .transform((value) => value.trim().toLowerCase().replace(/\s+/g, '_'))
    .refine((value) => /^[a-z][a-z0-9_]{1,31}$/.test(value), { message: 'Use lowercase letters, numbers and underscores (2–32 characters).' }),
  description: zOptionalText(240),
  isActive: z.boolean().default(true),
  maxDiscountBasisPoints: z.number().int().min(0).max(10_000).nullish(),
  permissions: z.array(z.string().max(64)).max(200).default([])
})

export const zRole = z.object({
  id: z.number(),
  name: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  isActive: z.boolean(),
  maxDiscountBasisPoints: z.number().nullable(),
  userCount: z.number(),
  permissions: z.array(z.string())
})

export const zPermissionDef = z.object({
  code: z.string(),
  module: z.string(),
  label: z.string(),
  description: z.string()
})

export const practiceChannels = {
  'settings.defs': channel(z.object({}).default({}), z.array(zSettingDef)),
  'settings.all': channel(z.object({}).default({}), zSettingsMap),
  'settings.update': channel(z.object({ values: zSettingsMap }), zSettingsMap),
  'settings.clinic': channel(z.object({}).default({}), zClinicProfile),
  'settings.updateClinic': channel(zClinicProfileInput, zClinicProfile),
  'settings.uploadLogo': channel(
    z.object({ fileName: z.string().min(1).max(200), dataBase64: z.string().min(1).max(8_000_000) }),
    z.object({ logoPath: z.string() })
  ),
  'settings.clearLogo': channel(z.object({}).default({}), zActionResult),
  'settings.workingHours': channel(z.object({}).default({}), z.object({ openingTime: z.string(), closingTime: z.string(), weeklyClosedDays: z.array(z.number()) })),

  'dentists.list': channel(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }), z.array(zDentist)),
  'dentists.save': channel(zDentistInput, zDentist),
  'dentists.setActive': channel(z.object({ id: z.number().int().positive(), isActive: z.boolean() }), zDentist),
  'dentists.archive': channel(z.object({ id: z.number().int().positive() }), z.object({ archived: z.boolean(), deactivatedOnly: z.boolean() })),
  'dentists.uploadPhoto': channel(
    z.object({ id: z.number().int().positive(), fileName: z.string().min(1).max(200), dataBase64: z.string().min(1).max(8_000_000) }),
    zDentist
  ),
  'dentists.onDuty': channel(z.object({ weekday: z.number().int().min(0).max(6) }), z.array(zDentist)),

  'staff.list': channel(
    z
      .object({
        search: z.string().max(120).optional(),
        status: z.enum(['active', 'probation', 'resigned', 'terminated']).optional(),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(100),
        offset: z.number().int().min(0).default(0)
      })
      .default({ includeArchived: false, limit: 100, offset: 0 }),
    z.object({ items: z.array(zStaff), total: z.number() })
  ),
  'staff.get': channel(z.object({ id: z.number().int().positive() }), zStaff),
  'staff.save': channel(zStaffInput, zStaff),
  'staff.archive': channel(z.object({ id: z.number().int().positive(), reason: zOptionalText(240) }), zActionResult),
  'staff.uploadPhoto': channel(
    z.object({ id: z.number().int().positive(), fileName: z.string().min(1).max(200), dataBase64: z.string().min(1).max(8_000_000) }),
    zStaff
  ),

  'users.list': channel(
    z.object({ search: z.string().max(120).optional(), includeInactive: z.boolean().default(true) }).default({ includeInactive: true }),
    z.array(zUser)
  ),
  'users.save': channel(zUserInput, zUser),
  'users.setActive': channel(z.object({ id: z.number().int().positive(), isActive: z.boolean() }), zUser),
  'users.resetPassword': channel(
    z.object({ id: z.number().int().positive(), newPassword: z.string().min(6).max(128), requireChange: z.boolean().default(true) }),
    zActionResult
  ),
  'users.unlock': channel(z.object({ id: z.number().int().positive() }), zUser),
  'users.delete': channel(z.object({ id: z.number().int().positive(), confirmation: z.string().min(1) }), zActionResult),
  'users.loginHistory': channel(
    z.object({ userId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(200).default(50) }).default({ limit: 50 }),
    z.array(z.object({ id: z.number(), username: z.string(), at: z.number(), success: z.boolean(), reason: z.string().nullable() }))
  ),

  'roles.list': channel(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }), z.array(zRole)),
  'roles.permissions': channel(z.object({}).default({}), z.array(zPermissionDef)),
  'roles.save': channel(zRoleInput, zRole),
  'roles.delete': channel(z.object({ id: z.number().int().positive(), confirmation: z.string().min(1) }), zActionResult),

  'preferences.get': channel(z.object({}).default({}), z.record(z.string(), z.string())),
  'preferences.set': channel(z.object({ values: z.record(z.string(), z.string()) }), zActionResult)
} as const
