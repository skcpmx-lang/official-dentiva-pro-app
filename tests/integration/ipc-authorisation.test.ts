import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import { createHarness } from './helpers'
import { AppError } from '@shared/errors'
import { archiveDentist, dentistsOnDuty, listDentists, saveDentist, setDentistActive } from '@main/modules/dentists/service'
import { batchesForItem, saveItem } from '@main/modules/inventory/items'
import { safeJoin } from '@main/files/storage'
import { createPracticeHandlers } from '@main/ipc/handlers/practice'
import { reportCatalog, runReport } from '@main/modules/accounting/reports'
import type { HandlerDeps } from '@main/ipc/handlers/system'

/**
 * Authorisation of the operations the security audit checked (checkpoint 18).
 *
 * The IPC boundary is not a security boundary on its own: a renderer that hides a button still lets
 * anyone who can reach the channel call it. These cases pin the service- and handler-level refusals
 * that `scripts/audit-security.mjs` finds statically — the doctor register (the professional identity
 * that appears on prescriptions), the clinic logo, and the batch/expiry/cost detail of stock.
 */

const harness = createHarness()

function deps(): HandlerDeps {
  return {
    db: harness.database.db,
    host: harness.host,
    sessions: {} as HandlerDeps['sessions'],
    invalidateActor: () => undefined,
    broadcast: () => undefined,
    refreshAutoLock: () => undefined,
    isMaintenanceMode: () => false,
    setMaintenanceMode: () => undefined,
    relaunch: () => undefined,
    currentDb: () => harness.database.db,
    closeDatabase: () => undefined,
    reopenDatabase: () => true,
    inspectDatabase: () => ({ ok: true, problems: [], counts: {} })
  }
}

const dentistInput = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Dr. Audit Test',
  fullNameBn: null,
  phone: null,
  email: null,
  registrationNo: null,
  signatureLabel: null,
  color: '#0f4d4a',
  isActive: true,
  sortOrder: 1,
  designations: [],
  qualifications: [],
  schedules: [],
  ...overrides
})

/** The harness starts with an empty database; the roster is created through the real service. */
function ensureDentist(): number {
  const existing = harness.database.db.prepare('SELECT id FROM dentists WHERE is_deleted = 0').get() as { id: number } | undefined
  if (existing) return existing.id
  const actor = harness.ctx(['settings.modify'])
  const created = saveDentist(actor, dentistInput() as never)
  return created.id
}

function permissionOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof AppError ? error.code : `unexpected:${String(error)}`
  }
}

describe('authorisation of privileged writes', () => {
  it('refuses to save a dentist without the settings permission', () => {
    const id = ensureDentist()
    const input = dentistInput({ id, fullName: 'Changed Without Permission', color: '#123456' })
    const weak = harness.ctx(['patients.view', 'clinical.view'])
    expect(permissionOf(() => saveDentist(weak, input as never))).toBe('E_PERMISSION')
    const row = harness.database.db.prepare('SELECT full_name FROM dentists WHERE id = ?').get(id) as { full_name: string }
    expect(row.full_name).not.toBe('Changed Without Permission')

    // …and the same call with the permission really writes, so the refusal above is about the actor.
    const full = harness.ctx(['settings.modify'])
    const saved = saveDentist(full, input as never)
    expect(saved.id).toBe(id)
    expect(saved.fullName).toBe('Changed Without Permission')
  })

  it('refuses to activate or archive a dentist without the settings permission', () => {
    const id = ensureDentist()
    const weak = harness.ctx(['patients.view'])
    expect(permissionOf(() => setDentistActive(weak, id, false))).toBe('E_PERMISSION')
    expect(permissionOf(() => archiveDentist(weak, id))).toBe('E_PERMISSION')
  })

  it('keeps the dentist roster readable for scheduling screens', () => {
    // Appointment booking needs the roster; this is shared reference data (docs/SECURITY_MODEL.md §9),
    // not patient or financial information.
    ensureDentist()
    const weak = harness.ctx(['appointments.view'])
    expect(listDentists(weak).length).toBeGreaterThan(0)
    expect(dentistsOnDuty(weak, 1).length).toBeGreaterThanOrEqual(0)
  })

  it('refuses to replace or clear the clinic logo without the settings permission', () => {
    const handlers = createPracticeHandlers(deps())
    const weak = harness.ctx(['patients.view'])
    const upload = handlers['settings.uploadLogo']!
    const clear = handlers['settings.clearLogo']!
    expect(permissionOf(() => upload(weak, { fileName: 'logo.png', dataBase64: 'AAAA' }))).toBe('E_PERMISSION')
    expect(permissionOf(() => clear(weak, {}))).toBe('E_PERMISSION')
  })

  it('refuses to read batch, expiry and cost detail without stock permissions', () => {
    const item = saveItem(harness.ctx(['inventory.create']), {
      id: null,
      code: null,
      name: 'Audit test item',
      category: 'restorative',
      unit: 'piece',
      supplierId: null,
      purchasePriceMicro: 1_000,
      sellingPriceMicro: 2_000,
      reorderLevel: 0,
      expiryTracking: false,
      location: null,
      notes: null,
      isActive: true
    } as never)
    const itemId = item.id
    const weak = harness.ctx(['patients.view'])
    expect(permissionOf(() => batchesForItem(weak, itemId))).toBe('E_PERMISSION')
    // The clerk who issues stock sees the same batches even without `inventory.view`.
    expect(permissionOf(() => batchesForItem(harness.ctx(['inventory.adjust']), itemId))).toBeNull()
    expect(permissionOf(() => batchesForItem(harness.ctx(['inventory.view']), itemId))).toBeNull()
  })
})

describe('report visibility', () => {
  it('offers only the reports the operator may open, and refuses the rest on the channel', () => {
    const operational = reportCatalog(harness.ctx(['reports.view']))
    expect(operational.map((entry) => entry.key).sort()).toEqual(['appointment_stats', 'patient_growth'])

    const accountant = reportCatalog(harness.ctx(['accounting.reports']))
    expect(accountant).toHaveLength(10)

    const financialOnly = reportCatalog(harness.ctx(['reports.financial']))
    expect(financialOnly.length).toBe(8)
    expect(financialOnly.every((entry) => entry.permission === 'reports.financial')).toBe(true)

    // Seeing the button is not authorisation: running a hidden report is still refused.
    expect(permissionOf(() => runReport(harness.ctx(['reports.view']), { key: 'profit_loss', limit: 10 } as never))).toBe('E_PERMISSION')
    expect(permissionOf(() => reportCatalog(harness.ctx(['patients.view'])))).toBe('E_PERMISSION')
  })
})

describe('path safety', () => {
  const root = resolve('/tmp/dentiva-data-root')

  it('keeps every stored path inside the data directory', () => {
    expect(safeJoin(root, 'attachments', '12', 'scan.pdf')).toBe(join(root, 'attachments', '12', 'scan.pdf'))
    expect(() => safeJoin(root, '..', 'escape.txt')).toThrow(AppError)
    expect(() => safeJoin(root, 'attachments/../../escape.txt')).toThrow(AppError)
    expect(() => safeJoin(root, 'attachments/\0hidden')).toThrow(AppError)
    expect(() => safeJoin(root, 'C:' + String.fromCharCode(92) + 'Windows')).toThrow(AppError)
    expect(() => safeJoin(root, String.fromCharCode(92).repeat(2) + 'server' + String.fromCharCode(92) + 'share')).toThrow(AppError)
    expect(() => safeJoin(root, '/etc/passwd')).toThrow(AppError)
  })
})
