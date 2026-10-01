import type { ServiceContext } from '../../context'
import { assertPermission } from '../../context'
import { resolveRange, type RangePreset } from '@shared/datetime'

export interface AuditFilter {
  search?: string
  module?: string
  action?: string
  entityType?: string
  entityId?: number
  userId?: number
  result?: 'success' | 'failure'
  range?: { preset: RangePreset, from?: string, to?: string }
  limit?: number
  offset?: number
}

export interface AuditEntry {
  id: number
  at: number
  userId: number | null
  username: string | null
  module: string
  action: string
  entityType: string | null
  entityId: number | null
  summary: string
  detail: Record<string, unknown> | null
  result: string
  sessionId: string | null
}

export interface AuditPage {
  entries: AuditEntry[]
  total: number
  limit: number
  offset: number
}

interface AuditRow {
  id: number
  at: number
  user_id: number | null
  username: string | null
  module: string
  action: string
  entity_type: string | null
  entity_id: number | null
  summary: string
  detail_json: string | null
  result: string
  session_id: string | null
}

function mapRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    at: row.at,
    userId: row.user_id,
    username: row.username,
    module: row.module,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: row.summary,
    detail: row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null,
    result: row.result,
    sessionId: row.session_id
  }
}

/** Read the audit trail. Append-only: there is no update or delete path anywhere in the application. */
export function listAudit(ctx: ServiceContext, filter: AuditFilter = {}): AuditPage {
  assertPermission(ctx, 'audit.view')
  const conditions: string[] = ['1 = 1']
  const params: Record<string, unknown> = {}
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500)
  const offset = Math.max(filter.offset ?? 0, 0)

  if (filter.search) {
    conditions.push('(summary LIKE @search OR COALESCE(username, \'\') LIKE @search OR COALESCE(entity_type, \'\') LIKE @search)')
    params.search = `%${filter.search.replace(/[%_]/g, '')}%`
  }
  if (filter.module) {
    conditions.push('module = @module')
    params.module = filter.module
  }
  if (filter.action) {
    conditions.push('action = @action')
    params.action = filter.action
  }
  if (filter.entityType) {
    conditions.push('entity_type = @entityType')
    params.entityType = filter.entityType
  }
  if (typeof filter.entityId === 'number') {
    conditions.push('entity_id = @entityId')
    params.entityId = filter.entityId
  }
  if (typeof filter.userId === 'number') {
    conditions.push('user_id = @userId')
    params.userId = filter.userId
  }
  if (filter.result) {
    conditions.push('result = @result')
    params.result = filter.result
  }
  if (filter.range) {
    const range = resolveRange(
      filter.range.preset,
      ctx.now(),
      filter.range.from && filter.range.to
        ? { from: new Date(filter.range.from).getTime(), to: new Date(filter.range.to).getTime() }
        : undefined
    )
    conditions.push('at BETWEEN @from AND @to')
    params.from = range.from
    params.to = range.to
  }

  const where = conditions.join(' AND ')
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS count FROM audit_log WHERE ${where}`).get(params) as { count: number }).count
  const rows = ctx.db
    .prepare(`SELECT * FROM audit_log WHERE ${where} ORDER BY at DESC, id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset }) as AuditRow[]

  return { entries: rows.map(mapRow), total, limit, offset }
}

export interface AuditFacets {
  modules: string[]
  actions: string[]
  users: Array<{ userId: number | null, username: string | null }>
}

export function auditFacets(ctx: ServiceContext): AuditFacets {
  assertPermission(ctx, 'audit.view')
  const modules = (ctx.db.prepare('SELECT DISTINCT module FROM audit_log ORDER BY module').all() as Array<{ module: string }>).map((r) => r.module)
  const actions = (ctx.db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all() as Array<{ action: string }>).map((r) => r.action)
  const users = ctx.db
    .prepare('SELECT DISTINCT user_id AS userId, username FROM audit_log ORDER BY username')
    .all() as Array<{ userId: number | null, username: string | null }>
  return { modules, actions, users }
}

export function auditEntryFor(ctx: ServiceContext, entityType: string, entityId: number, limit = 20): AuditEntry[] {
  assertPermission(ctx, 'audit.view')
  const rows = ctx.db
    .prepare('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY at DESC LIMIT ?')
    .all(entityType, entityId, limit) as AuditRow[]
  return rows.map(mapRow)
}
