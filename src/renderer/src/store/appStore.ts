import { create } from 'zustand'
import type { SessionSummary } from '@shared/contracts'
import type { ClinicProfile } from '@shared/contracts'

/**
 * Renderer-side application state: the current session (mirrored from the main process), clinic
 * profile, settings, interface preferences, toasts and the notification badge count.
 *
 * Nothing here is authoritative: permissions come from the session summary, which the main process
 * derives from the database. Clearing this store cannot grant access to anything.
 */

export type ToastKind = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id: string
  kind: ToastKind
  title: string
  message?: string
  action?: { label: string, run: () => void }
}

export interface NotificationSummary {
  unread: number
  critical: number
}

interface AppState {
  session: SessionSummary | null
  clinic: ClinicProfile | null
  settings: Record<string, string>
  preferences: Record<string, string>
  ready: boolean
  locked: boolean
  maintenanceMode: boolean
  sidebarCollapsed: boolean
  toasts: Toast[]
  notifications: NotificationSummary
  commandPaletteOpen: boolean
  setSession(session: SessionSummary | null): void
  setClinic(clinic: ClinicProfile | null): void
  setSettings(settings: Record<string, string>): void
  mergeSettings(values: Record<string, string>): void
  setPreferences(values: Record<string, string>): void
  setReady(ready: boolean): void
  setLocked(locked: boolean): void
  setMaintenanceMode(value: boolean): void
  setSidebarCollapsed(collapsed: boolean): void
  toggleSidebar(): void
  pushToast(toast: Omit<Toast, 'id'> & { id?: string }): string
  dismissToast(id: string): void
  setNotifications(summary: NotificationSummary): void
  setCommandPaletteOpen(open: boolean): void
  hasPermission(code: string | string[]): boolean
}

export const useAppStore = create<AppState>((set, get) => ({
  session: null,
  clinic: null,
  settings: {},
  preferences: {},
  ready: false,
  locked: false,
  maintenanceMode: false,
  sidebarCollapsed: false,
  toasts: [],
  notifications: { unread: 0, critical: 0 },
  commandPaletteOpen: false,

  setSession: (session) =>
    set((state) => ({
      session,
      locked: session ? session.locked : false
    })),
  setClinic: (clinic) => set({ clinic }),
  setSettings: (settings) => set({ settings }),
  mergeSettings: (values) => set((state) => ({ settings: { ...state.settings, ...values } })),
  setPreferences: (values) => set({ preferences: values }),
  setReady: (ready) => set({ ready }),
  setLocked: (locked) => set({ locked }),
  setMaintenanceMode: (value) => set({ maintenanceMode: value }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  pushToast: (toast) => {
    const id = toast.id ?? `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }].slice(-4) }))
    return id
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setNotifications: (summary) => set({ notifications: summary }),
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  hasPermission: (code) => {
    const session = get().session
    if (!session) return false
    const codes = Array.isArray(code) ? code : [code]
    return codes.some((entry) => session.permissions.includes(entry))
  }
}))

export function usePermission(code: string | string[]): boolean {
  return useAppStore((state) => {
    if (!state.session) return false
    const codes = Array.isArray(code) ? code : [code]
    return codes.some((entry) => state.session?.permissions.includes(entry))
  })
}

export function useSession(): SessionSummary | null {
  return useAppStore((state) => state.session)
}

export function useSettings(): Record<string, string> {
  return useAppStore((state) => state.settings)
}

export function useSetting(key: string, fallback = ''): string {
  return useAppStore((state) => state.settings[key] ?? fallback)
}
