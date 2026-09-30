import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from './helpers'
import { savePatient, type PatientInput } from '@main/modules/patients/service'
import { archivePrintProfile, getPrintProfile, listPrintProfiles, savePrintProfile, type PrintProfileInput } from '@main/printing/profiles'
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
} from '@main/printing/jobs'

/**
 * Printing pipeline behaviour.
 *
 * Exercises the real database, the real document builders and a controllable print host: profiles keep a
 * single default, a rendered prescription or summary carries Bengali text verbatim, a refused printer
 * never loses the document (the payload stays on disk and can be retried or saved as PDF), and the
 * history records who did what.
 */

function samplePatient(overrides: Partial<PatientInput> = {}): PatientInput {
  return {
    fullName: 'Rahima Akter',
    fullNameBn: 'রহিমা আক্তার',
    dob: '1994-05-12',
    ageYears: null,
    gender: 'female',
    bloodGroup: 'B+',
    phone: '01712345678',
    altPhone: null,
    emergencyPhone: null,
    address: 'House 12, Road 4, Mirpur, Dhaka',
    addressBn: 'বাসা ১২, রোড ৪, মিরপুর, ঢাকা',
    city: 'Dhaka',
    occupation: 'Teacher',
    maritalStatus: 'married',
    chiefComplaint: 'Upper right molar pain',
    pastHistory: null,
    allergies: 'Penicillin',
    medicalHistory: 'Hypertension (controlled)',
    dentalHistory: null,
    currentMedications: 'Amlodipine 5 mg',
    notes: null,
    tags: ['regular'],
    status: 'active',
    ...overrides
  } as PatientInput
}

function profileInput(overrides: Partial<PrintProfileInput> = {}): PrintProfileInput {
  return {
    id: null,
    name: 'Reception A4',
    documentType: 'prescription',
    printerName: null,
    paperClass: 'a4',
    customWidthMm: null,
    customHeightMm: null,
    thermalWidthMm: 80,
    orientation: 'portrait',
    marginsMm: { top: 12, right: 12, bottom: 12, left: 12 },
    scaleBp: 10000,
    copies: 1,
    isDefault: true,
    isActive: true,
    notes: null,
    ...overrides
  }
}

describe('printing module', () => {
  it('keeps printer profiles with a single default per document type and archives with a reason', () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()

      const first = savePrintProfile(ctx, profileInput({ name: 'Reception A4' }))
      expect(first.isDefault).toBe(true)

      const second = savePrintProfile(ctx, profileInput({ name: 'Reception A5', paperClass: 'a5' }))
      const active = listPrintProfiles(ctx).filter((profile) => profile.name.startsWith('Reception'))
      expect(active.map((profile) => profile.name).sort()).toEqual(['Reception A4', 'Reception A5'])
      const defaults = listPrintProfiles(ctx).filter((profile) => profile.documentType === 'prescription' && profile.isDefault)
      expect(defaults).toHaveLength(1)
      expect(defaults[0]?.id).toBe(second.id)
      expect(active.find((profile) => profile.id === first.id)?.isDefault).toBe(false)

      archivePrintProfile(ctx, second.id, 'Replaced by the A4 profile')
      expect(listPrintProfiles(ctx).filter((profile) => profile.name.startsWith('Reception')).map((profile) => profile.id)).toEqual([first.id])
      expect(listPrintProfiles(ctx, true).some((profile) => profile.id === second.id)).toBe(false)
      expect(() => getPrintProfile(ctx, second.id)).toThrowError(/could not be found/i)
      const audit = harness.database.db.prepare("SELECT summary FROM audit_log WHERE action = 'profile.archive' ORDER BY id DESC LIMIT 1").get() as { summary: string } | undefined
      expect(audit?.summary).toContain('Reception A5')

      const printOnly = harness.ctx(['printing.print'])
      expect(() => savePrintProfile(printOnly, profileInput({ name: 'Blocked' }))).toThrowError(/permission/i)
    } finally {
      harness.cleanup()
    }
  })

  it('renders a patient summary with the Bengali name intact and applies the document profile', async () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      const patient = savePatient(ctx, samplePatient())

      const plain = renderDocument(ctx, { documentType: 'patient_summary', entityId: patient.id, copies: 1 })
      expect(plain.html).toContain('<!DOCTYPE html>')
      expect(plain.html).toContain('রহিমা আক্তার')
      expect(plain.html).toContain('রহিমা')
      expect(plain.paperClass).toBe('a4')
      expect(plain.fileName.endsWith('.html')).toBe(true)

      savePrintProfile(ctx, profileInput({ name: 'Summary A5', documentType: 'patient_summary', paperClass: 'a5' }))
      const profiled = renderDocument(ctx, { documentType: 'patient_summary', entityId: patient.id, copies: 1 })
      expect(profiled.paperClass).toBe('a5')
      expect(profiled.profileName).toBe('Summary A5')

      const printed: Array<{ html: string, printerName?: string }> = []
      harness.host.printing.print = async (job) => {
        printed.push(job)
        return { success: true, printerName: job.printerName ?? null }
      }

      const outcome = await printDocument(ctx, { documentType: 'patient_summary', entityId: patient.id, copies: 1 }, 'POS-80')
      expect(outcome.ok).toBe(true)
      expect(printed[0]?.html).toContain('রহিমা আক্তার')
      expect(printed[0]?.printerName).toBe('POS-80')

      const history = listPrintHistory(ctx, { documentType: 'patient_summary', limit: 10, offset: 0 })
      expect(history.total).toBe(1)
      expect(history.items[0]?.result).toBe('success')
      expect(history.items[0]?.hasPayload).toBe(false)
      expect(history.items[0]?.performedByName).toBe('tester')
      expect(history.items[0]?.reference).toBe(patient.code)
    } finally {
      harness.cleanup()
    }
  })

  it('keeps a refused document on disk so it can be inspected and retried, and saves PDFs offline', async () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()

      harness.host.printing.print = async () => ({ success: false, failureReason: 'The printer is not responding.', printerName: 'POS-80' })
      const failed = await printDocument(ctx, { documentType: 'test', entityId: null, copies: 1 }, 'POS-80')
      expect(failed.ok).toBe(false)
      expect(failed.failureReason).toMatch(/not responding/i)

      const failedRows = listPrintHistory(ctx, { result: 'failed', limit: 10, offset: 0 })
      expect(failedRows.items).toHaveLength(1)
      expect(failedRows.items[0]?.hasPayload).toBe(true)
      expect(failedRows.items[0]?.failureReason).toMatch(/not responding/i)

      const payload = loadPrintPayload(ctx, failedRows.items[0]!.id)
      expect(payload.html).toContain('<!DOCTYPE html>')
      const payloadFile = join(harness.dataDir, 'print-jobs', payload.fileName)
      expect(existsSync(payloadFile)).toBe(true)
      expect(readFileSync(payloadFile, 'utf8')).toBe(payload.html)

      harness.host.printing.print = async () => ({ success: true, printerName: 'POS-80' })
      const retried = await retryPrint(ctx, failedRows.items[0]!.id, 'POS-80')
      expect(retried.ok).toBe(true)
      expect(() => loadPrintPayload(ctx, failedRows.items[0]!.id)).toThrowError(/no stored document/i)
      expect(existsSync(payloadFile)).toBe(false)

      harness.host.printing.renderPdf = async () => ({ data: new Uint8Array([0x25, 0x50, 0x44, 0x46]) })
      harness.host.dialogs.saveFile = async () => join(harness.dataDir, 'test-page.pdf')
      const pdf = await savePdf(ctx, { documentType: 'test', entityId: null, copies: 1 }, null)
      expect(pdf.ok).toBe(true)
      expect(pdf.filePath).toBe(join(harness.dataDir, 'test-page.pdf'))
      expect(existsSync(pdf.filePath!)).toBe(true)

      const pdfHistory = listPrintHistory(ctx, { documentType: 'test', limit: 10, offset: 0 })
      const saved = pdfHistory.items.find((entry) => entry.action === 'pdf')
      expect(saved?.filePath).toBe(pdf.filePath)
      expect(saved?.result).toBe('success')
    } finally {
      harness.cleanup()
    }
  })

  it('reports printers, prints a test page and records previews', async () => {
    const harness = createHarness()
    try {
      const ctx = harness.ctx()
      harness.host.machine.printersAvailable = true

      harness.host.printing.listPrinters = async () => [
        { name: 'POS-80', displayName: 'POS-80 Receipt', description: 'USB002', status: 0, isDefault: true }
      ]
      harness.host.printing.getDefaultPrinter = async () => 'POS-80'
      const status = await printerStatus(ctx)
      expect(status.printers).toHaveLength(1)
      expect(status.printers[0]?.name).toBe('POS-80')
      expect(status.defaultPrinter).toBe('POS-80')
      expect(status.available).toBe(true)

      const printed: Array<{ pageSizeMicrons?: { width: number, height: number } }> = []
      harness.host.printing.print = async (job) => {
        printed.push(job)
        return { success: true, printerName: job.printerName ?? null }
      }
      const test = await testPrint(ctx, { printerName: 'POS-80', paperClass: 'thermal', thermalWidthMm: 58 })
      expect(test.ok).toBe(true)
      expect(printed[0]?.pageSizeMicrons?.width).toBe(58_000)

      recordPreview(ctx, 'invoice', 'INV-2601-0001', 3)
      const history = listPrintHistory(ctx, { documentType: 'invoice', limit: 5, offset: 0 })
      expect(history.items[0]?.action).toBe('preview')
      expect(history.items[0]?.title).toBe('INV-2601-0001')

      const catalog = documentCatalog()
      expect(catalog.map((entry) => entry.type)).toEqual(expect.arrayContaining(['prescription', 'invoice', 'test']))
      expect(catalog.find((entry) => entry.type === 'test')?.requiresEntity).toBe(false)

      const printOnly = harness.ctx(['printing.print'])
      expect(() => listPrintHistory(printOnly, { limit: 5, offset: 0 })).not.toThrow()
      expect(() => documentCatalog()).not.toThrow()
    } finally {
      harness.cleanup()
    }
  })
})
