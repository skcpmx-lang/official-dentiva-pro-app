import { z } from 'zod'
import { channel, zOptionalText, zTrimmed } from '../ipc'
import { zActionResult } from './system'

/* -------------------------------------------------------------------------- */
/* Value objects                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Paper classes the printing engine understands.
 *
 * A document never scales an A4 layout onto a thermal roll: the class selects the layout engine
 * (`receipt` < 100 mm, `compact` < 170 mm, `full` otherwise), so a 58 mm printer gets a receipt layout
 * and an A5 sheet gets the compact clinical layout.
 */
export const PRINT_PAPER_CLASSES = ['a4', 'a5', 'thermal', 'mini', 'custom'] as const
export const zPrintPaperClass = z.enum(PRINT_PAPER_CLASSES)

/** Documents that can be printed. `test` is the self-test page used from the printer profiles screen. */
export const PRINT_DOCUMENT_TYPES = [
  'prescription',
  'invoice',
  'payment_receipt',
  'appointment_slip',
  'patient_summary',
  'report',
  'test'
] as const
export const zPrintDocumentType = z.enum(PRINT_DOCUMENT_TYPES)

export const zPrintOrientation = z.enum(['portrait', 'landscape'])

export const zPrintMarginsMm = z.object({
  top: z.number().min(0).max(40),
  right: z.number().min(0).max(40),
  bottom: z.number().min(0).max(40),
  left: z.number().min(0).max(40)
})

export const zPrintProfileInput = z.object({
  id: z.number().int().positive().nullish(),
  name: zTrimmed(2, 60, 'Profile name'),
  documentType: zPrintDocumentType,
  printerName: zOptionalText(160),
  paperClass: zPrintPaperClass.default('a4'),
  customWidthMm: z.number().int().min(40).max(297).nullish(),
  customHeightMm: z.number().int().min(40).max(431).nullish(),
  thermalWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
  orientation: zPrintOrientation.default('portrait'),
  marginsMm: zPrintMarginsMm.default({ top: 12, right: 12, bottom: 12, left: 12 }),
  scaleBp: z.number().int().min(5000).max(20000).default(10000),
  copies: z.number().int().min(1).max(10).default(1),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: zOptionalText(240)
})

export const zPrintProfile = zPrintProfileInput.extend({
  id: z.number(),
  createdByName: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number()
})

export const zPrinterInfo = z.object({
  name: z.string(),
  displayName: z.string(),
  description: z.string(),
  status: z.number(),
  isDefault: z.boolean()
})

export const zPrintDocumentInfo = z.object({
  type: zPrintDocumentType,
  title: z.string(),
  description: z.string(),
  paperClasses: z.array(zPrintPaperClass),
  /** Documents without an entity (the test page, a period report) ignore `entityId`. */
  requiresEntity: z.boolean()
})

/**
 * A print/PDF/preview request.
 *
 * Overrides are optional: when they are left out the profile (or the clinic defaults) decides the paper,
 * orientation, margins and copy count. The renderer never sends layout numbers it invented — the engine
 * resolves them so preview, paper output and PDF always agree.
 */
export const zPrintRequest = z.object({
  documentType: zPrintDocumentType,
  entityId: z.number().int().positive().nullish(),
  profileId: z.number().int().positive().nullish(),
  paperClass: zPrintPaperClass.optional(),
  customWidthMm: z.number().int().min(40).max(297).optional(),
  customHeightMm: z.number().int().min(40).max(431).optional(),
  thermalWidthMm: z.union([z.literal(58), z.literal(80)]).optional(),
  orientation: zPrintOrientation.optional(),
  copies: z.number().int().min(1).max(10).optional(),
  /** Report key/period for `report` documents. */
  reportKey: z.string().max(60).optional(),
  reportFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reportTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
})

export const zPrintDocument = z.object({
  documentType: zPrintDocumentType,
  title: z.string(),
  fileName: z.string(),
  html: z.string(),
  paperClass: zPrintPaperClass,
  layout: z.enum(['full', 'compact', 'receipt']),
  widthMicrons: z.number(),
  heightMicrons: z.number(),
  marginsMicrons: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }),
  landscape: z.boolean(),
  copies: z.number(),
  profileId: z.number().nullable(),
  profileName: z.string().nullable(),
  /** Non-fatal notes (a missing bundled font, an empty medicine list) shown in the preview. */
  warnings: z.array(z.string()),
  sizeBytes: z.number()
})

export const zPrintOutcome = z.object({
  ok: z.boolean(),
  failureReason: z.string().nullable(),
  printerName: z.string().nullable(),
  historyId: z.number().nullable(),
  filePath: z.string().nullable()
})

export const zPrintHistoryEntry = z.object({
  id: z.number(),
  documentType: zPrintDocumentType,
  title: z.string(),
  reference: z.string().nullable(),
  profileId: z.number().nullable(),
  profileName: z.string().nullable(),
  printerName: z.string().nullable(),
  paperClass: z.string(),
  action: z.enum(['print', 'pdf', 'preview', 'test']),
  result: z.enum(['success', 'failed']),
  failureReason: z.string().nullable(),
  copies: z.number(),
  filePath: z.string().nullable(),
  hasPayload: z.boolean(),
  performedByName: z.string().nullable(),
  at: z.number()
})

/* -------------------------------------------------------------------------- */
/* Channel registry                                                           */
/* -------------------------------------------------------------------------- */

export const printingChannels = {
  'printing.printers': channel(
    z.object({}).default({}),
    z.object({
      printers: z.array(zPrinterInfo),
      defaultPrinter: z.string().nullable(),
      available: z.boolean(),
      missingFonts: z.array(z.string())
    })
  ),
  'printing.documents': channel(z.object({}).default({}), z.array(zPrintDocumentInfo)),

  'printing.profiles': channel(z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false }), z.array(zPrintProfile)),
  'printing.profile.save': channel(zPrintProfileInput, zPrintProfile),
  'printing.profile.archive': channel(z.object({ id: z.number().int().positive(), reason: zOptionalText(240) }), zActionResult),

  'printing.render': channel(zPrintRequest, zPrintDocument),
  'printing.previewed': channel(z.object({ documentType: zPrintDocumentType, entityId: z.number().int().positive().nullish(), title: z.string().max(160) }), zActionResult),
  'printing.print': channel(
    zPrintRequest.extend({ printerName: zOptionalText(160), confirmOnly: z.boolean().default(false) }),
    zPrintOutcome
  ),
  'printing.pdf': channel(
    zPrintRequest.extend({ targetPath: zOptionalText(500) }),
    zPrintOutcome
  ),
  'printing.testPrint': channel(
    z.object({
      printerName: zOptionalText(160),
      paperClass: zPrintPaperClass.default('a4'),
      thermalWidthMm: z.union([z.literal(58), z.literal(80)]).default(80)
    }),
    zPrintOutcome
  ),

  'printing.history': channel(
    z
      .object({
        documentType: zPrintDocumentType.optional(),
        result: z.enum(['success', 'failed']).optional(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0)
      })
      .default({ limit: 50, offset: 0 }),
    z.object({ items: z.array(zPrintHistoryEntry), total: z.number() })
  ),
  'printing.history.payload': channel(z.object({ id: z.number().int().positive() }), z.object({ html: z.string(), title: z.string(), fileName: z.string() })),
  'printing.retry': channel(z.object({ historyId: z.number().int().positive(), printerName: zOptionalText(160) }), zPrintOutcome)
} as const
