import type { ServiceContext } from '../../context'
import { AppError, validationError } from '@shared/errors'
import { DASHBOARD_RANGES, sanitizePanelList } from '@shared/preferences'
import { NOTIFICATION_TYPE_VALUES } from '@shared/notifications'

/**
 * Per-user interface preferences: dashboard layout, table density and recently viewed records.
 *
 * These are presentation-only and never influence permissions or business rules. Values are validated
 * against the catalogue in `@shared/preferences` before they are stored, so a mistyped key or an
 * impossible value is refused loudly instead of being stored and silently ignored — a control that
 * appears to work but does nothing is exactly what the specification forbids. Only preferences the
 * application actually honours are accepted here; a key nothing reads is refused like any other typo.
 */

export const RECENT_KINDS = ['patient', 'invoice', 'prescription'] as const
export type RecentKind = (typeof RECENT_KINDS)[number]

const RECENT_LIMIT = 12

interface PreferenceRule {
  validate(value: string): string
}

function jsonArray(value: string, key: string): unknown[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed
  } catch {
    throw validationError(`“${key}” must be a list.`)
  }
}

const RULES: Record<string, PreferenceRule> = {
  'dashboard.range': {
    validate: (value) => {
      if (!(DASHBOARD_RANGES as readonly string[]).includes(value)) {
        throw validationError('Choose one of the offered dashboard periods.')
      }
      return value
    }
  },
  'dashboard.panels': {
    validate: (value) => {
      const panels = sanitizePanelList(jsonArray(value, 'dashboard.panels'))
      if (panels.length === 0) throw validationError('Keep at least one dashboard panel.')
      return JSON.stringify(panels)
    }
  },
  'notifications.muted': {
    validate: (value) => {
      const muted = jsonArray(value, 'notifications.muted').filter(
        (entry): entry is string => typeof entry === 'string' && NOTIFICATION_TYPE_VALUES.includes(entry)
      )
      return JSON.stringify([...new Set(muted)])
    }
  }
}

for (const kind of RECENT_KINDS) {
  RULES[`recent.${kind}`] = {
    validate: (value) => {
      const ids = jsonArray(value, `recent.${kind}`).filter((entry): entry is number => Number.isInteger(entry) && (entry as number) > 0)
      return JSON.stringify([...new Set(ids)].slice(0, RECENT_LIMIT))
    }
  }
}

export function getPreferences(ctx: ServiceContext): Record<string, string> {
  if (ctx.actor.userId === 0) return {}
  const rows = ctx.db.prepare('SELECT key, value FROM user_preferences WHERE user_id = ?').all(ctx.actor.userId) as Array<{
    key: string
    value: string
  }>
  return Object.fromEntries(rows.map((row) => [row.key, row.value]))
}

export function setPreferences(ctx: ServiceContext, values: Record<string, string>): void {
  if (ctx.actor.userId === 0) return
  const cleaned: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    const rule = RULES[key]
    if (!rule) {
      throw new AppError('E_VALIDATION', `“${key}” is not a preference Dentiva Pro stores.`, { fieldErrors: { [key]: 'Unknown preference.' } })
    }
    cleaned[key] = rule.validate(String(value).slice(0, 2000))
  }
  const upsert = ctx.db.prepare(
    `INSERT INTO user_preferences (user_id, key, value) VALUES (@userId, @key, @value)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  )
  const run = ctx.db.transaction(() => {
    for (const [key, value] of Object.entries(cleaned)) upsert.run({ userId: ctx.actor.userId, key, value })
  })
  run()
}

/** Notification types this operator asked not to see in the bell, in the bell's own vocabulary. */
export function mutedNotificationTypes(ctx: ServiceContext): string[] {
  const raw = getPreferences(ctx)['notifications.muted']
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((entry): entry is string => typeof entry === 'string' && NOTIFICATION_TYPE_VALUES.includes(entry))
  } catch {
    return []
  }
}

export function recordRecentlyViewed(ctx: ServiceContext, kind: RecentKind, id: number): void {
  if (ctx.actor.userId === 0) return
  const key = `recent.${kind}`
  const existing = ctx.db.prepare('SELECT value FROM user_preferences WHERE user_id = ? AND key = ?').get(ctx.actor.userId, key) as
    | { value: string }
    | undefined
  let list: number[] = []
  try {
    const parsed = existing ? (JSON.parse(existing.value) as unknown) : []
    if (Array.isArray(parsed)) list = parsed.filter((entry): entry is number => typeof entry === 'number')
  } catch {
    list = []
  }
  const next = [id, ...list.filter((entry) => entry !== id)].slice(0, RECENT_LIMIT)
  ctx.db
    .prepare(
      `INSERT INTO user_preferences (user_id, key, value) VALUES (@userId, @key, @value)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
    )
    .run({ userId: ctx.actor.userId, key, value: JSON.stringify(next) })
}

export function getRecentlyViewed(ctx: ServiceContext, kind: RecentKind): number[] {
  const prefs = getPreferences(ctx)
  const raw = prefs[`recent.${kind}`]
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is number => typeof entry === 'number') : []
  } catch {
    return []
  }
}

export interface RecentEntry {
  kind: RecentKind
  id: number
  title: string
  subtitle: string | null
  route: string
}

/**
 * The operator's recently viewed records, newest first, resolved to something the dashboard can render.
 *
 * A record the operator may no longer open (the permission changed, or the row was deleted) is dropped
 * rather than shown as a dead link. Order is kept across kinds by the sequence in which each kind's list
 * was written, so the newest three of each kind are enough to fill a dashboard card.
 */
export function listRecentlyViewed(ctx: ServiceContext, limit: number): RecentEntry[] {
  const entries: RecentEntry[] = []
  const permissions = ctx.actor.permissions

  if (permissions.has('patients.view')) {
    for (const id of getRecentlyViewed(ctx, 'patient').slice(0, limit)) {
      const row = ctx.db
        .prepare('SELECT id, code, full_name AS fullName FROM patients WHERE id = ? AND is_deleted = 0')
        .get(id) as { id: number, code: string, fullName: string } | undefined
      if (row) entries.push({ kind: 'patient', id: row.id, title: row.fullName, subtitle: row.code, route: `/patients/${row.id}` })
    }
  }

  if (permissions.has('billing.view')) {
    for (const id of getRecentlyViewed(ctx, 'invoice').slice(0, limit)) {
      const row = ctx.db
        .prepare(
          `SELECT i.id, i.invoice_no AS invoiceNo, p.full_name AS patientName
             FROM invoices i JOIN patients p ON p.id = i.patient_id
            WHERE i.id = ? AND i.is_deleted = 0`
        )
        .get(id) as { id: number, invoiceNo: string, patientName: string } | undefined
      if (row) {
        entries.push({
          kind: 'invoice',
          id: row.id,
          title: `${row.invoiceNo} · ${row.patientName}`,
          subtitle: null,
          route: `/invoices/${row.id}`
        })
      }
    }
  }

  if (permissions.has('prescriptions.view')) {
    for (const id of getRecentlyViewed(ctx, 'prescription').slice(0, limit)) {
      const row = ctx.db
        .prepare(
          `SELECT rx.id, rx.rx_no AS rxNo, p.full_name AS patientName
             FROM prescriptions rx JOIN patients p ON p.id = rx.patient_id
            WHERE rx.id = ? AND rx.is_deleted = 0`
        )
        .get(id) as { id: number, rxNo: string, patientName: string } | undefined
      if (row) {
        entries.push({
          kind: 'prescription',
          id: row.id,
          title: `${row.rxNo} · ${row.patientName}`,
          subtitle: null,
          route: `/prescriptions/${row.id}`
        })
      }
    }
  }

  return entries.slice(0, limit)
}
