/**
 * Exact monetary arithmetic for Dentiva Pro.
 *
 * All money is stored and computed as integers in **micro-Taka** (µ): 1 BDT (৳) = 10 000 µ.
 * Floating point is never used for money, so totals are deterministic and reproducible:
 *   ৳ 1 234.50  ⇔  12 345 000 µ
 */

export const MICRO_PER_TAKA = 10_000

/** Branded integer micro-Taka amount. */
export type Micro = number

export const BDT_SYMBOL = '৳'
export const BDT_CODE = 'BDT'

export function zero(): Micro {
  return 0
}

export function microFromTaka(taka: number): Micro {
  return Math.round(taka * MICRO_PER_TAKA)
}

export function microToTakaNumber(micro: Micro): number {
  return micro / MICRO_PER_TAKA
}

export function isMicro(value: unknown): value is Micro {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

export function add(...values: Micro[]): Micro {
  let total = 0
  for (const value of values) total += value
  return total
}

export function sub(a: Micro, b: Micro): Micro {
  return a - b
}

export function negate(value: Micro): Micro {
  return -value
}

export function multiply(value: Micro, factor: number): Micro {
  return Math.round(value * factor)
}

/** Quantity multiplication where quantity may be fractional (e.g. 1.5 units, 0.25 kg). */
export function multiplyQty(unitPrice: Micro, quantity: number): Micro {
  return Math.round(unitPrice * quantity)
}

/** Apply a percentage expressed in basis points (1 % = 100 bp) using half-up rounding. */
export function percent(value: Micro, basisPoints: number): Micro {
  return divideRoundHalfUp(value * basisPoints, 10_000)
}

export function divideRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('Division by zero in money calculation')
  const sign = numerator < 0 !== denominator < 0 ? -1 : 1
  const n = Math.abs(numerator)
  const d = Math.abs(denominator)
  return sign * Math.floor((n + d / 2) / d)
}

/** Percentage value of `part` inside `whole`, in basis points (0 when whole is 0). */
export function percentOf(part: Micro, whole: Micro): number {
  if (whole === 0) return 0
  return Math.round((part * 10_000) / whole)
}

export interface LineAmount {
  /** Unit price in µ. */
  unitPrice: Micro
  /** Quantity, may be fractional but validated to be > 0. */
  quantity: number
  /** Per-line discount in µ (absolute). */
  discount: Micro
}

export function lineTotal(line: LineAmount): Micro {
  const gross = multiplyQty(line.unitPrice, line.quantity)
  return Math.max(0, gross - line.discount)
}

export interface InvoiceTotals {
  subtotal: Micro
  discountTotal: Micro
  total: Micro
  paid: Micro
  due: Micro
  refunded: Micro
}

export interface InvoiceTotalsInput {
  lines: LineAmount[]
  /** Invoice-level extra discount in µ applied after line totals. */
  invoiceDiscount: Micro
  /** Payments applied to the invoice (positive = paid, negative = refund). */
  payments: Micro[]
}

/**
 * Canonical invoice computation. Any code that needs invoice totals must call this,
 * whether it is the service layer, a report, a test or the UI preview.
 */
export function computeInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  let subtotal = 0
  let lineDiscounts = 0
  for (const line of input.lines) {
    subtotal += multiplyQty(line.unitPrice, line.quantity)
    lineDiscounts += Math.max(0, Math.min(line.discount, multiplyQty(line.unitPrice, line.quantity)))
  }
  const invoiceDiscount = Math.max(0, Math.min(input.invoiceDiscount, subtotal - lineDiscounts))
  const discountTotal = lineDiscounts + invoiceDiscount
  const total = Math.max(0, subtotal - discountTotal)
  let paid = 0
  let refunded = 0
  for (const payment of input.payments) {
    if (payment >= 0) paid += payment
    else refunded += -payment
  }
  const netPaid = paid - refunded
  const due = Math.max(0, total - netPaid)
  return { subtotal, discountTotal, total, paid, due, refunded }
}

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'

export function invoiceStatusFor(total: Micro, netPaid: Micro, voided: boolean): InvoiceStatus {
  if (voided) return 'void'
  if (netPaid <= 0) return 'unpaid'
  if (netPaid >= total) return 'paid'
  return 'partial'
}

const AMOUNT_PATTERN = /^-?\d{1,12}(\.\d{1,4})?$/

/** Parse user input ("1,234.50", "৳ 500", "1.2k" is rejected) into µ. Throws on malformed input. */
export function parseAmountToMicro(raw: string | number): Micro {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new Error('Amount is not a number')
    return Math.round(raw * MICRO_PER_TAKA)
  }
  const cleaned = raw.replace(/[৳,\s]/g, '').replace(/BDT/i, '')
  if (cleaned === '' || cleaned === '-') throw new Error('Amount is required')
  if (!AMOUNT_PATTERN.test(cleaned)) throw new Error(`Invalid amount: ${raw}`)
  const value = Number(cleaned)
  if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${raw}`)
  if (Math.abs(value) > 999_999_999_999) throw new Error('Amount is out of the supported range')
  return Math.round(value * MICRO_PER_TAKA)
}

const grouped = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true
})

const plain = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  useGrouping: true
})

/** "৳ 1,234.50" — the canonical display format for money in Dentiva Pro. */
export function formatBDT(micro: Micro, options: { symbol?: boolean; compactZero?: boolean } = {}): string {
  const { symbol = true, compactZero = false } = options
  if (compactZero && micro === 0) return symbol ? `${BDT_SYMBOL} 0` : '0'
  const sign = micro < 0 ? '-' : ''
  const value = Math.abs(micro) / MICRO_PER_TAKA
  const body = grouped.format(value)
  return symbol ? `${sign}${BDT_SYMBOL} ${body}` : `${sign}${body}`
}

/** "1,234.50" without the currency symbol (inputs, CSV, PDF tables). */
export function formatAmountPlain(micro: Micro, withDecimals = true): string {
  const sign = micro < 0 ? '-' : ''
  const value = Math.abs(micro) / MICRO_PER_TAKA
  return `${sign}${(withDecimals ? grouped : plain).format(value)}`
}

/** Short human display for dashboards: ৳ 12.5K / ৳ 1.2L (Bangladeshi lakh grouping). */
export function formatBDTShort(micro: Micro): string {
  const taka = micro / MICRO_PER_TAKA
  const abs = Math.abs(taka)
  const sign = taka < 0 ? '-' : ''
  if (abs >= 10_000_000) return `${sign}${BDT_SYMBOL} ${(abs / 10_000_000).toFixed(2)}Cr`
  if (abs >= 100_000) return `${sign}${BDT_SYMBOL} ${(abs / 100_000).toFixed(2)}L`
  if (abs >= 1_000) return `${sign}${BDT_SYMBOL} ${(abs / 1_000).toFixed(1)}K`
  return formatBDT(micro)
}

/** Format basis points as a human percentage: 1250 → "12.5 %". */
export function formatBasisPoints(bp: number): string {
  const value = bp / 100
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} %`
}

export function parsePercentToBasisPoints(raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/[%\s]/g, ''))
  if (!Number.isFinite(value)) throw new Error('Invalid percentage')
  if (value < 0 || value > 100) throw new Error('Percentage must be between 0 and 100')
  return Math.round(value * 100)
}
