import { create } from 'zustand'
import type { ActivationState, BootstrapResult, ClinicProfile, SessionSummary, SetupStatus } from '../lib/types'

/**
 * Renderer state.
 *
 * This store mirrors what the main process tells us — it never grants anything. Permissions come from
 * the session summary that the main process derives from the database, and every privileged action is
 * re-checked on the other side of the bridge.
 */

export type Stage = 'activation' | 'setup' | 'login' | 'ready'
export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  message?: string
  action?: { label: string, run(): void }
}

interface AppState {
  ready: boolean
  stage: Stage
  build: BootstrapResult['build'] | null
  machine: BootstrapResult['machine'] | null
  clinic: ClinicProfile | null
  activation: ActivationState | null
  setupStatus: SetupStatus | null
  session: SessionSummary | null
  settings: Record<string, string>
  maintenanceMode: boolean
  locked: boolean
  sidebarCollapsed: boolean
  commandPaletteOpen: boolean
  toasts: Toast[]

  setReady(value: boolean): void
  setStage(stage: Stage): void
  setBuild(build: BootstrapResult['build'], machine: BootstrapResult['machine']): void
  setClinic(clinic: ClinicProfile | null): void
  setActivation(activation: ActivationState | null): void
  setSetupStatus(status: SetupStatus | null): void
  setSession(session: SessionSummary | null): void
  setSettings(settings: Record<string, string>): void
  mergeSettings(values: Record<string, string>): void
  setMaintenanceMode(value: boolean): void
  setLocked(value: boolean): void
  setSidebarCollapsed(value: boolean): void
  toggleSidebar(): void
  setCommandPaletteOpen(value: boolean): void
  pushToast(toast: Omit<Toast, 'id'> & { id?: string }): string
  dismissToast(id: string): void
  hasPermission(code: string | string[]): boolean
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  stage: 'activation',
  build: null,
  machine: null,
  clinic: null,
  activation: null,
  setupStatus: null,
  session: null,
  settings: {},
  maintenanceMode: false,
  locked: false,
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  toasts: [],

  setReady: (value) => set({ ready: value }),
  setStage: (stage) => set({ stage }),
  setBuild: (build, machine) => set({ build, machine }),
  setClinic: (clinic) => set({ clinic }),
  setActivation: (activation) => set({ activation }),
  setSetupStatus: (setupStatus) => set({ setupStatus }),
  setSession: (session) => set({ session, locked: session ? session.locked : false }),
  setSettings: (settings) => set((state) => ({ settings: { ...state.settings, ...settings } })),
  mergeSettings: (values) => set((state) => ({ settings: { ...state.settings, ...values } })),
  setMaintenanceMode: (value) => set({ maintenanceMode: value }),
  setLocked: (value) => set({ locked: value }),
  setSidebarCollapsed: (value) => set({ sidebarCollapsed: value }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setCommandPaletteOpen: (value) => set({ commandPaletteOpen: value }),
  pushToast: (toast) => {
    const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    // Keep at most four toasts on screen: an operator should never lose the workspace behind messages.
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }))
    return id
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  hasPermission: (code) => {
    const session = get().session
    if (!session) return false
    const codes = Array.isArray(code) ? code : [code]
    return codes.some((entry) => session.permissions.includes(entry))
  }
}))

/* ------------------------------------------------------------------ selectors */

export function usePermission(code: string | string[]): boolean {
  return useAppStore((state) => {
    const session = state.session
    if (!session) return false
    const codes = Array.isArray(code) ? code : [code]
    return codes.some((entry) => session.permissions.includes(entry))
  })
}

export function useAnyPermission(codes: string[]): boolean {
  return useAppStore((state) => {
    const session = state.session
    if (!session) return false
    return codes.some((entry) => session.permissions.includes(entry))
  })
}

export function useSession(): SessionSummary | null {
  return useAppStore((state) => state.session)
}

export function useSetting(key: string, fallback = ''): string {
  return useAppStore((state) => state.settings[key] ?? fallback)
}

export function useSettings(): Record<string, string> {
  return useAppStore((state) => state.settings)
}

export function useClinic(): ClinicProfile | null {
  return useAppStore((state) => state.clinic)
}

/** Discard everything that belongs to the signed-in operator (used on sign-out). */
export function clearSessionState(): void {
  useAppStore.setState({ session: null, locked: false, commandPaletteOpen: false })
}
