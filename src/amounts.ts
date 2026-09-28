/**
 * Amount handling.
 *
 * v0 took `amount: number` and did `BigInt(Math.floor(amount * 10 ** decimals))`.
 * A float that lands a hair low (0.1 + 0.2 territory) then floors a lamport off
 * the deposit, silently, and `amount * 1e9` stops being exact above ~9M SOL.
 *
 * Here the boundary is explicit: humans pass strings, the API is base-unit
 * `bigint`, and there is exactly one place where one becomes the other.
 */
import { InvalidAmountError } from './errors'

/** Fixed-point denominator the program uses for its rates. */
export const RATE_DENOM = 100_000n

/**
 * Parse a human amount ("1.5") into base units, exactly.
 *
 * Rejects anything that is not a plain non-negative decimal, including exponent
 * notation and thousands separators — a silently-accepted "1,000" would be read
 * as 1. More fractional digits than the token has are rejected rather than
 * truncated, because truncation is the bug this function exists to prevent.
 */
export function parseAmount(human: string, decimals: number): bigint {
  if (typeof human !== 'string') throw new InvalidAmountError(human)
  const trimmed = human.trim()
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new InvalidAmountError(human)
  }

  const [whole = '', fraction = ''] = trimmed.split('.')
  if (fraction.length > decimals) {
    throw new InvalidAmountError(
      `${human} has ${fraction.length} decimal places but this token has ${decimals}. ` +
        'Round it before parsing rather than letting the SDK truncate it.',
    )
  }

  const padded = fraction.padEnd(decimals, '0')
  return BigInt(`${whole || '0'}${padded}`)
}

/**
 * Format base units for display, choosing precision by magnitude so a balance
 * reads like a balance: 1,234.56 / 12.3456 / 0.123456. Trailing zeros go, and a
 * value below the shown precision reads as `<0.000001` rather than a lying `0`.
 */
export function formatAmount(
  raw: bigint,
  decimals: number,
  options: { maxFractionDigits?: number; grouping?: boolean } = {},
): string {
  const negative = raw < 0n
  const absolute = negative ? -raw : raw

  const divisor = 10n ** BigInt(decimals)
  const whole = absolute / divisor
  const fraction = absolute % divisor

  const digits =
    options.maxFractionDigits ??
    (whole >= 1000n ? 2 : absolute >= divisor ? 4 : 6)

  const fractionText = fraction
    .toString()
    .padStart(decimals, '0')
    .slice(0, digits)
    .replace(/0+$/, '')

  if (whole === 0n && fractionText === '' && absolute > 0n) {
    return `${negative ? '-' : ''}<0.${'0'.repeat(Math.max(digits - 1, 0))}1`
  }

  const wholeText =
    options.grouping === false ? whole.toString() : whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${wholeText}${fractionText ? `.${fractionText}` : ''}`
}

/** Exact decimal for exports, where display rounding would be data loss. */
export function formatAmountExact(raw: bigint, decimals: number): string {
  const negative = raw < 0n
  const absolute = negative ? -raw : raw
  const divisor = 10n ** BigInt(decimals)
  const fraction = (absolute % divisor).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${negative ? '-' : ''}${absolute / divisor}${fraction ? `.${fraction}` : ''}`
}

/** A signed amount that always carries its direction: `+12.4`, `-0.89`, `0`. */
export function formatSignedAmount(raw: bigint, decimals: number, maxFractionDigits = 4): string {
  if (raw === 0n) return '0'
  const body = formatAmount(raw < 0n ? -raw : raw, decimals, { maxFractionDigits })
  if (body.startsWith('<')) return '0'
  return `${raw > 0n ? '+' : '-'}${body}`
}

/** `part / whole` as a percentage, or null when the denominator is zero. */
export function percentOf(part: bigint, whole: bigint): number | null {
  if (whole === 0n) return null
  return Number((part * 10_000n) / whole) / 100
}

export function formatPercent(percent: number | null, digits = 2): string {
  if (percent === null || !Number.isFinite(percent)) return '—'
  return `${percent > 0 ? '+' : ''}${percent.toFixed(digits)}%`
}

/**
 * What one receipt token redeems for, in stake-token units.
 *
 * Reads the `unstakeRate`, so it is the redemption price rather than a market
 * price: 0.99407 means one lmUSD currently redeems for 0.99407 USDC.
 */
export function receiptPrice(unstakeRate: bigint, rateDenom: bigint = RATE_DENOM): number {
  if (rateDenom === 0n) return Number.NaN
  return Number(unstakeRate) / Number(rateDenom)
}

/** How many receipt tokens one stake token mints at the current rate. */
export function stakePrice(stakeRate: bigint, rateDenom: bigint = RATE_DENOM): number {
  if (stakeRate === 0n) return Number.NaN
  return Number(rateDenom) / Number(stakeRate)
}
