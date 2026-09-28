/**
 * Amount handling.
 *
 * This is where v0 lost money: `BigInt(Math.floor(amount * 10 ** decimals))`.
 * Float error can land a hair low and floor a lamport off a deposit, silently.
 * The tests below are the properties that must hold whatever the input.
 */
import { describe, expect, it } from 'vitest'

import {
  RATE_DENOM,
  formatAmount,
  formatAmountExact,
  formatPercent,
  formatSignedAmount,
  parseAmount,
  percentOf,
  receiptPrice,
  stakePrice,
} from '../src/amounts'
import { applySlippage } from '../src/actions'
import { InvalidAmountError } from '../src/errors'

describe('parseAmount', () => {
  it('parses exactly, including values a float would round', () => {
    expect(parseAmount('1.5', 9)).toBe(1_500_000_000n)
    expect(parseAmount('0.1', 9)).toBe(100_000_000n)
    // 0.1 + 0.2 === 0.30000000000000004 in float arithmetic; as a string it is
    // simply 0.3, and this is the reason the API takes a string.
    expect(parseAmount('0.3', 9)).toBe(300_000_000n)
    expect(parseAmount('123456789.123456789', 9)).toBe(123_456_789_123_456_789n)
    expect(parseAmount('0', 6)).toBe(0n)
    expect(parseAmount('.5', 6)).toBe(500_000n)
  })

  it('refuses more decimals than the token has instead of truncating', () => {
    expect(() => parseAmount('1.0000001', 6)).toThrow(InvalidAmountError)
    // The truncating behaviour this replaces would have returned 1_000_000n.
    expect(parseAmount('1.000001', 6)).toBe(1_000_001n)
  })

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['', ' ', '.', '-1', '1e9', '1,000', '1.2.3', 'abc', '0x10']) {
      expect(() => parseAmount(bad, 9)).toThrow(InvalidAmountError)
    }
  })

  it('round-trips through formatting for every magnitude band', () => {
    for (const [value, decimals] of [
      ['1234.567891', 9],
      ['12.345678', 9],
      ['0.123456789', 9],
      ['999999.999999', 6],
      ['1', 6],
    ] as const) {
      const raw = parseAmount(value, decimals)
      expect(parseAmount(formatAmountExact(raw, decimals), decimals)).toBe(raw)
    }
  })
})

describe('formatAmount', () => {
  it('picks precision by magnitude', () => {
    expect(formatAmount(parseAmount('1234.567891', 9), 9)).toBe('1,234.56')
    expect(formatAmount(parseAmount('12.345678', 9), 9)).toBe('12.3456')
    expect(formatAmount(parseAmount('0.123456789', 9), 9)).toBe('0.123456')
    expect(formatAmount(parseAmount('1234.5', 9), 9, { grouping: false })).toBe('1234.5')
  })

  it('never shows a real amount as zero', () => {
    expect(formatAmount(1n, 9)).toBe('<0.000001')
    expect(formatAmount(0n, 9)).toBe('0')
  })

  it('carries the sign through formatSignedAmount', () => {
    expect(formatSignedAmount(1_500_000_000n, 9)).toBe('+1.5')
    expect(formatSignedAmount(-1_500_000_000n, 9)).toBe('-1.5')
    expect(formatSignedAmount(0n, 9)).toBe('0')
    // Sub-resolution values round to zero rather than printing "-<0.0001".
    expect(formatSignedAmount(-1n, 9)).toBe('0')
  })

  it('exports full precision, unlike display formatting', () => {
    expect(formatAmountExact(123_456_789_123_456_789n, 9)).toBe('123456789.123456789')
    expect(formatAmount(123_456_789_123_456_789n, 9)).toBe('123,456,789.12')
  })
})

describe('rates and percentages', () => {
  it('prices a receipt from the redeem rate', () => {
    expect(receiptPrice(99_407n)).toBeCloseTo(0.99407, 10)
    expect(stakePrice(100_412n)).toBeCloseTo(100_000 / 100_412, 10)
    // The two are inverses at the same rate, which is what makes the spread the
    // ratio between them.
    expect(receiptPrice(RATE_DENOM) * stakePrice(RATE_DENOM)).toBeCloseTo(1, 12)
  })

  it('returns null rather than Infinity for a zero denominator', () => {
    expect(percentOf(1n, 0n)).toBeNull()
    expect(formatPercent(null)).toBe('—')
    expect(percentOf(-1n, 100n)).toBe(-1)
    expect(formatPercent(1.234)).toBe('+1.23%')
    expect(formatPercent(-1.234)).toBe('-1.23%')
  })
})

describe('applySlippage', () => {
  it('is the minimum received, so it can only reduce', () => {
    expect(applySlippage(1_000_000n, 0)).toBe(1_000_000n)
    expect(applySlippage(1_000_000n, 50)).toBe(995_000n)
    expect(applySlippage(1_000_000n, 10_000)).toBe(0n)
  })

  it('refuses a nonsensical tolerance instead of inverting the guard', () => {
    expect(() => applySlippage(1_000_000n, -1)).toThrow()
    expect(() => applySlippage(1_000_000n, 10_001)).toThrow()
    // At 10_000 bps the floor is zero, which is a valid (if reckless) choice, but
    // anything above it would mean accepting *more* than the quoted amount.
    expect(() => applySlippage(1_000_000n, 20_000)).toThrow()
  })
})
