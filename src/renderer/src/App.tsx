import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createHashRouter, Navigate, Outlet, RouterProvider, useLocation, useNavigate } from 'react-router-dom'
import { invoke } from './lib/api'
import { applyInterfaceSettings, startsCollapsed } from './lib/interface'
import { useAppStore, usePermission } from './store/appStore'
import { AppShell } from './components/shell/AppShell'
import { CommandPalette } from './components/shell/CommandPalette'
import { ConfirmDialogHost, Toaster, toast } from './components/ui/overlay'
import { Button, PermissionDenied } from './components/ui/primitives'
import { ActivationScreen } from './features/auth/ActivationScreen'
import { LoginScreen } from './features/auth/LoginScreen'
import { LockScreen } from './features/auth/LockScreen'
import { ChangePasswordScreen } from './features/auth/ChangePasswordScreen'
import { SetupWizard } from './features/setup/SetupWizard'
import { DashboardScreen } from './features/dashboard/DashboardScreen'
import { PatientListScreen } from './features/patients/PatientListScreen'
import { PatientFormScreen } from './features/patients/PatientFormScreen'
import { PatientProfileScreen } from './features/patients/PatientProfileScreen'
import { VisitListScreen } from './features/clinical/VisitListScreen'
import { VisitScreen } from './features/clinical/VisitScreen'
import { DentalChartScreen } from './features/clinical/DentalChartScreen'
import { TreatmentCatalogScreen } from './features/clinical/TreatmentCatalogScreen'
import { PrescriptionListScreen } from './features/clinical/PrescriptionListScreen'
import { PrescriptionScreen } from './features/clinical/PrescriptionScreen'
import { AppointmentsScreen } from './features/scheduling/AppointmentsScreen'
import { QueueScreen } from './features/scheduling/QueueScreen'
import { InvoiceListScreen } from './features/billing/InvoiceListScreen'
import { InvoiceScreen } from './features/billing/InvoiceScreen'
import { InventoryScreen } from './features/inventory/InventoryScreen'
import { InventoryItemScreen } from './features/inventory/InventoryItemScreen'
import { SuppliersScreen } from './features/inventory/SuppliersScreen'
import { AccountingScreen } from './features/accounting/AccountingScreen'
import { ReportsScreen } from './features/reports/ReportsScreen'
import { SettingsScreen } from './features/settings/SettingsScreen'
import { DentistsScreen } from './features/settings/DentistsScreen'
import { StaffScreen } from './features/settings/StaffScreen'
import { UsersScreen } from './features/settings/UsersScreen'
import { RolesScreen } from './features/settings/RolesScreen'
import { PrintingScreen } from './features/settings/PrintingScreen'
import { PrintHistoryScreen } from './features/printing/PrintHistoryScreen'
import { BackupScreen } from './features/settings/BackupScreen'
import { PreferencesScreen } from './features/settings/PreferencesScreen'
import { NotificationsScreen } from './features/notifications/NotificationsScreen'
import { AuditScreen } from './features/admin/AuditScreen'
import { AboutScreen } from './features/admin/AboutScreen'
import { NotFoundScreen } from './features/states/NotFoundScreen'
import type { BootstrapResult, StartupState } from './lib/types'

/**
 * Application root.
 *
 * Runs the startup sequence exactly once (activation → clinic setup → sign-in → workspace), keeps the
 * renderer's view of the session in sync with the main process, and routes to the correct gate. The
 * UI never decides by itself whether the application may be used: it renders what `app.bootstrap`
 * reports and what the session summary allows.
 */

export function App(): ReactNode {
  const ready = useAppStore((state) => state.ready)
  const settings = useAppStore((state) => state.settings)
  const setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed)

  /* Density and reduced motion are document-level: they are applied here so every screen inherits
     them, including the sign-in and setup screens that render before the shell exists. */
  useEffect(() => {
    applyInterfaceSettings(settings)
  }, [settings])

  /* “Start with the sidebar collapsed” is a starting position, not a lock: it is applied when the
     clinic changes the setting and the operator can still toggle the sidebar for the session. */
  const sidebarSetting = settings['ui.sidebarCollapsed']
  const appliedSidebar = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (sidebarSetting === undefined || appliedSidebar.current === sidebarSetting) return
    appliedSidebar.current = sidebarSetting
    setSidebarCollapsed(startsCollapsed(settings))
  }, [settings, sidebarSetting, setSidebarCollapsed])
  const router = useMemo(
    () =>
      createHashRouter([
        { path: '/activation', element: <ActivationScreen /> },
        { path: '/setup', element: <SetupWizard /> },
        { path: '/login', element: <LoginScreen /> },
        { path: '/lock', element: <LockScreen /> },
        {
          path: '/',
          element: (
            <>
              <SessionGate />
              <ShellChrome />
            </>
          ),
          children: [
            {
              element: <AppShell />,
              children: [
                { index: true, element: <DashboardScreen /> },
                { path: 'patients', element: <PermissionRoute permission="patients.view"><PatientListScreen /></PermissionRoute> },
                { path: 'patients/new', element: <PermissionRoute permission="patients.create"><PatientFormScreen mode="create" /></PermissionRoute> },
                { path: 'patients/:patientId', element: <PermissionRoute permission="patients.view"><PatientProfileScreen /></PermissionRoute> },
                { path: 'patients/:patientId/edit', element: <PermissionRoute permission="patients.edit"><PatientFormScreen mode="edit" /></PermissionRoute> },
                { path: 'accounting', element: <PermissionRoute permission="accounting.view"><AccountingScreen /></PermissionRoute> },
                { path: 'reports', element: <PermissionRoute permission="reports.view"><ReportsScreen /></PermissionRoute> },
                { path: 'inventory', element: <PermissionRoute permission="inventory.view"><InventoryScreen /></PermissionRoute> },
                { path: 'inventory/suppliers', element: <PermissionRoute permission="suppliers.view"><SuppliersScreen /></PermissionRoute> },
                { path: 'inventory/:itemId', element: <PermissionRoute permission="inventory.view"><InventoryItemScreen /></PermissionRoute> },
                { path: 'invoices', element: <PermissionRoute permission="billing.view"><InvoiceListScreen /></PermissionRoute> },
                { path: 'invoices/new', element: <PermissionRoute permission="billing.create"><InvoiceScreen /></PermissionRoute> },
                { path: 'invoices/:invoiceId', element: <PermissionRoute permission="billing.view"><InvoiceScreen /></PermissionRoute> },
                { path: 'appointments', element: <PermissionRoute permission="appointments.view"><AppointmentsScreen /></PermissionRoute> },
                { path: 'queue', element: <PermissionRoute permission="queue.view"><QueueScreen /></PermissionRoute> },
                { path: 'visits', element: <PermissionRoute permission="clinical.view"><VisitListScreen /></PermissionRoute> },
                { path: 'visits/:visitId', element: <PermissionRoute permission="clinical.view"><VisitScreen /></PermissionRoute> },
                { path: 'chart/:patientId', element: <PermissionRoute permission="clinical.view"><DentalChartScreen /></PermissionRoute> },
                { path: 'treatments', element: <PermissionRoute permission="clinical.view"><TreatmentCatalogScreen /></PermissionRoute> },
                { path: 'prescriptions', element: <PermissionRoute permission="prescriptions.view"><PrescriptionListScreen /></PermissionRoute> },
                { path: 'prescriptions/new', element: <PermissionRoute permission="prescriptions.create"><PrescriptionScreen /></PermissionRoute> },
                { path: 'prescriptions/:prescriptionId', element: <PermissionRoute permission="prescriptions.view"><PrescriptionScreen /></PermissionRoute> },
                { path: 'settings', element: <PermissionRoute permission="settings.view"><SettingsScreen /></PermissionRoute> },
                { path: 'settings/dentists', element: <PermissionRoute permission="settings.view"><DentistsScreen /></PermissionRoute> },
                { path: 'settings/staff', element: <PermissionRoute permission="staff.view"><StaffScreen /></PermissionRoute> },
                { path: 'settings/users', element: <PermissionRoute permission="users.view"><UsersScreen /></PermissionRoute> },
                { path: 'settings/roles', element: <PermissionRoute permission="roles.view"><RolesScreen /></PermissionRoute> },
                { path: 'settings/printing', element: <PermissionRoute permission={['printing.configure', 'printing.print']}><PrintingScreen /></PermissionRoute> },
                { path: 'settings/backup', element: <PermissionRoute permission={['backups.create', 'backups.restore', 'backups.configure']}><BackupScreen /></PermissionRoute> },
                { path: 'settings/preferences', element: <PreferencesScreen /> },
                { path: 'notifications', element: <NotificationsScreen /> },
                { path: 'printing/history', element: <PermissionRoute permission="printing.print"><PrintHistoryScreen /></PermissionRoute> },
                { path: 'audit', element: <PermissionRoute permission="audit.view"><AuditScreen /></PermissionRoute> },
                { path: 'about', element: <AboutScreen /> },
                { path: 'account/password', element: <ChangePasswordScreen /> }
              ]
            }
          ]
        },
        { path: '*', element: <NotFoundScreen /> }
      ]),
    []
  )

  return (
    <BootstrapGate>
      {ready ? <RouterProvider router={router} /> : null}
      {/* The palette navigates, so it must live inside the router: mounted beside `RouterProvider` it
          throws “useNavigate() may be used only in the context of a <Router> component” the moment a
          session exists, and React unmounts the whole interface. It is rendered by `ShellChrome`
          inside the router tree. */}
      <Toaster />
      <ConfirmDialogHost />
    </BootstrapGate>
  )
}

/**
 * The parts of the interface that need to be *inside* the router: the command palette, which navigates
 * to the record the operator picked. `Toaster` and `ConfirmDialogHost` render portals and stay outside
 * with the rest of the application chrome.
 */
function ShellChrome(): ReactNode {
  const session = useAppStore((state) => state.session)
  const locked = useAppStore((state) => state.locked)
  return session && !locked ? <CommandPalette /> : null
}

/** Runs the startup handshake and keeps global state (session, settings, events) up to date. */
function BootstrapGate({ children }: { children: ReactNode }): ReactNode {
  const [error, setError] = useState<string | null>(null)
  const [startup, setStartup] = useState<StartupState | null>(null)
  const [attempt, setAttempt] = useState(0)
  const setReady = useAppStore((state) => state.setReady)

  useEffect(() => {
    let active = true
    const controller = { cancelled: false }

    async function load(): Promise<void> {
      try {
        const bootstrap = await invoke('app.bootstrap', {})
        if (!active) return
        applyBootstrap(bootstrap)
      } catch (caught) {
        if (!active) return
        setError(caught instanceof Error ? caught.message : 'Dentiva Pro could not start.')
        /* The main process answers this channel even when it could not open the database. */
        try {
          const state = await invoke('app.startupState', {})
          if (active) setStartup(state)
        } catch {
          /* Leave the generic message in place. */
        }
      } finally {
        if (active && !controller.cancelled) setReady(true)
      }
    }

    void load()

    const unsubscribe = window.dentiva.on('app:message', (payload) => {
      toast(payload.kind, payload.message, payload.detail)
    })

    return () => {
      active = false
      controller.cancelled = true
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  if (error) {
    const recovery = startup?.mode === 'recovery'
    return (
      <div className="auth-layout">
        <div className="auth-card stack">
          <h1 className="auth-card__title">{recovery ? 'Dentiva Pro is in recovery mode' : 'Dentiva Pro could not start'}</h1>
          <p className="muted">{startup?.reason ?? error}</p>
          <p className="muted small">
            {recovery
              ? 'The clinic database could not be opened, so no record is available and nothing has been changed. Your files are still where they were: open the data folder below to copy them somewhere safe, or run a restore from a backup through your support contact. Restarting the application retries the normal start-up.'
              : 'Your data has not been changed. If the problem continues, open the log folder below and contact support with the files inside it.'}
          </p>
          <div className="row">
            <Button variant="primary" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void invoke('app.openDataFolder', { kind: recovery ? 'data' : 'logs' })
              }}
            >
              Open data folder
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void invoke('app.openDataFolder', { kind: 'logs' })
              }}
            >
              Open log folder
            </Button>
            <Button
              variant="tertiary"
              onClick={() => {
                void invoke('app.relaunch', {})
              }}
            >
              Restart Dentiva Pro
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

/** Applies a bootstrap payload to the global store. */
export function applyBootstrap(bootstrap: BootstrapResult): void {
  const store = useAppStore.getState()
  store.setActivation(bootstrap.activation)
  store.setSetupStatus(bootstrap.setup)
  store.setClinic(bootstrap.clinic)
  store.setBuild(bootstrap.build, bootstrap.machine)
  store.setMaintenanceMode(bootstrap.maintenanceMode)
  store.setStage(bootstrap.stage)
  if (bootstrap.settings) store.setSettings(bootstrap.settings)
  if (bootstrap.session) store.setSession(bootstrap.session)
}

/** Keeps the workspace reachable only for an authenticated, unlocked session. */
function SessionGate(): ReactNode {
  const stage = useAppStore((state) => state.stage)
  const session = useAppStore((state) => state.session)
  const locked = useAppStore((state) => state.locked)
  const setLocked = useAppStore((state) => state.setLocked)
  const setSession = useAppStore((state) => state.setSession)
  const navigate = useNavigate()
  const location = useLocation()

  const needsPasswordChange = session?.mustChangePassword === true

  useEffect(() => {
    void (async () => {
      try {
        const state = await invoke('session.state', {})
        if (state.session) setSession(state.session)
        setLocked(state.locked)
      } catch {
        /* The router will redirect to sign-in because no session is present. */
      }
    })()
  }, [setLocked, setSession])

  useEffect(() => {
    const unsubscribeLocked = window.dentiva.on('session:locked', () => {
      setLocked(true)
    })
    const unsubscribeUnlocked = window.dentiva.on('session:unlocked', () => {
      setLocked(false)
    })
    const unsubscribeEnded = window.dentiva.on('session:ended', () => {
      setSession(null)
      navigate('/login', { replace: true })
    })
    const unsubscribePermissions = window.dentiva.on('session:permissions-changed', () => {
      void (async () => {
        try {
          const summary = await invoke('session.refresh', {})
          setSession(summary)
          toast('info', 'Your access rights were updated')
        } catch {
          /* A failed refresh leaves the previous permission set in place; the main process still enforces. */
        }
      })()
    })
    return () => {
      unsubscribeLocked()
      unsubscribeUnlocked()
      unsubscribeEnded()
      unsubscribePermissions()
    }
  }, [navigate, setLocked, setSession])

  // Idle activity ping: keeps the main-process idle clock honest while the operator is working.
  useEffect(() => {
    let last = 0
    const onActivity = (): void => {
      const now = Date.now()
      if (now - last < 60_000) return
      last = now
      void invoke('session.touch', {})
    }
    for (const event of ['pointerdown', 'keydown', 'wheel'] as const) {
      window.addEventListener(event, onActivity, { passive: true })
    }
    return () => {
      for (const event of ['pointerdown', 'keydown', 'wheel'] as const) {
        window.removeEventListener(event, onActivity)
      }
    }
  }, [])

  if (stage === 'activation') return <Navigate to="/activation" replace />
  if (stage === 'setup') return <Navigate to="/setup" replace />
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (locked) return <Navigate to="/lock" replace />
  if (needsPasswordChange && location.pathname !== '/account/password') {
    return <Navigate to="/account/password" replace />
  }
  return <Outlet />
}

/** Route-level permission gate. Menu entries are also filtered, but this is the enforcement point. */
function PermissionRoute({ permission, children }: { permission: string | string[], children: ReactNode }): ReactNode {
  const allowed = usePermission(permission)
  if (!allowed) return <PermissionDenied />
  return <>{children}</>
}
