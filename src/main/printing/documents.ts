import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { assertPermission, type ServiceContext } from '../context'
import { validationError } from '@shared/errors'
import { formatBDT } from '@shared/money'
import { toLocalDate } from '@shared/datetime'
import { getClinicProfileSafe, getNumberSetting, getSettingSafe } from '../modules/settings/service'
import { getPrescription } from '../modules/clinical/prescriptions'
import { getInvoice } from '../modules/billing/invoices'
import { getPayment } from '../modules/billing/payments'
import { getAppointment } from '../modules/scheduling/appointments'
import { getPatient, getPatientFinancials, getPatientTimeline } from '../modules/patients/service'
import { getChart } from '../modules/clinical/chart'
import { runReport } from '../modules/accounting/reports'
import { embeddedFontFaceCss, missingBundledFonts } from './fonts'
import {
  layoutForPaper,
  pageSizeMm,
  renderAppointmentSlip,
  renderInvoice,
  renderPatientSummary,
  renderPaymentReceipt,
  renderPrescription,
  renderReport,
  renderTestPage,
  wrapDocument,
  type Layout,
  type PrescriptionView,
  type TemplateClinic,
  type TemplateDentist,
  type TemplateOptions,
  type TemplatePatient
} from './templates'
import type { zPrintRequest } from '@shared/contracts'
import type { z } from 'zod'

/**
 * Document preparation.
 *
 * A print request names a document and a record; this module loads that record through the ordinary
 * business services (so every permission check still applies), turns it into a paper-independent view
 * model and hands it to the templates together with the resolved paper and the embedded fonts. Nothing is
 * formatted for the page before this point, and nothing after it invents a number: the printed figure is
 * the stored figure.
 */

export type PrintRequest = z.infer<typeof zPrintRequest>

export interface ResolvedProfileLike {
  id: number
  name: string
  paperClass: string
  customWidthMm: number | null
  customHeightMm: number | null
  thermalWidthMm: number | null
  orientation: string
  marginsMm: { top: number, right: number, bottom: number, left: number }
  copies: number
}

export interface ResolvedPaper {
  paperClass: string
  layout: Layout
  widthMm: number
  heightMm: number
  marginsMm: { top: number, right: number, bottom: number, left: number }
  landscape: boolean
  copies: number
  profileId: number | null
  profileName: string | null
}

export interface PreparedDocument {
  html: string
  title: string
  fileName: string
  reference: string | null
  patientId: number | null
  paper: ResolvedPaper
  warnings: string[]
  sizeBytes: number
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

/** Only the clinic's own logo file is ever inlined; a missing file degrades to a text header. */
export function logoDataUri(path: string | null): string | null {
  if (!path || !existsSync(path)) return null
  const mime = MIME_BY_EXTENSION[extname(path).toLowerCase()]
  if (!mime) return null
  try {
    return `data:${mime};base64,${readFileSync(path).toString('base64')}`
  } catch {
    return null
  }
}

export function templateClinic(ctx: ServiceContext): TemplateClinic {
  const clinic = getClinicProfileSafe(ctx)
  const hours = clinic?.openingTime && clinic.closingTime ? `${clinic.openingTime} – ${clinic.closingTime}` : null
  const allowedFooter = getSettingSafe(ctx, 'print.showClinicFooter') === 'false' ? null : (clinic?.footerMessage ?? null)
  return {
    name: clinic?.name || 'Dental clinic',
    nameBn: clinic?.nameBn ?? null,
    address: clinic?.address ?? clinic?.addressBn ?? null,
    phone: clinic?.phone ?? clinic?.altPhone ?? null,
    email: clinic?.email ?? null,
    website: clinic?.website ?? null,
    registrationNo: null,
    footerMessage: allowedFooter,
    hours,
    logoDataUri: logoDataUri(clinic?.logoPath ?? null)
  }
}

function templatePatient(patient: {
  fullName: string
  fullNameBn: string | null
  code: string
  gender: string | null
  ageLabel: string | null
  phone: string | null
  address: string | null
}): TemplatePatient {
  return {
    name: patient.fullName,
    nameBn: patient.fullNameBn,
    code: patient.code,
    gender: patient.gender,
    age: patient.ageLabel,
    phone: patient.phone,
    address: patient.address
  }
}

function dentistFor(ctx: ServiceContext, id: number | null): TemplateDentist | null {
  if (!id) return null
  const row = ctx.db
    .prepare('SELECT full_name, full_name_bn, designations_json, registration_no FROM dentists WHERE id = ? AND is_deleted = 0')
    .get(id) as { full_name: string, full_name_bn: string | null, designations_json: string | null, registration_no: string | null } | undefined
  if (!row) return null
  let designations: string[] = []
  try {
    const parsed: unknown = JSON.parse(row.designations_json ?? '[]')
    if (Array.isArray(parsed)) designations = parsed.map((entry) => String(entry))
  } catch {
    designations = []
  }
  return { name: row.full_name, nameBn: row.full_name_bn, designations, registrationNo: row.registration_no }
}

function visitDentistId(ctx: ServiceContext, visitId: number | null): number | null {
  if (!visitId) return null
  const row = ctx.db.prepare('SELECT dentist_id FROM visits WHERE id = ?').get(visitId) as { dentist_id: number | null } | undefined
  return row?.dentist_id ?? null
}

/** Resolves paper, orientation, margins and copies from the request, then the profile, then the settings. */
export function resolvePaper(ctx: ServiceContext, request: PrintRequest, profile: ResolvedProfileLike | null): ResolvedPaper {
  const settingsClass = getSettingSafe(ctx, 'print.defaultPaperClass') || 'a4'
  const paperClass = request.paperClass ?? profile?.paperClass ?? settingsClass
  const thermalWidthMm =
    request.thermalWidthMm ?? profile?.thermalWidthMm ?? (getNumberSetting(ctx, 'print.thermalWidthMm') === 58 ? 58 : 80)
  const size = pageSizeMm(paperClass, {
    customWidthMm: request.customWidthMm ?? profile?.customWidthMm ?? null,
    customHeightMm: request.customHeightMm ?? profile?.customHeightMm ?? null,
    thermalWidthMm
  })
  const defaultMargin = 12
  const margins = profile?.marginsMm ?? { top: defaultMargin, right: defaultMargin, bottom: defaultMargin, left: defaultMargin }
  const requestedCopies = request.copies ?? profile?.copies ?? (getNumberSetting(ctx, 'print.copies') || 1)
  return {
    paperClass,
    layout: layoutForPaper(paperClass, size.widthMm),
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    marginsMm: margins,
    landscape: (request.orientation ?? profile?.orientation ?? 'portrait') === 'landscape',
    copies: Math.max(1, Math.min(requestedCopies, 10)),
    profileId: profile?.id ?? null,
    profileName: profile?.name ?? null
  }
}

function templateOptions(ctx: ServiceContext, paper: ResolvedPaper): TemplateOptions {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? null
  return {
    layout: paper.layout,
    paperClass: paper.paperClass,
    widthMm: paper.widthMm,
    heightMm: paper.heightMm,
    margins: paper.marginsMm,
    clinic: templateClinic(ctx),
    fontFaceCss: embeddedFontFaceCss({ appRoot: ctx.host.paths.appRoot, resourcesPath, isPackaged: !ctx.host.isDevelopment() }),
    missingFonts: missingBundledFonts()
  }
}

function requireEntity(request: PrintRequest): number {
  if (!request.entityId) throw validationError('Choose the record to print first.')
  return request.entityId
}

const FORM_LABELS: Record<string, string> = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  syrup: 'Syrup',
  suspension: 'Suspension',
  drops: 'Drops',
  injection: 'Injection',
  ointment: 'Ointment',
  gel: 'Gel',
  mouthwash: 'Mouthwash',
  sachet: 'Sachet',
  other: 'Other'
}

const TIMING_LABELS: Record<string, string> = {
  before_meal: 'Before meal',
  after_meal: 'After meal',
  with_meal: 'With meal',
  empty_stomach: 'Empty stomach',
  bedtime: 'At bedtime',
  as_needed: 'As needed'
}

/** The dose as the operator wrote it (1, ½, 2 …), never re-derived from numbers. */
function medicineDose(medicine: { doseMorning: string | null, doseAfternoon: string | null, doseNight: string | null, isPrn: boolean }): string {
  const parts: string[] = []
  if (medicine.doseMorning) parts.push(`Morning ${medicine.doseMorning}`)
  if (medicine.doseAfternoon) parts.push(`Noon ${medicine.doseAfternoon}`)
  if (medicine.doseNight) parts.push(`Night ${medicine.doseNight}`)
  if (medicine.isPrn) parts.push('If needed (PRN)')
  return parts.length > 0 ? parts.join(' · ') : 'As directed'
}

function buildPrescriptionView(ctx: ServiceContext, rx: ReturnType<typeof getPrescription>): PrescriptionView {
  const patientRow = ctx.db.prepare('SELECT allergies FROM patients WHERE id = ?').get(rx.patientId) as { allergies: string | null } | undefined
  const visitRow = rx.visitId
    ? (ctx.db.prepare('SELECT visit_no FROM visits WHERE id = ?').get(rx.visitId) as { visit_no: string } | undefined)
    : undefined
  return {
    rxNo: rx.rxNo,
    date: toLocalDate(rx.prescriptionAt),
    visitNo: visitRow?.visit_no ?? null,
    dentist: {
      name: rx.dentistName,
      nameBn: rx.dentistNameBn,
      designations: rx.dentistDesignations,
      registrationNo: rx.dentistRegistrationNo
    },
    patient: {
      name: rx.patientName,
      nameBn: rx.patientNameBn,
      code: rx.patientCode,
      gender: rx.patientGender,
      age: rx.patientAgeYears === null ? null : `${rx.patientAgeYears} years`,
      phone: rx.patientPhone,
      address: null
    },
    chiefComplaint: rx.ccText,
    onExamination: rx.oeText,
    diagnosis: rx.reText ?? rx.diagnosis,
    advice: rx.advice,
    followUp: rx.followUpDate,
    allergies: patientRow?.allergies ?? null,
    medicines: rx.medicines.map((medicine) => ({
      name: medicine.medicineName,
      strength: medicine.strength,
      form: [FORM_LABELS[medicine.form] ?? medicine.form, medicine.unit].filter(Boolean).join(' · '),
      dose: medicineDose(medicine),
      timing: TIMING_LABELS[medicine.timing] ?? medicine.timing,
      duration: medicine.durationDays ? `${medicine.durationDays} day(s)` : medicine.durationText,
      quantity: medicine.quantity,
      instructions: medicine.instructions
    }))
  }
}

function formatReportCell(value: string | number | null, format: string): string {
  if (value === null) return '—'
  if (format === 'money') return formatBDT(Number(value))
  if (format === 'number') return Number(value).toLocaleString('en-IN')
  if (format === 'percent') return `${Number(value).toFixed(2)} %`
  return String(value)
}

/**
 * Loads the record, fills the template and wraps it into a standalone HTML document. The caller supplies
 * the resolved paper so preview, paper output and PDF render the same page, and each document type is
 * gated by the permission of the record it prints.
 */
export function prepareDocument(ctx: ServiceContext, request: PrintRequest, paper: ResolvedPaper): PreparedDocument {
  const options = templateOptions(ctx, paper)
  let reference: string | null = null
  let patientId: number | null = null
  let result

  switch (request.documentType) {
    case 'prescription': {
      assertPermission(ctx, 'prescriptions.view')
      const rx = getPrescription(ctx, requireEntity(request))
      reference = rx.rxNo
      patientId = rx.patientId
      result = renderPrescription(buildPrescriptionView(ctx, rx), options)
      break
    }
    case 'invoice': {
      assertPermission(ctx, 'billing.view')
      const invoice = getInvoice(ctx, requireEntity(request))
      reference = invoice.invoiceNo
      patientId = invoice.patientId
      result = renderInvoice(
        {
          invoiceNo: invoice.invoiceNo,
          date: invoice.issueDate,
          status: invoice.status,
          voided: invoice.voidedAt !== null,
          patient: {
            name: invoice.patientName,
            nameBn: invoice.patientNameBn,
            code: invoice.patientCode,
            gender: null,
            age: null,
            phone: invoice.patientPhone,
            address: null
          },
          dentist: dentistFor(ctx, visitDentistId(ctx, invoice.visitId)),
          lines: invoice.lines.map((line) => ({
            description: line.description,
            toothCodes: line.toothCodes ?? [],
            quantity: String(line.quantity),
            unitPrice: formatBDT(line.unitPriceMicro),
            discount: line.discountMicro > 0 ? formatBDT(line.discountMicro) : '—',
            total: formatBDT(line.lineTotalMicro)
          })),
          subtotal: formatBDT(invoice.subtotalMicro),
          discount: invoice.discountMicro > 0 ? formatBDT(invoice.discountMicro) : '',
          total: formatBDT(invoice.totalMicro),
          paid: formatBDT(invoice.paidMicro),
          due: formatBDT(invoice.dueMicro),
          payments: invoice.payments
            .filter((payment) => payment.status === 'active')
            .map((payment) => ({
              receiptNo: payment.receiptNo,
              date: toLocalDate(payment.paidAt),
              amount: formatBDT(payment.kind === 'refund' ? -payment.amountMicro : payment.amountMicro),
              method: payment.method,
              receivedBy: payment.receivedByName
            })),
          notes: invoice.notes
        },
        options
      )
      break
    }
    case 'payment_receipt': {
      assertPermission(ctx, 'payments.view')
      const payment = getPayment(ctx, requireEntity(request))
      reference = payment.receiptNo
      patientId = payment.patientId
      result = renderPaymentReceipt(
        {
          receiptNo: payment.receiptNo,
          date: payment.paidDate,
          patient: { name: payment.patientName, nameBn: null, code: payment.patientCode, gender: null, age: null, phone: null, address: null },
          invoiceNo: payment.invoiceNo,
          amount: formatBDT(payment.amountMicro),
          method: payment.method,
          reference: payment.reference,
          receivedBy: payment.receivedByName,
          balanceAfter: null,
          voided: payment.status === 'void'
        },
        options
      )
      break
    }
    case 'appointment_slip': {
      assertPermission(ctx, 'appointments.view')
      const appointment = getAppointment(ctx, requireEntity(request))
      reference = `A-${appointment.id}`
      patientId = appointment.patientId
      const at = new Date(appointment.scheduledAt)
      result = renderAppointmentSlip(
        {
          patient: {
            name: appointment.patientName,
            nameBn: appointment.patientNameBn,
            code: appointment.patientCode,
            gender: null,
            age: null,
            phone: appointment.patientPhone,
            address: null
          },
          dentist: { name: appointment.dentistName, nameBn: null, designations: [], registrationNo: null },
          date: appointment.scheduledDate,
          time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`,
          durationMinutes: appointment.durationMin,
          reason: appointment.reason,
          queueNo: appointment.queueNo ? `#${appointment.queueNo}` : null,
          status: appointment.status
        },
        options
      )
      break
    }
    case 'patient_summary': {
      assertPermission(ctx, 'patients.view')
      const patient = getPatient(ctx, requireEntity(request))
      patientId = patient.id
      reference = patient.code
      const timeline = getPatientTimeline(ctx, { patientId: patient.id, limit: 200, offset: 0 })
      const financials = getPatientFinancials(ctx, patient.id)
      const chart = getChart(ctx, patient.id)
      result = renderPatientSummary(
        {
          generatedAt: new Date(ctx.now()).toLocaleString('en-GB'),
          patient: templatePatient(patient),
          allergies: patient.allergies,
          medicalNotes: patient.medicalHistory ?? patient.pastHistory,
          visits: timeline.items
            .filter((entry) => entry.kind === 'visit')
            .slice(0, 40)
            .map((entry) => ({ date: toLocalDate(entry.at), visitNo: `#${entry.entityId}`, dentist: entry.dentistName, summary: entry.title })),
          treatments: timeline.items
            .filter((entry) => entry.kind === 'treatment')
            .slice(0, 40)
            .map((entry) => ({
              date: toLocalDate(entry.at),
              description: entry.title,
              total: entry.amountMicro === null ? '—' : formatBDT(entry.amountMicro)
            })),
          prescriptions: timeline.items
            .filter((entry) => entry.kind === 'prescription')
            .slice(0, 20)
            .map((entry) => ({ date: toLocalDate(entry.at), rxNo: `#${entry.entityId}`, summary: entry.title })),
          chart: Object.values(chart.byTooth)
            .filter((entry) => entry.status !== 'resolved')
            .map((entry) => ({ tooth: entry.toothCode, text: entry.conditionName })),
          financials: {
            invoiced: formatBDT(financials.invoicedMicro),
            paid: formatBDT(financials.paidMicro),
            due: formatBDT(financials.dueMicro)
          }
        },
        options
      )
      break
    }
    case 'report': {
      assertPermission(ctx, 'reports.view')
      const key = request.reportKey ?? 'revenue_daily'
      const range =
        request.reportFrom && request.reportTo ? { preset: 'custom' as const, from: request.reportFrom, to: request.reportTo } : undefined
      const report = runReport(ctx, { key, range, limit: 5000 })
      reference = report.title
      result = renderReport(
        {
          title: report.title,
          description: report.description,
          period: report.from && report.to ? `${report.from} → ${report.to}` : 'Current position',
          generatedAt: new Date(ctx.now()).toLocaleString('en-GB'),
          columns: report.columns.map((column) => ({ key: column.key, header: column.header, align: column.align })),
          rows: report.rows.map((row) =>
            Object.fromEntries(
              Object.entries(row).map(([cellKey, value]) => [
                cellKey,
                formatReportCell(value, report.columns.find((column) => column.key === cellKey)?.format ?? 'text')
              ])
            )
          ),
          totals: report.totals.map((total) => ({ label: total.label, value: formatReportCell(total.value, total.format) })),
          note: report.note
        },
        options
      )
      break
    }
    case 'test': {
      result = renderTestPage(
        {
          clinicName: options.clinic.name,
          printedAt: new Date(ctx.now()).toLocaleString('en-GB'),
          printerName: null,
          appVersion: ctx.host.build.version,
          bengaliProbe: 'বাংলা লিখন পরীক্ষা — দাঁত, মাড়ি, চিকিৎসা',
          fontFamilies: ['Inter', 'Noto Sans Bengali']
        },
        options
      )
      break
    }
    default: {
      const exhaustive: never = request.documentType
      throw validationError(`Unsupported document type: ${String(exhaustive)}`)
    }
  }

  const html = wrapDocument(result, options)
  return {
    html,
    title: result.title,
    fileName: result.fileName,
    reference,
    patientId,
    paper,
    warnings: result.warnings,
    sizeBytes: Buffer.byteLength(html, 'utf8')
  }
}
