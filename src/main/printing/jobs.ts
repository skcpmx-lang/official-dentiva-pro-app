import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ServiceContext } from '../context'
import { assertPermission } from '../context'
import { AppError, notFoundError, validationError } from '@shared/errors'
import { exportStamp, requireExtension } from '../files/csv'
import { marginMicrons, paperMicrons } from '../platform/types'
import { prepareDocument, resolvePaper, type PreparedDocument, type PrintRequest } from './documents'
import { resolveProfileFor } from './profiles'
import { markPrescriptionPrinted } from '../modules/clinical/prescriptions'
import { markInvoicePrinted } from '../modules/billing/invoices'
import type { zPrintDocumentInfo, zPrintHistoryEntry, zPrintProfileInput } from '@shared/contracts'
import type { z } from 'zod'

/**
 * Print jobs.
 *
 * Every attempt — paper, PDF or a test page — goes through one path: resolve the paper, render the
 * document HTML, send it to the host, then record the result. When the printer refuses, the rendered HTML
 * is written to the print-jobs folder **before** the failure is reported, so the document is never lost:
 * the history screen can re-open it, retry it on another printer or save it as a PDF. Successful jobs
 * keep no payload, because the record itself can always be re-rendered from the database.
 */

export type PrintProfileInput = z.infer<typeof zPrintProfileInput>
export type DocumentInfo = z.infer<typeof zPrintDocumentInfo>
export type HistoryEntry = z.infer<typeof zPrintHistoryEntry>

export interface PrintOutcome {
  ok: boolean
  failureReason: string | null
  printerName: string | null
  historyId: number | null
  filePath: string | null
}

const PAYLOAD_RETENTION = 40

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'document'
}

function payloadDir(ctx: ServiceContext): string {
  return join(ctx.host.paths.dataDir, 'print-jobs')
}

/** Keeps only the most recent payload files; older failed documents are superseded by their records. */
function prunePayloads(ctx: ServiceContext): void {
  const dir = payloadDir(ctx)
  try {
    const files = readdirSync(dir)
      .map((file) => ({ file, path: join(dir, file), at: statSync(join(dir, file)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const stale of files.slice(PAYLOAD_RETENTION)) rmSync(stale.path, { force: true })
  } catch {
    /* The folder may not exist yet; nothing to prune. */
  }
}

function storePayload(ctx: ServiceContext, document: PreparedDocument): string {
  const dir = payloadDir(ctx)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${exportStamp()}-${slug(document.title)}.html`)
  writeFileSync(path, document.html, 'utf8')
  prunePayloads(ctx)
  return path
}

function recordHistory(
  ctx: ServiceContext,
  entry: {
    documentType: string
    entityId: number | null
    patientId: number | null
    reference: string | null
    title: string
    profileId: number | null
    printerName: string | null
    paperClass: string
    action: 'print' | 'pdf' | 'preview' | 'test'
    result: 'success' | 'failed'
    failureReason: string | null
    copies: number
    filePath: string | null
    payloadPath: string | null
  }
): number {
  const result = ctx.db
    .prepare(
      `INSERT INTO print_history (document_type, record_id, record_no, patient_id, user_id, username, printer_name,
         paper_class, copies, result, error, printed_at, title, profile_id, action, payload_path)
       VALUES (@documentType, @entityId, @reference, @patientId, @userId, @username, @printerName, @paperClass,
         @copies, @result, @failureReason, @at, @title, @profileId, @action, @payloadPath)`
    )
    .run({
      documentType: entry.documentType,
      entityId: entry.entityId,
      reference: entry.reference,
      patientId: entry.patientId,
      userId: ctx.actor.userId,
      username: ctx.actor.username,
      printerName: entry.printerName,
      paperClass: entry.paperClass,
      copies: entry.copies,
      result: entry.result,
      failureReason: entry.failureReason,
      at: ctx.now(),
      title: entry.title,
      profileId: entry.profileId,
      action: entry.action,
      payloadPath: entry.payloadPath
    })
  return Number(result.lastInsertRowid)
}

/** Marks the source record as printed; only a successful paper print counts. */
function markPrinted(ctx: ServiceContext, request: PrintRequest, printerName: string): void {
  if (!request.entityId) return
  if (request.documentType === 'prescription') markPrescriptionPrinted(ctx, request.entityId, printerName)
  if (request.documentType === 'invoice') markInvoicePrinted(ctx, request.entityId, printerName)
}

export function documentCatalog(): DocumentInfo[] {
  const all = ['a4', 'a5', 'thermal', 'mini', 'custom'] as const
  return [
    { type: 'prescription', title: 'Prescription', description: 'Rx with C/C, O/E, R/E, advice, medicines, follow-up and the prescriber’s qualifications.', paperClasses: ['a4', 'a5', 'thermal', 'custom'], requiresEntity: true },
    { type: 'invoice', title: 'Invoice', description: 'Itemised invoice with discount, payments received and the outstanding balance.', paperClasses: [...all], requiresEntity: true },
    { type: 'payment_receipt', title: 'Payment receipt', description: 'Receipt for a single payment or refund, with method and reference.', paperClasses: ['a5', 'thermal', 'mini', 'custom'], requiresEntity: true },
    { type: 'appointment_slip', title: 'Appointment slip', description: 'Patient, dentist, date, time, reason and the queue number.', paperClasses: ['a5', 'thermal', 'mini', 'custom'], requiresEntity: true },
    { type: 'patient_summary', title: 'Patient clinical summary', description: 'Alerts, chart findings, visits, treatments, prescriptions and the account position.', paperClasses: ['a4', 'a5', 'custom'], requiresEntity: true },
    { type: 'report', title: 'Report', description: 'Any report from the reports catalogue, formatted for paper.', paperClasses: ['a4', 'a5', 'custom'], requiresEntity: false },
    { type: 'test', title: 'Printer test page', description: 'Alignment ruler, embedded-font check and a Bengali line to verify the printer.', paperClasses: [...all], requiresEntity: false }
  ]
}

export async function printerStatus(ctx: ServiceContext): Promise<{
  printers: Array<{ name: string, displayName: string, description: string, status: number, isDefault: boolean }>
  defaultPrinter: string | null
  available: boolean
  missingFonts: string[]
}> {
  assertPermission(ctx, 'printing.print')
  const { missingBundledFonts } = await import('./fonts')
  try {
    const printers = await ctx.host.printing.listPrinters()
    const defaultPrinter = await ctx.host.printing.getDefaultPrinter()
    return {
      printers: printers.map((printer) => ({
        name: printer.name,
        displayName: printer.displayName,
        description: printer.description,
        status: printer.status,
        isDefault: printer.isDefault
      })),
      defaultPrinter: defaultPrinter ?? printers.find((printer) => printer.isDefault)?.name ?? null,
      available: ctx.host.machine.printersAvailable,
      missingFonts: missingBundledFonts()
    }
  } catch {
    /* A machine with no printing subsystem still renders, previews and saves PDFs. */
    return { printers: [], defaultPrinter: null, available: false, missingFonts: missingBundledFonts() }
  }
}

export interface RenderedDocument {
  documentType: string
  title: string
  fileName: string
  html: string
  paperClass: string
  layout: 'full' | 'compact' | 'receipt'
  widthMicrons: number
  heightMicrons: number
  marginsMicrons: { top: number, right: number, bottom: number, left: number }
  landscape: boolean
  copies: number
  profileId: number | null
  profileName: string | null
  warnings: string[]
  sizeBytes: number
}

function prepare(ctx: ServiceContext, request: PrintRequest): { prepared: PreparedDocument, profileId: number | null } {
  const profile = resolveProfileFor(ctx, request.documentType, request.profileId)
  const paper = resolvePaper(ctx, request, profile)
  const prepared = prepareDocument(ctx, request, paper)
  return { prepared, profileId: paper.profileId }
}

export function renderDocument(ctx: ServiceContext, request: PrintRequest): RenderedDocument {
  assertPermission(ctx, 'printing.print')
  const { prepared } = prepare(ctx, request)
  const paper = prepared.paper
  return {
    documentType: request.documentType,
    title: prepared.title,
    fileName: prepared.fileName,
    html: prepared.html,
    paperClass: paper.paperClass,
    layout: paper.layout,
    widthMicrons: paper.widthMm * 1000,
    heightMicrons: paper.heightMm * 1000,
    marginsMicrons: marginMicrons(paper.marginsMm),
    landscape: paper.landscape,
    copies: paper.copies,
    profileId: paper.profileId,
    profileName: paper.profileName,
    warnings: prepared.warnings,
    sizeBytes: prepared.sizeBytes
  }
}

/** A preview is remembered in the history (who looked at which record) but never mutates the record. */
export function recordPreview(ctx: ServiceContext, documentType: string, title: string, entityId: number | null): void {
  assertPermission(ctx, 'printing.print')
  recordHistory(ctx, {
    documentType,
    entityId,
    patientId: null,
    reference: null,
    title,
    profileId: null,
    printerName: null,
    paperClass: '',
    action: 'preview',
    result: 'success',
    failureReason: null,
    copies: 1,
    filePath: null,
    payloadPath: null
  })
}

export async function printDocument(ctx: ServiceContext, request: PrintRequest, printerName: string | null): Promise<PrintOutcome> {
  assertPermission(ctx, 'printing.print')
  const { prepared, profileId } = prepare(ctx, request)
  const paper = prepared.paper
  const target = printerName ?? (await resolvePrinter(ctx))
  if (!target) {
    const payloadPath = storePayload(ctx, prepared)
    const historyId = recordHistory(ctx, {
      documentType: request.documentType,
      entityId: request.entityId ?? null,
      patientId: prepared.patientId,
      reference: prepared.reference,
      title: prepared.title,
      profileId,
      printerName: null,
      paperClass: paper.paperClass,
      action: 'print',
      result: 'failed',
      failureReason: 'No printer is available.',
      copies: paper.copies,
      filePath: null,
      payloadPath
    })
    return { ok: false, failureReason: 'No printer is available. Choose a printer or save the document as PDF.', printerName: null, historyId, filePath: null }
  }

  const result = await ctx.host.printing.print({
    html: prepared.html,
    printerName: target,
    pageSizeMicrons: { width: paper.widthMm * 1000, height: paper.heightMm * 1000 },
    marginsMicrons: marginMicrons(paper.marginsMm),
    landscape: paper.landscape,
    copies: paper.copies
  })

  if (result.success) {
    markPrinted(ctx, request, target)
    const historyId = recordHistory(ctx, {
      documentType: request.documentType,
      entityId: request.entityId ?? null,
      patientId: prepared.patientId,
      reference: prepared.reference,
      title: prepared.title,
      profileId,
      printerName: target,
      paperClass: paper.paperClass,
      action: 'print',
      result: 'success',
      failureReason: null,
      copies: paper.copies,
      filePath: null,
      payloadPath: null
    })
    return { ok: true, failureReason: null, printerName: target, historyId, filePath: null }
  }

  const payloadPath = storePayload(ctx, prepared)
  const historyId = recordHistory(ctx, {
    documentType: request.documentType,
    entityId: request.entityId ?? null,
    patientId: prepared.patientId,
    reference: prepared.reference,
    title: prepared.title,
    profileId,
    printerName: target,
    paperClass: paper.paperClass,
    action: 'print',
    result: 'failed',
    failureReason: result.failureReason ?? 'The printer did not accept the job.',
    copies: paper.copies,
    filePath: null,
    payloadPath
  })
  return {
    ok: false,
    failureReason: result.failureReason ?? 'The printer did not accept the job. The document is saved — retry, change printer or save it as PDF.',
    printerName: target,
    historyId,
    filePath: null
  }
}

async function resolvePrinter(ctx: ServiceContext): Promise<string | null> {
  const status = await printerStatus(ctx)
  return status.defaultPrinter ?? status.printers[0]?.name ?? null
}

export async function savePdf(ctx: ServiceContext, request: PrintRequest, targetPath: string | null): Promise<PrintOutcome> {
  assertPermission(ctx, 'printing.print')
  const { prepared, profileId } = prepare(ctx, request)
  const paper = prepared.paper
  const path =
    targetPath ??
    (await ctx.host.dialogs.saveFile({
      title: 'Save document as PDF',
      defaultPath: join(ctx.host.paths.exportsDir, prepared.fileName.replace(/\.html$/, '.pdf')),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    }))
  if (!path) {
    return { ok: false, failureReason: 'The save was cancelled.', printerName: null, historyId: null, filePath: null }
  }
  requireExtension(path, '.pdf')

  const pdf = await ctx.host.printing.renderPdf({
    html: prepared.html,
    pageSizeMicrons: { width: paper.widthMm * 1000, height: paper.heightMm * 1000 },
    marginsMicrons: marginMicrons(paper.marginsMm),
    landscape: paper.landscape
  })
  writeFileSync(path, pdf.data)

  const historyId = recordHistory(ctx, {
    documentType: request.documentType,
    entityId: request.entityId ?? null,
    patientId: prepared.patientId,
    reference: prepared.reference,
    title: prepared.title,
    profileId,
    printerName: null,
    paperClass: paper.paperClass,
    action: 'pdf',
    result: 'success',
    failureReason: null,
    copies: 1,
    filePath: path,
    payloadPath: null
  })
  return { ok: true, failureReason: null, printerName: null, historyId, filePath: path }
}

export async function testPrint(
  ctx: ServiceContext,
  options: { printerName: string | null, paperClass: string, thermalWidthMm: 58 | 80 }
): Promise<PrintOutcome> {
  assertPermission(ctx, 'printing.print')
  return printDocument(
    ctx,
    { documentType: 'test', paperClass: options.paperClass as 'a4' | 'a5' | 'thermal' | 'mini' | 'custom', thermalWidthMm: options.thermalWidthMm },
    options.printerName
  )
}

export function listPrintHistory(
  ctx: ServiceContext,
  filter: { documentType?: string, result?: 'success' | 'failed', limit: number, offset: number }
): { items: HistoryEntry[], total: number } {
  assertPermission(ctx, 'printing.print')
  const clauses = ['1 = 1']
  const params: Record<string, unknown> = {}
  if (filter.documentType) {
    clauses.push('h.document_type = @documentType')
    params.documentType = filter.documentType
  }
  if (filter.result) {
    clauses.push('h.result = @result')
    params.result = filter.result
  }
  const where = clauses.join(' AND ')
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM print_history h WHERE ${where}`).get(params) as { count: number }).count
  const rows = ctx.db
    .prepare(
      `SELECT h.id, h.document_type, h.title, h.record_no, h.profile_id, h.printer_name, h.paper_class, h.action,
              h.result, h.error, h.copies, h.file_path, h.payload_path, h.username, h.printed_at,
              p.name AS profile_name
         FROM print_history h
         LEFT JOIN print_profiles p ON p.id = h.profile_id
        WHERE ${where}
        ORDER BY h.printed_at DESC, h.id DESC
        LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit: filter.limit, offset: filter.offset }) as Array<{
    id: number
    document_type: string
    title: string | null
    record_no: string | null
    profile_id: number | null
    printer_name: string | null
    paper_class: string | null
    action: string
    result: string
    error: string | null
    copies: number
    file_path: string | null
    payload_path: string | null
    username: string | null
    printed_at: number
    profile_name: string | null
  }>
  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      documentType: row.document_type as HistoryEntry['documentType'],
      title: row.title ?? row.document_type,
      reference: row.record_no,
      profileId: row.profile_id,
      profileName: row.profile_name,
      printerName: row.printer_name,
      paperClass: row.paper_class ?? '',
      action: (row.action ?? 'print') as HistoryEntry['action'],
      result: (row.result === 'failed' ? 'failed' : 'success') as HistoryEntry['result'],
      failureReason: row.error,
      copies: row.copies,
      filePath: row.file_path,
      hasPayload: Boolean(row.payload_path),
      performedByName: row.username,
      at: row.printed_at
    }))
  }
}

/** Re-opens the exact HTML of a stored job so a failed print can be inspected, retried or saved. */
export function loadPrintPayload(ctx: ServiceContext, id: number): { html: string, title: string, fileName: string } {
  assertPermission(ctx, 'printing.print')
  const row = ctx.db.prepare('SELECT title, payload_path FROM print_history WHERE id = ?').get(id) as
    | { title: string | null, payload_path: string | null }
    | undefined
  if (!row) throw notFoundError('print job', id)
  if (!row.payload_path) throw validationError('This job has no stored document (successful jobs are re-rendered from the record instead).')
  const html = readFileSync(row.payload_path, 'utf8')
  const fileName = row.payload_path.split(/[\\/]/).pop() ?? 'document.html'
  return { html, title: row.title ?? 'Print job', fileName }
}

export async function retryPrint(ctx: ServiceContext, historyId: number, printerName: string | null): Promise<PrintOutcome> {
  assertPermission(ctx, 'printing.print')
  const row = ctx.db
    .prepare('SELECT title, document_type, printer_name, paper_class, copies, payload_path FROM print_history WHERE id = ?')
    .get(historyId) as
    | { title: string | null, document_type: string, printer_name: string | null, paper_class: string | null, copies: number, payload_path: string | null }
    | undefined
  if (!row) throw notFoundError('print job', historyId)
  if (!row.payload_path) throw validationError('Only a failed job with a stored document can be retried.')
  const html = readFileSync(row.payload_path, 'utf8')
  const target = printerName ?? row.printer_name ?? (await resolvePrinter(ctx))
  if (!target) return { ok: false, failureReason: 'No printer is available.', printerName: null, historyId, filePath: null }

  const paperClass = (row.paper_class as 'a4' | 'a5' | 'thermal' | 'mini' | 'custom') || 'a4'
  const size = paperMicrons(paperClass, undefined, 80)
  const result = await ctx.host.printing.print({
    html,
    printerName: target,
    pageSizeMicrons: size,
    marginsMicrons: marginMicrons({ top: 12, right: 12, bottom: 12, left: 12 }),
    copies: row.copies
  })

  const newHistoryId = recordHistory(ctx, {
    documentType: row.document_type,
    entityId: null,
    patientId: null,
    reference: `retry of #${historyId}`,
    title: `Retry — ${row.title ?? row.document_type}`,
    profileId: null,
    printerName: target,
    paperClass: row.paper_class ?? '',
    action: 'print',
    result: result.success ? 'success' : 'failed',
    failureReason: result.failureReason ?? null,
    copies: row.copies,
    filePath: null,
    payloadPath: result.success ? null : row.payload_path
  })
  if (result.success) {
    /* The retried document is gone from the queue, so its stored copy can go too. */
    rmSync(row.payload_path, { force: true })
  }
  return {
    ok: result.success,
    failureReason: result.failureReason ?? null,
    printerName: target,
    historyId: newHistoryId,
    filePath: null
  }
}

export function assertPrintingReady(ctx: ServiceContext): void {
  if (!ctx.host.machine.printersAvailable) {
    throw new AppError('E_STATE', 'This machine reports no printing subsystem. Save the document as PDF instead.')
  }
}
