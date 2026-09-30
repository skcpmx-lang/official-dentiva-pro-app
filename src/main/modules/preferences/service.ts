import type { ServiceContext } from '../../context'

/**
 * Per-user interface preferences (dashboard layout, table density, recently viewed items).
 * These are presentation-only and never influence permissions or business rules.
 */

const ALLOWED_PREFIXES = ['ui.', 'dashboard.', 'recent.']

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
  const upsert = ctx.db.prepare(
    `INSERT INTO user_preferences (user_id, key, value) VALUES (@userId, @key, @value)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
  )
  const run = ctx.db.transaction(() => {
    for (const [key, value] of Object.entries(values)) {
      if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
      upsert.run({ userId: ctx.actor.userId, key, value: String(value).slice(0, 2000) })
    }
  })
  run()
}

export function recordRecentlyViewed(ctx: ServiceContext, kind: 'patient' | 'invoice' | 'prescription', id: number): void {
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
  const next = [id, ...list.filter((entry) => entry !== id)].slice(0, 12)
  ctx.db
    .prepare(
      `INSERT INTO user_preferences (user_id, key, value) VALUES (@userId, @key, @value)
       ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`
    )
    .run({ userId: ctx.actor.userId, key, value: JSON.stringify(next) })
}

export function getRecentlyViewed(ctx: ServiceContext, kind: 'patient' | 'invoice' | 'prescription'): number[] {
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
