import { z } from 'zod'
import type { Db } from '../db/connection'
import type { HostServices } from '../platform/types'
import { AppError, describeErrorForLog, toSerializedError, type Envelope } from '@shared/errors'
import { isAllowedWhileLocked, isPublicChannel, zodMessage } from '@shared/ipc'
import { CHANNELS, type ChannelId } from '@shared/contracts'
import { createAuditWriter, createServiceContext, type ServiceContext } from '../context'
import { SessionManager } from '../session/sessionManager'
import { deriveActor } from '../modules/auth/actor'
import { isActivated } from '../activation/service'
import type { Actor } from '@shared/permissions'

export type Handler<I, O> = (ctx: ServiceContext, input: I) => O | Promise<O>

export type HandlerMap = {
  /** Handlers receive the *parsed* payload: defaults applied, unknown keys stripped, types narrowed. */
  [C in ChannelId]: (ctx: ServiceContext, input: z.output<(typeof CHANNELS)[C]['input']>) => unknown | Promise<unknown>
}

export type PartialHandlerMap = Partial<HandlerMap>

export interface RouterDependencies {
  db: Db
  host: HostServices
  sessions: SessionManager
  /** Called when the renderer must be told something (lock, permission refresh, data changed). */
  emit?: (webContentsId: number, event: string, payload: unknown) => void
  /**
   * True while a restore is replacing the database. Every non-public channel outside the backup
   * namespace is refused so a second window cannot write into a database that is being swapped.
   */
  isMaintenanceMode?: () => boolean
}

/** Small TTL cache for actors so a burst of IPC calls does not re-derive permissions repeatedly. */
class ActorCache {
  private entries = new Map<number, { actor: Actor, at: number }>()
  constructor(private readonly ttlMs: number) {}

  get(userId: number, now: number): Actor | null {
    const entry = this.entries.get(userId)
    if (!entry) return null
    if (now - entry.at > this.ttlMs) {
      this.entries.delete(userId)
      return null
    }
    return entry.actor
  }

  set(userId: number, actor: Actor, now: number): void {
    this.entries.set(userId, { actor, at: now })
  }

  invalidate(userId?: number): void {
    if (userId === undefined) this.entries.clear()
    else this.entries.delete(userId)
  }
}

export class IpcRouter {
  private handlers = new Map<ChannelId, HandlerMap[ChannelId]>()
  private readonly actorCache = new ActorCache(2000)

  constructor(private readonly deps: RouterDependencies) {}

  register(map: PartialHandlerMap): void {
    for (const [channelId, handler] of Object.entries(map)) {
      if (!handler) continue
      this.handlers.set(channelId as ChannelId, handler as HandlerMap[ChannelId])
    }
  }

  /** Startup verification: every declared channel must be implemented. */
  missingChannels(): ChannelId[] {
    return (Object.keys(CHANNELS) as ChannelId[]).filter((channelId) => !this.handlers.has(channelId))
  }

  invalidateActor(userId?: number): void {
    this.actorCache.invalidate(userId)
  }

  private actorFor(userId: number, now: number): Actor {
    const cached = this.actorCache.get(userId, now)
    if (cached) return cached
    const actor = deriveActor(this.deps.db, userId)
    this.actorCache.set(userId, actor, now)
    return actor
  }

  async handle(webContentsId: number, channelId: string, rawInput: unknown): Promise<Envelope<unknown>> {
    const { db, host, sessions } = this.deps
    const now = host.now()
    const def = (CHANNELS as Record<string, { input: z.ZodTypeAny, output: z.ZodTypeAny } | undefined>)[channelId]

    try {
      if (!def) throw new AppError('E_UNSUPPORTED', 'This action is not available in this version of Dentiva Pro.', { detail: { channelId } })
      const handler = this.handlers.get(channelId as ChannelId)
      if (!handler) throw new AppError('E_UNSUPPORTED', 'This action is not available in this version of Dentiva Pro.', { detail: { channelId } })

      const publicChannel = isPublicChannel(channelId)
      if (this.deps.isMaintenanceMode?.() && !publicChannel && !channelId.startsWith('backups.')) {
        throw new AppError('E_STATE', 'The clinic data is being restored. Please wait — this window will refresh when the restore finishes.')
      }
      const session = sessions.get(webContentsId)

      if (!publicChannel && !session) throw new AppError('E_UNAUTHENTICATED', 'Your session has ended. Please sign in again.')

      if (session) {
        if (session.lockedAt !== null && !isAllowedWhileLocked(channelId)) {
          throw new AppError('E_LOCKED', 'The application is locked. Enter your password to continue.')
        }
        if (!isAllowedWhileLocked(channelId)) sessions.touch(webContentsId, now)
      }

      const activationRequired = !isPublicChannel(channelId) && !isActivated(db)
      if (activationRequired) {
        throw new AppError('E_LICENSE', 'Dentiva Pro has not been activated on this computer.')
      }

      const parsedInput = def.input.safeParse(rawInput ?? {})
      if (!parsedInput.success) {
        const { message, fieldErrors } = zodMessage(parsedInput.error)
        throw new AppError('E_VALIDATION', message, { fieldErrors, detail: { channelId } })
      }

      const actor = session ? this.actorFor(session.actor.userId, now) : undefined
      if (session && actor) session.actor = actor

      const ctx = createServiceContext({
        db,
        host,
        actor: actor ?? {
          userId: 0,
          username: 'system',
          fullName: 'System',
          roleId: 0,
          roleCode: 'system',
          permissions: new Set<string>(),
          maxDiscountBasisPoints: null
        },
        sessionId: session?.id ?? 'public',
        webContentsId,
        audit: createAuditWriter(db, actor ?? {
          userId: 0,
          username: 'system',
          fullName: 'System',
          roleId: 0,
          roleCode: 'system',
          permissions: new Set<string>(),
          maxDiscountBasisPoints: null
        }, session?.id ?? 'public', () => host.now())
      })

      const result = await handler(ctx, parsedInput.data as never)
      const parsedOutput = def.output.safeParse(result)
      if (!parsedOutput.success) {
        host.logger.error('IPC output failed validation', new Error(parsedOutput.error.message), { channelId })
        throw new AppError('E_INTERNAL', 'The action completed but its result could not be displayed. Please reopen the screen.')
      }
      return { ok: true, data: parsedOutput.data }
    } catch (error) {
      const serialized = toSerializedError(error)
      if (!(error instanceof AppError)) {
        host.logger.error(`IPC failure on ${channelId}`, error, { channelId, webContentsId })
      } else if (error.code === 'E_INTERNAL' || error.code === 'E_DB') {
        host.logger.warn(`IPC error ${error.code} on ${channelId}: ${error.message}`, { detail: error.detail })
      }
      return { ok: false, error: serialized }
    }
  }

  describeFailure(channelId: string, error: unknown): string {
    return `[${channelId}] ${describeErrorForLog(error)}`
  }
}
