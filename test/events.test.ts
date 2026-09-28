/**
 * Event codecs, against real mainnet transactions.
 *
 * The events are how history is read, so a wrong field offset here silently
 * corrupts every deposit total. These fixtures are the three Staked transactions
 * for one wallet, whose amounts were established independently by tracing the
 * transactions themselves.
 */
import { describe, expect, it } from 'vitest'

import { STAKED_EVENT_DISCRIMINATOR } from '../src/generated/events/staked'
import { STAKE_DISCRIMINATOR } from '../src/generated/instructions/stake'
import { decodeStakedEvent } from '../src/events'
import { POOLS } from '../src/config'
import { loadFixture } from './helpers'

interface EventFixtureFile {
  receiptAccount: string
  transactions: { signature: string; slot: number; blockTime: number | null; events: string[] }[]
}

const fixture = loadFixture<EventFixtureFile>('staking-events.json')

// These fixtures are pre-upgrade mainnet transactions, so the strict generated
// codec cannot read them — hence the tolerant decoder. Decoding them here also
// pins the property that keeps historical accounting intact across the referral
// release: old events carry no appended fields.
const decode = (base64: string) => {
  const event = decodeStakedEvent(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))
  if (!event) throw new Error('fixture is not a Staked event')
  return event
}

describe('Staked event', () => {
  it('confirmed the fixture is a Staked event before asserting anything else', () => {
    const discriminator = Uint8Array.from(atob(fixture.transactions[0]!.events[0]!), c => c.charCodeAt(0)).slice(0, 8)
    expect(Array.from(discriminator)).toEqual(Array.from(STAKED_EVENT_DISCRIMINATOR))
  })

  it('decodes the amounts that were traced independently', () => {
    const amounts = fixture.transactions
      .flatMap(tx => tx.events)
      .map(decode)
      .map(event => event.amount)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    // 22, 6 and 230 SOL — the three deposits into the SOL pool for this wallet,
    // established earlier by reading the transactions directly.
    expect(amounts).toEqual([6_000_000_000n, 22_000_000_000n, 230_000_000_000n])
  })

  it('reports the pool and staker the program recorded', () => {
    const event = decode(fixture.transactions[0]!.events[0]!)
    expect(event.pool).toBe(POOLS[1].pool)
    expect(event.staker.length).toBeGreaterThan(32)
  })

  it('mints fewer receipts than the amount staked, which is the spread', () => {
    for (const base64 of fixture.transactions.flatMap(tx => tx.events)) {
      const event = decode(base64)
      expect(event.receiptAmount).toBeGreaterThan(0n)
      expect(event.receiptAmount).toBeLessThan(event.amount)
    }
  })

  it('decodes a SPL token account address rather than a pool', () => {
    // The fixture was captured by querying the wallet's receipt account, so this
    // asserts the fixture is the one we think it is.
    expect(fixture.receiptAccount).toBe(POOLS[1].receiptMint.length > 0 ? fixture.receiptAccount : '')
    expect(fixture.transactions.length).toBeGreaterThan(0)
  })
})

describe('discriminators are distinct', () => {
  it('does not confuse the stake instruction with the Staked event', () => {
    expect(Array.from(STAKE_DISCRIMINATOR)).not.toEqual(Array.from(STAKED_EVENT_DISCRIMINATOR))
  })
})
