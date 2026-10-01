import { describe, expect, it } from 'vitest'
import {
  MS_PER_DAY,
  addDays,
  ageAt,
  endOfDay,
  formatDate,
  formatDateTime,
  formatDuration,
  formatRelative,
  formatTime,
  fromLocalDate,
  rangeFromDates,
  resolveRange,
  startOfDay,
  startOfMonth,
  toLocalDate
} from '@shared/datetime'

/**
 * Date and time helpers.
 *
 * The clinic works in local calendar days ("today's list", "this month's takings"), while records are
 * stored as epoch milliseconds, so the boundary between the two is where reporting bugs live. Every
 * instant below is built with the local `Date` constructor so the expectations hold in any timezone.
 */

const at = (year: number, month: number, day: number, hour = 0, minute = 0): number =>
  new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

describe('local calendar days', () => {
  it('round-trips a date through local midnight', () => {
    expect(toLocalDate(at(2026, 6, 15, 14, 30))).toBe('2026-06-15')
    const midnight = fromLocalDate('2026-06-15')
    expect(toLocalDate(midnight)).toBe('2026-06-15')
    expect(new Date(midnight).getHours()).toBe(0)
    expect(toLocalDate(fromLocalDate('2026-01-01'))).toBe('2026-01-01')
  })

  it('refuses dates that do not exist instead of rolling them over', () => {
    expect(() => fromLocalDate('2026-02-30')).toThrow(/invalid/i)
    expect(() => fromLocalDate('2025-02-29')).toThrow(/invalid/i)
    expect(() => fromLocalDate('15/06/2026')).toThrow(/invalid/i)
    // 2024 is a leap year, so this one is real.
    expect(toLocalDate(fromLocalDate('2024-02-29'))).toBe('2024-02-29')
  })

  it('brackets a day, a month and a range inclusively', () => {
    const noon = at(2026, 6, 15, 12, 0)
    expect(startOfDay(noon)).toBe(at(2026, 6, 15))
    expect(endOfDay(noon)).toBe(at(2026, 6, 15) + MS_PER_DAY - 1)
    expect(startOfMonth(noon)).toBe(at(2026, 6, 1))

    const range = rangeFromDates('2026-06-01', '2026-06-30')
    expect(range.from).toBe(at(2026, 6, 1))
    expect(range.to).toBe(at(2026, 6, 30) + MS_PER_DAY - 1)
  })

  it('adds days across month and year boundaries', () => {
    expect(toLocalDate(addDays(at(2026, 6, 15), 1))).toBe('2026-06-16')
    expect(toLocalDate(addDays(at(2026, 6, 15), -15))).toBe('2026-05-31')
    expect(toLocalDate(addDays(at(2026, 12, 31), 1))).toBe('2027-01-01')
    expect(toLocalDate(addDays(at(2026, 3, 1), -1))).toBe('2026-02-28')
    expect(toLocalDate(addDays(at(2024, 3, 1), -1))).toBe('2024-02-29')
  })
})

describe('range presets', () => {
  const noon = at(2026, 6, 15, 14, 30)

  it('resolves each preset into an inclusive local range', () => {
    const cases: Array<[Parameters<typeof resolveRange>[0], string, string]> = [
      ['today', '2026-06-15', '2026-06-15'],
      ['yesterday', '2026-06-14', '2026-06-14'],
      ['last7', '2026-06-09', '2026-06-15'],
      ['last30', '2026-05-17', '2026-06-15'],
      ['last90', '2026-03-18', '2026-06-15'],
      ['thisMonth', '2026-06-01', '2026-06-15'],
      ['lastYear', '2025-06-16', '2026-06-15']
    ]
    for (const [preset, fromDate, toDate] of cases) {
      const range = resolveRange(preset, noon)
      expect(range.preset).toBe(preset)
      expect(range.fromDate).toBe(fromDate)
      expect(range.toDate).toBe(toDate)
      expect(range.from).toBe(fromLocalDate(fromDate))
      expect(range.to).toBe(endOfDay(fromLocalDate(toDate)))
    }
  })

  it('covers the whole history for "all" and normalises a custom range', () => {
    const all = resolveRange('all', noon)
    expect(all.fromDate).toBe('1970-01-01')
    // Five years of calendar days (1825), which lands just before the anniversary in a leap year.
    expect(toLocalDate(all.to)).toBe('2031-06-14')

    const custom = resolveRange('custom', noon, { from: at(2026, 1, 5, 9), to: at(2026, 1, 7, 22) })
    expect(custom.fromDate).toBe('2026-01-05')
    expect(custom.toDate).toBe('2026-01-07')
    expect(custom.from).toBe(at(2026, 1, 5))
    expect(custom.to).toBe(endOfDay(at(2026, 1, 7)))
  })

  it('refuses a custom range that is missing or reversed', () => {
    expect(() => resolveRange('custom', noon)).toThrow(/from\/to/i)
    expect(() => resolveRange('custom', noon, { from: at(2026, 6, 2), to: at(2026, 6, 1) })).toThrow(/before/i)
    expect(() => resolveRange('nonsense' as never, noon)).toThrow(/unsupported/i)
  })
})

describe('age', () => {
  it('counts years, months and days like a clinic record does', () => {
    const birthday = at(1990, 6, 15)
    expect(ageAt(birthday, at(2026, 6, 15))).toMatchObject({ years: 36, months: 0, days: 0, label: '36 y', totalMonths: 432 })
    expect(ageAt(birthday, at(2026, 6, 14))).toMatchObject({ years: 35, months: 11, days: 30, label: '35 y 11 m' })
    expect(ageAt(birthday, at(2026, 9, 20))).toMatchObject({ years: 36, months: 3, days: 5, label: '36 y 3 m' })
  })

  it('switches to months and days for infants', () => {
    expect(ageAt(at(2026, 1, 1), at(2026, 6, 15))).toMatchObject({ years: 0, months: 5, days: 14, label: '5 m 14 d' })
    expect(ageAt(at(2026, 6, 10), at(2026, 6, 15))).toMatchObject({ years: 0, months: 0, days: 5, label: '5 d' })
    expect(ageAt(at(2026, 6, 15), at(2026, 6, 15)).label).toBe('0 d')
  })

  it('never reports a negative component and refuses a future birth date', () => {
    const age = ageAt(at(2024, 2, 29), at(2025, 2, 28))
    expect(age.years).toBeGreaterThanOrEqual(0)
    expect(age.months).toBeGreaterThanOrEqual(0)
    expect(age.days).toBeGreaterThanOrEqual(0)
    expect(age.totalMonths).toBe(age.years * 12 + age.months)
    expect(() => ageAt(at(2026, 6, 16), at(2026, 6, 15))).toThrow(/future/i)
  })
})

describe('formatting', () => {
  const january5th = at(2026, 1, 5, 9, 5)

  it('formats dates in every format the clinic prints', () => {
    expect(formatDate(january5th)).toBe('05/01/2026')
    expect(formatDate(january5th, 'dd-MM-yyyy')).toBe('05-01-2026')
    expect(formatDate(january5th, 'MM/dd/yyyy')).toBe('01/05/2026')
    expect(formatDate(january5th, 'yyyy-MM-dd')).toBe('2026-01-05')
    expect(formatDate(january5th, 'd MMM yyyy')).toBe('5 Jan 2026')
    expect(formatDate(january5th, 'dd MMM yyyy')).toBe('05 Jan 2026')
    expect(formatDate(january5th, 'dd MMMM yyyy')).toBe('05 January 2026')
    expect(() => formatDate(january5th, 'yyyy' as never)).toThrow(/unsupported/i)
  })

  it('formats times in both clocks, including midnight and noon', () => {
    expect(formatTime(january5th)).toBe('09:05 AM')
    expect(formatTime(at(2026, 1, 5, 0, 0))).toBe('12:00 AM')
    expect(formatTime(at(2026, 1, 5, 12, 0))).toBe('12:00 PM')
    expect(formatTime(at(2026, 1, 5, 23, 59))).toBe('11:59 PM')
    expect(formatTime(january5th, '24h')).toBe('09:05')
    expect(formatTime(at(2026, 1, 5, 0, 0), '24h')).toBe('00:00')
    expect(formatDateTime(january5th, 'yyyy-MM-dd', '24h')).toBe('2026-01-05 09:05')
  })

  it('formats durations for waiting times and consultations', () => {
    expect(formatDuration(0)).toBe('0 m')
    expect(formatDuration(30_000)).toBe('0 m')
    expect(formatDuration(65 * 60_000)).toBe('1 h 05 m')
    expect(formatDuration(90 * 60_000)).toBe('1 h 30 m')
    expect(formatDuration(45 * 60_000)).toBe('45 m')
    expect(formatDuration(-5_000)).toBe('0 m')
  })

  it('describes how long ago something happened', () => {
    const now = at(2026, 6, 15, 12, 0)
    expect(formatRelative(now - 10_000, now)).toBe('just now')
    expect(formatRelative(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatRelative(now + 5 * 60_000, now)).toBe('in 5 min')
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(formatRelative(now - 2 * MS_PER_DAY, now)).toBe('2 days ago')
    expect(formatRelative(now - MS_PER_DAY, now)).toBe('1 day ago')
    // Older than a month falls back to a full date rather than "42 days ago".
    expect(formatRelative(now - 45 * MS_PER_DAY, now)).toBe(formatDate(now - 45 * MS_PER_DAY))
  })
})
