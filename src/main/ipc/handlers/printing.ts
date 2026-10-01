import { archivePrintProfile, listPrintProfiles, savePrintProfile } from '../../printing/profiles'
import {
  documentCatalog,
  listPrintHistory,
  loadPrintPayload,
  printDocument,
  printerStatus,
  recordPreview,
  renderDocument,
  retryPrint,
  savePdf,
  testPrint
} from '../../printing/jobs'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Handlers for the printing subsystem.
 *
 * Everything the print dialog needs is resolved on this side: printers, profiles, the rendered document
 * HTML, the print and PDF actions and the history of what was printed. The renderer only ever receives a
 * finished document — it never composes a page itself, so preview, paper output and PDF cannot diverge.
 */
export function createPrintingHandlers(_deps: HandlerDeps): PartialHandlerMap {
  return {
    'printing.printers': (ctx) => printerStatus(ctx),

    'printing.documents': () => documentCatalog(),

    'printing.profiles': (ctx, input) => listPrintProfiles(ctx, input.includeInactive),
    'printing.profile.save': (ctx, input) => savePrintProfile(ctx, input),
    'printing.profile.archive': (ctx, input) => {
      archivePrintProfile(ctx, input.id, input.reason ?? null)
      return { ok: true as const }
    },

    'printing.render': (ctx, input) => renderDocument(ctx, input),
    'printing.previewed': (ctx, input) => {
      recordPreview(ctx, input.documentType, input.title, input.entityId ?? null)
      return { ok: true as const }
    },
    'printing.print': (ctx, input) => printDocument(ctx, input, input.printerName ?? null),
    'printing.pdf': (ctx, input) => savePdf(ctx, input, input.targetPath ?? null),
    'printing.testPrint': (ctx, input) =>
      testPrint(ctx, {
        printerName: input.printerName ?? null,
        paperClass: input.paperClass,
        thermalWidthMm: input.thermalWidthMm
      }),

    'printing.history': (ctx, input) =>
      listPrintHistory(ctx, {
        documentType: input.documentType,
        result: input.result,
        limit: input.limit,
        offset: input.offset
      }),
    'printing.history.payload': (ctx, input) => loadPrintPayload(ctx, input.id),
    'printing.retry': (ctx, input) => retryPrint(ctx, input.historyId, input.printerName ?? null)
  }
}
