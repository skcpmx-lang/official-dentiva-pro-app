import { z } from 'zod'
import { channel, zTrimmed } from '../ipc'

/**
 * Global search.
 *
 * One query fans out across the clinic's records. Groups the signed-in operator may not open are not
 * searched at all — not merely hidden in the interface — so a restricted user cannot learn that a
 * patient, invoice or stock item exists. Every result carries the route that opens it.
 */

export const SEARCH_GROUP_KEYS = [
  'patients',
  'appointments',
  'invoices',
  'payments',
  'prescriptions',
  'visits',
  'treatments',
  'inventory',
  'suppliers',
  'staff',
  'accounting'
] as const
export const zSearchGroupKey = z.enum(SEARCH_GROUP_KEYS)

export const zSearchResultItem = z.object({
  id: z.number(),
  title: z.string(),
  subtitle: z.string().nullable(),
  /** Short right-aligned text: a code, a date, an amount. */
  meta: z.string().nullable(),
  route: z.string()
})

export const zSearchGroup = z.object({
  key: zSearchGroupKey,
  label: z.string(),
  items: z.array(zSearchResultItem),
  /** Total matches in this group, which may be higher than the number returned. */
  total: z.number()
})

export const searchChannels = {
  'search.global': channel(
    z
      .object({
        query: zTrimmed(1, 120, 'Search text'),
        limitPerGroup: z.number().int().min(1).max(20).default(5)
      }),
    z.object({ query: z.string(), groups: z.array(zSearchGroup), total: z.number() })
  )
} as const
