import { writeFile } from 'node:fs/promises'
import { AppError } from '@shared/errors'
import { writeCsv, exportStamp, type CsvColumn } from '../../files/csv'
import {
  archivePatient,
  attachmentAbsolutePath,
  checkDuplicates,
  deleteAttachment,
  deleteReferral,
  getPatient,
  getPatientFinancials,
  getPatientSummary,
  getPatientTimeline,
  listAttachments,
  listPatientTags,
  listPatients,
  listReferralFollowUps,
  listReferrals,
  readAttachmentData,
  restorePatient,
  savePatient,
  saveReferral,
  updateAttachment,
  uploadAttachment
} from '../../modules/patients/service'
import { formatAmountPlain } from '@shared/money'
import type { PartialHandlerMap } from '../router'
import type { HandlerDeps } from './system'

/**
 * Handlers for patients, their history timeline, attachments and referrals.
 *
 * Handlers stay deliberately thin: they translate the validated IPC payload into service calls, and
 * use the host services for anything that needs the operating system (native save dialog, opening a
 * file, revealing a folder). Every authorisation decision happens inside the service.
 */
export function createPatientHandlers(deps: HandlerDeps): PartialHandlerMap {
  const patientColumns: Array<CsvColumn<Awaited<ReturnType<typeof listPatients>>['items'][number]>> = [
    { key: 'code', header: 'Patient ID', value: (row) => row.code },
    { key: 'fullName', header: 'Full name', value: (row) => row.fullName },
    { key: 'fullNameBn', header: 'Name (Bangla)', value: (row) => row.fullNameBn ?? '' },
    { key: 'gender', header: 'Gender', value: (row) => row.gender },
    { key: 'age', header: 'Age', value: (row) => row.ageLabel ?? '' },
    { key: 'phone', header: 'Phone', value: (row) => row.phone ?? '' },
    { key: 'address', header: 'Address', value: (row) => row.address ?? '' },
    { key: 'registered', header: 'Registered', value: (row) => row.registrationDate },
    { key: 'visits', header: 'Visits', value: (row) => row.visitCount },
    { key: 'invoiced', header: 'Invoiced (BDT)', value: (row) => formatAmountPlain(row.invoicedMicro, false) },
    { key: 'paid', header: 'Paid (BDT)', value: (row) => formatAmountPlain(row.paidMicro, false) },
    { key: 'due', header: 'Due (BDT)', value: (row) => formatAmountPlain(row.dueMicro, false) }
  ]

  return {
    'patients.list': (ctx, input) => listPatients(ctx, input),

    'patients.get': (ctx, input) => getPatient(ctx, input.id),

    'patients.save': (ctx, input) => savePatient(ctx, input),

    'patients.archive': (ctx, input) => archivePatient(ctx, input),

    'patients.restore': (ctx, input) => restorePatient(ctx, input.id),

    'patients.summary': (ctx, input) => getPatientSummary(ctx, input.id),

    'patients.financials': (ctx, input) => getPatientFinancials(ctx, input.id),

    'patients.timeline': (ctx, input) => getPatientTimeline(ctx, input),

    'patients.tags': (ctx) => listPatientTags(ctx),

    'patients.duplicateCheck': (ctx, input) => checkDuplicates(ctx, input),

    'patients.export': async (ctx, input) => {
      const page = listPatients(ctx, { ...input, limit: 5000, offset: 0 })
      const suggested = `patients-${exportStamp(ctx.now())}.csv`
      const target = await deps.host.dialogs.saveFile({
        title: 'Export patient list',
        defaultPath: `${deps.host.paths.exportsDir}/${suggested}`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.items, patientColumns)
      ctx.audit.write({
        module: 'patients',
        action: 'export',
        summary: `Exported ${page.items.length} patient record(s) to CSV`,
        detail: { file: target, rows: page.items.length }
      })
      return { path: target, rowCount: page.items.length }
    },

    /* ------------------------------------------------------------ attachments */

    'attachments.list': (ctx, input) => listAttachments(ctx, input.patientId),
    'attachments.upload': (ctx, input) => uploadAttachment(ctx, input),
    'attachments.update': (ctx, input) => updateAttachment(ctx, input),
    'attachments.delete': (ctx, input) => deleteAttachment(ctx, input.id),
    'attachments.data': (ctx, input) => readAttachmentData(ctx, input.id),

    'attachments.open': async (ctx, input) => {
      const file = attachmentAbsolutePath(ctx, input.id)
      const failure = await deps.host.shell.openPath(file.absolutePath)
      if (failure) {
        throw new AppError('E_IO', `The attachment could not be opened by the operating system: ${failure}`)
      }
      ctx.audit.write({
        module: 'patients',
        action: 'attachment_open',
        entityType: 'patient_attachment',
        entityId: input.id,
        summary: `Opened attachment “${file.fileName}” of patient #${file.patientId}`
      })
      return { ok: true as const }
    },

    'attachments.export': async (ctx, input) => {
      const file = attachmentAbsolutePath(ctx, input.id)
      const data = readAttachmentData(ctx, input.id)
      const target = await deps.host.dialogs.saveFile({
        title: 'Save a copy of the attachment',
        defaultPath: `${deps.host.paths.exportsDir}/${file.fileName}`,
        filters: [{ name: 'All files', extensions: ['*'] }]
      })
      if (!target) return { path: null }
      await writeFile(target, Buffer.from(data.dataBase64, 'base64'))
      ctx.audit.write({
        module: 'patients',
        action: 'attachment_export',
        entityType: 'patient_attachment',
        entityId: input.id,
        summary: `Exported attachment “${file.fileName}”`,
        detail: { target }
      })
      return { path: target }
    },

    /* -------------------------------------------------------------- referrals */

    'referrals.list': (ctx, input) => listReferrals(ctx, input.patientId),
    'referrals.save': (ctx, input) => saveReferral(ctx, input),
    'referrals.delete': (ctx, input) => deleteReferral(ctx, input.id),
    'referrals.followUps': (ctx, input) => listReferralFollowUps(ctx, input),
  }
}
