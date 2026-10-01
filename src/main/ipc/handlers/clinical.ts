import { writeCsv, exportStamp, type CsvColumn } from '../../files/csv'
import { formatAmountPlain } from '@shared/money'
import {
  addVisitTreatment,
  deleteVisit,
  getVisitSummary,
  listVisits,
  removeVisitTreatment,
  saveVisit,
  setVisitFindings,
  setVisitStatus,
  type VisitSummaryRecord
} from '../../modules/clinical/visits'
import { recordRecentlyViewed } from '../../modules/preferences/service'
import { archiveTreatment, listTreatments, saveTreatment, treatmentCategories } from '../../modules/clinical/treatments'
import { chartHistory, getChart, listConditions, removeChartEntry, saveCondition, setChartEntry } from '../../modules/clinical/chart'
import {
  adviceLibrary,
  applyTemplate,
  deletePrescription,
  deleteTemplate,
  duplicatePrescription,
  getPrescription,
  listPrescriptions,
  listTemplates,
  medicineHistory,
  savePrescription,
  saveTemplate
} from '../../modules/clinical/prescriptions'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Handlers for the clinical core: treatment catalogue, visits (with treatment lines and findings),
 * the dental chart and prescriptions. File-writing handlers (CSV exports) are the only ones that touch
 * the operating system; everything else is a straight service call, with authorisation enforced inside
 * the service.
 */
export function createClinicalHandlers(deps: HandlerDeps): PartialHandlerMap {
  const treatmentColumns: Array<CsvColumn<ReturnType<typeof listTreatments>[number]>> = [
    { key: 'code', header: 'Code', value: (row) => row.code },
    { key: 'name', header: 'Treatment', value: (row) => row.name },
    { key: 'nameBn', header: 'Treatment (Bangla)', value: (row) => row.nameBn ?? '' },
    { key: 'category', header: 'Category', value: (row) => row.category },
    { key: 'price', header: 'Default price (BDT)', value: (row) => formatAmountPlain(row.defaultPriceMicro, false) },
    { key: 'duration', header: 'Minutes', value: (row) => row.durationMin },
    { key: 'active', header: 'Active', value: (row) => (row.isActive ? 'yes' : 'no') },
    { key: 'used', header: 'Times performed', value: (row) => row.usageCount }
  ]

  const visitColumns: Array<CsvColumn<VisitSummaryRecord>> = [
    { key: 'visitNo', header: 'Visit no', value: (row) => row.visitNo },
    { key: 'date', header: 'Date', value: (row) => new Date(row.visitAt).toISOString() },
    { key: 'patientCode', header: 'Patient ID', value: (row) => row.patientCode },
    { key: 'patientName', header: 'Patient', value: (row) => row.patientName },
    { key: 'dentist', header: 'Dentist', value: (row) => row.dentistName },
    { key: 'status', header: 'Status', value: (row) => row.status },
    { key: 'diagnosis', header: 'Diagnosis', value: (row) => row.diagnosis ?? '' },
    { key: 'treatments', header: 'Treatments', value: (row) => row.treatments.map((entry) => entry.treatmentName).join('; ') },
    { key: 'teeth', header: 'Teeth', value: (row) => row.treatments.flatMap((entry) => entry.toothCodes).join(' ') },
    { key: 'total', header: 'Treatments value (BDT)', value: (row) => formatAmountPlain(row.totals.totalMicro, false) }
  ]

  return {
    /* -------------------------------------------------------------- treatments */

    'treatments.list': (ctx, input) => listTreatments(ctx, input),
    'treatments.save': (ctx, input) => saveTreatment(ctx, input),
    'treatments.archive': (ctx, input) => archiveTreatment(ctx, input),
    'treatments.categories': (ctx) => treatmentCategories(ctx),
    'treatments.export': async (ctx) => {
      const rows = listTreatments(ctx, { includeInactive: true })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export treatment catalogue',
        defaultPath: `${deps.host.paths.exportsDir}/treatments-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, rows, treatmentColumns)
      ctx.audit.write({ module: 'treatments', action: 'export', summary: `Exported ${rowCount} treatment(s) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    },

    /* ------------------------------------------------------------------ visits */

    'visits.list': (ctx, input) => listVisits(ctx, input),
    'visits.get': (ctx, input) => getVisitSummary(ctx, input.id),
    'visits.save': (ctx, input) => saveVisit(ctx, input),
    'visits.setStatus': (ctx, input) => setVisitStatus(ctx, input),
    'visits.delete': (ctx, input) => deleteVisit(ctx, input),
    'visits.treatments.add': (ctx, input) => addVisitTreatment(ctx, input),
    'visits.treatments.update': (ctx, input) => addVisitTreatment(ctx, input, input.id),
    'visits.treatments.remove': (ctx, input) => removeVisitTreatment(ctx, input.id),
    'visits.findings.set': (ctx, input) => setVisitFindings(ctx, input),
    'visits.export': async (ctx, input) => {
      const page = listVisits(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export visits',
        defaultPath: `${deps.host.paths.exportsDir}/visits-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.items, visitColumns)
      ctx.audit.write({ module: 'clinical', action: 'export', summary: `Exported ${rowCount} visit(s) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    },

    /* ------------------------------------------------------------ dental chart */

    'chart.get': (ctx, input) => getChart(ctx, input.patientId),
    'chart.setEntry': (ctx, input) => setChartEntry(ctx, input),
    'chart.removeEntry': (ctx, input) => removeChartEntry(ctx, input),
    'chart.history': (ctx, input) => chartHistory(ctx, input),
    'chart.conditions': (ctx, input) => listConditions(ctx, input.includeInactive),
    'chart.saveCondition': (ctx, input) => saveCondition(ctx, input),

    /* ----------------------------------------------------------- prescriptions */

    'prescriptions.list': (ctx, input) => listPrescriptions(ctx, input),
    'prescriptions.get': (ctx, input) => {
      recordRecentlyViewed(ctx, 'prescription', input.id)
      return getPrescription(ctx, input.id)
    },
    'prescriptions.save': (ctx, input) => savePrescription(ctx, input),
    'prescriptions.delete': (ctx, input) => deletePrescription(ctx, input),
    'prescriptions.duplicate': (ctx, input) => duplicatePrescription(ctx, input.id),
    'prescriptions.medicines': (ctx, input) => medicineHistory(ctx, input),
    'prescriptions.adviceLibrary': (ctx) => adviceLibrary(ctx),
    'prescriptions.templates.list': (ctx) => listTemplates(ctx),
    'prescriptions.templates.save': (ctx, input) => saveTemplate(ctx, input),
    'prescriptions.templates.delete': (ctx, input) => deleteTemplate(ctx, input.id),
    'prescriptions.templates.apply': (ctx, input) => applyTemplate(ctx, input),
    'prescriptions.export': async (ctx, input) => {
      const page = listPrescriptions(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export prescriptions',
        defaultPath: `${deps.host.paths.exportsDir}/prescriptions-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const columns: Array<CsvColumn<(typeof page.items)[number]>> = [
        { key: 'rxNo', header: 'Prescription no', value: (row) => row.rxNo },
        { key: 'date', header: 'Date', value: (row) => new Date(row.prescriptionAt).toISOString() },
        { key: 'patientCode', header: 'Patient ID', value: (row) => row.patientCode },
        { key: 'patientName', header: 'Patient', value: (row) => row.patientName },
        { key: 'dentist', header: 'Dentist', value: (row) => row.dentistName },
        { key: 'diagnosis', header: 'Diagnosis', value: (row) => row.diagnosis ?? '' },
        { key: 'medicines', header: 'Medicines', value: (row) => row.medicines.map((medicine) => medicine.medicineName).join('; ') },
        { key: 'printed', header: 'Printed', value: (row) => row.printedCount }
      ]
      const rowCount = writeCsv(target, page.items, columns)
      ctx.audit.write({ module: 'prescriptions', action: 'export', summary: `Exported ${rowCount} prescription(s) to CSV`, detail: { file: target } })
      return { path: target, rowCount }
    }
  }
}
