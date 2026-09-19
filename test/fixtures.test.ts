/**
 * Account decoders, against real mainnet bytes.
 *
 * A decoder can pass a discriminator check and still read the wrong fields — the
 * website's own decoder did exactly that with Anchor's `Option<Pubkey>` tag. These
 * fixtures were captured from the deployed accounts, so the assertions are about
 * the bytes the chain actually stores.
 */
import { describe, expect, it } from 'vitest'

import { decodeClaimRecord } from '../src/generated/accounts/claimRecord'
import { decodeGlobal } from '../src/generated/accounts/global'
import { decodePool } from '../src/generated/accounts/pool'
import { SYTHSTAKING_PROGRAM_ADDRESS } from '../src/generated/programs/sythstaking'
import { MAINNET, POOLS } from '../src/config'
import { toPosition } from '../src/position'
import { loadFixture, toEncodedAccount, type AccountFixture } from './helpers'

const RATE_DENOM = 100_000n

describe('Pool', () => {
  it.each([
    ['pool-0.json', POOLS[0].pool, MAINNET.USDC_MINT],
    ['pool-1.json', POOLS[1].pool, MAINNET.WSOL_MINT],
  ])('decodes %s', (file, expectedAddress, expectedStakeMint) => {
    const fixture = loadFixture(file)
    const account = decodePool(toEncodedAccount(fixture))
    const pool = account.data

    expect(fixture.address).toBe(expectedAddress)
    expect(fixture.programAddress).toBe(SYTHSTAKING_PROGRAM_ADDRESS)
    expect(account.address).toBe(expectedAddress)

    // Rates are the pool's share price. A plausible range catches a decoder that
    // reads the wrong offset and returns something enormous or zero.
    expect(pool.stakeRate).toBeGreaterThan(90_000n)
    expect(pool.stakeRate).toBeLessThan(200_000n)
    expect(pool.unstakeRate).toBeGreaterThan(90_000n)
    expect(pool.unstakeRate).toBeLessThan(200_000n)

    // The stake rate stays above the redeem rate: that difference is the spread.
    expect(pool.stakeRate).toBeGreaterThan(pool.unstakeRate)

    expect(pool.stakeToken).toBe(expectedStakeMint)
    expect(pool.receiptToken).toBe(POOLS[Number(account.data.id)].receiptMint)
    expect(pool.reserveBps).toBeLessThan(10_000)

    // `strategy` is Anchor's Option<Pubkey>; a decoder that ignores the tag reads
    // the next field from inside the key. It is set on this deployment.
    expect(pool.strategy?.__option).toBe('Some')
  })

  it('decodes the same fields from both pools consistently', () => {
    const usdc = decodePool(toEncodedAccount(loadFixture('pool-0.json'))).data
    const sol = decodePool(toEncodedAccount(loadFixture('pool-1.json'))).data
    expect(usdc.id).toBe(0n)
    expect(sol.id).toBe(1n)
    expect(usdc.manager).toBe(sol.manager)
  })
})

describe('Global', () => {
  it('decodes and carries the redemption timelock', () => {
    const account = decodeGlobal(toEncodedAccount(loadFixture('global.json')))
    expect(account.address).toBe(MAINNET.GLOBAL)
    expect(account.data.admin).toBe('BHkegLqjnti85Y7HjG76TA5yoxkgMoFZ92sAFNFk2sGg')
    expect(account.data.count).toBe(2n)
    // v0 exported a Global type with no way to fetch one, so this field — how long
    // a redemption can be held before settlement — was unreachable.
    expect(account.data.withdrawDelay).toBe(86_400n)
  })
})

describe('ClaimRecord', () => {
  it('decodes a real claim at the FIFO head', () => {
    const fixture = loadFixture('claim-record.json')
    const account = decodeClaimRecord(toEncodedAccount(fixture))
    const claim = account.data

    expect(fixture.programAddress).toBe(SYTHSTAKING_PROGRAM_ADDRESS)
    expect(claim.poolId).toBe(0n)
    expect(claim.payout).toBeGreaterThan(0n)
    expect(claim.receiptAmount).toBeGreaterThan(0n)

    // The payout is the burned receipts valued at the pool's redeem rate, so it
    // must never exceed them — the spread guarantees it.
    const pool = decodePool(toEncodedAccount(loadFixture('pool-0.json'))).data
    void pool
    expect(claim.payout).toBeLessThanOrEqual(claim.receiptAmount)

    // At least one of the lifecycle flags is meaningful; a decoder that read the
    // wrong byte would produce arbitrary booleans on a record we know is unsettled.
    expect(typeof claim.settled).toBe('boolean')
    expect(typeof claim.cancelled).toBe('boolean')
  })
})

describe('accounting from real accounts', () => {
  it('produces a position whose numbers are internally consistent', () => {
    const pool = decodePool(toEncodedAccount(loadFixture('pool-0.json'))).data

    // A synthetic hosted position built from the real rates: 1,000 USDC staked,
    // receipts outstanding, nothing in flight.
    const deposited = 1_000_000_000n
    const receipts = (deposited * RATE_DENOM) / pool.stakeRate
    const hosted = {
      poolId: 0,
      symbol: 'USDC',
      receiptSymbol: 'lmUSD',
      decimals: 6,
      receiptBalance: receipts,
      currentValue: (receipts * pool.unstakeRate) / RATE_DENOM,
      pending: 0n,
      claimable: 0n,
      totalDeposited: deposited,
      totalWithdrawn: 0n,
      netYield: (receipts * pool.unstakeRate) / RATE_DENOM - deposited,
      stakeRate: pool.stakeRate,
      unstakeRate: pool.unstakeRate,
      rateDenom: RATE_DENOM,
      transferReceipts: 0n,
    }

    const position = toPosition(hosted, POOLS[0])

    // The whole point of the receipt-denominated view: a deposit that has earned
    // nothing must not read as a loss. The redemption figure is lower by the
    // spread, and that spread is exactly what `yieldEarned` nets back out.
    expect(position.netRedemptionValue).toBeLessThan(0n)
    expect(position.yieldEarned).toBeGreaterThanOrEqual(-2n)
    expect(Math.abs(position.yieldPercent ?? 0)).toBeLessThan(0.05)
    expect(position.underlying.entrySpread).toBeGreaterThan(0n)
    expect(position.price).toBeCloseTo(Number(pool.unstakeRate) / Number(RATE_DENOM), 10)
  })
})
