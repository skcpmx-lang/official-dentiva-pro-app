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
/** Local clock time, `HH:mm` (24h storage; 12h rendering handled by the formatter). */
export type LocalTime = string

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

/** Local clock time of an instant, as `HH:mm`. */
export function toLocalTime(ms: EpochMs): LocalTime {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toLocalDateTime(ms: EpochMs): string {
  return `${toLocalDate(ms)} ${toLocalTime(ms)}`
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

export function isValidLocalDate(value: string): boolean {
  try {
    fromLocalDate(value)
    return true
  } catch {
    return false
  }
}

/**
 * Parse `YYYY-MM-DD` or `YYYY-MM-DD HH:mm` into an instant.
 * Ambiguous/invalid input throws rather than silently producing NaN dates.
 */
export function parseDateTimeInput(value: string): EpochMs {
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return fromLocalDate(trimmed)
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(trimmed)
  if (!match) throw new Error(`Invalid date/time: ${value}`)
  const base = fromLocalDate(match[1]!)
  const hours = Number(match[2])
  const minutes = Number(match[3])
  const seconds = Number(match[4] ?? 0)
  if (hours > 23 || minutes > 59 || seconds > 59) throw new Error(`Invalid time: ${value}`)
  return base + hours * MS_PER_HOUR + minutes * MS_PER_MINUTE + seconds * 1000
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

export function endOfMonth(ms: EpochMs): EpochMs {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() - 1
}

export function startOfYear(ms: EpochMs): EpochMs {
  return new Date(new Date(ms).getFullYear(), 0, 1).getTime()
}

export function addDays(ms: EpochMs, days: number): EpochMs {
  const d = new Date(ms)
  // Calendar-safe: handles DST transitions without drifting an hour.
  d.setDate(d.getDate() + days)
  return d.getTime()
}

export function addMonths(ms: EpochMs, months: number): EpochMs {
  const d = new Date(ms)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return d.getTime()
}

export function addMinutes(ms: EpochMs, minutes: number): EpochMs {
  return ms + minutes * MS_PER_MINUTE
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

export function daysBetween(fromMs: EpochMs, toMs: EpochMs): number {
  return Math.round((startOfDay(toMs) - startOfDay(fromMs)) / MS_PER_DAY)
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a === b ? 0 : a < b ? -1 : 1
}

/** Inclusive local-date range expressed in instants (start of first day → end of last day). */
export interface InstantRange {
  from: EpochMs
  to: EpochMs
}

export function rangeFromDates(from: LocalDate, to: LocalDate): InstantRange {
  return { from: fromLocalDate(from), to: endOfDay(fromLocalDate(to)) }
}

export function rangeForDay(ms: EpochMs): InstantRange {
  return { from: startOfDay(ms), to: endOfDay(ms) }
}

export function rangeForMonth(ms: EpochMs): InstantRange {
  return { from: startOfMonth(ms), to: endOfMonth(ms) }
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

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  last90: 'Last 90 days',
  thisMonth: 'This month',
  lastYear: 'Last 1 year',
  all: 'All time',
  custom: 'Custom range'
}

/** Month key `YYYY-MM` for grouping and period reports. */
export function monthKey(ms: EpochMs): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function monthKeyLabel(key: string): string {
  const [year, month] = key.split('-')
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const index = Number(month) - 1
  return `${monthNames[index] ?? month} ${year}`
}

/** Ordered list of month keys covering the last `count` months ending at `ms` (inclusive). */
export function lastMonthKeys(count: number, ms: EpochMs = now()): string[] {
  const keys: string[] = []
  for (let i = count - 1; i >= 0; i--) keys.push(monthKey(addMonths(startOfMonth(ms), -i)))
  return keys
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

export const DATE_FORMATS: DateFormat[] = [
  'dd/MM/yyyy',
  'dd-MM-yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd',
  'd MMM yyyy',
  'dd MMM yyyy',
  'dd MMMM yyyy'
]

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

export function formatDateLong(ms: EpochMs): string {
  const d = new Date(ms)
  return `${pad(d.getDate())} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`
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

/** Weekday index with Sunday = 0, matching `dentist_schedules.weekday` and JS `Date.getDay()`. */
export function weekdayIndex(ms: EpochMs): number {
  return new Date(ms).getDay()
}

export const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Build `HH:mm` → instant for a given local day. */
export function combineDateAndTime(date: LocalDate, time: LocalTime): EpochMs {
  const base = fromLocalDate(date)
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) throw new Error(`Invalid time: ${time}`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time: ${time}`)
  return base + hours * MS_PER_HOUR + minutes * MS_PER_MINUTE
}

/** Generate time slots between two `HH:mm` boundaries with a step in minutes. */
export function timeSlots(start: LocalTime, end: LocalTime, stepMinutes: number): LocalTime[] {
  const toMinutes = (value: LocalTime): number => {
    const [h, m] = value.split(':').map(Number)
    return (h ?? 0) * 60 + (m ?? 0)
  }
  const slots: LocalTime[] = []
  const startMinutes = toMinutes(start)
  const endMinutes = toMinutes(end)
  if (stepMinutes <= 0) throw new Error('Slot step must be positive')
  for (let t = startMinutes; t + stepMinutes <= endMinutes; t += stepMinutes) {
    slots.push(`${pad(Math.floor(t / 60))}:${pad(t % 60)}`)
  }
  return slots
}
