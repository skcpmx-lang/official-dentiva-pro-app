import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { conflictError, notFoundError, stateError, validationError } from '@shared/errors'
import { conditionInfo, isToothCode, parseToothList, toothInfo } from '@shared/dental'
import { foldForSearch, normalizeBengali } from '@shared/bengali'
import type { zChartEntryInput } from '@shared/contracts'
import { z } from 'zod'

export type ChartEntryInput = z.infer<typeof zChartEntryInput>

export type ChartStatus = 'active' | 'resolved' | 'historic'

export interface ChartConditionRecord {
  code: string
  name: string
  nameBn: string | null
  category: 'finding' | 'treatment' | 'state'
  color: string | null
  appliesTooth: boolean
  isActive: boolean
  sortOrder: number
}

export interface ChartEntryRecord {
  id: number
  patientId: number
  visitId: number | null
  toothCode: string
  dentition: 'adult' | 'primary'
  conditionCode: string
  conditionName: string
  conditionCategory: string
  conditionColor: string | null
  treatmentCode: string | null
  status: ChartStatus
  note: string | null
  recordedAt: number
  recordedByName: string | null
  resolvedAt: number | null
}

export interface ChartViewRecord {
  patientId: number
  entries: ChartEntryRecord[]
  byTooth: Record<string, ChartEntryRecord>
  counts: Array<{ conditionCode: string, conditionName: string, count: number }>
  conditions: ChartConditionRecord[]
  summaryText: string
}

interface ConditionRow {
  id: number
  code: string
  name: string
  name_bn: string | null
  category: string
  applies_tooth: number
  is_active: number
  is_system: number
  sort_order: number
}

function colorFor(code: string): string | null {
  return conditionInfo(code)?.color ?? 'chart-other'
}

function conditionName(code: string): string {
  return conditionInfo(code)?.label ?? code.replace(/_/g, ' ')
}

export function dentalConditionFor(code: string): { known: boolean, category: string, appliesTooth: boolean } {
  const info = conditionInfo(code)
  return info ? { known: true, category: info.kind, appliesTooth: true } : { known: false, category: 'finding', appliesTooth: true }
}

/**
 * Dental chart.
 *
 * One row per tooth-condition pair. Recording the same condition again on the same tooth updates that
 * row (status, note, visit) instead of duplicating it, and resolving a condition keeps the row with
 * `status = 'resolved'`, so the chart shows current state while the history stays auditable.
 */

export function listConditions(ctx: ServiceContext, includeInactive = false): ChartConditionRecord[] {
  const rows = ctx.db
    .prepare(`SELECT * FROM clinical_findings ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY sort_order, name COLLATE NOCASE`)
    .all() as ConditionRow[]
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    nameBn: row.name_bn,
    category: (row.category as ChartConditionRecord['category']) ?? 'finding',
    color: colorFor(row.code),
    appliesTooth: row.applies_tooth === 1,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order
  }))
}

function mapEntry(row: {
  id: number
  patient_id: number
  visit_id: number | null
  tooth_code: string
  dentition: string
  condition_code: string
  treatment_code: string | null
  status: string
  note: string | null
  recorded_at: number
  recorded_by: number | null
  resolved_at: number | null
  recorded_by_name?: string | null
}): ChartEntryRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    visitId: row.visit_id,
    toothCode: row.tooth_code,
    dentition: row.dentition === 'primary' ? 'primary' : 'adult',
    conditionCode: row.condition_code,
    conditionName: conditionName(row.condition_code),
    conditionCategory: conditionInfo(row.condition_code)?.kind ?? 'finding',
    conditionColor: colorFor(row.condition_code),
    treatmentCode: row.treatment_code,
    status: row.status as ChartStatus,
    note: row.note,
    recordedAt: row.recorded_at,
    recordedByName: row.recorded_by_name ?? null,
    resolvedAt: row.resolved_at
  }
}

const ENTRY_SELECT = `
  SELECT e.*, COALESCE(NULLIF(u.full_name, ''), u.username) AS recorded_by_name
  FROM dental_chart_entries e
  LEFT JOIN users u ON u.id = e.recorded_by
`

export function getChartForVisit(ctx: ServiceContext, visitId: number): ChartEntryRecord[] {
  const rows = ctx.db.prepare(`${ENTRY_SELECT} WHERE e.visit_id = ? ORDER BY e.tooth_code, e.id`).all(visitId) as never[]
  return rows.map((row) => mapEntry(row))
}

export function getChart(ctx: ServiceContext, patientId: number): ChartViewRecord {
  assertPermission(ctx, 'clinical.view')
  assertPatientExists(ctx, patientId)
  const rows = ctx.db.prepare(`${ENTRY_SELECT} WHERE e.patient_id = ? ORDER BY e.recorded_at DESC, e.id DESC`).all(patientId) as never[]
  const entries = rows.map((row) => mapEntry(row))

  // The chart face renders the most significant entry per tooth: an active condition wins over a resolved one.
  const byTooth: Record<string, ChartEntryRecord> = {}
  for (const entry of [...entries].sort((a, b) => rank(a) - rank(b))) {
    const current = byTooth[entry.toothCode]
    if (!current) byTooth[entry.toothCode] = entry
  }

  const counter = new Map<string, { conditionCode: string, conditionName: string, count: number }>()
  for (const entry of entries) {
    if (entry.status === 'resolved') continue
    const bucket = counter.get(entry.conditionCode) ?? { conditionCode: entry.conditionCode, conditionName: entry.conditionName, count: 0 }
    bucket.count += 1
    counter.set(entry.conditionCode, bucket)
  }

  return {
    patientId,
    entries,
    byTooth,
    counts: [...counter.values()].sort((a, b) => b.count - a.count),
    conditions: listConditions(ctx, false),
    summaryText: summarize(entries)
  }
}

function rank(entry: ChartEntryRecord): number {
  if (entry.status === 'active') return 0
  if (entry.status === 'historic') return 1
  return 2
}

export function summarize(entries: ChartEntryRecord[]): string {
  const active = entries.filter((entry) => entry.status === 'active')
  if (active.length === 0) return 'No active chart findings.'
  const grouped = new Map<string, string[]>()
  for (const entry of active) {
    const list = grouped.get(entry.conditionName) ?? []
    list.push(entry.toothCode)
    grouped.set(entry.conditionName, list)
  }
  return [...grouped.entries()]
    .map(([label, teeth]) => `${label}: ${teeth.sort().join(', ')}`)
    .join(' · ')
}

function assertPatientExists(ctx: ServiceContext, patientId: number, forWrite = false): void {
  const row = ctx.db.prepare('SELECT id, status, is_deleted FROM patients WHERE id = ?').get(patientId) as
    | { id: number, status: string, is_deleted: number }
    | undefined
  if (!row) throw notFoundError('patient', patientId)
  if (forWrite && (row.is_deleted === 1 || row.status !== 'active')) {
    throw stateError('This patient record is archived. Restore it before changing the dental chart.')
  }
}

export function setChartEntry(ctx: ServiceContext, input: ChartEntryInput): ChartViewRecord {
  assertPermission(ctx, 'clinical.create')
  const toothCode = input.toothCode.trim().toUpperCase()
  if (!isToothCode(toothCode)) throw validationError(`“${input.toothCode}” is not a valid FDI tooth code.`, { toothCode: 'Use an FDI code such as 11, 36 or 75.' })
  assertPatientExists(ctx, input.patientId, true)

  const tooth = toothInfo(toothCode)
  const dentition: 'adult' | 'primary' = tooth?.dentition === 'primary' ? 'primary' : input.dentition
  const condition = ctx.db.prepare('SELECT code, is_active FROM clinical_findings WHERE code = ?').get(input.conditionCode) as
    | { code: string, is_active: number }
    | undefined
  if (!condition) throw notFoundError('dental condition', input.conditionCode)
  if (condition.is_active !== 1) throw validationError('That condition is no longer in use. Choose an active condition.', { conditionCode: 'Inactive condition.' })
  if (input.visitId) {
    const visit = ctx.db.prepare('SELECT id, patient_id FROM visits WHERE id = ? AND is_deleted = 0').get(input.visitId) as
      | { id: number, patient_id: number }
      | undefined
    if (!visit) throw notFoundError('visit', input.visitId)
    if (visit.patient_id !== input.patientId) throw validationError('The selected visit belongs to a different patient.')
  }

  const now = ctx.now()
  ctx.db.transaction(() => {
    const existing = ctx.db
      .prepare('SELECT id, status FROM dental_chart_entries WHERE patient_id = ? AND tooth_code = ? AND condition_code = ?')
      .get(input.patientId, toothCode, input.conditionCode) as { id: number, status: string } | undefined

    if (existing) {
      ctx.db
        .prepare(
          `UPDATE dental_chart_entries SET status = @status, note = @note, visit_id = @visitId, treatment_code = @treatmentCode,
             recorded_at = @now, recorded_by = @recordedBy, resolved_at = @resolvedAt WHERE id = @id`
        )
        .run({
          id: existing.id,
          status: input.status,
          note: input.note ?? null,
          visitId: input.visitId ?? null,
          treatmentCode: input.treatmentCode ?? null,
          now,
          recordedBy: ctx.actor.userId,
          resolvedAt: input.status === 'resolved' ? now : null
        })
      ctx.audit.write({
        module: 'clinical',
        action: 'chart.update',
        entityType: 'dental_chart_entry',
        entityId: existing.id,
        summary: `Tooth ${toothCode} marked ${conditionName(input.conditionCode)} (${input.status})`,
        detail: { patientId: input.patientId, from: existing.status, to: input.status }
      })
      return
    }

    const result = ctx.db
      .prepare(
        `INSERT INTO dental_chart_entries (patient_id, visit_id, tooth_code, dentition, condition_code, treatment_code, status, note,
           recorded_at, recorded_by, resolved_at)
         VALUES (@patientId, @visitId, @toothCode, @dentition, @conditionCode, @treatmentCode, @status, @note, @now, @recordedBy, @resolvedAt)`
      )
      .run({
        patientId: input.patientId,
        visitId: input.visitId ?? null,
        toothCode,
        dentition,
        conditionCode: input.conditionCode,
        treatmentCode: input.treatmentCode ?? null,
        status: input.status,
        note: input.note ?? null,
        now,
        recordedBy: ctx.actor.userId,
        resolvedAt: input.status === 'resolved' ? now : null
      })
    ctx.audit.write({
      module: 'clinical',
      action: 'chart.record',
      entityType: 'dental_chart_entry',
      entityId: Number(result.lastInsertRowid),
      summary: `Tooth ${toothCode} recorded as ${conditionName(input.conditionCode)}`,
      detail: { patientId: input.patientId, condition: input.conditionCode }
    })
  })()

  return getChart(ctx, input.patientId)
}

export function removeChartEntry(ctx: ServiceContext, input: { id: number, patientId: number }): ChartViewRecord {
  assertPermission(ctx, 'clinical.edit')
  const row = ctx.db.prepare('SELECT * FROM dental_chart_entries WHERE id = ?').get(input.id) as
    | { id: number, patient_id: number, tooth_code: string, condition_code: string }
    | undefined
  if (!row) throw notFoundError('chart entry', input.id)
  if (row.patient_id !== input.patientId) throw validationError('That chart entry belongs to a different patient.')
  ctx.db.transaction(() => {
    ctx.db.prepare('DELETE FROM dental_chart_entries WHERE id = ?').run(input.id)
    ctx.audit.write({
      module: 'clinical',
      action: 'chart.remove',
      entityType: 'dental_chart_entry',
      entityId: input.id,
      summary: `Chart entry removed: tooth ${row.tooth_code} ${conditionName(row.condition_code)}`,
      detail: { patientId: row.patient_id }
    })
  })()
  return getChart(ctx, input.patientId)
}

export function chartHistory(ctx: ServiceContext, input: { patientId: number, toothCode?: string }): ChartEntryRecord[] {
  assertPermission(ctx, 'clinical.view')
  const rows = input.toothCode
    ? (ctx.db.prepare(`${ENTRY_SELECT} WHERE e.patient_id = ? AND e.tooth_code = ? ORDER BY e.recorded_at DESC`).all(input.patientId, input.toothCode) as never[])
    : (ctx.db.prepare(`${ENTRY_SELECT} WHERE e.patient_id = ? ORDER BY e.recorded_at DESC`).all(input.patientId) as never[])
  return rows.map((row) => mapEntry(row))
}

export function saveCondition(
  ctx: ServiceContext,
  input: {
    code: string
    name: string
    nameBn?: string | null
    category: 'finding' | 'treatment' | 'state'
    color?: string | null
    appliesTooth: boolean
    isActive: boolean
    sortOrder: number
  }
): { ok: true } {
  assertPermission(ctx, 'clinical.edit')
  const code = foldForSearch(input.code.trim().toLowerCase().replace(/\s+/g, '_')).slice(0, 40)
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(code)) {
    throw validationError('The condition code must start with a letter and contain only lower-case letters, numbers and underscores.', {
      code: 'Invalid code.'
    })
  }
  const name = normalizeBengali(input.name).trim()
  const existing = ctx.db.prepare('SELECT * FROM clinical_findings WHERE code = ?').get(code) as ConditionRow | undefined
  const now = ctx.now()
  ctx.db.transaction(() => {
    if (existing) {
      ctx.db
        .prepare('UPDATE clinical_findings SET name = ?, name_bn = ?, category = ?, is_active = ?, sort_order = ? WHERE code = ?')
        .run(name, input.nameBn ?? null, input.category, input.isActive ? 1 : 0, input.sortOrder, code)
    } else {
      ctx.db
        .prepare(
          `INSERT INTO clinical_findings (code, name, name_bn, category, applies_tooth, is_active, is_system, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
        )
        .run(code, name, input.nameBn ?? null, input.category, input.appliesTooth ? 1 : 0, input.isActive ? 1 : 0, input.sortOrder)
    }
    ctx.audit.write({
      module: 'clinical',
      action: existing ? 'condition.update' : 'condition.create',
      entityType: 'clinical_finding',
      entityId: existing?.id ?? null,
      summary: `${existing ? 'Updated' : 'Added'} dental condition “${name}” (${code})`,
      detail: { category: input.category, isActive: input.isActive, color: input.color ?? null, at: now }
    })
  })()
  return { ok: true }
}

export function chartSummaryForPatient(ctx: ServiceContext, patientId: number): string {
  const chart = getChart(ctx, patientId)
  return chart.summaryText
}

export function assertChartToothUnused(ctx: ServiceContext, toothCode: string): void {
  const row = ctx.db
    .prepare('SELECT COUNT(*) AS count FROM dental_chart_entries WHERE tooth_code = ? AND status = ?')
    .get(toothCode, 'active') as { count: number }
  if (row.count > 0) throw conflictError(`Tooth ${toothCode} already has ${row.count} active chart entr(y/ies).`)
}

export function teethFromCodes(codes: string): string[] {
  return parseToothList(codes)
}
