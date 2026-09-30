import { app, BrowserWindow, ipcMain, session as electronSession, shell } from 'electron'
import { join } from 'node:path'
import { markReady, markRecovery, markStarting, startupState } from './startup/state'
import { createElectronHost } from './platform/electronHost'
import { openDatabase, type DatabaseContext } from './db/connection'
import { SessionManager } from './session/sessionManager'
import { IpcRouter } from './ipc/router'
import { createSystemHandlers, type HandlerDeps } from './ipc/handlers/system'
import { createPracticeHandlers } from './ipc/handlers/practice'
import { createPatientHandlers } from './ipc/handlers/patients'
import { createDashboardHandlers } from './ipc/handlers/dashboard'
import { createClinicalHandlers } from './ipc/handlers/clinical'
import { createSchedulingHandlers } from './ipc/handlers/scheduling'
import { createBillingHandlers } from './ipc/handlers/billing'
import { createInventoryHandlers } from './ipc/handlers/inventory'
import { createAccountingHandlers } from './ipc/handlers/accounting'
import { createPrintingHandlers } from './ipc/handlers/printing'
import { createBackupHandlers } from './ipc/handlers/backup'
import { createNotificationHandlers } from './ipc/handlers/notifications'
import { liveRowCounts, runScheduledBackup } from './backup/service'
import { createServiceContext, SCHEDULER_ACTOR } from './context'
import { verifyActivationIntegrity } from './activation/service'
import { AppError, describeErrorForLog } from '@shared/errors'
import type { HostServices } from './platform/types'

/**
 * Application entry point.
 *
 * Responsibilities: single-instance enforcement, hardened window creation, IPC wiring, the auto-lock
 * timer, crash guards and Recovery Mode when the clinic database cannot be opened. All business logic
 * lives in `src/main/modules/*`; this file only wires the process together.
 */

const IPC_INVOKE = 'dentiva:invoke'
const IPC_EVENT = 'dentiva:event'

let mainWindow: BrowserWindow | null = null
let host: HostServices | null = null
let database: DatabaseContext | null = null
let router: IpcRouter | null = null
let recoveryReason: string | null = null
let maintenanceMode = false
let autoLockTimer: NodeJS.Timeout | null = null
const sessions = new SessionManager()

function broadcast(event: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(IPC_EVENT, event, payload)
  }
}

function currentWindow(): BrowserWindow | null {
  return mainWindow
}

function relaunch(): void {
  shutdownDatabase()
  app.relaunch()
  app.exit(0)
}

function shutdownDatabase(): void {
  try {
    database?.close()
  } catch (error) {
    host?.logger.warn('Failed to close the database cleanly during shutdown', { reason: describeErrorForLog(error) })
  }
  database = null
}

/** Start (or restart) the auto-lock watchdog: locked sessions are enforced in the main process. */
function refreshAutoLockTimer(): void {
  if (autoLockTimer) {
    clearInterval(autoLockTimer)
    autoLockTimer = null
  }
  const anyTimed = sessions.all().some((session) => session.autoLockMs > 0)
  if (!anyTimed) return
  autoLockTimer = setInterval(() => {
    const now = Date.now()
    for (const session of sessions.dueForLock(now)) {
      sessions.lock(session.webContentsId, now)
      broadcast('session:locked', { at: now })
      try {
        database?.db
          .prepare(
            `INSERT INTO audit_log (at, user_id, username, module, action, entity_type, entity_id, summary, detail_json, result, session_id)
             VALUES (?, ?, ?, 'auth', 'session.auto-lock', 'user', ?, ?, NULL, 'success', ?)`
          )
          .run(now, session.actor.userId, session.actor.username, session.actor.userId, 'Session locked automatically after inactivity', session.id)
      } catch (error) {
        host?.logger.warn('Failed to audit automatic session lock', { reason: describeErrorForLog(error) })
      }
    }
  }, 5000)
}

function openDatabaseSafely(): void {
  if (!host) return
  try {
    database = openDatabase({
      filePath: host.paths.databaseFile,
      now: () => host!.now(),
      backupDir: host.paths.defaultBackupDir,
      appVersion: host.build.version
    })
    recoveryReason = null
    markReady()
    const integrity = verifyActivationIntegrity(database.db)
    if (integrity.invalidated) {
      host.logger.warn('Activation state failed its integrity check and was reset')
    }
    host.machine.printersAvailable = true
    markInterruptedRestores()
    host.logger.info('Database opened', { schemaVersion: database.integrityCheck().ok ? 'ok' : 'warning' })
  } catch (error) {
    recoveryReason =
      error instanceof AppError
        ? error.message
        : 'The clinic database could not be opened. Your data has not been changed.'
    markRecovery(recoveryReason)
    host.logger.error('Database could not be opened — entering recovery mode', error)
    database = null
  }
}

/**
 * A restore writes an `in_progress` row before it touches any file. If the process died mid-restore that
 * row survives in whichever database is now on disk, so it is closed out here with an honest message
 * instead of leaving a permanently running restore in the history.
 */
function markInterruptedRestores(): void {
  if (!database) return
  try {
    const result = database.db
      .prepare(
        `UPDATE restore_history
            SET result = 'failed',
                message = COALESCE(message, 'The restore was interrupted before it finished.'),
                finished_at = COALESCE(finished_at, ?)
          WHERE result = 'in_progress'`
      )
      .run(Date.now())
    if (result.changes > 0) host?.logger.warn('Closed out interrupted restore attempts', { count: result.changes })
  } catch {
    /* older databases may not have the table yet */
  }
}

function handlerDeps(): HandlerDeps {
  if (!host) throw new Error('Host services are not ready')
  if (!database) throw new Error('Database is not available')
  return {
    db: database.db,
    host,
    sessions,
    invalidateActor: (userId) => router?.invalidateActor(userId),
    broadcast,
    refreshAutoLock: refreshAutoLockTimer,
    isMaintenanceMode: () => maintenanceMode,
    setMaintenanceMode: (value) => {
      maintenanceMode = value
    },
    relaunch,
    currentDb: () => database?.db ?? null,
    closeDatabase: () => shutdownDatabase(),
    reopenDatabase: () => reopenDatabase(),
    inspectDatabase: () => {
      if (!database) return { ok: false, problems: ['The clinic database is not open.'], counts: {} }
      const integrity = database.integrityCheck()
      const foreignKeys = database.foreignKeyCheck()
      const problems = [...(integrity.ok ? [] : integrity.messages), ...(foreignKeys.ok ? [] : foreignKeys.violations)]
      return { ok: problems.length === 0, problems, counts: liveRowCounts(database.db) }
    }
  }
}

function buildRouter(): IpcRouter {
  const deps = handlerDeps()
  const instance = new IpcRouter({
    db: deps.db,
    host: deps.host,
    sessions,
    emit: (webContentsId, event, payload) => {
      const target = BrowserWindow.getAllWindows().find((window) => window.webContents.id === webContentsId)
      if (target && !target.isDestroyed()) target.webContents.send(IPC_EVENT, event, payload)
    },
    isMaintenanceMode: () => maintenanceMode
  })
  instance.register(createSystemHandlers(deps))
  instance.register(createPracticeHandlers(deps))
  instance.register(createPatientHandlers(deps))
  instance.register(createClinicalHandlers(deps))
  instance.register(createSchedulingHandlers(deps))
  instance.register(createBillingHandlers(deps))
  instance.register(createInventoryHandlers(deps))
  instance.register(createAccountingHandlers(deps))
  instance.register(createPrintingHandlers(deps))
  instance.register(createBackupHandlers(deps))
  instance.register(createNotificationHandlers(deps))
  instance.register(createDashboardHandlers())
  const missing = instance.missingChannels()
  if (missing.length > 0) {
    // Failing fast in development keeps the contract honest; production logs and continues with the
    // channels that are implemented so a single gap cannot make the whole application unusable.
    if (!app.isPackaged) throw new Error(`IPC channels without handlers: ${missing.join(', ')}`)
    deps.host.logger.error('IPC channels without handlers', new Error(missing.join(', ')))
  }
  return instance
}

function applySecurityPolicy(): void {
  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            'font-src \'self\' data:',
            'img-src \'self\' data: blob:',
            "connect-src 'self'",
            "object-src 'none'",
            "frame-src 'self'",
            "base-uri 'none'",
            "form-action 'none'"
          ].join('; ')
        ]
      }
    })
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const allowed = process.env['ELECTRON_RENDERER_URL']
      const isAllowed = allowed ? url.startsWith(allowed) : url.startsWith('file://')
      if (!isAllowed) {
        event.preventDefault()
        host?.logger.warn('Blocked navigation to an external destination', { url: url.slice(0, 120) })
      }
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-read' || permission === 'clipboard-sanitized-write')
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0B1F3A',
    title: 'Dentiva Pro',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged,
      backgroundThrottling: false
    }
  })

  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void window.loadURL(devUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

function installCrashGuards(): void {
  process.on('uncaughtException', (error) => {
    host?.logger.error('Uncaught exception in the main process', error)
  })
  process.on('unhandledRejection', (reason) => {
    host?.logger.error('Unhandled promise rejection in the main process', reason)
  })
  app.on('render-process-gone', (_event, _webContents, details) => {
    host?.logger.error('Renderer process ended unexpectedly', new Error(details.reason), { exitCode: details.exitCode })
    if (details.reason === 'crashed' || details.reason === 'oom') {
      broadcast('app:message', {
        kind: 'error',
        message: 'The application window closed unexpectedly and has been restored. Your data is safe.'
      })
      if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow()
    }
  })
  app.on('child-process-gone', (_event, details) => {
    host?.logger.warn('A background process ended unexpectedly', { type: details.type, reason: details.reason })
  })
}

/**
 * The recovery surface.
 *
 * Without a database there is no router, so a clinic in recovery mode could not open its own folders or
 * restart — the very actions the recovery screen offers. These three channels are therefore answered by
 * the process itself when the router is unavailable; every other request is refused with the reason the
 * application is in recovery.
 */
const RECOVERY_CHANNELS = new Set(['app.startupState', 'app.openDataFolder', 'app.relaunch'])

async function handleRecoveryRequest(channelId: string, payload: unknown): Promise<unknown> {
  if (channelId === 'app.startupState') return { ok: true, data: startupState() }
  if (channelId === 'app.openDataFolder' && host) {
    const kind = (payload as { kind?: string } | null)?.kind ?? 'data'
    const map = {
      data: host.paths.dataDir,
      logs: host.paths.logsDir,
      exports: host.paths.exportsDir,
      backups: host.paths.defaultBackupDir,
      attachments: host.paths.attachmentsDir
    } as const
    const target = map[(kind as keyof typeof map) in map ? (kind as keyof typeof map) : 'data']
    const failure = await host.shell.openPath(target)
    if (failure) return { ok: false, error: { code: 'E_IO', message: `The folder could not be opened: ${failure}` } }
    return { ok: true, data: { ok: true } }
  }
  if (channelId === 'app.relaunch') {
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 300)
    return { ok: true, data: { ok: true } }
  }
  return {
    ok: false,
    error: { code: 'E_STATE', message: 'That action needs the clinic database, which could not be opened.' }
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC_INVOKE, async (event, channelId: unknown, payload: unknown) => {
    if (typeof channelId !== 'string') {
      return { ok: false, error: { code: 'E_VALIDATION', message: 'Unsupported request.' } }
    }
    /* Answered with or without a router: the recovery screen has to be able to describe itself. */
    if (channelId === 'app.startupState' && router) return router.handle(event.sender.id, channelId, payload)
    if (!router) {
      if (RECOVERY_CHANNELS.has(channelId)) return handleRecoveryRequest(channelId, payload)
      return {
        ok: false,
        error: {
          code: 'E_STATE',
          message: recoveryReason ?? 'Dentiva Pro is still starting up. Please wait a moment and try again.'
        }
      }
    }
    return router.handle(event.sender.id, channelId, payload)
  })
}

async function bootstrap(): Promise<void> {
  app.setName('Dentiva Pro')
  markStarting()
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
    return
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  host = createElectronHost({ getWindow: currentWindow })
  host.logger.info('Dentiva Pro starting', { version: host.build.version, packaged: app.isPackaged, dataDir: host.paths.dataDir })
  applySecurityPolicy()
  installCrashGuards()
  openDatabaseSafely()
  if (database) {
    try {
      router = buildRouter()
    } catch (error) {
      recoveryReason = 'Dentiva Pro could not start its internal services. Please contact support with the log files.'
      markRecovery(recoveryReason)
      host.logger.error('Failed to build the IPC router', error)
      router = null
    }
  }
  registerIpc()
  mainWindow = createWindow()
  scheduleAutomaticBackups()

  app.on('window-all-closed', () => {
    shutdownDatabase()
    app.quit()
  })
  app.on('before-quit', () => {
    shutdownDatabase()
    host?.logger.close()
  })
  app.on('activate', () => {
    if (!mainWindow) mainWindow = createWindow()
  })
}

/**
 * Runs the automatic backup when one is due. The scheduler runs as the application itself (the audit
 * trail records the system actor) and only ever writes into the configured backup folder. A failed
 * scheduled backup is logged and retried on the next tick; it never blocks the clinic's work.
 */
function scheduleAutomaticBackups(): void {
  const runIfDue = async (): Promise<void> => {
    if (!host || !database || recoveryReason !== null || maintenanceMode) return
    try {
      const ctx = createServiceContext({
        db: database.db,
        host,
        actor: SCHEDULER_ACTOR,
        sessionId: 'scheduler'
      })
      const result = await runScheduledBackup(ctx, {})
      if (result.ran) host.logger.info('Scheduled backup created', { filePath: result.filePath })
    } catch (error) {
      host?.logger.warn('Scheduled backup failed', { reason: describeErrorForLog(error) })
    }
  }
  setTimeout(() => void runIfDue(), 5000)
  const timer = setInterval(() => void runIfDue(), 60 * 60 * 1000)
  timer.unref()
}

/** Re-open the database after a restore without restarting the process. */
export function reopenDatabase(): boolean {
  shutdownDatabase()
  openDatabaseSafely()
  if (!database) return false
  try {
    router = buildRouter()
    return true
  } catch (error) {
    host?.logger.error('Failed to rebuild IPC services after reopening the database', error)
    return false
  }
}

void app.whenReady().then(bootstrap)
