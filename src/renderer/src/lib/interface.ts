/**
 * Interface settings.
 *
 * `ui.density` and `ui.reducedMotion` are clinic settings, so they are applied to the document root
 * where the design tokens read them (`tokens.css` defines the compact row height and the zeroed motion
 * durations on `[data-density='compact']` / `[data-reduced-motion='true']`). `ui.sidebarCollapsed` and
 * `ui.landingPage` are applied at the points where they mean something: the first render of the shell
 * and the navigation that follows a sign-in. Keeping the mapping here means a setting can never be
 * displayed in Settings without being effective somewhere.
 */

export type LandingPage = 'dashboard' | 'appointments' | 'queue' | 'patients'

const LANDING_ROUTES: Record<LandingPage, string> = {
  dashboard: '/',
  appointments: '/appointments',
  queue: '/queue',
  patients: '/patients'
}

/** Route opened after a successful sign-in or unlock. Unknown or missing values fall back to the dashboard. */
export function landingRoute(settings: Record<string, string>): string {
  const value = settings['ui.landingPage']
  return LANDING_ROUTES[(value as LandingPage) ?? 'dashboard'] ?? '/'
}

/** Applies the display settings to the document root. Safe to call before the first paint. */
export function applyInterfaceSettings(settings: Record<string, string>): void {
  const root = document.documentElement
  root.dataset.density = settings['ui.density'] === 'compact' ? 'compact' : 'comfortable'
  root.dataset.reducedMotion = settings['ui.reducedMotion'] === 'true' ? 'true' : 'false'
}

/** Whether the shell should start with the sidebar collapsed. */
export function startsCollapsed(settings: Record<string, string>): boolean {
  return settings['ui.sidebarCollapsed'] === 'true'
}
