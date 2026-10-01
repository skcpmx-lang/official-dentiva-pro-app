import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { createHarness } from './helpers'
import { SCHEDULER_ACTOR, SYSTEM_ACTOR, assertPermission, createServiceContext } from '@main/context'
import { listBackups, runScheduledBackup } from '@main/backup/service'
import { getSettingSafe, setInternalSetting } from '@main/modules/settings/service'
import { listAudit } from '@main/modules/audit/service'

/**
 * The automatic backup timer.
 *
 * The application performs this work on its own behalf, with no operator present. `SYSTEM_ACTOR` exists
 * for activation, setup and recovery and is refused clinic data outright, so a scheduled backup running
 * as that actor never got past its first permission check — it failed silently into the log while the
 * settings screen promised automatic backups. These tests pin both halves: the system actor stays out of
 * clinic data, and the scheduler actor really produces a package, records the run and writes the audit
 * trail under its own name.
 */

function schedulerContext(harness: ReturnType<typeof createHarness>) {
  return createServiceContext({ db: harness.database.db, host: harness.host, actor: SCHEDULER_ACTOR, sessionId: 'scheduler' })
}

describe('automatic backup scheduler', () => {
  it('runs as the scheduler actor and not as the system actor', async () => {
    const harness = createHarness()
    try {
      const system = harness.systemCtx()
      const scheduler = schedulerContext(harness)

      /* The pre-authentication actor may not read clinic data at all. */
      expect(() => assertPermission(system, 'backups.create')).toThrowError(/permission/i)
      expect(() => assertPermission(scheduler, 'backups.create')).not.toThrow()

      /* Nothing has been written for the role: the scheduler holds exactly what it needs. */
      expect(SCHEDULER_ACTOR.userId).toBe(0)
      expect([...SCHEDULER_ACTOR.permissions]).toEqual(['backups.create'])
      expect(SYSTEM_ACTOR.permissions.size).toBe(0)
    } finally {
      harness.cleanup()
    }
  })

  it('creates the due package, remembers when it ran and records who ran it', async () => {
    const harness = createHarness()
    try {
      const ctx = schedulerContext(harness)
      setInternalSetting(ctx, 'backup.frequencyDays', '7')
      setInternalSetting(ctx, 'backup.lastRunAt', '')

      const result = await runScheduledBackup(ctx)
      expect(result.ran).toBe(true)
      expect(result.filePath).toBeDefined()
      expect(existsSync(result.filePath!)).toBe(true)

      const rows = listBackups(ctx)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.kind).toBe('auto')
      expect(getSettingSafe(ctx, 'backup.lastRunAt')).not.toBe('')

      const audit = listAudit(harness.ctx(), { module: 'backups', limit: 20, offset: 0 })
      expect(audit.entries.some((entry) => entry.username === 'scheduler' && entry.action.startsWith('backup.'))).toBe(true)

      /* The next tick inside the interval has nothing to do. */
      const again = await runScheduledBackup(ctx)
      expect(again.ran).toBe(false)
      expect(again.reason).toMatch(/not due/i)
      expect(listBackups(ctx)).toHaveLength(1)

      /* Turning the schedule off stops it, and a forced run still works. */
      setInternalSetting(ctx, 'backup.frequencyDays', '0')
      expect((await runScheduledBackup(ctx)).ran).toBe(false)
      expect((await runScheduledBackup(ctx, { force: true })).ran).toBe(true)
      expect(listBackups(ctx)).toHaveLength(2)
    } finally {
      harness.cleanup()
    }
  })

  it('refuses the scheduled path to an operator who does not hold the backup permission', async () => {
    const harness = createHarness()
    try {
      setInternalSetting(harness.ctx(), 'backup.frequencyDays', '7')
      const reception = harness.ctx(['patients.view'])
      await expect(runScheduledBackup(reception)).rejects.toThrowError(/permission/i)
    } finally {
      harness.cleanup()
    }
  })
})
