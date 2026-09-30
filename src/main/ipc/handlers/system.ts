import type { ServiceContext } from '../../context'
import { AppError } from '@shared/errors'
import { activate, getActivationState, ACTIVATION_CODE_LENGTH_HINT } from '../../activation/service'
import { getSetupStatus, getSetupSummary, saveAdministratorStep, saveClinicStep, saveDentistsStep, savePreferencesStep, completeSetup, resolveStage } from '../../modules/setup/service'
import { getClinicProfileSafe, getNumberSetting, getBooleanSetting, getDisplaySettings } from '../../modules/settings/service'
import { listAudit, auditFacets, auditEntryFor, type AuditEntry } from '../../modules/audit/service'
import { changeOwnPassword, login } from '../../modules/auth/service'
import { deriveActor } from '../../modules/auth/actor'
import { verifyPassword } from '../../auth/password'
import { evaluateDiagnostics, collectAboutInfo } from '../../modules/support/service'
import type { PartialHandlerMap } from '../router'
import type { SessionManager } from '../../session/sessionManager'
import type { HostServices } from '../../platform/types'
import type { Db } from '../../db/connection'
import type { Actor } from '@shared/permissions'
import { exportStamp, writeCsv, type CsvColumn } from '../../files/csv'
import { resolve as resolvePath, sep } from 'node:path'

export interface HandlerDeps {
  db: Db
  host: HostServices
  sessions: SessionManager
  /** Invalidate the cached actor for a user (called after role/permission changes). */
  invalidateActor(userId?: number): void
  /** Push an event to every renderer window. */
  broadcast(event: string, payload: unknown): void
  /** Re-read the auto-lock timeout after a settings or session change. */
  refreshAutoLock(): void
  /** True while the database is being replaced by a restore. */
  isMaintenanceMode(): boolean
  /** Turn maintenance mode on/off while a restore replaces the database. */
  setMaintenanceMode(value: boolean): void
  /** Restart the application (used after restore). */
  relaunch(): void
  /** The live database handle at the moment of the call; it changes after a restore reopens the database. */
  currentDb(): Db | null
  /** Close the live database so its files can be replaced by a restore. */
  closeDatabase(): void
  /** Re-open the database after a restore; false when it could not be opened. */
  reopenDatabase(): boolean
  /** Integrity check, relationship check and row counts of the database that is open right now. */
  inspectDatabase(): { ok: boolean, problems: string[], counts: Record<string, number> }
}

function systemActor(): Actor {
  return {
    userId: 0,
    username: 'system',
    fullName: 'System',
    roleId: 0,
    roleCode: 'system',
    permissions: new Set<string>(),
    maxDiscountBasisPoints: null
  }
}

function securityPolicy(deps: HandlerDeps, ctx: ServiceContext): { minPasswordLength: number, passwordExpiryDays: number, maxFailedAttempts: number, lockoutMinutes: number } {
  return {
    minPasswordLength: getNumberSetting(ctx, 'security.passwordMinLength'),
    passwordExpiryDays: getNumberSetting(ctx, 'security.passwordExpiryDays'),
    maxFailedAttempts: getNumberSetting(ctx, 'security.maxFailedAttempts'),
    lockoutMinutes: getNumberSetting(ctx, 'security.lockoutMinutes')
  }
}

/** Guard for "open/reveal" actions: only application-owned locations may be opened by the shell. */
function assertPathAllowed(deps: HandlerDeps, candidate: string): string {
  const resolved = resolvePath(candidate)
  const roots = [deps.host.paths.dataDir, deps.host.paths.exportsDir, deps.host.paths.attachmentsDir, deps.host.paths.defaultBackupDir, deps.host.paths.logsDir]
  const allowed = roots.some((root) => resolved === resolvePath(root) || resolved.startsWith(`${resolvePath(root)}${sep}`))
  if (!allowed) throw new AppError('E_PERMISSION', 'That location cannot be opened from Dentiva Pro.')
  return resolved
}

export function createSystemHandlers(deps: HandlerDeps): PartialHandlerMap {
  const sessionSummary = (webContentsId: number): ReturnType<SessionManager['summarize']> => deps.sessions.summarize(webContentsId)

  return {
    'app.bootstrap': (ctx) => ({
      stage: resolveStage(ctx),
      build: ctx.host.build,
      machine: ctx.host.machine,
      clinic: getClinicProfileSafe(ctx),
      activation: { ...getActivationState(ctx), codeHint: ACTIVATION_CODE_LENGTH_HINT },
      setup: getSetupStatus(ctx),
      maintenanceMode: deps.isMaintenanceMode(),
      settings: getDisplaySettings(ctx),
      session: sessionSummary(ctx.webContentsId)
    }),

    'app.environment': (ctx) => ({
      build: ctx.host.build,
      machine: ctx.host.machine,
      dataDirectory: ctx.host.paths.dataDir,
      exportsDirectory: ctx.host.paths.exportsDir,
      defaultBackupDirectory: ctx.host.paths.defaultBackupDir,
      logDirectory: ctx.host.paths.logsDir,
      isDevelopment: ctx.host.isDevelopment()
    }),

    'app.openDataFolder': async (ctx, input) => {
      const map = {
        data: ctx.host.paths.dataDir,
        logs: ctx.host.paths.logsDir,
        exports: ctx.host.paths.exportsDir,
        backups: ctx.host.paths.defaultBackupDir,
        attachments: ctx.host.paths.attachmentsDir
      } as const
      const error = await ctx.host.shell.openPath(map[input.kind])
      if (error) throw new AppError('E_IO', `The folder could not be opened: ${error}`)
      return { ok: true as const }
    },

    'app.openPath': async (ctx, input) => {
      const error = await ctx.host.shell.openPath(assertPathAllowed(deps, input.path))
      if (error) throw new AppError('E_IO', `The file could not be opened: ${error}`)
      return { ok: true as const }
    },

    'app.revealPath': async (ctx, input) => {
      await ctx.host.shell.showItemInFolder(assertPathAllowed(deps, input.path))
      return { ok: true as const }
    },

    'app.systemEvents': (ctx, input) => {
      const rows = ctx.db
        .prepare('SELECT id, at, level, source, code, message, detail_json FROM system_events ORDER BY at DESC, id DESC LIMIT ?')
        .all(input.limit) as Array<{ id: number, at: number, level: string, source: string, code: string, message: string, detail_json: string | null }>
      return rows.map((row) => ({
        id: row.id,
        at: row.at,
        level: row.level,
        source: row.source,
        code: row.code,
        message: row.message,
        detail: row.detail_json ? (JSON.parse(row.detail_json) as Record<string, unknown>) : null
      }))
    },

    'app.diagnostics': (ctx) => evaluateDiagnostics(ctx),
    'app.about': (ctx) => collectAboutInfo(ctx),

    'app.relaunch': () => {
      setTimeout(() => deps.relaunch(), 300)
      return { ok: true as const }
    },

    'activation.state': (ctx) => ({ ...getActivationState(ctx), codeHint: ACTIVATION_CODE_LENGTH_HINT }),
    'activation.submit': async (ctx, input) => {
      const result = activate(ctx, input.code)
      if (result.delayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, result.delayMs))
      return { activated: true as const, activatedAt: result.activatedAt }
    },

    'setup.status': (ctx) => getSetupStatus(ctx),
    'setup.clinic': (ctx, input) => saveClinicStep(ctx, input),
    'setup.dentists': (ctx, input) => saveDentistsStep(ctx, input.dentists).map((dentist) => ({
      ...dentist,
      designationList: dentist.designations,
      qualificationList: dentist.qualifications.map((qualification) => qualification.title)
    })),
    'setup.administrator': (ctx, input) => saveAdministratorStep(ctx, input),
    'setup.preferences': (ctx, input) => savePreferencesStep(ctx, input.values),
    'setup.summary': (ctx) => getSetupSummary(ctx),
    'setup.complete': (ctx, input) => completeSetup(ctx, input.confirmation),

    'auth.login': (ctx, input) => {
      const result = login(
        { db: deps.db, host: deps.host, audit: ctx.audit, now: () => deps.host.now(), policy: securityPolicy(deps, ctx) },
        input.username,
        input.password
      )
      deps.sessions.destroy(ctx.webContentsId)
      const autoLockMinutes = getNumberSetting(ctx, 'practice.autoLockMinutes')
      deps.sessions.create(ctx.webContentsId, result.actor, {
        autoLockMs: Math.max(0, autoLockMinutes) * 60_000,
        mustChangePassword: result.mustChangePassword,
        lastUsername: result.actor.username,
        now: deps.host.now()
      })
      deps.refreshAutoLock()
      return {
        session: sessionSummary(ctx.webContentsId)!,
        mustChangePassword: result.mustChangePassword,
        passwordExpired: result.passwordExpired
      }
    },

    'auth.logout': (ctx) => {
      const session = deps.sessions.destroy(ctx.webContentsId)
      if (session) {
        ctx.audit.write({ module: 'auth', action: 'logout', entityType: 'user', entityId: session.actor.userId, summary: `${session.actor.username} signed out` })
      }
      deps.refreshAutoLock()
      deps.broadcast('session:ended', { reason: 'logout' })
      return { ok: true as const }
    },

    'auth.lock': (ctx) => {
      const session = deps.sessions.lock(ctx.webContentsId, deps.host.now())
      if (!session) throw new AppError('E_UNAUTHENTICATED', 'Your session has ended. Please sign in again.')
      ctx.audit.write({ module: 'auth', action: 'session.lock', entityType: 'user', entityId: session.actor.userId, summary: `${session.actor.username} locked the application` })
      deps.broadcast('session:locked', { at: deps.host.now() })
      return { ok: true as const }
    },

    'auth.unlock': (ctx, input) => {
      const session = deps.sessions.get(ctx.webContentsId)
      if (!session) throw new AppError('E_UNAUTHENTICATED', 'Your session has ended. Please sign in again.')
      const row = ctx.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(session.actor.userId) as { password_hash: string } | undefined
      if (!row || !verifyPassword(input.password, row.password_hash).ok) {
        ctx.audit.write({
          module: 'auth',
          action: 'session.unlock.failure',
          entityType: 'user',
          entityId: session.actor.userId,
          summary: 'Failed unlock attempt',
          result: 'failure'
        })
        throw new AppError('E_VALIDATION', 'That password is not correct.', { fieldErrors: { password: 'Incorrect password.' } })
      }
      deps.sessions.unlock(ctx.webContentsId, deps.host.now())
      deps.invalidateActor(session.actor.userId)
      deps.sessions.refreshActor(ctx.webContentsId, deriveActor(deps.db, session.actor.userId))
      ctx.audit.write({ module: 'auth', action: 'session.unlock', entityType: 'user', entityId: session.actor.userId, summary: `${session.actor.username} unlocked the application` })
      deps.broadcast('session:unlocked', { at: deps.host.now() })
      deps.refreshAutoLock()
      return sessionSummary(ctx.webContentsId)!
    },

    'auth.changePassword': (ctx, input) => {
      changeOwnPassword(
        { db: deps.db, host: deps.host, audit: ctx.audit, now: () => deps.host.now(), policy: securityPolicy(deps, ctx) },
        ctx.actor,
        input
      )
      const session = deps.sessions.get(ctx.webContentsId)
      if (session) session.mustChangePassword = false
      return { ok: true as const }
    },

    'auth.rememberedUsername': (ctx) => {
      if (!getBooleanSetting(ctx, 'ui.rememberUsername')) return { username: null }
      const row = ctx.db
        .prepare('SELECT username FROM users WHERE is_deleted = 0 ORDER BY last_login_at DESC NULLS LAST, id LIMIT 1')
        .get() as { username: string } | undefined
      return { username: row?.username ?? null }
    },

    'session.state': (ctx) => {
      const summary = ctx.webContentsId >= 0 ? sessionSummary(ctx.webContentsId) : null
      return { authenticated: Boolean(summary), locked: Boolean(summary?.locked), session: summary }
    },

    'session.touch': (ctx) => {
      deps.sessions.touch(ctx.webContentsId, deps.host.now())
      return { ok: true as const }
    },

    'session.refresh': (ctx) => {
      const session = deps.sessions.get(ctx.webContentsId)
      if (!session) throw new AppError('E_UNAUTHENTICATED', 'Your session has ended. Please sign in again.')
      deps.invalidateActor(session.actor.userId)
      const actor = deriveActor(deps.db, session.actor.userId)
      deps.sessions.refreshActor(ctx.webContentsId, actor)
      deps.refreshAutoLock()
      return sessionSummary(ctx.webContentsId)!
    },

    'audit.list': (ctx, input) => listAudit(ctx, input),
    'audit.facets': (ctx) => auditFacets(ctx),

    'audit.export': async (ctx, input) => {
      const page = listAudit(ctx, { ...input, limit: 5000, offset: 0 })
      const target = await deps.host.dialogs.saveFile({
        title: 'Export audit log',
        defaultPath: `${deps.host.paths.exportsDir}/audit-log-${exportStamp(ctx.now())}.csv`,
        filters: [{ name: 'CSV file', extensions: ['csv'] }]
      })
      if (!target) return { path: null, rowCount: 0 }
      const rowCount = writeCsv(target, page.entries, auditColumns)
      ctx.audit.write({
        module: 'audit',
        action: 'export',
        summary: `Exported ${page.entries.length} audit entr(y/ies) to CSV`,
        detail: { file: target, rows: rowCount }
      })
      return { path: target, rowCount }
    },
    'audit.forEntity': (ctx, input) => auditEntryFor(ctx, input.entityType, input.entityId, input.limit)
  }
}

const auditColumns: Array<CsvColumn<AuditEntry>> = [
  { key: 'at', header: 'Timestamp', value: (row) => new Date(row.at).toISOString() },
  { key: 'username', header: 'User', value: (row) => row.username ?? 'system' },
  { key: 'module', header: 'Module', value: (row) => row.module },
  { key: 'action', header: 'Action', value: (row) => row.action },
  { key: 'result', header: 'Result', value: (row) => row.result },
  { key: 'entityType', header: 'Entity type', value: (row) => row.entityType ?? '' },
  { key: 'entityId', header: 'Entity id', value: (row) => (row.entityId === null ? '' : String(row.entityId)) },
  { key: 'summary', header: 'Summary', value: (row) => row.summary },
  { key: 'sessionId', header: 'Session', value: (row) => row.sessionId ?? '' },
  { key: 'detail', header: 'Detail', value: (row) => (row.detail ? JSON.stringify(row.detail) : '') }
]

export { systemActor }
