import { app, BrowserWindow, ipcMain, session as electronSession, shell } from 'electron'
import { existsSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createElectronHost } from './platform/electronHost'
import { openDatabase, type DatabaseContext } from './db/connection'
import { SessionManager } from './session/sessionManager'
import { IpcRouter } from './ipc/router'
import { createSystemHandlers, type HandlerDeps } from './ipc/handlers/system'
import { createPracticeHandlers } from './ipc/handlers/practice'
import { createPatientHandlers } from './ipc/handlers/patients'
import { createDashboardHandlers } from './ipc/handlers/dashboard'
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
    database = openDatabase({ filePath: host.paths.databaseFile, now: () => host!.now() })
    recoveryReason = null
    const integrity = verifyActivationIntegrity(database.db)
    if (integrity.invalidated) {
      host.logger.warn('Activation state failed its integrity check and was reset')
    }
    host.machine.printersAvailable = true
    host.logger.info('Database opened', { schemaVersion: database.integrityCheck().ok ? 'ok' : 'warning' })
  } catch (error) {
    recoveryReason =
      error instanceof AppError
        ? error.message
        : 'The clinic database could not be opened. Your data has not been changed.'
    host.logger.error('Database could not be opened — entering recovery mode', error)
    database = null
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
    relaunch
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
    }
  })
  instance.register(createSystemHandlers(deps))
  instance.register(createPracticeHandlers(deps))
  instance.register(createPatientHandlers(deps))
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

function registerIpc(): void {
  ipcMain.handle(IPC_INVOKE, async (event, channelId: unknown, payload: unknown) => {
    if (!router) {
      return {
        ok: false,
        error: {
          code: 'E_STATE',
          message: recoveryReason ?? 'Dentiva Pro is still starting up. Please wait a moment and try again.'
        }
      }
    }
    if (typeof channelId !== 'string') {
      return { ok: false, error: { code: 'E_VALIDATION', message: 'Unsupported request.' } }
    }
    return router.handle(event.sender.id, channelId, payload)
  })
}

async function bootstrap(): Promise<void> {
  app.setName('Dentiva Pro')
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
      host.logger.error('Failed to build the IPC router', error)
      router = null
    }
  }
  registerIpc()
  mainWindow = createWindow()

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

export const processState = {
  isRecoveryMode: (): boolean => recoveryReason !== null,
  recoveryReason: (): string | null => recoveryReason,
  setMaintenanceMode: (value: boolean): void => {
    maintenanceMode = value
  },
  dataAvailable: (): boolean => database !== null
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

/** Reset a corrupt database by moving it aside, then creating a fresh one. */
export function archiveDatabaseAndReset(): { archived: string | null } {
  if (!host) return { archived: null }
  const target = host.paths.databaseFile
  let archived: string | null = null
  try {
    if (existsSync(target)) {
      archived = `${target}.broken-${Date.now()}`
      renameSync(target, archived)
    }
    for (const suffix of ['-wal', '-shm']) {
      try {
        if (existsSync(`${target}${suffix}`)) unlinkSync(`${target}${suffix}`)
      } catch {
        /* ignore lock files that are still held */
      }
    }
  } catch (error) {
    host.logger.error('Could not archive the damaged database', error)
    return { archived: null }
  }
  openDatabaseSafely()
  if (database) router = buildRouter()
  return { archived }
}

void app.whenReady().then(bootstrap)
