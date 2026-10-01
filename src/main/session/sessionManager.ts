import { randomUUID } from 'node:crypto'
import type { Actor } from '@shared/permissions'

/**
 * Session registry (main process only).
 *
 * Sessions are keyed by the renderer's `webContents` id, so the renderer never has to (and never can)
 * claim an identity: the main process decides who is calling. Idle time is tracked here, which means
 * auto-lock cannot be defeated by manipulating the UI, and a locked session is refused at the IPC
 * router before any service runs.
 */

export interface SessionRecord {
  id: string
  webContentsId: number
  actor: Actor
  lockedAt: number | null
  createdAt: number
  lastActivityAt: number
  autoLockMs: number
  mustChangePassword: boolean
  /** Username remembered for the sign-in screen (never the password). */
  lastUsername: string | null
}

export interface SessionSummary {
  id: string
  userId: number
  username: string
  fullName: string
  roleCode: string
  permissions: string[]
  locked: boolean
  lastActivityAt: number
  autoLockMinutes: number
  mustChangePassword: boolean
}

export class SessionManager {
  private sessions = new Map<number, SessionRecord>()

  create(webContentsId: number, actor: Actor, options: { autoLockMs: number, mustChangePassword?: boolean, lastUsername?: string | null, now: number }): SessionRecord {
    const record: SessionRecord = {
      id: randomUUID(),
      webContentsId,
      actor,
      lockedAt: null,
      createdAt: options.now,
      lastActivityAt: options.now,
      autoLockMs: options.autoLockMs,
      mustChangePassword: options.mustChangePassword ?? false,
      lastUsername: options.lastUsername ?? null
    }
    this.sessions.set(webContentsId, record)
    return record
  }

  get(webContentsId: number): SessionRecord | undefined {
    return this.sessions.get(webContentsId)
  }

  require(webContentsId: number): SessionRecord | undefined {
    return this.sessions.get(webContentsId)
  }

  touch(webContentsId: number, now: number): void {
    const session = this.sessions.get(webContentsId)
    if (session) session.lastActivityAt = now
  }

  lock(webContentsId: number, now: number): SessionRecord | undefined {
    const session = this.sessions.get(webContentsId)
    if (!session) return undefined
    session.lockedAt ??= now
    return session
  }

  unlock(webContentsId: number, now: number): SessionRecord | undefined {
    const session = this.sessions.get(webContentsId)
    if (!session) return undefined
    session.lockedAt = null
    session.lastActivityAt = now
    return session
  }

  destroy(webContentsId: number): SessionRecord | undefined {
    const session = this.sessions.get(webContentsId)
    this.sessions.delete(webContentsId)
    return session
  }

  isLocked(webContentsId: number): boolean {
    return Boolean(this.sessions.get(webContentsId)?.lockedAt)
  }

  setAutoLock(webContentsId: number, autoLockMs: number): void {
    const session = this.sessions.get(webContentsId)
    if (session) session.autoLockMs = autoLockMs
  }

  refreshActor(webContentsId: number, actor: Actor): void {
    const session = this.sessions.get(webContentsId)
    if (session) session.actor = actor
  }

  /** Sessions whose idle time exceeded their auto-lock timeout and that are not locked yet. */
  dueForLock(now: number): SessionRecord[] {
    const due: SessionRecord[] = []
    for (const session of this.sessions.values()) {
      if (session.lockedAt !== null) continue
      if (session.autoLockMs <= 0) continue
      if (now - session.lastActivityAt >= session.autoLockMs) due.push(session)
    }
    return due
  }

  summarize(webContentsId: number): SessionSummary | null {
    const session = this.sessions.get(webContentsId)
    if (!session) return null
    return {
      id: session.id,
      userId: session.actor.userId,
      username: session.actor.username,
      fullName: session.actor.fullName,
      roleCode: session.actor.roleCode,
      permissions: [...session.actor.permissions],
      locked: session.lockedAt !== null,
      lastActivityAt: session.lastActivityAt,
      autoLockMinutes: Math.round(session.autoLockMs / 60000),
      mustChangePassword: session.mustChangePassword
    }
  }

  all(): SessionRecord[] {
    return [...this.sessions.values()]
  }

  clear(): void {
    this.sessions.clear()
  }
}
