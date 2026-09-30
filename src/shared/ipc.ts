import { z } from 'zod'

/**
 * IPC contract primitives.
 *
 * Every channel declares its input and output schema, which gives three guarantees:
 *  1. the renderer gets full type inference (`ChannelInput` / `ChannelOutput`),
 *  2. the main process rejects malformed or malicious payloads before any service runs,
 *  3. output validation prevents accidental leaks (a password hash or internal column can never
 *     travel to the UI, because the response is parsed against the declared output schema).
 */

export interface ChannelDef<In extends z.ZodTypeAny = z.ZodTypeAny, Out extends z.ZodTypeAny = z.ZodTypeAny> {
  input: In
  output: Out
}

export function channel<In extends z.ZodTypeAny, Out extends z.ZodTypeAny>(input: In, output: Out): ChannelDef<In, Out> {
  return { input, output }
}

/** Channels that may be invoked without an authenticated session. */
export const PUBLIC_CHANNELS = [
  'app.bootstrap',
  'app.environment',
  'activation.state',
  'activation.submit',
  'setup.status',
  'setup.clinic',
  'setup.dentists',
  'setup.administrator',
  'setup.preferences',
  'setup.summary',
  'setup.complete',
  'auth.login',
  'auth.rememberedUsername',
  'auth.unlock'
] as const

/** Channels allowed while the session is locked (everything else answers `E_LOCKED`). */
export const LOCKED_ALLOWED_CHANNELS = ['session.state', 'session.touch', 'auth.unlock', 'auth.logout', 'app.bootstrap'] as const

export function isPublicChannel(channelId: string): boolean {
  return (PUBLIC_CHANNELS as readonly string[]).includes(channelId)
}

export function isAllowedWhileLocked(channelId: string): boolean {
  return (LOCKED_ALLOWED_CHANNELS as readonly string[]).includes(channelId)
}

export const zId = z.number().int().positive()
export const zOptionalId = z.number().int().positive().nullish()
export const zLocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in YYYY-MM-DD format')
export const zLocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time in HH:mm format')
export const zDateTime = z.string().min(10).max(32)
export const zTrimmed = (min: number, max: number, label = 'This field') =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= min, { message: `${label} must be at least ${min} character(s).` })
    .refine((value) => value.length <= max, { message: `${label} must be at most ${max} character(s).` })
export const zOptionalText = (max = 4000) => z.string().max(max).nullish().transform((value) => (value === undefined ? null : value))
export const zMoneyMicro = z.number().int().min(-999_999_999_999).max(999_999_999_999)
export const zQuantity = z.number().positive().max(100_000)
export const zPage = z.object({
  limit: z.number().int().min(1).max(500).default(50),
  offset: z.number().int().min(0).default(0)
})

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export const zSortDir = z.enum(['asc', 'desc'])

export const zRangePreset = z.enum(['today', 'yesterday', 'last7', 'last30', 'last90', 'thisMonth', 'lastYear', 'all', 'custom'])

export const zDateRange = z
  .object({
    preset: zRangePreset,
    from: zLocalDate.nullish(),
    to: zLocalDate.nullish()
  })
  .default({ preset: 'last30' })

export function zodMessage(error: z.ZodError): { message: string, fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (!fieldErrors[path]) fieldErrors[path] = issue.message
  }
  const first = error.issues[0]
  const message = first ? first.message : 'Some values in the request were not valid.'
  return { message, fieldErrors }
}
