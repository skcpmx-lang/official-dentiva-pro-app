import { systemChannels } from './system'
import { practiceChannels } from './practice'

/**
 * The complete IPC channel registry. `CHANNELS` is the single source of truth for:
 *  · main-process input validation and output validation,
 *  · renderer-side typing of `window.dentiva.invoke(...)`,
 *  · the startup check that every declared channel has a handler.
 */
export const CHANNELS = {
  ...systemChannels,
  ...practiceChannels
} as const

export type ChannelId = keyof typeof CHANNELS
export type ChannelInput<C extends ChannelId> = import('zod').input<(typeof CHANNELS)[C]['input']>
export type ChannelOutput<C extends ChannelId> = import('zod').output<(typeof CHANNELS)[C]['output']>

export * from './system'
export * from './practice'
