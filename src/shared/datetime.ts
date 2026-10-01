/**
 * Date & time handling.
 *
 * Storage format: epoch milliseconds (UTC instant) for ordering/auditing **plus** an explicit
 * local `YYYY-MM-DD` column whenever records are grouped or filtered by a clinic working day.
 * Display always goes through the helpers below so the clinic's configured format is respected
 * and never depends on the machine's ICU locale data.
 */

export type EpochMs = number
/** Local calendar date, `YYYY-MM-DD`. */
export type LocalDate = string
export const MS_PER_MINUTE = 60_000
export const MS_PER_HOUR = 3_600_000
export const MS_PER_DAY = 86_400_000

export function now(): EpochMs {
  return Date.now()
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** Local calendar date of an instant, as `YYYY-MM-DD`. */
export function toLocalDate(ms: EpochMs): LocalDate {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Parse `YYYY-MM-DD` (or a full ISO string) into local midnight of that day. */
export function fromLocalDate(date: LocalDate): EpochMs {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!match) throw new Error(`Invalid date: ${date}`)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const d = new Date(year, month - 1, day, 0, 0, 0, 0)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    throw new Error(`Invalid calendar date: ${date}`)
  }
  return d.getTime()
}

export function startOfDay(ms: EpochMs): EpochMs {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function endOfDay(ms: EpochMs): EpochMs {
  return startOfDay(ms) + MS_PER_DAY - 1
}

export function startOfMonth(ms: EpochMs): EpochMs {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function addDays(ms: EpochMs, days: number): EpochMs {
  const d = new Date(ms)
  // Calendar-safe: handles DST transitions without drifting an hour.
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/** Inclusive local-date range expressed in instants (start of first day → end of last day). */
export interface InstantRange {
  from: EpochMs
  to: EpochMs
}

export function rangeFromDates(from: LocalDate, to: LocalDate): InstantRange {
  return { from: fromLocalDate(from), to: endOfDay(fromLocalDate(to)) }
}

export type RangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'lastYear' | 'thisMonth' | 'all' | 'custom'

export interface ResolvedRange extends InstantRange {
  preset: RangePreset
  /** Local date strings, kept for reporting headers and CSV exports. */
  fromDate: LocalDate
  toDate: LocalDate
}

/** Resolve a preset into concrete instants; `nowMs` is injectable for deterministic tests. */
export function resolveRange(preset: RangePreset, nowMs: EpochMs = now(), custom?: InstantRange): ResolvedRange {
  const today = startOfDay(nowMs)
  let from: EpochMs
  let to: EpochMs = endOfDay(nowMs)
  switch (preset) {
    case 'today':
      from = today
      break
    case 'yesterday':
      from = addDays(today, -1)
      to = endOfDay(addDays(today, -1))
      break
    case 'last7':
      from = addDays(today, -6)
      break
    case 'last30':
      from = addDays(today, -29)
      break
    case 'last90':
      from = addDays(today, -89)
      break
    case 'thisMonth':
      from = startOfMonth(nowMs)
      break
    case 'lastYear':
      from = addDays(today, -364)
      break
    case 'all':
      from = fromLocalDate('1970-01-01')
      to = endOfDay(addDays(today, 365 * 5))
      break
    case 'custom': {
      if (!custom) throw new Error('custom range requires from/to instants')
      if (custom.from > custom.to) throw new Error('Range start must be before range end')
      from = startOfDay(custom.from)
      to = endOfDay(custom.to)
      break
    }
    default: {
      const exhaustive: never = preset
      throw new Error(`Unsupported range preset: ${String(exhaustive)}`)
    }
  }
  if (from > to) throw new Error('Range start must be before range end')
  return { preset, from, to, fromDate: toLocalDate(from), toDate: toLocalDate(to) }
}

export interface Age {
  years: number
  months: number
  days: number
  /** "34 y 5 m" / "7 m 12 d" / "18 d" — professional clinical rendering. */
  label: string
  totalMonths: number
}

/** Age at a given instant (defaults to now). Used for clinical documents and validation. */
export function ageAt(dobMs: EpochMs, atMs: EpochMs = now()): Age {
  if (dobMs > atMs) throw new Error('Date of birth cannot be in the future')
  const dob = new Date(dobMs)
  const at = new Date(atMs)
  let years = at.getFullYear() - dob.getFullYear()
  let months = at.getMonth() - dob.getMonth()
  let days = at.getDate() - dob.getDate()
  if (days < 0) {
    months -= 1
    const prevMonth = new Date(at.getFullYear(), at.getMonth(), 0)
    days += prevMonth.getDate()
  }
  if (months < 0) {
    years -= 1
    months += 12
  }
  const totalMonths = years * 12 + months
  const label = years > 0 ? `${years} y${months > 0 ? ` ${months} m` : ''}` : months > 0 ? `${months} m${days > 0 ? ` ${days} d` : ''}` : `${days} d`
  return { years, months, days, label, totalMonths }
}

export type DateFormat =
  | 'dd/MM/yyyy'
  | 'dd-MM-yyyy'
  | 'MM/dd/yyyy'
  | 'yyyy-MM-dd'
  | 'd MMM yyyy'
  | 'dd MMM yyyy'
  | 'dd MMMM yyyy'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

export function formatDate(ms: EpochMs, format: DateFormat = 'dd/MM/yyyy'): string {
  const d = new Date(ms)
  const dd = pad(d.getDate())
  const mm = pad(d.getMonth() + 1)
  const yyyy = String(d.getFullYear())
  switch (format) {
    case 'dd/MM/yyyy':
      return `${dd}/${mm}/${yyyy}`
    case 'dd-MM-yyyy':
      return `${dd}-${mm}-${yyyy}`
    case 'MM/dd/yyyy':
      return `${mm}/${dd}/${yyyy}`
    case 'yyyy-MM-dd':
      return `${yyyy}-${mm}-${dd}`
    case 'd MMM yyyy':
      return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${yyyy}`
    case 'dd MMM yyyy':
      return `${dd} ${MONTHS_SHORT[d.getMonth()]} ${yyyy}`
    case 'dd MMMM yyyy':
      return `${dd} ${MONTHS_LONG[d.getMonth()]} ${yyyy}`
    default: {
      const exhaustive: never = format
      throw new Error(`Unsupported date format: ${String(exhaustive)}`)
    }
  }
}

export type TimeFormat = '12h' | '24h'

export function formatTime(ms: EpochMs, format: TimeFormat = '12h'): string {
  const d = new Date(ms)
  const hours24 = d.getHours()
  const minutes = pad(d.getMinutes())
  if (format === '24h') return `${pad(hours24)}:${minutes}`
  const suffix = hours24 >= 12 ? 'PM' : 'AM'
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${pad(hours12)}:${minutes} ${suffix}`
}

export function formatDateTime(ms: EpochMs, dateFormat: DateFormat = 'dd/MM/yyyy', timeFormat: TimeFormat = '12h'): string {
  return `${formatDate(ms, dateFormat)} ${formatTime(ms, timeFormat)}`
}

/** "1 h 05 m" style duration used for waiting times and consultation length. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / MS_PER_MINUTE))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} m`
  return `${hours} h ${pad(minutes)} m`
}

export function formatRelative(ms: EpochMs, atMs: EpochMs = now()): string {
  const diff = atMs - ms
  const abs = Math.abs(diff)
  const past = diff >= 0
  if (abs < MS_PER_MINUTE) return 'just now'
  if (abs < MS_PER_HOUR) return `${past ? '' : 'in '}${Math.floor(abs / MS_PER_MINUTE)} min${past ? ' ago' : ''}`
  if (abs < MS_PER_DAY) return `${past ? '' : 'in '}${Math.floor(abs / MS_PER_HOUR)} h${past ? ' ago' : ''}`
  const days = Math.floor(abs / MS_PER_DAY)
  if (days < 30) return `${past ? '' : 'in '}${days} day${days === 1 ? '' : 's'}${past ? ' ago' : ''}`
  return formatDate(ms)
}

