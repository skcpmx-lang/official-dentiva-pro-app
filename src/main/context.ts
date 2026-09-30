import type { Db } from './db/connection'
import type { HostServices } from './platform/types'
import { AppError, permissionError, lockedError } from '@shared/errors'
import type { Actor } from '@shared/permissions'

export interface AuditEntryInput {
  module: string
  action: string
  entityType?: string | null
  entityId?: number | null
  summary: string
  detail?: Record<string, unknown> | null
  result?: 'success' | 'failure'
}

export interface AuditWriter {
  write(entry: AuditEntryInput): void
}

/**
 * Everything a domain service needs. Services receive a context instead of importing Electron or the
 * session store, which keeps them pure, testable and impossible to call without an authorised actor.
 */
export interface ServiceContext {
  readonly db: Db
  readonly host: HostServices
  readonly actor: Actor
  readonly sessionId: string
  /** Renderer that issued the call (the main process owns session lookup; the renderer never sends this). */
  readonly webContentsId: number
  readonly audit: AuditWriter
  now(): number
}

export interface CreateContextOptions {
  db: Db
  host: HostServices
  actor: Actor
  sessionId?: string
  webContentsId?: number
  /** Set to false only for migrations/support tooling that must run without an actor. */
  audit?: AuditWriter
}

/** Actor used before the first sign-in exists (activation, setup wizard, recovery). */
export const SYSTEM_ACTOR: Actor = {
  userId: 0,
  username: 'system',
  fullName: 'System',
  roleId: 0,
  roleCode: 'system',
  permissions: new Set<string>(),
  maxDiscountBasisPoints: null
}

/**
 * Actor for work the application performs on its own behalf while the clinic works: today that is only
 * the automatic backup timer. `SYSTEM_ACTOR` deliberately may not touch clinic data at all — it exists
 * for activation, the setup wizard and recovery — so the scheduler needs its own identity to be able to
 * read the backup schedule and write the package. The audit trail records it as “Dentiva Pro scheduler”,
 * so an automatic package is never mistaken for something an operator did.
 */
export const SCHEDULER_ACTOR: Actor = {
  userId: 0,
  username: 'scheduler',
  fullName: 'Dentiva Pro scheduler',
  roleId: 0,
  roleCode: 'scheduler',
  permissions: new Set<string>(['backups.create']),
  maxDiscountBasisPoints: null
}

export function createAuditWriter(db: Db, actor: Actor, sessionId: string, now: () => number): AuditWriter {
  const insert = db.prepare(
    `INSERT INTO audit_log (at, user_id, username, module, action, entity_type, entity_id, summary, detail_json, result, session_id)
     VALUES (@at, @userId, @username, @module, @action, @entityType, @entityId, @summary, @detail, @result, @sessionId)`
  )
  return {
    write(entry: AuditEntryInput): void {
      insert.run({
        at: now(),
        userId: actor.userId || null,
        username: actor.username || null,
        module: entry.module,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        summary: entry.summary.slice(0, 500),
        detail: entry.detail ? JSON.stringify(entry.detail).slice(0, 4000) : null,
        result: entry.result ?? 'success',
        sessionId
      })
    }
  }
}

export function createServiceContext(options: CreateContextOptions): ServiceContext {
  const { db, host, actor, sessionId = 'local', webContentsId = -1, audit } = options
  const now = () => host.now()
  return {
    db,
    host,
    actor,
    sessionId,
    webContentsId,
    audit: audit ?? createAuditWriter(db, actor, sessionId, now),
    now
  }
}

/** Test/tooling helper: a context whose actor holds exactly the given permission codes. */
export function createTestContext(options: {
  db: Db
  host: HostServices
  permissions?: string[]
  actor?: Partial<Actor>
}): ServiceContext {
  const permissions = new Set(options.permissions ?? [])
  const actor: Actor = {
    userId: 1,
    username: 'tester',
    fullName: 'Test User',
    roleId: 1,
    roleCode: 'test',
    permissions,
    maxDiscountBasisPoints: 1000,
    ...options.actor
  }
  return createServiceContext({ db: options.db, host: options.host, actor })
}

/** Guard used by every domain service method before touching data. */
export function assertPermission(ctx: ServiceContext, permission: string): void {
  if (ctx.actor.userId === 0 && ctx.actor.roleCode === 'system') {
    // System actor (activation/setup/recovery) may not access clinic data at all.
    throw permissionError(permission)
  }
  if (!ctx.actor.permissions.has(permission)) throw permissionError(permission)
}

export function assertAnyPermission(ctx: ServiceContext, permissions: readonly string[]): void {
  if (permissions.some((code) => ctx.actor.permissions.has(code))) return
  throw permissionError(permissions.join(' | '))
}

export function hasPermission(ctx: ServiceContext, permission: string): boolean {
  return ctx.actor.permissions.has(permission)
}

/**
 * Business rule: discount authority. Returns the maximum discount in basis points allowed for the
 * actor, or `null` when unlimited. Any service computing an invoice discount must call this.
 */
export function assertDiscountAllowed(ctx: ServiceContext, discountBasisPoints: number): void {
  if (discountBasisPoints < 0) throw new AppError('E_VALIDATION', 'Discount cannot be negative.')
  if (ctx.actor.permissions.has('billing.discount_override')) return
  const limit = ctx.actor.maxDiscountBasisPoints ?? 0
  if (discountBasisPoints > limit) {
    throw new AppError(
      'E_PERMISSION',
      `Your role allows a discount of up to ${(limit / 100).toFixed(limit % 100 === 0 ? 0 : 2)} %. Ask an administrator for approval or reduce the discount.`,
      { detail: { requestedBp: discountBasisPoints, limitBp: limit } }
    )
  }
}

export function assertUnlocked(sessionLocked: boolean): void {
  if (sessionLocked) throw lockedError()
}
