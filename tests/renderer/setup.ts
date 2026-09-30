import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import type { ChannelId, ChannelInput, ChannelOutput } from '@shared/contracts'
import type { Envelope } from '@shared/errors'
import type { EventId, EventPayloads } from '@shared/events'

/**
 * Renderer test environment.
 *
 * The renderer only ever talks to the main process through `window.dentiva`; tests install a controllable
 * fake bridge so a screen can be exercised without Electron. Handlers are registered per channel and any
 * unhandled channel rejects loudly, which keeps the tests honest — a screen that calls an unexpected
 * channel fails instead of silently rendering stale data.
 */

type Handler<C extends ChannelId> = (payload: ChannelInput<C>) => ChannelOutput<C> | Promise<ChannelOutput<C>>

const handlers = new Map<string, (payload: unknown) => unknown>()
const listeners = new Map<string, Set<(payload: unknown) => void>>()

export const callLog: Array<{ channel: string, payload: unknown }> = []

export function mockChannel<C extends ChannelId>(channel: C, handler: Handler<C>): void {
  handlers.set(channel, handler as (payload: unknown) => unknown)
}

export function mockChannels(entries: Partial<{ [C in ChannelId]: Handler<C> }>): void {
  for (const [channel, handler] of Object.entries(entries)) {
    handlers.set(channel, handler as (payload: unknown) => unknown)
  }
}

export function resetBridge(): void {
  handlers.clear()
  listeners.clear()
  callLog.length = 0
}

export function emitEvent<E extends EventId>(event: E, payload: EventPayloads[E]): void {
  for (const listener of listeners.get(event) ?? []) listener(payload)
}

const bridge = {
  invoke: async <C extends ChannelId>(channel: C, payload: ChannelInput<C>): Promise<Envelope<ChannelOutput<C>>> => {
    callLog.push({ channel, payload })
    const handler = handlers.get(channel)
    if (!handler) {
      throw new Error(`The renderer test called the unmocked channel “${channel}”. Register it with mockChannel().`)
    }
    const data = await handler(payload)
    return { ok: true, data } as Envelope<ChannelOutput<C>>
  },
  on: <E extends EventId>(event: E, listener: (payload: EventPayloads[E]) => void): (() => void) => {
    const set = listeners.get(event) ?? new Set()
    set.add(listener as (payload: unknown) => void)
    listeners.set(event, set)
    return () => set.delete(listener as (payload: unknown) => void)
  },
  platform: 'win32',
  versions: { app: '1.0.0', electron: '44.5.1', chromium: '144.0.0.0', node: '24.0.0' }
}

Object.defineProperty(window, 'dentiva', { value: bridge, writable: true, configurable: true })

/* --------------------------------------------------------------- browser shims */

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn()
  })
})

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverStub, writable: true })

Object.defineProperty(globalThis, 'IntersectionObserver', {
  writable: true,
  value: class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): [] {
      return []
    }
  }
})

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn(async () => undefined), readText: vi.fn(async () => '') }
})

// html2canvas-style APIs are not used, but charts query the SVG size; jsdom reports zero, so give it one.
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, value: 800 })
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, value: 400 })
Object.defineProperty(Element.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({ x: 0, y: 0, width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, toJSON: () => ({}) })
})

window.scrollTo = vi.fn()

afterEach(() => {
  cleanup()
  resetBridge()
})
