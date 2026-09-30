import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_IDS, type EventId } from '@shared/events'

/**
 * The only bridge between the renderer (untrusted) and the main process.
 *
 * The renderer cannot import Node modules, cannot access the filesystem and cannot address Electron
 * APIs directly: everything goes through `invoke`, which the main process validates, authorises and
 * audits. Event subscriptions are restricted to the allowlisted ids in `@shared/events`.
 */

const IPC_INVOKE = 'dentiva:invoke'
const IPC_EVENT = 'dentiva:event'

export interface DentivaBridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>
  on(event: EventId, listener: (payload: unknown) => void): () => void
  platform: string
  versions: { app: string, electron: string, chromium: string, node: string }
}

const bridge: DentivaBridge = {
  invoke(channel, payload) {
    if (typeof channel !== 'string' || channel.length === 0 || channel.length > 64) {
      return Promise.resolve({ ok: false, error: { code: 'E_VALIDATION', message: 'Unsupported request.' } })
    }
    return ipcRenderer.invoke(IPC_INVOKE, channel, payload)
  },
  on(event, listener) {
    if (!(EVENT_IDS as readonly string[]).includes(event)) {
      throw new Error(`Unsupported event subscription: ${event}`)
    }
    const handler = (_event: unknown, eventName: string, payload: unknown): void => {
      if (eventName === event) listener(payload)
    }
    ipcRenderer.on(IPC_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC_EVENT, handler)
  },
  platform: process.platform,
  versions: {
    app: process.env.DENTIVA_APP_VERSION ?? '1.0.0',
    electron: process.versions.electron ?? '',
    chromium: process.versions.chrome ?? '',
    node: process.versions.node ?? ''
  }
}

contextBridge.exposeInMainWorld('dentiva', bridge)
