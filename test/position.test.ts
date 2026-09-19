/**
 * The accounting, as properties rather than examples.
 *
 * Each case here is a way the displayed number was wrong at some point: a fresh
 * deposit reading as a loss, a mid-redemption wallet reading as a loss, a gift
 * reading as yield.
 */
import { describe, expect, it } from 'vitest'

import { isClosed, toPosition } from '../src/position'
import { POOLS } from '../src/config'
import type { HostedPosition } from '../src/api'

const DENOM = 100_000n
const STAKE_RATE = 100_412n
const UNSTAKE_RATE = 99_407n

/** Build a hosted position the way the API would, given underlying amounts. */
function hosted(overrides: Partial<HostedPosition> = {}): HostedPosition {
  return {
    poolId: 1,
    symbol: 'SOL',
    receiptSymbol: 'lmSOL',
    decimals: 9,
    receiptBalance: 0n,
    currentValue: 0n,
    pending: 0n,
    claimable: 0n,
    totalDeposited: 0n,
    totalWithdrawn: 0n,
    netYield: 0n,
    stakeRate: STAKE_RATE,
    unstakeRate: UNSTAKE_RATE,
    rateDenom: DENOM,
    transferReceipts: 0n,
    ...overrides,
  }
}

/** A deposit of `amount` and nothing else. */
function freshDeposit(amount: bigint): HostedPosition {
  const receipts = (amount * DENOM) / STAKE_RATE
  const value = (receipts * UNSTAKE_RATE) / DENOM
  return hosted({
    receiptBalance: receipts,
    currentValue: value,
    totalDeposited: amount,
    netYield: value - amount,
  })
}

describe('a fresh deposit', () => {
  it('reads as roughly flat, not as a loss', () => {
    const position = toPosition(freshDeposit(1_000_000_000n), POOLS[1])
    // The redemption basis is lower by the spread...
    expect(position.netRedemptionValue).toBeLessThan(0n)
    // ...and the spread is exactly what the yield figure nets out.
    expect(position.underlying.entrySpread).toBeGreaterThan(0n)
    expect(position.yieldEarned).toBeGreaterThanOrEqual(-2n)
    expect(Math.abs(position.yieldPercent ?? 1)).toBeLessThan(0.05)
  })

  it('keeps the redemption figure available rather than hiding it', () => {
    const position = toPosition(freshDeposit(1_000_000_000n), POOLS[1])
    expect(position.netRedemptionValue).toBe(position.receiptValue - position.underlying.deposited)
  })

  it('is exactly flat when the two rates are equal', () => {
    const amount = 1_000_000_000n
    const receipts = (amount * DENOM) / STAKE_RATE
    const position = toPosition(
      hosted({
        receiptBalance: receipts,
        currentValue: (receipts * STAKE_RATE) / DENOM,
        totalDeposited: amount,
        netYield: 0n,
        unstakeRate: STAKE_RATE,
      }),
      POOLS[1],
    )
    expect(position.underlying.entrySpread).toBe(0n)
    expect(position.yieldEarned).toBe(0n)
    expect(position.yieldPercent).toBe(0)
  })
})

describe('an accrued gain', () => {
  it('shows as yield, in receipt units, once it clears the spread', () => {
    const amount = 1_000_000_000n
    const receipts = (amount * DENOM) / STAKE_RATE
    const gain = 50_000_000n
    const value = (receipts * UNSTAKE_RATE) / DENOM + gain
    const position = toPosition(
      hosted({
        receiptBalance: receipts,
        currentValue: value,
        totalDeposited: amount,
        netYield: value - amount,
      }),
      POOLS[1],
    )
    expect(position.yieldEarned).toBeGreaterThan(0n)
    expect(position.yieldPercent).toBeGreaterThan(0)
    // Receipt-denominated yield is the value figure expressed at the redeem rate.
    expect(position.yieldEarned).toBe(
      ((position.underlying.netYield + position.underlying.entrySpread) * DENOM) / UNSTAKE_RATE,
    )
  })
})

describe('receipts that were transferred in', () => {
  it('are not counted as yield', () => {
    const amount = 1_000_000_000n
    const receipts = (amount * DENOM) / STAKE_RATE
    const gift = 5_000_000n // receipts, minted by someone else

    // The API has already subtracted the gift's value from netYield; the position
    // must not add it back through its own arithmetic.
    const value = ((receipts + gift) * UNSTAKE_RATE) / DENOM
    const giftValue = (gift * UNSTAKE_RATE) / DENOM
    const position = toPosition(
      hosted({
        receiptBalance: receipts + gift,
        currentValue: value,
        totalDeposited: amount,
        netYield: value - amount - giftValue,
        transferReceipts: gift,
      }),
      POOLS[1],
    )

    expect(position.received).toBe(gift)
    expect(position.yieldEarned).toBeGreaterThanOrEqual(-2n)
    expect(Math.abs(position.yieldPercent ?? 1)).toBeLessThan(0.05)
  })
})

describe('a mid-redemption wallet', () => {
  it('counts in-flight receipts as still owned', () => {
    const amount = 1_000_000_000n
    const receipts = (amount * DENOM) / STAKE_RATE
    const burned = receipts / 2n
    const payout = (burned * UNSTAKE_RATE) / DENOM

    const position = toPosition(
      hosted({
        receiptBalance: receipts - burned,
        currentValue: ((receipts - burned) * UNSTAKE_RATE) / DENOM,
        pending: payout,
        totalDeposited: amount,
        netYield: payout + ((receipts - burned) * UNSTAKE_RATE) / DENOM - amount,
      }),
      POOLS[1],
    )

    // Burning receipts must not look like losing them: the payout is an asset.
    expect(position.inFlight.pending).toBeGreaterThan(0n)
    expect(position.inFlight.total).toBe(position.inFlight.pending + position.inFlight.claimable)
    expect(isClosed(position)).toBe(false)

    // No yield accrued, so the figure must be flat. The bound is lamport-scale
    // rather than exact because this fixture floors at each of four separate
    // integer divisions — the real API computes the value in one step.
    expect(position.yieldEarned).toBeGreaterThanOrEqual(-5n)
    expect(position.yieldEarned).toBeLessThanOrEqual(5n)
  })
})

describe('a completed round trip at unchanged rates', () => {
  it('earns nothing, and the spread it paid is not reported as a loss', () => {
    const amount = 1_000_000_000n
    const receipts = (amount * DENOM) / STAKE_RATE
    const payout = (receipts * UNSTAKE_RATE) / DENOM

    // What the API would report: everything redeemed, so the net is minus the
    // spread — the cost of the round trip, already realised.
    const netYield = payout - amount
    expect(netYield).toBeLessThan(0n)

    const position = toPosition(
      hosted({
        receiptBalance: 0n,
        currentValue: 0n,
        pending: 0n,
        claimable: 0n,
        totalDeposited: amount,
        totalWithdrawn: payout,
        netYield,
      }),
      POOLS[1],
    )

    expect(isClosed(position)).toBe(true)
    // The realised spread is netted back out, because the yield figure answers
    // "what did this position earn", and the answer is nothing. What the wallet
    // actually received is `netRedemptionValue`, which stays negative.
    expect(position.yieldPercent).toBeGreaterThanOrEqual(-0.01)
    expect(position.yieldPercent).toBeLessThanOrEqual(0.01)
  })

  it('is closed when nothing is held and nothing is in flight', () => {
    const position = toPosition(
      hosted({ totalDeposited: 1_000n, totalWithdrawn: 1_000n, netYield: -10n }),
      POOLS[1],
    )
    expect(isClosed(position)).toBe(true)
  })
})
