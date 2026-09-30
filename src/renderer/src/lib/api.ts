import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChannelId, ChannelInput, ChannelOutput } from '@shared/contracts'
import type { ErrorCode, SerializedAppError } from '@shared/errors'

/**
 * Typed access to the main process.
 *
 * Every call goes through the preload bridge, which the main process validates and authorises.
 * Failures arrive as a serialised error with a stable `code`, a professional message and optional
 * field errors, so screens can render helpful recovery actions instead of raw stack traces.
 */

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly fieldErrors?: Record<string, string>

  constructor(serialized: SerializedAppError) {
    super(serialized.message)
    this.name = 'ApiError'
    this.code = serialized.code
    this.fieldErrors = serialized.fieldErrors
  }
}

export interface InvokeResultOptions {
  /** Suppress the global error toast (screens that render their own error state). */
  silent?: boolean
}

export async function invoke<C extends ChannelId>(
  channel: C,
  payload: ChannelInput<C>,
  _options: InvokeResultOptions = {}
): Promise<ChannelOutput<C>> {
  const envelope = (await window.dentiva.invoke(channel as string, payload)) as
    | { ok: true, data: unknown }
    | { ok: false, error: SerializedAppError }
  if (!envelope || typeof envelope !== 'object') {
    throw new ApiError({ code: 'E_INTERNAL', message: 'The application did not respond. Please try again.' })
  }
  if (!envelope.ok) throw new ApiError(envelope.error)
  return envelope.data as ChannelOutput<C>
}

export interface QueryState<T> {
  data: T | null
  error: ApiError | null
  loading: boolean
  /** True while a reload of already-loaded data is in flight. */
  refreshing: boolean
  reload(): Promise<void>
  setData(next: T | null): void
}

/**
 * Data loading hook for a single channel call. The payload is compared structurally, so callers can
 * build the object inline without causing request storms.
 */
export function useInvoke<C extends ChannelId>(
  channel: C,
  payload: ChannelInput<C>,
  options: { enabled?: boolean, pollMs?: number } = {}
): QueryState<ChannelOutput<C>> {
  const { enabled = true, pollMs } = options
  const payloadKey = useMemo(() => JSON.stringify(payload ?? {}), [payload])
  const [data, setData] = useState<ChannelOutput<C> | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [refreshing, setRefreshing] = useState(false)
  const requestId = useRef(0)
  const hasData = useRef(false)
  const channelRef = useRef(channel)
  channelRef.current = channel

  const load = useCallback(
    async (background: boolean) => {
      const current = ++requestId.current
      if (background) setRefreshing(true)
      else setLoading(true)
      try {
        const result = await invoke(channelRef.current, JSON.parse(payloadKey) as ChannelInput<C>)
        if (current !== requestId.current) return
        setData(result)
        setError(null)
        hasData.current = true
      } catch (caught) {
        if (current !== requestId.current) return
        setError(caught instanceof ApiError ? caught : new ApiError({ code: 'E_INTERNAL', message: 'Something went wrong while loading this screen.' }))
      } finally {
        if (current === requestId.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [payloadKey]
  )

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      return
    }
    void load(hasData.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, payloadKey])

  useEffect(() => {
    if (!enabled || !pollMs) return
    const timer = setInterval(() => void load(true), pollMs)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, pollMs, payloadKey])

  return {
    data,
    error,
    loading,
    refreshing,
    reload: () => load(true),
    setData: (next) => {
      hasData.current = next !== null
      setData(next)
    }
  }
}

export interface MutationState<C extends ChannelId> {
  run(payload: ChannelInput<C>): Promise<ChannelOutput<C>>
  loading: boolean
  error: ApiError | null
  reset(): void
}

/** Mutation hook with in-flight tracking; errors are rethrown so callers can react (e.g. keep a dialog open). */
export function useMutation<C extends ChannelId>(channel: C): MutationState<C> {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const channelRef = useRef(channel)
  channelRef.current = channel

  const run = useCallback(async (payload: ChannelInput<C>): Promise<ChannelOutput<C>> => {
    setLoading(true)
    setError(null)
    try {
      return await invoke(channelRef.current, payload)
    } catch (caught) {
      const apiError =
        caught instanceof ApiError ? caught : new ApiError({ code: 'E_INTERNAL', message: 'The action could not be completed. Please try again.' })
      setError(apiError)
      throw apiError
    } finally {
      setLoading(false)
    }
  }, []) as MutationState<C>['run']

  return { run, loading, error, reset: () => setError(null) }
}

/** Human-readable summary of an API failure, used by error states and toasts. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong. Please try again.'
}

export function isPermissionError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'E_PERMISSION'
}

export function isLockedError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'E_LOCKED'
}
