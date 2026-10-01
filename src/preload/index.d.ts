import type { ChannelId, ChannelInput, ChannelOutput } from '@shared/contracts'
import type { Envelope } from '@shared/errors'
import type { EventId, EventPayloads } from '@shared/events'

/**
 * Renderer-facing typing of the preload bridge. The renderer only ever sees a typed `invoke` and a
 * typed event subscription; there is no path from the UI to Electron or Node APIs.
 */
export interface DentivaBridge {
  invoke<C extends ChannelId>(channel: C, payload: ChannelInput<C>): Promise<Envelope<ChannelOutput<C>>>
  on<E extends EventId>(event: E, listener: (payload: EventPayloads[E]) => void): () => void
  platform: string
  versions: { app: string, electron: string, chromium: string, node: string }
}

declare global {
  interface Window {
    dentiva: DentivaBridge
  }
}

export {}
