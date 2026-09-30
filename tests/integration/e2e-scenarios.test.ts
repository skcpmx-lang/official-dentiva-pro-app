import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHarness, type TestHarness } from './helpers'
import { createRouterHarness, type RouterHarness } from './routerHarness'
import {
  ADMIN,
  CLINIC,
  E2E_ACTIVATION_CODE,
  FRONT_DESK,
  ITEM,
  administratorStepPayload,
  appointmentPayload,
  backupCreatePayload,
  chartEntryPayload,
  clinicStepPayload,
  dentistStepPayload,
  frontDeskRolePayload,
  frontDeskUserPayload,
  inventoryItemPayload,
  invoicePayload,
  loginPayload,
  patientPayload,
  paymentPayload,
  preferencesStepPayload,
  prescriptionPayload,
  setupCompletePayload,
  stockMovementPayload,
  visitPayload,
  visitTreatmentPayload
} from '../e2e/support/scenario'

/**
 * The end-to-end scenarios, replayed through the real router.
 *
 * `tests/e2e/**` drives the packaged application on Windows and can only run there. The payloads those
 * workflows send are the same ones used here, so the half of an end-to-end failure that is not about
 * clicking — a payload the contract rejects, a response the contract refuses to display, a permission
 * that turns out not to be enforced — is caught by `npm test` on any machine. What remains for the
 * Windows run is the interface itself: the fields, the buttons and the printed documents.
 */

let harness: TestHarness
let router: RouterHarness
let dentistId = 0
let patientId = 0
let visitId = 0
let invoiceId = 0

beforeAll(async () => {
  harness = createHarness()
  router = createRouterHarness(harness)
  process.env.DENTIVA_ACTIVATION_CODE = E2E_ACTIVATION_CODE
})

afterAll(() => {
  delete process.env.DENTIVA_ACTIVATION_CODE
  harness.cleanup()
})

describe('the end-to-end scenario payloads', () => {
  it('activates and completes the setup wizard with the payloads the workflows send', async () => {
    expect((await router.call<{ stage: string }>('app.bootstrap')).stage).toBe('activation')
    await router.call('activation.submit', { code: E2E_ACTIVATION_CODE })
    await router.call('setup.clinic', clinicStepPayload())
    await router.call('setup.dentists', dentistStepPayload())
    await router.call('setup.administrator', administratorStepPayload())
    await router.call('setup.preferences', preferencesStepPayload())
    await router.call('setup.complete', setupCompletePayload())

    const login = await router.call<{ session: { username: string } }>('auth.login', loginPayload())
    expect(login.session.username).toBe(ADMIN.username)
    expect((await router.call<{ stage: string }>('app.bootstrap')).stage).toBe('ready')

    const dentists = await router.call<Array<{ id: number, fullName: string }>>('dentists.list', { includeInactive: false })
    expect(dentists[0]?.fullName).toBe('Dr. Ayesha Rahman')
    dentistId = dentists[0]!.id
  })

  it('registers a patient, records a visit, a treatment line, a prescription and a chart entry', async () => {
    const patient = await router.call<{ id: number, fullName: string, code: string }>('patients.save', patientPayload({ fullName: 'Zarina Sultana', fullNameBn: 'জরিনা সুলতানা' }))
    expect(patient.code).toMatch(/^DP-/)
    patientId = patient.id

    const visit = await router.call<{ id: number, visitNo: string }>('visits.save', visitPayload(patientId, dentistId))
    visitId = visit.id
    await router.call('visits.treatments.add', visitTreatmentPayload(visitId))

    const prescription = await router.call<{ id: number }>('prescriptions.save', prescriptionPayload(patientId, dentistId, visitId))
    expect(prescription.id).toBeGreaterThan(0)

    await router.call('chart.setEntry', chartEntryPayload(patientId, visitId))
    const chart = await router.call<{ entries: Array<{ toothCode: string, conditionCode: string }> }>('chart.get', { patientId })
    expect(chart.entries.some((entry) => entry.toothCode === '46' && entry.conditionCode === 'pulpitis')).toBe(true)

    /* ৳ 900 of treatment on the invoice, then ৳ 400 and ৳ 500 received. */
    const invoice = await router.call<{ id: number, invoiceNo: string, totalMicro: number }>('invoices.save', invoicePayload(patientId))
    invoiceId = invoice.id
    expect(invoice.totalMicro).toBe(900_000)

    await router.call('payments.add', paymentPayload(patientId, invoiceId, 400_000))
    let current = await router.call<{ status: string, dueMicro: number, paidMicro: number }>('invoices.get', { id: invoiceId })
    expect(current.paidMicro).toBe(400_000)
    expect(current.dueMicro).toBe(500_000)

    await router.call('payments.add', paymentPayload(patientId, invoiceId, 500_000))
    current = await router.call<{ status: string, dueMicro: number, paidMicro: number }>('invoices.get', { id: invoiceId })
    expect(current.paidMicro).toBe(900_000)
    expect(current.dueMicro).toBe(0)
    expect(current.status).toBe('paid')

    /* Overpaying is refused: the clinic cannot receive more than the invoice asks for. */
    const overpay = await router.callRaw('payments.add', paymentPayload(patientId, invoiceId, 100_000))
    expect(overpay.ok).toBe(false)
    if (overpay.ok) throw new Error('an overpayment must be refused')

    /* The printed prescription carries the Bengali name and the instruction pairs. */
    const document = await router.call<{ html: string, paperClass: string, title: string }>('printing.render', {
      documentType: 'prescription',
      entityId: prescription.id,
      paperClass: 'a4'
    })
    expect(document.paperClass).toBe('a4')
    expect(document.html).toContain('জরিনা সুলতানা')
    expect(document.html).toContain('Amoxicillin')
    /* The Bengali face is embedded in the document, never fetched from a font server. */
    expect(document.html).toContain('@font-face')
  })

  it('books an appointment, runs the queue and completes the visit', async () => {
    const scheduledAt = Date.now() + 30 * 60_000
    const appointment = await router.call<{ id: number }>('appointments.save', appointmentPayload(patientId, dentistId, scheduledAt))
    expect(appointment.id).toBeGreaterThan(0)

    const entry = await router.call<{ id: number, status: string }>('queue.add', { patientId, dentistId, appointmentId: appointment.id, priority: 0, note: null })
    expect(entry.status).toBe('waiting')

    const board = await router.call<{ items: Array<{ id: number }>, counters: { waiting: number } }>('queue.board', { date: null })
    expect(board.items.some((row) => row.id === entry.id)).toBe(true)
    expect(board.counters.waiting).toBeGreaterThanOrEqual(1)

    await router.call('queue.setStatus', { id: entry.id, status: 'in_progress' })
    await router.call('queue.setStatus', { id: entry.id, status: 'completed' })
    const after = await router.call<{ counters: { completedToday: number } }>('queue.board', { date: null })
    expect(after.counters.completedToday).toBeGreaterThanOrEqual(1)
  })

  it('receives stock, corrects it, and retires the low-stock alert when it is restocked', async () => {
    const item = await router.call<{ id: number, code: string }>('inventory.save', inventoryItemPayload({ name: ITEM.name, category: ITEM.category, unit: ITEM.unit }))
    expect(item.code).toMatch(/^ITM-/)

    await router.call('inventory.movement.add', stockMovementPayload(item.id, 'purchase', 30, 'Purchase received during the end-to-end run'))
    let detail = await router.call<{ item: { quantityOnHand: number } }>('inventory.get', { id: item.id })
    expect(detail.item.quantityOnHand).toBe(30)

    await router.call('inventory.movement.add', stockMovementPayload(item.id, 'adjustment_out', 10, 'Stock-take correction'))
    detail = await router.call<{ item: { quantityOnHand: number } }>('inventory.get', { id: item.id })
    expect(detail.item.quantityOnHand).toBe(20)

    const movements = await router.call<{ items: Array<{ movementType: string, quantity: number }> }>('inventory.movements', { itemId: item.id, limit: 20, offset: 0 })
    expect(movements.items.some((row) => row.movementType === 'purchase' && row.quantity === 30)).toBe(true)
    expect(movements.items.some((row) => row.movementType === 'adjustment_out' && row.quantity === 10)).toBe(true)

    /* Raising the reorder level above the quantity on hand must warn the clinic. */
    await router.call('inventory.save', inventoryItemPayload({ id: item.id, name: ITEM.name, category: ITEM.category, unit: ITEM.unit, reorderLevel: 25 }))
    const alerts = await router.call<{ unread: number }>('notifications.summary')
    expect(typeof alerts.unread).toBe('number')
    const list = await router.call<{ items: Array<{ title: string, message: string, severity: string }> }>('notifications.list', { filter: 'all', limit: 50, offset: 0 })
    const lowStock = list.items.find((row) => row.title.includes(ITEM.name) || row.message.includes(ITEM.name))
    expect(lowStock, 'the low-stock alert names the item').toBeTruthy()

    /* Restocking retires it instead of leaving a stale warning. */
    await router.call('inventory.movement.add', stockMovementPayload(item.id, 'purchase', 40, 'Purchase order received during the end-to-end run'))
    await router.call('notifications.summary')
    const after = await router.call<{ items: Array<{ message: string }> }>('notifications.list', { filter: 'all', limit: 50, offset: 0 })
    expect(after.items.some((row) => row.message.includes(ITEM.name))).toBe(false)
  })

  it('runs the financial reports and the dashboard over the data just recorded', async () => {
    const catalog = await router.call<Array<{ key: string, title: string }>>('reports.catalog')
    expect(catalog.length).toBeGreaterThan(0)

    const income = await router.call<{ key: string, columns: unknown[], rows: unknown[] }>('reports.run', { key: 'revenue_daily', limit: 100 })
    expect(income.key).toBe('revenue_daily')
    expect(Array.isArray(income.columns)).toBe(true)
    expect(income.rows.length).toBeGreaterThan(0)

    const dues = await router.call<{ key: string, rows: unknown[] }>('reports.run', { key: 'receivables', limit: 100 })
    expect(dues.key).toBe('receivables')
    expect(Array.isArray(dues.rows)).toBe(true)

    const summary = await router.call<{ kpis: Array<{ key: string }> }>('dashboard.summary')
    expect(summary.kpis.length).toBeGreaterThan(0)

    const search = await router.call<{ groups: Array<{ kind: string, items: unknown[] }> }>('search.global', { query: 'Zarina', limitPerGroup: 5 })
    expect(search.groups.some((group) => group.items.length > 0)).toBe(true)
  })

  it('creates a quick backup and validates it', async () => {
    const created = await router.call<{ filePath: string, sizeBytes: number }>('backups.create', backupCreatePayload())
    expect(created.sizeBytes).toBeGreaterThan(1000)
    const validation = await router.call<{ ok: boolean }>('backups.validate', { filePath: created.filePath })
    expect(validation.ok).toBe(true)
  })

  it('denies a restricted role on the channel, not merely in the interface', async () => {
    const role = await router.call<{ id: number, code: string }>('roles.save', frontDeskRolePayload())
    await router.call('users.save', frontDeskUserPayload(role.id))

    /* The restricted operator signs in on a second window. */
    const second = 8
    const login = await router.handle(second, 'auth.login', loginPayload(FRONT_DESK))
    expect(login.ok).toBe(true)

    const billing = await router.handle(second, 'invoices.list', { limit: 10, offset: 0 })
    expect(billing.ok).toBe(false)
    if (billing.ok) throw new Error('a role without billing permissions must not list invoices')
    expect(billing.error.code).toBe('E_PERMISSION')

    const payment = await router.handle(second, 'payments.add', paymentPayload(patientId, invoiceId, 100_000))
    expect(payment.ok).toBe(false)
    if (payment.ok) throw new Error('a role without billing permissions must not record payments')
    expect(payment.error.code).toBe('E_PERMISSION')

    const audit = await router.handle(second, 'audit.list', { limit: 10, offset: 0 })
    expect(audit.ok).toBe(false)

    /* What the role may do still works: the restriction is scoped, not a broken account. */
    const queue = await router.handle(second, 'queue.board', { date: null })
    expect(queue.ok).toBe(true)
    const patients = await router.handle(second, 'patients.list', { limit: 10, offset: 0 })
    expect(patients.ok).toBe(true)

    /* An anonymous window is refused as well. */
    const anonymous = await router.handle(router.anonymousWindow, 'patients.list', { limit: 10, offset: 0 })
    expect(anonymous.ok).toBe(false)

    /* The administrator's own session still reaches the invoice. */
    const asAdmin = await router.call<{ id: number }>('invoices.get', { id: invoiceId })
    expect(asAdmin.id).toBe(invoiceId)
  })

  it('reports the clinic and the operator through the shell channels', async () => {
    const state = await router.call<{ authenticated: boolean }>('session.state')
    expect(state.authenticated).toBe(true)

    const clinic = await router.call<{ name: string, nameBn: string | null }>('settings.clinic')
    expect(clinic.name).toBe(CLINIC.name)
    expect(clinic.nameBn).toBe(CLINIC.nameBn)

    const audit = await router.call<{ items: Array<{ module: string }>, total: number }>('audit.list', { limit: 20, offset: 0 })
    expect(audit.total).toBeGreaterThan(0)
  })
})
