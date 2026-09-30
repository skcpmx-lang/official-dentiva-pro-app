import { useMemo } from 'react'
import { formatBDT, formatBDTShort, formatAmountPlain, type Micro } from '@shared/money'
import {
  formatDate as formatDateShared,
  formatDateTime as formatDateTimeShared,
  formatTime as formatTimeShared,
  formatDuration,
  formatRelative,
  type DateFormat,
  type TimeFormat
} from '@shared/datetime'
import { useAppStore } from '../store/appStore'
import { hasBengali } from '@shared/bengali'

/**
 * Display formatting bound to the clinic's configured date/time formats.
 * Components never call `Intl` or `Date` formatting directly, so a settings change updates the whole
 * interface consistently (and printing uses the same helpers through the main process).
 */

export interface Formatters {
  money(micro: Micro, options?: { symbol?: boolean }): string
  moneyShort(micro: Micro): string
  amountPlain(micro: Micro): string
  date(ms: number | null | undefined): string
  dateTime(ms: number | null | undefined): string
  time(ms: number | null | undefined): string
  duration(ms: number): string
  relative(ms: number): string
  number(value: number | null | undefined, decimals?: number): string
  percent(basisPoints: number): string
  quantity(value: number): string
  textClass(value: string | null | undefined): string
  dateFormat: DateFormat
  timeFormat: TimeFormat
}

const DASH = '—'

export function useFormatters(): Formatters {
  const dateFormat = (useAppStore((state) => state.settings['practice.dateFormat']) ?? 'dd/MM/yyyy') as DateFormat
  const timeFormat = (useAppStore((state) => state.settings['practice.timeFormat']) ?? '12h') as TimeFormat

  return useMemo<Formatters>(
    () => ({
      money: (micro, options) => formatBDT(micro ?? 0, { symbol: options?.symbol ?? true }),
      moneyShort: (micro) => formatBDTShort(micro ?? 0),
      amountPlain: (micro) => formatAmountPlain(micro ?? 0),
      date: (ms) => (ms === null || ms === undefined ? DASH : formatDateShared(ms, dateFormat)),
      dateTime: (ms) => (ms === null || ms === undefined ? DASH : formatDateTimeShared(ms, dateFormat, timeFormat)),
      time: (ms) => (ms === null || ms === undefined ? DASH : formatTimeShared(ms, timeFormat)),
      duration: (ms) => formatDuration(ms),
      relative: (ms) => formatRelative(ms),
      number: (value, decimals = 0) =>
        value === null || value === undefined || Number.isNaN(value)
          ? DASH
          : new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: Math.max(decimals, 2) }).format(value),
      percent: (basisPoints) => `${(basisPoints / 100).toFixed(basisPoints % 100 === 0 ? 0 : 2)} %`,
      quantity: (value) => (Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')),
      textClass: (value) => (value && hasBengali(value) ? 'bn' : ''),
      dateFormat,
      timeFormat
    }),
    [dateFormat, timeFormat]
  )
}

/** Non-hook variants for use inside printing/export helpers and non-component code. */
export function formatDateWith(format: DateFormat, ms: number | null | undefined): string {
  return ms === null || ms === undefined ? DASH : formatDateShared(ms, format)
}

export const INVOICE_STATUS_META: Record<string, { label: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  unpaid: { label: 'Unpaid', tone: 'danger' },
  partial: { label: 'Partially paid', tone: 'warning' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Void', tone: 'neutral' }
}

export const APPOINTMENT_STATUS_META: Record<string, { label: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  scheduled: { label: 'Scheduled', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  arrived: { label: 'Arrived', tone: 'warning' },
  in_consultation: { label: 'In consultation', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'No show', tone: 'danger' }
}

export const QUEUE_STATUS_META: Record<string, { label: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  waiting: { label: 'Waiting', tone: 'warning' },
  called: { label: 'Called', tone: 'info' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  left: { label: 'Left', tone: 'danger' }
}

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' },
  { value: 'rocket', label: 'Rocket' },
  { value: 'upay', label: 'Upay' },
  { value: 'other_wallet', label: 'Other mobile wallet' },
  { value: 'other', label: 'Other' }
] as const

export function paymentMethodLabel(value: string): string {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value
}

export const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'unspecified', label: 'Not specified' }
] as const

export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const

export const MARITAL_STATUS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'unspecified', label: 'Not specified' }
] as const

export const PATIENT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'deceased', label: 'Deceased' }
] as const

export const TREATMENT_CATEGORIES = [
  { value: 'diagnostic', label: 'Diagnostic' },
  { value: 'preventive', label: 'Preventive' },
  { value: 'restorative', label: 'Restorative' },
  { value: 'endodontic', label: 'Endodontic' },
  { value: 'surgical', label: 'Surgical' },
  { value: 'prosthetic', label: 'Prosthetic' },
  { value: 'orthodontic', label: 'Orthodontic' },
  { value: 'cosmetic', label: 'Cosmetic' },
  { value: 'general', label: 'General' }
] as const

export function treatmentCategoryLabel(value: string): string {
  return TREATMENT_CATEGORIES.find((category) => category.value === value)?.label ?? value
}

export const INVENTORY_CATEGORIES = [
  { value: 'consumable', label: 'Consumable' },
  { value: 'restorative', label: 'Restorative' },
  { value: 'endodontic', label: 'Endodontic' },
  { value: 'prosthetic', label: 'Prosthetic' },
  { value: 'orthodontic', label: 'Orthodontic' },
  { value: 'instrument', label: 'Instrument' },
  { value: 'sterilisation', label: 'Sterilisation' },
  { value: 'pharmaceutical', label: 'Pharmaceutical' },
  { value: 'office', label: 'Office' },
  { value: 'general', label: 'General' }
] as const

export function inventoryCategoryLabel(value: string): string {
  return INVENTORY_CATEGORIES.find((category) => category.value === value)?.label ?? value
}

/** Movement vocabulary: label plus whether it adds to or subtracts from stock. */
export const MOVEMENT_TYPE_META: Record<string, { label: string, direction: 'in' | 'out' }> = {
  opening: { label: 'Opening stock', direction: 'in' },
  purchase: { label: 'Purchase received', direction: 'in' },
  return_in: { label: 'Returned to stock', direction: 'in' },
  adjustment_in: { label: 'Count correction (in)', direction: 'in' },
  usage: { label: 'Issued for treatment', direction: 'out' },
  adjustment_out: { label: 'Count correction (out)', direction: 'out' },
  expired: { label: 'Expired write-off', direction: 'out' },
  damaged: { label: 'Damaged write-off', direction: 'out' },
  return_out: { label: 'Returned to supplier', direction: 'out' }
}

export function movementTypeLabel(value: string): string {
  return MOVEMENT_TYPE_META[value]?.label ?? value
}

export const PURCHASE_STATUS_META: Record<string, { label: string, tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  unpaid: { label: 'Unpaid', tone: 'warning' },
  partial: { label: 'Partly paid', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  void: { label: 'Void', tone: 'neutral' }
}

/** Presentation labels for the prescription medicine form and timing vocabularies. */
export const MEDICINE_FORM_LABELS: Record<string, string> = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  syrup: 'Syrup',
  suspension: 'Suspension',
  drops: 'Drops',
  injection: 'Injection',
  ointment: 'Ointment',
  gel: 'Gel',
  mouthwash: 'Mouthwash',
  sachet: 'Sachet',
  other: 'Other'
}

export const MEDICINE_TIMING_LABELS: Record<string, string> = {
  before_meal: 'Before meal',
  after_meal: 'After meal',
  with_meal: 'With meal',
  empty_stomach: 'Empty stomach',
  bedtime: 'Bedtime',
  as_needed: 'As needed (PRN)'
}

/* ------------------------------------------------------------------ non-hook helpers */

/**
 * Formatting helpers for code that is not a React component (event handlers, exported CSV files and
 * print pipelines). They read the same settings as {@link useFormatters} so a document always matches
 * what the operator saw on screen.
 */
function currentDateFormat(): DateFormat {
  return (useAppStore.getState().settings['practice.dateFormat'] ?? 'dd/MM/yyyy') as DateFormat
}

function currentTimeFormat(): TimeFormat {
  return (useAppStore.getState().settings['practice.timeFormat'] ?? '12h') as TimeFormat
}

export function formatDate(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? DASH : formatDateShared(ms, currentDateFormat())
}

export function formatDateTime(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? DASH : formatDateTimeShared(ms, currentDateFormat(), currentTimeFormat())
}

export function formatTime(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? DASH : formatTimeShared(ms, currentTimeFormat())
}

export function formatRelativeTime(ms: number): string {
  return formatRelative(ms)
}

/** Byte counts for backups, attachments and the database file. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return DASH
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`
}

/** Dentiva Pro records money in Bangladeshi Taka only. */
export const CURRENCY_CODE = 'BDT'
export const CURRENCY_SYMBOL = '\u09F3'
