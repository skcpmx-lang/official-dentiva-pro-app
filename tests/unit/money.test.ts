import { describe, expect, it } from 'vitest'
import {
  BDT_SYMBOL,
  MICRO_PER_TAKA,
  add,
  computeInvoiceTotals,
  divideRoundHalfUp,
  formatAmountPlain,
  formatBDT,
  formatBDTShort,
  invoiceStatusFor,
  lineTotal,
  multiplyQty,
  parseAmountToMicro,
  percent,
  sub
} from '@shared/money'

/**
 * Money helpers.
 *
 * Every amount in Dentiva Pro is an integer count of micro-Taka (1 ৳ = 10 000 µ), so the whole product
 * depends on these few functions being exact. `docs/TEST_PLAN.md` §4 asks for ≥95 % coverage on shared
 * maths; more importantly, a rounding drift here is a wrong invoice at the counter.
 */

const taka = (amount: number): number => Math.round(amount * MICRO_PER_TAKA)

describe('micro-Taka arithmetic', () => {
  it('fixes the conversion rate the whole product assumes', () => {
    expect(MICRO_PER_TAKA).toBe(10_000)
    expect(BDT_SYMBOL).toBe('৳')
  })

  it('adds and subtracts without floating-point drift', () => {
    expect(add(taka(0.1), taka(0.2))).toBe(taka(0.3))
    expect(add(1, 2, 3, 4)).toBe(10)
    expect(add()).toBe(0)
    expect(sub(taka(900), taka(400))).toBe(taka(500))
    expect(sub(5, 10)).toBe(-5)
  })

  it('multiplies by fractional quantities with half-up rounding', () => {
    expect(multiplyQty(taka(1_000), 3)).toBe(taka(3_000))
    expect(multiplyQty(taka(120), 0.25)).toBe(taka(30))
    // ৳ 33.333… per unit × 3 = 99.9999… → 1 µ rounds half up.
    expect(multiplyQty(333_333, 3)).toBe(999_999)
    expect(multiplyQty(taka(10), 0)).toBe(0)
  })

  it('rounds half up and keeps the sign, and refuses division by zero', () => {
    expect(divideRoundHalfUp(1, 2)).toBe(1)
    expect(divideRoundHalfUp(3, 2)).toBe(2)
    expect(divideRoundHalfUp(-3, 2)).toBe(-2)
    expect(divideRoundHalfUp(3, -2)).toBe(-2)
    expect(divideRoundHalfUp(0, 7)).toBe(0)
    expect(() => divideRoundHalfUp(1, 0)).toThrow(/zero/i)
  })

  it('applies basis-point percentages (1 % = 100 bp) with half-up rounding', () => {
    expect(percent(taka(1_000), 1_000)).toBe(taka(100))
    expect(percent(taka(450), 500)).toBe(taka(22.5))
    expect(percent(taka(450), 0)).toBe(0)
    expect(percent(333_333, 1_000)).toBe(33_333)
  })

  it('never lets a line discount push a line below zero', () => {
    expect(lineTotal({ unitPrice: taka(500), quantity: 2, discount: taka(100) })).toBe(taka(900))
    expect(lineTotal({ unitPrice: taka(500), quantity: 2, discount: taka(99_999) })).toBe(0)
  })
})

describe('invoice totals', () => {
  it('computes subtotal, discounts, total and due from lines and payments', () => {
    const totals = computeInvoiceTotals({
      lines: [
        { unitPrice: taka(900), quantity: 1, discount: 0 },
        { unitPrice: taka(500), quantity: 2, discount: taka(100) }
      ],
      invoiceDiscount: taka(200),
      payments: [taka(1_000), taka(500)]
    })
    expect(totals.subtotal).toBe(taka(1_900))
    expect(totals.discountTotal).toBe(taka(300))
    expect(totals.total).toBe(taka(1_600))
    expect(totals.paid).toBe(taka(1_500))
    expect(totals.due).toBe(taka(100))
    expect(totals.refunded).toBe(0)
  })

  it('caps discounts at the amount being discounted', () => {
    const totals = computeInvoiceTotals({
      lines: [{ unitPrice: taka(100), quantity: 1, discount: taka(10_000) }],
      invoiceDiscount: taka(50),
      payments: []
    })
    expect(totals.discountTotal).toBe(taka(100))
    expect(totals.total).toBe(0)
    expect(totals.due).toBe(0)
  })

  it('separates refunds from payments and never reports a negative balance', () => {
    const totals = computeInvoiceTotals({
      lines: [{ unitPrice: taka(1_000), quantity: 1, discount: 0 }],
      invoiceDiscount: 0,
      payments: [taka(1_000), -taka(250)]
    })
    expect(totals.paid).toBe(taka(1_000))
    expect(totals.refunded).toBe(taka(250))
    expect(totals.due).toBe(taka(250))

    const overpaid = computeInvoiceTotals({
      lines: [{ unitPrice: taka(100), quantity: 1, discount: 0 }],
      invoiceDiscount: 0,
      payments: [taka(500)]
    })
    expect(overpaid.due).toBe(0)
  })

  it('maps totals onto the invoice status the register shows', () => {
    expect(invoiceStatusFor(taka(100), 0, false)).toBe('unpaid')
    expect(invoiceStatusFor(taka(100), taka(40), false)).toBe('partial')
    expect(invoiceStatusFor(taka(100), taka(100), false)).toBe('paid')
    expect(invoiceStatusFor(taka(100), taka(150), false)).toBe('paid')
    // A void invoice is void whatever was paid against it.
    expect(invoiceStatusFor(taka(100), taka(100), true)).toBe('void')
  })
})

describe('amount input', () => {
  it('parses what an operator types, in both scripts and with separators', () => {
    expect(parseAmountToMicro('1234.50')).toBe(taka(1_234.5))
    expect(parseAmountToMicro('1,234.50')).toBe(taka(1_234.5))
    expect(parseAmountToMicro('৳ 500')).toBe(taka(500))
    expect(parseAmountToMicro('BDT 250.25')).toBe(taka(250.25))
    // Bengali digits are converted at the input-contract level (`bengaliDigitsToAscii`), so this
    // helper refuses them rather than silently reading a different number.
    expect(() => parseAmountToMicro(' ১০০ ')).toThrow()
    expect(parseAmountToMicro(1_234.5)).toBe(taka(1_234.5))
    expect(parseAmountToMicro(0)).toBe(0)
    expect(parseAmountToMicro('0.0001')).toBe(1)
  })

  it('refuses malformed or absurd amounts instead of guessing', () => {
    for (const bad of ['', '   ', '-', '1.2k', 'abc', '12,34,567.00001', '1e5', '.5', '1.']) {
      expect(() => parseAmountToMicro(bad), `${bad} should be refused`).toThrow()
    }
    expect(() => parseAmountToMicro(Number.NaN)).toThrow()
    expect(() => parseAmountToMicro(Number.POSITIVE_INFINITY)).toThrow()
    // 12 digits (the maximum the parser accepts) can still exceed the supported range.
    expect(() => parseAmountToMicro('999999999999.99')).toThrow(/range/i)
    expect(() => parseAmountToMicro('9999999999999')).toThrow()
  })
})

describe('display formatting', () => {
  it('writes Taka the way a Bangladeshi receipt does', () => {
    expect(formatBDT(taka(4_500))).toBe('৳ 4,500.00')
    expect(formatBDT(taka(100_000))).toBe('৳ 1,00,000.00')
    expect(formatBDT(taka(10_000_000))).toBe('৳ 1,00,00,000.00')
    expect(formatBDT(0)).toBe('৳ 0.00')
    expect(formatBDT(0, { compactZero: true })).toBe('৳ 0')
    expect(formatBDT(-taka(250.5))).toBe('-৳ 250.50')
    expect(formatBDT(taka(12), { symbol: false })).toBe('12.00')
  })

  it('writes plain amounts for inputs, CSV and PDF tables', () => {
    expect(formatAmountPlain(taka(4_500))).toBe('4,500.00')
    expect(formatAmountPlain(taka(4_500), false)).toBe('4,500')
    // `withDecimals: false` drops the trailing `.00` but keeps any real fraction.
    expect(formatAmountPlain(-taka(0.5), false)).toBe('-0.5')
    expect(formatAmountPlain(-taka(2), false)).toBe('-2')
  })

  it('shortens dashboard figures with lakh and crore, not thousands of digits', () => {
    expect(formatBDTShort(taka(950))).toBe(formatBDT(taka(950)))
    expect(formatBDTShort(taka(12_500))).toBe('৳ 12.5K')
    expect(formatBDTShort(taka(250_000))).toBe('৳ 2.50L')
    expect(formatBDTShort(taka(20_000_000))).toBe('৳ 2.00Cr')
    expect(formatBDTShort(-taka(250_000))).toBe('-৳ 2.50L')
  })
})
