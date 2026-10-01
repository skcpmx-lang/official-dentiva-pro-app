import { z } from 'zod'
import { channel, zDateRange, zExportResult, zLocalDate, zOptionalText, zRangePreset, zTrimmed } from '../ipc'

export const zPatientInput = z.object({
  id: z.number().int().positive().nullish(),
  fullName: zTrimmed(2, 120, 'Patient name'),
  fullNameBn: zOptionalText(120),
  dob: zLocalDate.nullish(),
  ageYears: z.number().int().min(0).max(130).nullish(),
  gender: z.enum(['male', 'female', 'other', 'unspecified']).default('unspecified'),
  bloodGroup: zOptionalText(6),
  phone: zOptionalText(40),
  altPhone: zOptionalText(40),
  emergencyPhone: zOptionalText(40),
  address: zOptionalText(300),
  addressBn: zOptionalText(300),
  city: zOptionalText(80),
  occupation: zOptionalText(80),
  maritalStatus: zOptionalText(20),
  chiefComplaint: zOptionalText(1200),
  pastHistory: zOptionalText(2000),
  allergies: zOptionalText(1000),
  medicalHistory: zOptionalText(2000),
  dentalHistory: zOptionalText(2000),
  currentMedications: zOptionalText(1500),
  notes: zOptionalText(2000),
  tags: z.array(z.string().max(40)).max(20).default([]),
  status: z.enum(['active', 'archived', 'deceased']).default('active')
})

export const zPatient = zPatientInput.extend({
  id: z.number(),
  code: z.string(),
  registrationDate: zLocalDate,
  ageLabel: z.string().nullable(),
  ageAtRegistration: z.number().nullable(),
  dueMicro: z.number(),
  invoicedMicro: z.number(),
  paidMicro: z.number(),
  lastVisitAt: z.number().nullable(),
  visitCount: z.number(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const zPatientFilter = z
  .object({
    search: z.string().max(120).optional(),
    status: z.enum(['active', 'archived', 'deceased', 'all']).default('active'),
    range: zDateRange,
    tags: z.array(z.string().max(40)).max(10).optional(),
    hasDue: z.boolean().optional(),
    sortBy: z.enum(['recent', 'name', 'code', 'due']).default('recent'),
    limit: z.number().int().min(1).max(500).default(50),
    offset: z.number().int().min(0).default(0)
  })
  .default({ status: 'active', range: { preset: 'all' }, sortBy: 'recent', limit: 50, offset: 0 })

export const zPatientPage = z.object({ items: z.array(zPatient), total: z.number(), limit: z.number(), offset: z.number() })

export const zPatientFinancialSummary = z.object({
  invoicedMicro: z.number(),
  paidMicro: z.number(),
  dueMicro: z.number(),
  refundedMicro: z.number(),
  invoiceCount: z.number(),
  lastPaymentAt: z.number().nullable(),
  aging: z.object({ current: z.number(), days30: z.number(), days60: z.number(), days90: z.number(), older: z.number() })
})

export const zPatientAttachment = z.object({
  id: z.number(),
  patientId: z.number(),
  visitId: z.number().nullable(),
  fileName: z.string(),
  mime: z.string(),
  sizeBytes: z.number(),
  kind: z.string(),
  description: z.string().nullable(),
  attachmentDate: zLocalDate,
  createdAt: z.number(),
  uploadedBy: z.number().nullable()
})

export const zReferralInput = z.object({
  id: z.number().int().positive().nullish(),
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullish(),
  referredByDentistId: z.number().int().positive().nullish(),
  externalDoctor: zOptionalText(120),
  specialty: zOptionalText(120),
  organization: zOptionalText(160),
  address: zOptionalText(240),
  phone: zOptionalText(40),
  reason: zOptionalText(1000),
  notes: zOptionalText(1000),
  referralDate: zLocalDate,
  followUpStatus: z.enum(['pending', 'scheduled', 'completed', 'closed']).default('pending'),
  followUpDate: zLocalDate.nullish()
})

export const zReferral = zReferralInput.extend({ id: z.number(), createdAt: z.number(), createdByName: z.string().nullable() })

export const zTimelineEntry = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.enum(['registration', 'visit', 'treatment', 'prescription', 'invoice', 'payment', 'appointment', 'referral', 'attachment', 'chart', 'note']),
  title: z.string(),
  description: z.string().nullable(),
  dentistId: z.number().nullable(),
  dentistName: z.string().nullable(),
  amountMicro: z.number().nullable(),
  entityId: z.number(),
  route: z.string().nullable(),
  requiresPermission: z.string().nullable()
})

export const zTimelineFilter = z
  .object({
    patientId: z.number().int().positive(),
    kinds: z.array(z.string().max(30)).max(14).optional(),
    dentistId: z.number().int().positive().optional(),
    range: z.object({ preset: zRangePreset, from: zLocalDate.optional(), to: zLocalDate.optional() }).optional(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0)
  })
  .default({ patientId: 0, limit: 100, offset: 0 })

export const zPatientSummary = z.object({
  patient: zPatient,
  financials: zPatientFinancialSummary,
  lastVisit: z
    .object({ id: z.number(), visitNo: z.string(), at: z.number(), diagnosis: z.string().nullable(), dentistName: z.string() })
    .nullable(),
  allergies: z.string().nullable(),
  medicalHistory: z.string().nullable(),
  activeChartFindings: z.array(z.object({ toothCode: z.string(), conditionCode: z.string(), note: z.string().nullable() }))
})

export const patientChannels = {
  'patients.list': channel(zPatientFilter, zPatientPage),
  'patients.get': channel(z.object({ id: z.number().int().positive() }), zPatient),
  'patients.save': channel(zPatientInput, zPatient),
  'patients.archive': channel(z.object({ id: z.number().int().positive(), reason: zOptionalText(240) }), zPatient),
  'patients.restore': channel(z.object({ id: z.number().int().positive() }), zPatient),
  'patients.summary': channel(z.object({ id: z.number().int().positive() }), zPatientSummary),
  'patients.financials': channel(z.object({ id: z.number().int().positive() }), zPatientFinancialSummary),
  'patients.timeline': channel(zTimelineFilter, z.object({ items: z.array(zTimelineEntry), total: z.number() })),
  'patients.tags': channel(z.object({}).default({}), z.array(z.object({ tag: z.string(), count: z.number() }))),
  'patients.export': channel(zPatientFilter, zExportResult),
  'patients.duplicateCheck': channel(
    z.object({ fullName: z.string().max(120), phone: zOptionalText(40), excludeId: z.number().int().positive().nullish() }),
    z.array(z.object({ id: z.number(), code: z.string(), fullName: z.string(), phone: z.string().nullable(), registrationDate: z.string() }))
  ),

  'attachments.list': channel(z.object({ patientId: z.number().int().positive() }), z.array(zPatientAttachment)),
  'attachments.upload': channel(
    z.object({
      patientId: z.number().int().positive(),
      visitId: z.number().int().positive().nullish(),
      fileName: z.string().min(1).max(240),
      dataBase64: z.string().min(1).max(40_000_000),
      description: zOptionalText(240),
      kind: z.enum(['document', 'xray', 'scan', 'photo', 'report', 'other']).default('document'),
      attachmentDate: zLocalDate.optional()
    }),
    zPatientAttachment
  ),
  'attachments.update': channel(
    z.object({ id: z.number().int().positive(), description: zOptionalText(240), kind: z.string().max(20).optional(), attachmentDate: zLocalDate.optional() }),
    zPatientAttachment
  ),
  'attachments.delete': channel(z.object({ id: z.number().int().positive() }), z.object({ ok: z.literal(true) })),
  'attachments.open': channel(z.object({ id: z.number().int().positive() }), z.object({ ok: z.literal(true) })),
  'attachments.data': channel(z.object({ id: z.number().int().positive() }), z.object({ mime: z.string(), dataBase64: z.string(), fileName: z.string() })),
  'attachments.export': channel(z.object({ id: z.number().int().positive() }), z.object({ path: z.string().nullable() })),

  'referrals.list': channel(z.object({ patientId: z.number().int().positive() }), z.array(zReferral)),
  'referrals.save': channel(zReferralInput, zReferral),
  'referrals.delete': channel(z.object({ id: z.number().int().positive() }), z.object({ ok: z.literal(true) })),
  'referrals.followUps': channel(
    z.object({ status: z.enum(['pending', 'scheduled', 'completed', 'closed', 'all']).default('pending'), limit: z.number().int().min(1).max(200).default(50) }).default({ status: 'pending', limit: 50 }),
    z.array(zReferral.extend({ patientName: z.string(), patientCode: z.string() }))
  )
} as const
