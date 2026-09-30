import { describe, expect, it } from 'vitest'
import { CHANNELS, type ChannelId } from '@shared/contracts'
import { createSystemHandlers } from '@main/ipc/handlers/system'
import { createPracticeHandlers } from '@main/ipc/handlers/practice'
import { createPatientHandlers } from '@main/ipc/handlers/patients'
import { createClinicalHandlers } from '@main/ipc/handlers/clinical'
import { createSchedulingHandlers } from '@main/ipc/handlers/scheduling'
import { createDashboardHandlers } from '@main/ipc/handlers/dashboard'
import type { HandlerDeps } from '@main/ipc/handlers/system'

/**
 * Contract completeness.
 *
 * The channel registry in `@shared/contracts` is the single source of truth for the IPC surface. A
 * channel without a handler would render a dead button in the interface, so the registry and the
 * handler maps are checked against each other here as well as at application start.
 *
 * The dependencies below are never executed: handler factories only capture them, so a structural stub
 * is enough to enumerate the channels they serve.
 */

function stubDeps(): HandlerDeps {
  return {
    db: {} as HandlerDeps['db'],
    host: {} as HandlerDeps['host'],
    sessions: {} as HandlerDeps['sessions'],
    invalidateActor: () => undefined,
    broadcast: () => undefined,
    refreshAutoLock: () => undefined,
    isMaintenanceMode: () => false,
    relaunch: () => undefined
  }
}

function collectHandlers(): Set<string> {
  const deps = stubDeps()
  const maps = [
    createSystemHandlers(deps),
    createPracticeHandlers(deps),
    createPatientHandlers(deps),
    createClinicalHandlers(deps),
    createSchedulingHandlers(deps),
    createDashboardHandlers()
  ]
  const keys = new Set<string>()
  for (const map of maps) {
    for (const key of Object.keys(map)) {
      if (keys.has(key)) throw new Error(`Channel “${key}” is registered by more than one handler map.`)
      keys.add(key)
    }
  }
  return keys
}

describe('IPC channel registry', () => {
  it('declares a handler for every channel and no handler for an undeclared channel', () => {
    const declared = Object.keys(CHANNELS) as ChannelId[]
    const handled = collectHandlers()

    const missingHandlers = declared.filter((channel) => !handled.has(channel))
    const undeclaredHandlers = [...handled].filter((channel) => !(channel in CHANNELS))

    expect(missingHandlers, `channels without handlers: ${missingHandlers.join(', ')}`).toEqual([])
    expect(undeclaredHandlers, `handlers without a declared channel: ${undeclaredHandlers.join(', ')}`).toEqual([])
  })

  it('keeps channel names in the documented namespace form', () => {
    for (const channel of Object.keys(CHANNELS)) {
      expect(channel).toMatch(/^[a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z.]*$/)
    }
  })

  it('groups clinical channels under their documented namespaces', () => {
    const clinical = Object.keys(CHANNELS).filter((channel) => channel.startsWith('treatments.'))
    expect(clinical).toContain('treatments.list')
    expect(clinical).toContain('treatments.save')
    expect(clinical).toContain('treatments.archive')

    const visits = Object.keys(CHANNELS).filter((channel) => channel.startsWith('visits.'))
    expect(visits).toEqual(
      expect.arrayContaining([
        'visits.list',
        'visits.get',
        'visits.save',
        'visits.setStatus',
        'visits.delete',
        'visits.export',
        'visits.treatments.add',
        'visits.treatments.update',
        'visits.treatments.remove',
        'visits.findings.set'
      ])
    )

    const chart = Object.keys(CHANNELS).filter((channel) => channel.startsWith('chart.'))
    expect(chart).toEqual(expect.arrayContaining(['chart.get', 'chart.setEntry', 'chart.removeEntry', 'chart.history', 'chart.conditions', 'chart.saveCondition']))

    const appointments = Object.keys(CHANNELS).filter((channel) => channel.startsWith('appointments.'))
    expect(appointments).toEqual(
      expect.arrayContaining([
        'appointments.list',
        'appointments.day',
        'appointments.get',
        'appointments.save',
        'appointments.setStatus',
        'appointments.reschedule',
        'appointments.delete',
        'appointments.upcoming',
        'appointments.slots'
      ])
    )

    const queue = Object.keys(CHANNELS).filter((channel) => channel.startsWith('queue.'))
    expect(queue).toEqual(expect.arrayContaining(['queue.board', 'queue.add', 'queue.setStatus', 'queue.remove']))

    const prescriptions = Object.keys(CHANNELS).filter((channel) => channel.startsWith('prescriptions.'))
    expect(prescriptions).toEqual(
      expect.arrayContaining([
        'prescriptions.list',
        'prescriptions.get',
        'prescriptions.save',
        'prescriptions.delete',
        'prescriptions.duplicate',
        'prescriptions.medicines',
        'prescriptions.adviceLibrary',
        'prescriptions.templates.list',
        'prescriptions.templates.save',
        'prescriptions.templates.delete',
        'prescriptions.templates.apply',
        'prescriptions.export'
      ])
    )
  })
})
