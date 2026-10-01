import { PAPER_SIZES_MM } from '../platform/types'

/**
 * Document templates.
 *
 * Preview, paper printing and PDF all use the HTML produced here — one template per document type, with
 * three layout engines selected by paper width (a receipt is never a shrunken A4). Every number that
 * reaches the page arrives pre-formatted from the caller; the template only lays it out, so a printed
 * invoice and the invoice screen cannot disagree about a figure.
 *
 * Fonts are embedded as data URIs by `printing/fonts.ts`, so a machine without a Bengali font still
 * prints Bengali names and clinical text correctly, and no network resource is ever requested (§6, §7).
 */

export type Layout = 'full' | 'compact' | 'receipt'

export interface TemplateMargins {
  top: number
  right: number
  bottom: number
  left: number
}

export interface TemplateClinic {
  name: string
  nameBn: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  registrationNo: string | null
  footerMessage: string | null
  hours: string | null
  logoDataUri: string | null
}

export interface TemplateDentist {
  name: string
  nameBn: string | null
  designations: string[]
  registrationNo: string | null
}

export interface TemplatePatient {
  name: string
  nameBn: string | null
  code: string
  gender: string | null
  age: string | null
  phone: string | null
  address: string | null
}

export interface MedicineLine {
  name: string
  strength: string | null
  form: string | null
  dose: string
  timing: string | null
  duration: string | null
  quantity: string | null
  instructions: string | null
}

export interface PrescriptionView {
  rxNo: string
  date: string
  visitNo: string | null
  dentist: TemplateDentist
  patient: TemplatePatient
  chiefComplaint: string | null
  onExamination: string | null
  diagnosis: string | null
  advice: string | null
  followUp: string | null
  medicines: MedicineLine[]
  allergies: string | null
}

export interface InvoiceLineView {
  description: string
  toothCodes: string[]
  quantity: string
  unitPrice: string
  discount: string
  total: string
}

export interface InvoicePaymentView {
  receiptNo: string
  date: string
  amount: string
  method: string
  receivedBy: string | null
}

export interface InvoiceView {
  invoiceNo: string
  date: string
  status: string
  voided: boolean
  patient: TemplatePatient
  dentist: TemplateDentist | null
  lines: InvoiceLineView[]
  subtotal: string
  discount: string
  total: string
  paid: string
  due: string
  payments: InvoicePaymentView[]
  notes: string | null
}

export interface ReceiptView {
  receiptNo: string
  date: string
  patient: TemplatePatient
  invoiceNo: string | null
  amount: string
  method: string
  reference: string | null
  receivedBy: string | null
  balanceAfter: string | null
  voided: boolean
}

export interface AppointmentSlipView {
  patient: TemplatePatient
  dentist: TemplateDentist | null
  date: string
  time: string
  durationMinutes: number
  reason: string | null
  queueNo: string | null
  status: string
}

export interface PatientSummaryView {
  generatedAt: string
  patient: TemplatePatient
  allergies: string | null
  medicalNotes: string | null
  visits: Array<{ date: string, visitNo: string, dentist: string | null, summary: string | null }>
  treatments: Array<{ date: string, description: string, total: string }>
  prescriptions: Array<{ date: string, rxNo: string, summary: string }>
  chart: Array<{ tooth: string, text: string }>
  financials: { invoiced: string, paid: string, due: string } | null
}

export interface ReportView {
  title: string
  description: string
  period: string
  generatedAt: string
  columns: Array<{ key: string, header: string, align: 'left' | 'right' }>
  rows: Array<Record<string, string>>
  totals: Array<{ label: string, value: string }>
  note: string | null
}

export interface TestPageView {
  clinicName: string
  printedAt: string
  printerName: string | null
  appVersion: string
  bengaliProbe: string
  fontFamilies: string[]
}

export interface TemplateResult {
  title: string
  /** Suggested file name (used for PDF targets and the stored payload). */
  fileName: string
  body: string
  warnings: string[]
}

export interface TemplateOptions {
  layout: Layout
  paperClass: string
  widthMm: number
  heightMm: number
  margins: TemplateMargins
  clinic: TemplateClinic
  fontFaceCss: string
  missingFonts: string[]
}

/** Paper width decides the layout engine; a template is never scaled between classes (§2 of the spec). */
export function layoutForPaper(paperClass: string, widthMm: number): Layout {
  if (paperClass === 'thermal') return 'receipt'
  if (paperClass === 'mini') return 'compact'
  if (paperClass === 'custom') {
    if (widthMm < 100) return 'receipt'
    if (widthMm < 170) return 'compact'
    return 'full'
  }
  if (paperClass === 'a5') return 'compact'
  return 'full'
}

export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Newlines in clinic text (advice, notes) must survive as line breaks, never as literal text. */
function textBlock(value: string | null | undefined): string {
  if (!value) return ''
  return escapeHtml(value).replace(/\r?\n/g, '<br />')
}

function join(parts: Array<string | null | undefined>, separator = ' · '): string {
  return parts.filter((part) => part !== null && part !== undefined && String(part).trim() !== '').join(separator)
}

function orDash(value: string | null | undefined): string {
  return value && String(value).trim() !== '' ? escapeHtml(value) : '—'
}

/* -------------------------------------------------------------------------- */
/* Stylesheet                                                                 */
/* -------------------------------------------------------------------------- */

function baseCss(options: TemplateOptions): string {
  const { layout, widthMm, heightMm, margins } = options
  const scale = layout === 'receipt' ? 11 : layout === 'compact' ? 11.5 : 12.5
  const pageRule =
    layout === 'receipt'
      ? `@page { size: ${widthMm}mm auto; margin: 0; }`
      : `@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }`

  return `
${options.fontFaceCss}
${pageRule}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Inter', 'Noto Sans Bengali', 'Segoe UI', 'Nirmala UI', sans-serif;
  font-size: ${scale}pt;
  line-height: 1.45;
  color: #111827;
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.bn { font-family: 'Noto Sans Bengali', 'Inter', 'Nirmala UI', sans-serif; }
.page {
  width: ${widthMm}mm;
  ${layout === 'receipt' ? 'min-height: 40mm;' : `min-height: ${heightMm}mm;`}
  padding: ${margins.top}mm ${margins.right}mm ${margins.bottom}mm ${margins.left}mm;
  position: relative;
}
.watermark {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 42pt; font-weight: 700; letter-spacing: 6px; color: rgba(185, 28, 28, 0.16);
  transform: rotate(-24deg); pointer-events: none;
}
.clinic { display: flex; gap: 4mm; align-items: flex-start; border-bottom: 1.2pt solid #0f172a; padding-bottom: 3mm; }
.clinic__logo { width: 18mm; height: 18mm; object-fit: contain; }
.clinic__name { font-size: ${layout === 'receipt' ? 13 : 17}pt; font-weight: 700; margin: 0; }
.clinic__name-bn { font-size: ${layout === 'receipt' ? 11 : 12}pt; margin: 1px 0 0; color: #334155; }
.clinic__meta { font-size: 9.5pt; color: #475569; margin: 1px 0 0; }
.clinic__right { margin-left: auto; text-align: right; font-size: 9.5pt; color: #475569; }
.doc-title { text-align: center; font-weight: 700; font-size: ${layout === 'receipt' ? 11 : 13}pt; letter-spacing: 2px; text-transform: uppercase; margin: 3mm 0 2mm; }
.meta { display: flex; justify-content: space-between; gap: 4mm; font-size: 10pt; margin-bottom: 2mm; }
.meta__cell strong { font-weight: 600; }
.section { margin-top: 3mm; }
.section__title { font-weight: 700; font-size: 10.5pt; text-transform: uppercase; letter-spacing: 0.6px; color: #0f172a; border-bottom: 0.6pt solid #cbd5e1; padding-bottom: 0.6mm; margin-bottom: 1.5mm; }
.section__body { white-space: normal; }
.grid-2 { display: flex; gap: 5mm; }
.grid-2 > div { flex: 1; }
table { width: 100%; border-collapse: collapse; font-size: ${layout === 'receipt' ? 9.5 : 10}pt; }
th, td { border-bottom: 0.5pt solid #cbd5e1; padding: 1.2mm 1mm; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-weight: 600; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.4px; }
td.num, th.num { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 1pt solid #0f172a; }
.kv { display: flex; flex-wrap: wrap; gap: 1mm 4mm; font-size: 10pt; }
.kv span strong { font-weight: 600; }
.note { font-size: 9.5pt; color: #475569; }
.signature { margin-top: 10mm; display: flex; justify-content: space-between; gap: 10mm; font-size: 9.5pt; }
.signature__line { border-top: 0.6pt solid #0f172a; padding-top: 1mm; min-width: 45mm; text-align: center; }
.footer { margin-top: 4mm; border-top: 0.5pt solid #cbd5e1; padding-top: 1.5mm; font-size: 9pt; color: #475569; text-align: center; }
.receipt-line { display: flex; justify-content: space-between; gap: 3mm; padding: 0.8mm 0; }
.receipt-line strong { font-weight: 600; }
.dashed { border-top: 1px dashed #94a3b8; margin: 2mm 0; }
.chip { display: inline-block; border: 0.5pt solid #94a3b8; border-radius: 999px; padding: 0 2mm; font-size: 9pt; margin-right: 1mm; }
.pill { display: inline-block; border-radius: 3px; padding: 0.4mm 1.6mm; font-size: 9pt; background: #e2e8f0; }
.pill--paid { background: #dcfce7; color: #166534; }
.pill--due { background: #fee2e2; color: #991b1b; }
.legend { font-size: 8.5pt; color: #64748b; }
`
}

const DISPLAY_NAMES: Record<string, string> = {
  a4: 'A4',
  a5: 'A5',
  thermal: 'Thermal roll',
  mini: 'Mini',
  custom: 'Custom'
}

export function pageSizeMm(paperClass: string, options: { customWidthMm?: number | null, customHeightMm?: number | null, thermalWidthMm?: number | null }): { widthMm: number, heightMm: number } {
  if (paperClass === 'custom') {
    return {
      widthMm: Math.max(40, Math.min(options.customWidthMm ?? PAPER_SIZES_MM.mini.width, 297)),
      heightMm: Math.max(40, Math.min(options.customHeightMm ?? PAPER_SIZES_MM.mini.height, 431))
    }
  }
  if (paperClass === 'thermal') {
    const width = options.thermalWidthMm === 58 ? 58 : 80
    return { widthMm: width, heightMm: PAPER_SIZES_MM.thermal80.height }
  }
  const preset = PAPER_SIZES_MM[paperClass as keyof typeof PAPER_SIZES_MM] ?? PAPER_SIZES_MM.a4
  return { widthMm: preset.width, heightMm: preset.height }
}

export function paperLabel(paperClass: string, widthMm: number): string {
  if (paperClass === 'custom') return `Custom ${widthMm} mm`
  if (paperClass === 'thermal') return `Thermal ${widthMm} mm`
  return DISPLAY_NAMES[paperClass] ?? paperClass
}

/* -------------------------------------------------------------------------- */
/* Shared sections                                                            */
/* -------------------------------------------------------------------------- */

function clinicHeader(options: TemplateOptions): string {
  const { clinic, layout } = options
  if (layout === 'receipt') {
    return `
<header class="clinic">
  <div style="flex:1;text-align:center;">
    <p class="clinic__name">${escapeHtml(clinic.name)}</p>
    ${clinic.nameBn ? `<p class="clinic__name-bn bn">${escapeHtml(clinic.nameBn)}</p>` : ''}
    <p class="clinic__meta">${join([clinic.address, clinic.phone])}</p>
    ${clinic.registrationNo ? `<p class="clinic__meta">Reg. ${escapeHtml(clinic.registrationNo)}</p>` : ''}
  </div>
</header>`
  }
  return `
<header class="clinic">
  ${clinic.logoDataUri ? `<img class="clinic__logo" src="${clinic.logoDataUri}" alt="" />` : ''}
  <div>
    <p class="clinic__name">${escapeHtml(clinic.name)}</p>
    ${clinic.nameBn ? `<p class="clinic__name-bn bn">${escapeHtml(clinic.nameBn)}</p>` : ''}
    <p class="clinic__meta">${join([clinic.address, clinic.phone])}</p>
    <p class="clinic__meta">${join([clinic.email, clinic.website])}</p>
  </div>
  <div class="clinic__right">
    ${clinic.registrationNo ? `<div>Reg. ${escapeHtml(clinic.registrationNo)}</div>` : ''}
    ${clinic.hours ? `<div>${textBlock(clinic.hours)}</div>` : ''}
  </div>
</header>`
}

function patientStrip(patient: TemplatePatient, layout: Layout): string {
  if (layout === 'receipt') {
    return `
<div class="section">
  <div class="receipt-line"><span>Patient</span><strong>${escapeHtml(patient.name)}</strong></div>
  ${patient.nameBn ? `<div class="receipt-line"><span class="legend">নাম</span><span class="bn">${escapeHtml(patient.nameBn)}</span></div>` : ''}
  <div class="receipt-line"><span>Code</span><span>${escapeHtml(patient.code)}</span></div>
  ${join([patient.age ? `${patient.age}` : null, patient.gender]) ? `<div class="receipt-line"><span>Age / sex</span><span>${escapeHtml(join([patient.age, patient.gender]))}</span></div>` : ''}
</div>`
  }
  return `
<div class="kv">
  <span><strong>Patient:</strong> ${escapeHtml(patient.name)}${patient.nameBn ? ` <span class="bn">(${escapeHtml(patient.nameBn)})</span>` : ''}</span>
  <span><strong>Code:</strong> ${escapeHtml(patient.code)}</span>
  ${patient.age ? `<span><strong>Age:</strong> ${escapeHtml(patient.age)}</span>` : ''}
  ${patient.gender ? `<span><strong>Gender:</strong> ${escapeHtml(patient.gender)}</span>` : ''}
  ${patient.phone ? `<span><strong>Phone:</strong> ${escapeHtml(patient.phone)}</span>` : ''}
</div>`
}

function signatureBlock(dentist: TemplateDentist | null, clinic: TemplateClinic): string {
  return `
<div class="signature">
  <div class="signature__line">Patient / attendant</div>
  ${dentist ? `<div class="signature__line">${escapeHtml(dentist.name)}${dentist.registrationNo ? `<br /><span class="legend">BMDC ${escapeHtml(dentist.registrationNo)}</span>` : ''}</div>` : ''}
</div>
<div class="footer">${textBlock(clinic.footerMessage ?? '')}</div>`
}

function dentistLine(dentist: TemplateDentist | null): string {
  if (!dentist) return ''
  const degrees = join(dentist.designations, ', ')
  return `${escapeHtml(dentist.name)}${degrees ? ` · ${escapeHtml(degrees)}` : ''}${dentist.registrationNo ? ` · BMDC ${escapeHtml(dentist.registrationNo)}` : ''}`
}

/* -------------------------------------------------------------------------- */
/* Prescription                                                               */
/* -------------------------------------------------------------------------- */

export function renderPrescription(view: PrescriptionView, options: TemplateOptions): TemplateResult {
  const { layout } = options
  const warnings: string[] = []
  if (view.medicines.length === 0 && view.advice === null) warnings.push('This prescription has neither medicines nor advice.')
  if (options.missingFonts.length > 0) warnings.push(`Bundled font file(s) missing: ${options.missingFonts.join(', ')}. System fallbacks were used.`)

  const medicineRows = view.medicines
    .map((medicine, index) => {
      const name = `${escapeHtml(medicine.name)}${medicine.strength ? ` ${escapeHtml(medicine.strength)}` : ''}`
      const detail = join([medicine.form, medicine.timing, medicine.duration, medicine.quantity ? `Qty ${medicine.quantity}` : null], ' · ')
      if (layout === 'receipt') {
        return `<div class="receipt-line"><span>${index + 1}. ${name}</span><span>${escapeHtml(medicine.dose)}</span></div>
        ${detail ? `<div class="legend" style="margin-left:4mm;">${detail}</div>` : ''}
        ${medicine.instructions ? `<div class="legend" style="margin-left:4mm;">${textBlock(medicine.instructions)}</div>` : ''}`
      }
      return `<tr>
        <td>${index + 1}</td>
        <td><strong>${name}</strong>${medicine.instructions ? `<div class="legend">${textBlock(medicine.instructions)}</div>` : ''}</td>
        <td>${orDash(medicine.dose)}</td>
        <td>${orDash(medicine.timing)}</td>
        <td>${orDash(join([medicine.duration, medicine.quantity ? `Qty ${medicine.quantity}` : null]))}</td>
      </tr>`
    })
    .join('')

  const clinical = `
<div class="${layout === 'full' ? 'grid-2' : ''}">
  <div>
    <div class="section"><div class="section__title">C/C — Chief complaint</div><div class="section__body">${textBlock(view.chiefComplaint) || '<span class="legend">Not recorded</span>'}</div></div>
    <div class="section"><div class="section__title">O/E — On examination</div><div class="section__body">${textBlock(view.onExamination) || '<span class="legend">Not recorded</span>'}</div></div>
  </div>
  <div>
    <div class="section"><div class="section__title">R/E — Diagnosis</div><div class="section__body">${textBlock(view.diagnosis) || '<span class="legend">Not recorded</span>'}</div></div>
    <div class="section"><div class="section__title">Advice</div><div class="section__body">${textBlock(view.advice) || '<span class="legend">—</span>'}</div></div>
  </div>
</div>`

  const body = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">Prescription</div>
  <div class="meta">
    <div class="meta__cell"><strong>Rx No:</strong> ${escapeHtml(view.rxNo)}</div>
    <div class="meta__cell"><strong>Date:</strong> ${escapeHtml(view.date)}</div>
    ${view.visitNo ? `<div class="meta__cell"><strong>Visit:</strong> ${escapeHtml(view.visitNo)}</div>` : ''}
  </div>
  ${patientStrip(view.patient, layout)}
  ${view.allergies ? `<div class="section"><div class="section__title">Allergies / alerts</div><div class="section__body">${textBlock(view.allergies)}</div></div>` : ''}
  ${clinical}
  <div class="section">
    <div class="section__title">Rx — Medicines</div>
    ${layout === 'receipt' || view.medicines.length === 0
      ? medicineRows || '<div class="legend">No medicine prescribed.</div>'
      : `<table>
          <thead><tr><th style="width:6mm">#</th><th>Medicine</th><th style="width:20mm">Dose</th><th style="width:22mm">Timing</th><th style="width:28mm">Duration / qty</th></tr></thead>
          <tbody>${medicineRows || '<tr><td colspan="5" class="legend">No medicine prescribed.</td></tr>'}</tbody>
        </table>`}
  </div>
  ${view.followUp ? `<div class="section"><div class="section__title">Follow-up</div><div class="section__body">${textBlock(view.followUp)}</div></div>` : ''}
  ${signatureBlock(view.dentist, options.clinic)}
</div>`

  const receiptBody = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">Prescription</div>
  <div class="receipt-line"><span>Rx No</span><strong>${escapeHtml(view.rxNo)}</strong></div>
  <div class="receipt-line"><span>Date</span><span>${escapeHtml(view.date)}</span></div>
  <div class="receipt-line"><span>Dentist</span><span>${escapeHtml(view.dentist.name)}</span></div>
  ${patientStrip(view.patient, 'receipt')}
  <div class="dashed"></div>
  <div class="section__title">C/C</div><div class="section__body">${textBlock(view.chiefComplaint) || '—'}</div>
  <div class="section__title">O/E</div><div class="section__body">${textBlock(view.onExamination) || '—'}</div>
  <div class="section__title">R/E</div><div class="section__body">${textBlock(view.diagnosis) || '—'}</div>
  <div class="section__title">Advice</div><div class="section__body">${textBlock(view.advice) || '—'}</div>
  <div class="dashed"></div>
  <div class="section__title">Rx</div>
  ${medicineRows || '<div class="legend">No medicine prescribed.</div>'}
  ${view.followUp ? `<div class="dashed"></div><div class="section__title">Follow-up</div><div class="section__body">${textBlock(view.followUp)}</div>` : ''}
  ${view.allergies ? `<div class="dashed"></div><div class="legend">Allergies: ${textBlock(view.allergies)}</div>` : ''}
  ${options.clinic.footerMessage ? `<div class="dashed"></div><div class="legend">${textBlock(options.clinic.footerMessage)}</div>` : ''}
</div>`

  return {
    title: `Prescription ${view.rxNo}`,
    fileName: `prescription-${view.rxNo}.html`,
    body: layout === 'receipt' ? receiptBody : body,
    warnings
  }
}

/* -------------------------------------------------------------------------- */
/* Invoice and receipt                                                        */
/* -------------------------------------------------------------------------- */

export function renderInvoice(view: InvoiceView, options: TemplateOptions): TemplateResult {
  const { layout } = options
  const warnings: string[] = []
  if (view.lines.length === 0) warnings.push('This invoice has no lines.')

  if (layout === 'receipt') {
    const lines = view.lines
      .map(
        (line) => `<div class="receipt-line"><span>${escapeHtml(line.description)}${line.toothCodes.length > 0 ? ` <span class="legend">[${line.toothCodes.map(escapeHtml).join(', ')}]</span>` : ''}${line.quantity !== '1' ? ` ×${escapeHtml(line.quantity)}` : ''}</span><span>${escapeHtml(line.total)}</span></div>`
      )
      .join('')
    const payments = view.payments
      .map((payment) => `<div class="receipt-line legend"><span>${escapeHtml(payment.date)} · ${escapeHtml(payment.method)}${payment.receivedBy ? ` · ${escapeHtml(payment.receivedBy)}` : ''}</span><span>${escapeHtml(payment.amount)}</span></div>`)
      .join('')
    const body = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">${view.voided ? 'VOID INVOICE' : 'Invoice'}</div>
  <div class="receipt-line"><span>Invoice</span><strong>${escapeHtml(view.invoiceNo)}</strong></div>
  <div class="receipt-line"><span>Date</span><span>${escapeHtml(view.date)}</span></div>
  <div class="receipt-line"><span>Patient</span><span>${escapeHtml(view.patient.name)}</span></div>
  <div class="receipt-line"><span>Code</span><span>${escapeHtml(view.patient.code)}</span></div>
  <div class="dashed"></div>
  ${lines}
  <div class="dashed"></div>
  <div class="receipt-line"><span>Subtotal</span><span>${escapeHtml(view.subtotal)}</span></div>
  ${view.discount !== '' ? `<div class="receipt-line"><span>Discount</span><span>${escapeHtml(view.discount)}</span></div>` : ''}
  <div class="receipt-line"><strong>Total</strong><strong>${escapeHtml(view.total)}</strong></div>
  <div class="receipt-line"><span>Paid</span><span>${escapeHtml(view.paid)}</span></div>
  <div class="receipt-line"><strong>Due</strong><strong>${escapeHtml(view.due)}</strong></div>
  ${payments ? `<div class="dashed"></div>${payments}` : ''}
  ${options.clinic.footerMessage ? `<div class="dashed"></div><div class="legend">${textBlock(options.clinic.footerMessage)}</div>` : ''}
</div>`
    return { title: `Invoice ${view.invoiceNo}`, fileName: `invoice-${view.invoiceNo}.html`, body, warnings }
  }

  const lineRows = view.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.description)}${line.toothCodes.length > 0 ? ` <span class="legend">[${line.toothCodes.map(escapeHtml).join(', ')}]</span>` : ''}</td>
        <td class="num">${escapeHtml(line.quantity)}</td>
        <td class="num">${escapeHtml(line.unitPrice)}</td>
        <td class="num">${escapeHtml(line.discount)}</td>
        <td class="num">${escapeHtml(line.total)}</td>
      </tr>`
    )
    .join('')

  const paymentHistory =
    view.payments.length === 0
      ? ''
      : `<div class="section"><div class="section__title">Payments received</div>
        <table><thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Received by</th><th class="num">Amount</th></tr></thead>
        <tbody>${view.payments
          .map(
            (payment) => `<tr><td>${escapeHtml(payment.receiptNo)}</td><td>${escapeHtml(payment.date)}</td><td>${escapeHtml(payment.method)}</td><td>${escapeHtml(payment.receivedBy ?? '—')}</td><td class="num">${escapeHtml(payment.amount)}</td></tr>`
          )
          .join('')}</tbody></table></div>`

  const body = `
<div class="page">
  ${view.voided ? '<div class="watermark">VOID</div>' : ''}
  ${clinicHeader(options)}
  <div class="doc-title">${view.voided ? 'Invoice (void)' : 'Invoice'}</div>
  <div class="meta">
    <div class="meta__cell"><strong>Invoice:</strong> ${escapeHtml(view.invoiceNo)}<br /><strong>Date:</strong> ${escapeHtml(view.date)}</div>
    <div class="meta__cell" style="text-align:right">
      <span class="pill ${view.due !== '—' && Number.parseInt(view.due.replace(/\D/g, ''), 10) > 0 ? 'pill--due' : 'pill--paid'}">${escapeHtml(view.status)}</span><br />
      ${view.dentist ? `<span class="legend">${dentistLine(view.dentist)}</span>` : ''}
    </div>
  </div>
  ${patientStrip(view.patient, layout)}
  <div class="section">
    <table>
      <thead><tr><th>Description</th><th class="num" style="width:14mm">Qty</th><th class="num" style="width:26mm">Rate</th><th class="num" style="width:22mm">Discount</th><th class="num" style="width:28mm">Total</th></tr></thead>
      <tbody>${lineRows || '<tr><td colspan="5" class="legend">No lines.</td></tr>'}</tbody>
      <tfoot>
        <tr><td colspan="4" class="num">Subtotal</td><td class="num">${escapeHtml(view.subtotal)}</td></tr>
        <tr><td colspan="4" class="num">Discount</td><td class="num">${escapeHtml(view.discount)}</td></tr>
        <tr class="total"><td colspan="4" class="num">Total</td><td class="num">${escapeHtml(view.total)}</td></tr>
        <tr><td colspan="4" class="num">Paid</td><td class="num">${escapeHtml(view.paid)}</td></tr>
        <tr class="total"><td colspan="4" class="num">Due</td><td class="num">${escapeHtml(view.due)}</td></tr>
      </tfoot>
    </table>
  </div>
  ${paymentHistory}
  ${view.notes ? `<div class="section note">${textBlock(view.notes)}</div>` : ''}
  ${signatureBlock(view.dentist, options.clinic)}
</div>`

  return { title: `Invoice ${view.invoiceNo}`, fileName: `invoice-${view.invoiceNo}.html`, body, warnings }
}

export function renderPaymentReceipt(view: ReceiptView, options: TemplateOptions): TemplateResult {
  const warnings: string[] = []
  if (view.voided) warnings.push('This receipt was voided; the reversal is recorded in the books.')
  const receiptLayout = options.layout === 'receipt'
  const line = (label: string, value: string, strong = false): string =>
    receiptLayout
      ? `<div class="receipt-line"><span${strong ? ' style="font-weight:600"' : ''}>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`
      : `<span><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</span>`
  const body = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">${view.voided ? 'Receipt (void)' : 'Payment receipt'}</div>
  ${receiptLayout ? '' : '<div class="kv">'}
    ${line('Receipt', view.receiptNo, true)}
    ${line('Date', view.date)}
    ${line('Patient', view.patient.name)}
    ${line('Code', view.patient.code)}
    ${view.invoiceNo ? line('Invoice', view.invoiceNo) : ''}
    ${line('Method', view.method)}
    ${view.reference ? line('Reference', view.reference) : ''}
    ${line('Amount', view.amount, true)}
    ${view.balanceAfter ? line('Balance after', view.balanceAfter) : ''}
    ${view.receivedBy ? line('Received by', view.receivedBy) : ''}
  ${receiptLayout ? '' : '</div>'}
  ${receiptLayout ? '<div class="dashed"></div>' : ''}
  ${options.clinic.footerMessage ? `<div class="${receiptLayout ? 'dashed' : 'footer'}">${textBlock(options.clinic.footerMessage)}</div>` : ''}
</div>`
  return { title: `Receipt ${view.receiptNo}`, fileName: `receipt-${view.receiptNo}.html`, body, warnings }
}

/* -------------------------------------------------------------------------- */
/* Appointment slip, patient summary, report, test page                       */
/* -------------------------------------------------------------------------- */

export function renderAppointmentSlip(view: AppointmentSlipView, options: TemplateOptions): TemplateResult {
  const receipt = options.layout === 'receipt'
  const rows: Array<[string, string]> = [
    ['Patient', view.patient.name],
    ['Code', view.patient.code],
    ['Phone', view.patient.phone ?? '—'],
    ['Dentist', view.dentist ? dentistLine(view.dentist) : 'Any available dentist'],
    ['Date', view.date],
    ['Time', `${view.time} (${view.durationMinutes} min)`],
    ['Status', view.status]
  ]
  if (view.queueNo) rows.push(['Queue no', view.queueNo])
  if (view.reason) rows.push(['Reason', view.reason])
  const body = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">Appointment slip</div>
  ${receipt ? '' : '<div class="kv">'}
  ${rows.map(([label, value]) => (receipt ? `<div class="receipt-line"><span>${escapeHtml(label)}</span><strong>${textBlock(value)}</strong></div>` : `<span><strong>${escapeHtml(label)}:</strong> ${textBlock(value)}</span>`)).join('')}
  ${receipt ? '' : '</div>'}
  <div class="footer">Please arrive 10 minutes early. Bring any previous prescriptions and reports.</div>
</div>`
  return { title: `Appointment slip ${view.date} ${view.time}`, fileName: `appointment-${view.date}-${view.time.replace(':', '')}.html`, body, warnings: [] }
}

export function renderPatientSummary(view: PatientSummaryView, options: TemplateOptions): TemplateResult {
  const visits = view.visits
    .map((visit) => `<tr><td>${escapeHtml(visit.date)}</td><td>${escapeHtml(visit.visitNo)}</td><td>${escapeHtml(visit.dentist ?? '—')}</td><td>${textBlock(visit.summary) || '—'}</td></tr>`)
    .join('')
  const treatments = view.treatments
    .map((treatment) => `<tr><td>${escapeHtml(treatment.date)}</td><td>${textBlock(treatment.description)}</td><td class="num">${escapeHtml(treatment.total)}</td></tr>`)
    .join('')
  const prescriptions = view.prescriptions
    .map((prescription) => `<tr><td>${escapeHtml(prescription.date)}</td><td>${escapeHtml(prescription.rxNo)}</td><td>${textBlock(prescription.summary)}</td></tr>`)
    .join('')
  const chart = view.chart.map((entry) => `<span class="chip">${escapeHtml(entry.tooth)} — ${textBlock(entry.text)}</span>`).join(' ')
  const body = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">Patient clinical summary</div>
  ${patientStrip(view.patient, options.layout)}
  <div class="section"><div class="section__title">Alerts</div><div class="section__body">${textBlock(view.allergies) || 'No known allergy recorded.'}</div></div>
  ${view.medicalNotes ? `<div class="section"><div class="section__title">Medical history</div><div class="section__body">${textBlock(view.medicalNotes)}</div></div>` : ''}
  <div class="section"><div class="section__title">Current chart findings</div><div class="section__body">${chart || '<span class="legend">No active chart finding.</span>'}</div></div>
  <div class="section"><div class="section__title">Visits</div>
    <table><thead><tr><th style="width:22mm">Date</th><th style="width:26mm">Visit</th><th style="width:36mm">Dentist</th><th>Summary</th></tr></thead>
    <tbody>${visits || '<tr><td colspan="4" class="legend">No visit recorded.</td></tr>'}</tbody></table></div>
  <div class="section"><div class="section__title">Treatments</div>
    <table><thead><tr><th style="width:22mm">Date</th><th>Treatment</th><th class="num" style="width:28mm">Amount</th></tr></thead>
    <tbody>${treatments || '<tr><td colspan="3" class="legend">No treatment recorded.</td></tr>'}</tbody></table></div>
  <div class="section"><div class="section__title">Prescriptions</div>
    <table><thead><tr><th style="width:22mm">Date</th><th style="width:26mm">Rx</th><th>Medicines</th></tr></thead>
    <tbody>${prescriptions || '<tr><td colspan="3" class="legend">No prescription recorded.</td></tr>'}</tbody></table></div>
  ${view.financials ? `<div class="section"><div class="section__title">Account</div><div class="kv"><span><strong>Invoiced:</strong> ${escapeHtml(view.financials.invoiced)}</span><span><strong>Paid:</strong> ${escapeHtml(view.financials.paid)}</span><span><strong>Due:</strong> ${escapeHtml(view.financials.due)}</span></div></div>` : ''}
  <div class="footer">Generated from the clinic's own records on ${escapeHtml(view.generatedAt)}.</div>
</div>`
  return { title: `Summary — ${view.patient.name}`, fileName: `patient-summary-${view.patient.code}.html`, body, warnings: [] }
}

export function renderReport(view: ReportView, options: TemplateOptions): TemplateResult {
  const head = view.columns.map((column) => `<th class="${column.align === 'right' ? 'num' : ''}">${escapeHtml(column.header)}</th>`).join('')
  const rows = view.rows
    .map((row) => `<tr>${view.columns.map((column) => `<td class="${column.align === 'right' ? 'num' : ''}">${textBlock(row[column.key] ?? '')}</td>`).join('')}</tr>`)
    .join('')
  const totals = view.totals
    .map((total) => `<div class="receipt-line"><span>${escapeHtml(total.label)}</span><strong>${escapeHtml(total.value)}</strong></div>`)
    .join('')
  const body = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">${escapeHtml(view.title)}</div>
  <div class="meta">
    <div class="meta__cell">${escapeHtml(view.description)}</div>
    <div class="meta__cell" style="text-align:right">${escapeHtml(view.period)}<br /><span class="legend">Generated ${escapeHtml(view.generatedAt)}</span></div>
  </div>
  <div class="section">
    <table><thead><tr>${head}</tr></thead><tbody>${rows || `<tr><td colspan="${view.columns.length}" class="legend">No rows for this period.</td></tr>`}</tbody></table>
  </div>
  ${totals ? `<div class="section" style="width:70mm;margin-left:auto;">${totals}</div>` : ''}
  ${view.note ? `<div class="section note">${textBlock(view.note)}</div>` : ''}
  <div class="footer">${textBlock(options.clinic.footerMessage ?? '')}</div>
</div>`
  return { title: view.title, fileName: `report-${view.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.html`, body, warnings: [] }
}

export function renderTestPage(view: TestPageView, options: TemplateOptions): TemplateResult {
  const checks = [
    ['Latin text', 'The quick brown fox jumps over the lazy dog — 0123456789 ৳ 1,234.50'],
    ['Bengali text', view.bengaliProbe],
    ['Paper class', `${options.paperClass} · ${options.widthMm} mm × ${options.heightMm} mm`],
    ['Layout engine', options.layout],
    ['Fonts embedded', options.missingFonts.length === 0 ? 'Yes (Inter + Noto Sans Bengali)' : `Missing: ${options.missingFonts.join(', ')}`],
    ['Printer', view.printerName ?? 'Not specified'],
    ['Application', `Dentiva Pro ${view.appVersion}`],
    ['Printed at', view.printedAt]
  ]
  const body = `
<div class="page">
  ${clinicHeader(options)}
  <div class="doc-title">Printer test page</div>
  <div class="section">
    <table><tbody>${checks.map(([label, value]) => `<tr><th style="width:40mm">${escapeHtml(label)}</th><td>${textBlock(value)}</td></tr>`).join('')}</tbody></table>
  </div>
  <div class="section"><div class="section__title">Alignment ruler</div>
    <div style="font-family:monospace;letter-spacing:2px;">|----|----|----|----|----|----|----|----|----|----|</div>
  </div>
  <div class="section"><div class="section__title">Font families available to the document</div>
    <div>${view.fontFamilies.map((family) => `<div style="font-family:'${escapeHtml(family)}'">${escapeHtml(family)} — ${escapeHtml(view.bengaliProbe)}</div>`).join('')}</div>
  </div>
  <div class="footer">If this page is complete and the Bengali line above is readable, printing on this printer is safe.</div>
</div>`
  return { title: 'Printer test page', fileName: 'printer-test.html', body, warnings: options.missingFonts.length > 0 ? [`Missing bundled fonts: ${options.missingFonts.join(', ')}`] : [] }
}

/* -------------------------------------------------------------------------- */
/* Document shell                                                             */
/* -------------------------------------------------------------------------- */

export function wrapDocument(result: TemplateResult, options: TemplateOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;" />
  <title>${escapeHtml(result.title)}</title>
  <style>${baseCss(options)}</style>
</head>
<body>${result.body}</body>
</html>`
}
