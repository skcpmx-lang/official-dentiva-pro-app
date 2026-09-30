/**
 * Per-user dashboard preferences.
 *
 * Shared so the dashboard (which renders the panels) and the preferences screen (which offers them)
 * cannot drift: a panel added here appears in both, and a stored value naming an unknown panel is
 * dropped rather than rendered as an empty card. Panels that need a permission are only offered to an
 * operator who holds it, and the dashboard checks again when it renders.
 */

export interface DashboardPanelDef {
  id: string
  label: string
  description: string
  /** Permission required to see the panel; `null` for panels every signed-in operator may see. */
  permission: string | null
}

export const DASHBOARD_PANELS: readonly DashboardPanelDef[] = [
  { id: 'kpis', label: 'Key figures', description: 'Money, patients and visits for the selected period.', permission: null },
  { id: 'collections', label: 'Collections', description: 'Payments received over the selected period.', permission: 'billing.view' },
  { id: 'schedule', label: "Today's schedule", description: 'Appointments booked for today.', permission: 'appointments.view' },
  { id: 'dentistLoad', label: 'Visits per dentist', description: 'Workload in the selected period.', permission: 'clinical.view' },
  { id: 'dues', label: 'Outstanding dues', description: 'Patients with an unpaid balance.', permission: 'billing.view' },
  { id: 'lowStock', label: 'Low stock', description: 'Items at or below their reorder level.', permission: 'inventory.view' },
  { id: 'expiring', label: 'Expiring batches', description: 'Batches that expire within the next 90 days.', permission: 'inventory.view' },
  { id: 'queue', label: 'Queue right now', description: 'Patients waiting and in treatment.', permission: 'queue.view' },
  { id: 'recent', label: 'Recently viewed', description: 'The records this login opened last.', permission: null },
  { id: 'activity', label: 'Recent activity', description: 'The latest recorded actions on this computer.', permission: 'audit.view' }
] as const

export const DASHBOARD_PANEL_IDS: readonly string[] = DASHBOARD_PANELS.map((panel) => panel.id)

export const DASHBOARD_RANGES = ['today', 'last7', 'last30', 'thisMonth'] as const
export type DashboardRange = (typeof DASHBOARD_RANGES)[number]

export const DENSITIES = ['comfortable', 'compact'] as const

/** A stored panel list, emptied of anything an older build may have written. */
export function sanitizePanelList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !DASHBOARD_PANEL_IDS.includes(entry) || seen.has(entry)) continue
    seen.add(entry)
    result.push(entry)
  }
  return result
}
