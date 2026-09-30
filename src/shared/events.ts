/**
 * Push events (main → renderer). The renderer may only subscribe to the ids listed here; anything else
 * is refused by the preload bridge.
 */
export const EVENT_IDS = [
  'session:locked',
  'session:unlocked',
  'session:ended',
  'session:permissions-changed',
  'notifications:changed',
  'data:changed',
  'backup:progress',
  'print:progress',
  'app:message'
] as const

export type EventId = (typeof EVENT_IDS)[number]

export interface EventPayloads {
  'session:locked': { at: number }
  'session:unlocked': { at: number }
  'session:ended': { reason: 'logout' | 'shutdown' | 'session-expired' }
  'session:permissions-changed': { userId: number }
  'notifications:changed': { unread: number }
  'data:changed': { module: string, entity?: string, action?: string }
  'backup:progress': { operation: string, phase: string, percent: number, message?: string }
  'print:progress': { documentType: string, phase: 'preparing' | 'printing' | 'pdf' | 'done' | 'failed', message?: string }
  'app:message': { kind: 'info' | 'warning' | 'error', message: string, detail?: string }
}
