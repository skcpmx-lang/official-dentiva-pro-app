import { z } from 'zod'
import { channel, zDateRange, zLocalDate, zOptionalText, zTrimmed } from '../ipc'
import { zActionResult } from './system'

/* -------------------------------------------------------------------------- */
/* Value objects                                                              */
/* -------------------------------------------------------------------------- */

/** Shared with the seeded catalogue and the renderer's category labels. */
export const TREATMENT_CATEGORIES = [
  'diagnostic',
  'preventive',
  'restorative',
  'endodontic',
  'surgical',
  'prosthetic',
  'orthodontic',
  'cosmetic',
  'general'
] as const

export const VISIT_STATUSES = ['draft', 'final', 'cancelled'] as const
export const VISIT_TREATMENT_STATUSES = ['planned', 'in_progress', 'completed', 'deferred', 'cancelled'] as const
export const CHART_STATUSES = ['active', 'resolved', 'historic'] as const

export const zTreatmentInput = z.object({
  id: z.number().int().positive().nullish(),
  code: zOptionalText(32),
  name: zTrimmed(2, 120, 'Treatment name'),
  nameBn: zOptionalText(120),
  category: z.enum(TREATMENT_CATEGORIES).default('restorative'),
  description: zOptionalText(500),
  defaultPriceMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  durationMin: z.number().int().min(0).max(1440).default(30),
  isActive: z.boolean().default(true),
  notes: zOptionalText(500)
})

export const zTreatment = zTreatmentInput.extend({
  id: z.number(),
  code: z.string(),
  usageCount: z.number(),
  updatedAt: z.number()
})

export const zVisitInput = z.object({
  id: z.number().int().positive().nullish(),
  patientId: z.number().int().positive(),
  dentistId: z.number().int().positive(),
  appointmentId: z.number().int().positive().nullish(),
  visitAt: z.number().int().positive(),
  chiefComplaint: zOptionalText(1000),
  history: zOptionalText(2000),
  examination: zOptionalText(2000),
  diagnosis: zOptionalText(2000),
  findingsSummary: zOptionalText(2000),
  advice: zOptionalText(2000),
  treatmentPlan: zOptionalText(2000),
  nextAppointmentAt: z.number().int().positive().nullish(),
  notes: zOptionalText(2000),
  status: z.enum(VISIT_STATUSES).default('final')
})

export const zVisitSummary = z.object({
  id: z.number(),
  visitNo: z.string(),
  patientId: z.number(),
  patientCode: z.string(),
  patientName: z.string(),
  patientNameBn: z.string().nullable(),
  patientAgeYears: z.number().nullable(),
  patientGender: z.string(),
  patientPhone: z.string().nullable(),
  dentistId: z.number(),
  dentistName: z.string(),
  dentistDesignations: z.array(z.string()),
  visitAt: z.number(),
  status: z.enum(VISIT_STATUSES),
  chiefComplaint: z.string().nullable(),
  history: z.string().nullable(),
  examination: z.string().nullable(),
  diagnosis: z.string().nullable(),
  findingsSummary: z.string().nullable(),
  advice: z.string().nullable(),
  treatmentPlan: z.string().nullable(),
  nextAppointmentAt: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  treatments: z.array(
    z.object({
      id: z.number(),
      treatmentId: z.number().nullable(),
      treatmentName: z.string(),
      toothCodes: z.array(z.string()),
      quantity: z.number(),
      unitPriceMicro: z.number(),
      discountMicro: z.number(),
      totalMicro: z.number(),
      status: z.enum(VISIT_TREATMENT_STATUSES),
      notes: z.string().nullable()
    })
  ),
  findings: z.array(
    z.object({
      id: z.number(),
      findingId: z.number().nullable(),
      findingCode: z.string(),
      findingName: z.string(),
      toothCode: z.string().nullable(),
      severity: z.string().nullable(),
      notes: z.string().nullable()
    })
  ),
  chart: z.array(
    z.object({
      id: z.number(),
      toothCode: z.string(),
      dentition: z.enum(['adult', 'primary']),
      conditionCode: z.string(),
      conditionName: z.string(),
      status: z.enum(CHART_STATUSES),
      note: z.string().nullable(),
      recordedAt: z.number()
    })
  ),
  totals: z.object({
    subtotalMicro: z.number(),
    discountMicro: z.number(),
    totalMicro: z.number(),
    treatmentCount: z.number()
  }),
  invoices: z.array(
    z.object({ id: z.number(), invoiceNo: z.string(), totalMicro: z.number(), paidMicro: z.number(), dueMicro: z.number(), status: z.string() })
  ),
  prescriptions: z.array(z.object({ id: z.number(), rxNo: z.string(), prescriptionAt: z.number() }))
})

export const zVisitPage = z.object({
  items: z.array(zVisitSummary),
  total: z.number(),
  limit: z.number(),
  offset: z.number()
})

export const zVisitFilter = z.object({
  patientId: z.number().int().positive().optional(),
  dentistId: z.number().int().positive().optional(),
  search: z.string().max(120).optional(),
  status: z.enum(VISIT_STATUSES).optional(),
  range: z.object({ preset: z.enum(['today', 'yesterday', 'last7', 'last30', 'last90', 'thisMonth', 'lastYear', 'all', 'custom']), from: zLocalDate.optional(), to: zLocalDate.optional() }).optional(),
  mine: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).default(25),
  offset: z.number().int().min(0).default(0)
})

export const zVisitTreatmentInput = z.object({
  visitId: z.number().int().positive(),
  treatmentId: z.number().int().positive().nullish(),
  treatmentName: zTrimmed(1, 160, 'Treatment'),
  toothCodes: z.array(z.string().max(8)).max(40).default([]),
  quantity: z.number().min(0.01).max(1000).default(1),
  unitPriceMicro: z.number().int().min(0).max(999_999_999_999),
  discountMicro: z.number().int().min(0).max(999_999_999_999).default(0),
  status: z.enum(VISIT_TREATMENT_STATUSES).default('completed'),
  notes: zOptionalText(500)
})

export const zChartEntryInput = z.object({
  patientId: z.number().int().positive(),
  visitId: z.number().int().positive().nullish(),
  toothCode: z.string().min(1).max(8),
  dentition: z.enum(['adult', 'primary']).default('adult'),
  conditionCode: z.string().min(1).max(40),
  treatmentCode: zOptionalText(40),
  status: z.enum(CHART_STATUSES).default('active'),
  note: zOptionalText(300)
})

export const zChartEntry = z.object({
  id: z.number(),
  patientId: z.number(),
  visitId: z.number().nullable(),
  toothCode: z.string(),
  dentition: z.enum(['adult', 'primary']),
  conditionCode: z.string(),
  conditionName: z.string(),
  conditionCategory: z.string(),
  conditionColor: z.string().nullable(),
  treatmentCode: z.string().nullable(),
  status: z.enum(CHART_STATUSES),
  note: z.string().nullable(),
  recordedAt: z.number(),
  recordedByName: z.string().nullable(),
  resolvedAt: z.number().nullable()
})

export const zChartView = z.object({
  patientId: z.number(),
  entries: z.array(zChartEntry),
  /** Latest condition per tooth code, which is what the chart face renders. */
  byTooth: z.record(z.string(), zChartEntry),
  counts: z.array(z.object({ conditionCode: z.string(), conditionName: z.string(), count: z.number() })),
  conditions: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      nameBn: z.string().nullable(),
      category: z.enum(['finding', 'treatment', 'state']),
      color: z.string().nullable(),
      appliesTooth: z.boolean(),
      isActive: z.boolean(),
      sortOrder: z.number()
    })
  ),
  summaryText: z.string()
})

export const PRESCRIPTION_FORMS = ['tablet', 'capsule', 'syrup', 'suspension', 'drops', 'injection', 'ointment', 'gel', 'mouthwash', 'sachet', 'other'] as const
export const MEDICINE_TIMINGS = ['before_meal', 'after_meal', 'with_meal', 'empty_stomach', 'bedtime', 'as_needed'] as const

export const zMedicineInput = z.object({
  sortOrder: z.number().int().min(0).max(200).default(0),
  medicineName: zTrimmed(1, 160, 'Medicine name'),
  form: z.enum(PRESCRIPTION_FORMS).default('tablet'),
  strength: zOptionalText(60),
  unit: zOptionalText(20),
  doseMorning: zOptionalText(20),
  doseAfternoon: zOptionalText(20),
  doseNight: zOptionalText(20),
  timing: z.enum(MEDICINE_TIMINGS).default('after_meal'),
  frequency: zOptionalText(40),
  durationDays: z.number().int().min(0).max(365).nullish(),
  durationText: zOptionalText(60),
  quantity: zOptionalText(40),
  isPrn: z.boolean().default(false),
  instructions: zOptionalText(300)
})

export const zMedicine = zMedicineInput.extend({ id: z.number(), prescriptionId: z.number() })

export const zPrescriptionInput = z.object({
  id: z.number().int().positive().nullish(),
  patientId: z.number().int().positive(),
  dentistId: z.number().int().positive(),
  visitId: z.number().int().positive().nullish(),
  prescriptionAt: z.number().int().positive(),
  diagnosis: zOptionalText(2000),
  ccText: zOptionalText(2000),
  oeText: zOptionalText(2000),
  reText: zOptionalText(2000),
  advice: zOptionalText(2000),
  followUpDate: zLocalDate.nullish(),
  notes: zOptionalText(1000),
  medicines: z.array(zMedicineInput).max(40).default([])
})

export const zPrescription = zPrescriptionInput.extend({
  id: z.number(),
  rxNo: z.string(),
  patientCode: z.string(),
  patientName: z.string(),
  patientNameBn: z.string().nullable(),
  patientAgeYears: z.number().nullable(),
  patientGender: z.string(),
  patientPhone: z.string().nullable(),
  dentistName: z.string(),
  dentistNameBn: z.string().nullable(),
  dentistDesignations: z.array(z.string()),
  dentistRegistrationNo: z.string().nullable(),
  dentistSignatureLabel: z.string().nullable(),
  printedCount: z.number(),
  lastPrintedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  medicines: z.array(zMedicine)
})

export const zPrescriptionPage = z.object({
  items: z.array(zPrescription),
  total: z.number(),
  limit: z.number(),
  offset: z.number()
})

export const zPrescriptionFilter = z.object({
  patientId: z.number().int().positive().optional(),
  dentistId: z.number().int().positive().optional(),
  search: z.string().max(120).optional(),
  range: zDateRange.optional(),
  limit: z.number().int().min(1).max(200).default(25),
  offset: z.number().int().min(0).default(0)
})

export const zPrescriptionTemplateInput = z.object({
  id: z.number().int().positive().nullish(),
  name: zTrimmed(2, 80, 'Template name'),
  dentistId: z.number().int().positive().nullish(),
  isActive: z.boolean().default(true),
  medicines: z.array(zMedicineInput).min(1).max(40)
})

export const zPrescriptionTemplate = zPrescriptionTemplateInput.extend({
  id: z.number(),
  createdBy: z.string().nullable(),
  createdAt: z.number(),
  usageCount: z.number()
})

/* -------------------------------------------------------------------------- */
/* Channel registry                                                           */
/* -------------------------------------------------------------------------- */

export const clinicalChannels = {
  /* ------------------------------------------------------------------ treatments */
  'treatments.list': channel(
    z.object({ search: z.string().max(120).optional(), category: z.string().max(40).optional(), includeInactive: z.boolean().default(false) }).default({ includeInactive: false }),
    z.array(zTreatment)
  ),
  'treatments.save': channel(zTreatmentInput, zTreatment),
  'treatments.archive': channel(z.object({ id: z.number().int().positive(), reason: zOptionalText(240) }), zActionResult),
  'treatments.categories': channel(z.object({}).default({}), z.array(z.object({ category: z.string(), count: z.number() }))),
  'treatments.export': channel(z.object({}).default({}), z.object({ path: z.string().nullable(), rowCount: z.number().int() })),

  /* ---------------------------------------------------------------------- visits */
  'visits.list': channel(zVisitFilter, zVisitPage),
  'visits.get': channel(z.object({ id: z.number().int().positive() }), zVisitSummary),
  'visits.save': channel(zVisitInput, zVisitSummary),
  'visits.setStatus': channel(z.object({ id: z.number().int().positive(), status: z.enum(VISIT_STATUSES), reason: zOptionalText(240) }), zVisitSummary),
  'visits.delete': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 240, 'Reason') }), zActionResult),
  'visits.export': channel(zVisitFilter, z.object({ path: z.string().nullable(), rowCount: z.number().int() })),

  'visits.treatments.add': channel(zVisitTreatmentInput, zVisitSummary),
  'visits.treatments.update': channel(zVisitTreatmentInput.extend({ id: z.number().int().positive() }), zVisitSummary),
  'visits.treatments.remove': channel(z.object({ id: z.number().int().positive() }), zVisitSummary),

  'visits.findings.set': channel(
    z.object({
      visitId: z.number().int().positive(),
      findings: z
        .array(
          z.object({
            findingId: z.number().int().positive().nullish(),
            findingCode: z.string().min(1).max(40),
            toothCode: zOptionalText(8),
            severity: zOptionalText(20),
            notes: zOptionalText(300)
          })
        )
        .max(60)
    }),
    zVisitSummary
  ),

  /* ----------------------------------------------------------------- dental chart */
  'chart.get': channel(z.object({ patientId: z.number().int().positive() }), zChartView),
  'chart.setEntry': channel(zChartEntryInput, zChartView),
  'chart.removeEntry': channel(z.object({ id: z.number().int().positive(), patientId: z.number().int().positive() }), zChartView),
  'chart.history': channel(
    z.object({ patientId: z.number().int().positive(), toothCode: z.string().max(8).optional() }),
    z.array(zChartEntry)
  ),
  'chart.conditions': channel(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }), zChartView.shape.conditions),
  'chart.saveCondition': channel(
    z.object({
      code: zTrimmed(1, 40, 'Condition code'),
      name: zTrimmed(1, 80, 'Condition name'),
      nameBn: zOptionalText(80),
      category: z.enum(['finding', 'treatment', 'state']),
      color: zOptionalText(20),
      appliesTooth: z.boolean().default(true),
      isActive: z.boolean().default(true),
      sortOrder: z.number().int().min(0).max(999).default(100)
    }),
    zActionResult
  ),

  /* --------------------------------------------------------------- prescriptions */
  'prescriptions.list': channel(zPrescriptionFilter, zPrescriptionPage),
  'prescriptions.get': channel(z.object({ id: z.number().int().positive() }), zPrescription),
  'prescriptions.save': channel(zPrescriptionInput, zPrescription),
  'prescriptions.delete': channel(z.object({ id: z.number().int().positive(), reason: zTrimmed(3, 240, 'Reason') }), zActionResult),
  'prescriptions.medicines': channel(
    z.object({ search: z.string().max(120).optional(), limit: z.number().int().min(1).max(100).default(25) }).default({ limit: 25 }),
    z.array(z.object({ medicineName: z.string(), form: z.string(), strength: z.string().nullable(), lastUsedAt: z.number(), useCount: z.number() }))
  ),
  'prescriptions.adviceLibrary': channel(z.object({}).default({}), z.array(z.string())),
  'prescriptions.duplicate': channel(z.object({ id: z.number().int().positive() }), zPrescription),

  'prescriptions.templates.list': channel(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }), z.array(zPrescriptionTemplate)),
  'prescriptions.templates.save': channel(zPrescriptionTemplateInput, zPrescriptionTemplate),
  'prescriptions.templates.delete': channel(z.object({ id: z.number().int().positive() }), zActionResult),
  'prescriptions.templates.apply': channel(
    z.object({ templateId: z.number().int().positive(), patientId: z.number().int().positive(), dentistId: z.number().int().positive(), visitId: z.number().int().positive().nullish() }),
    zPrescription
  ),
  'prescriptions.export': channel(zPrescriptionFilter, z.object({ path: z.string().nullable(), rowCount: z.number().int() }))
} as const
