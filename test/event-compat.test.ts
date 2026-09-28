/**
 * Event layout across the referral release.
 *
 * The program now *appends* `ts`, the rate and an optional referral id to
 * `Staked` / `Unstaked`. On-chain history spans both shapes, and history is read
 * retroactively (no indexer), so the client has to decode pre-upgrade and
 * post-upgrade events alike. This test pins both directions: a real pre-upgrade
 * mainnet fixture on one side, a synthetic post-upgrade payload on the other,
 * and the strict generated codec documented as the reason the tolerant decoder
 * exists.
 */
import { describe, expect, it } from 'vitest'

import {
  decodeStakedEvent,
  decodeUnstakedEvent,
  eventsFromLogs,
  PROGRAM_DATA_PREFIX,
} from '../src/events'
import {
  STAKED_EVENT_DISCRIMINATOR,
  getStakedEventCodec,
} from '../src/generated/events/staked'
import {
  UNSTAKED_EVENT_DISCRIMINATOR,
  getUnstakedEventCodec,
} from '../src/generated/events/unstaked'
import { loadFixture } from './helpers'

interface EventFixtureFile {
  receiptAccount: string
  transactions: { signature: string; slot: number; blockTime: number | null; events: string[] }[]
}

const fixture = loadFixture<EventFixtureFile>('staking-events.json')

/** The real pre-upgrade `Staked` payload captured from mainnet. */
const oldStaked = () =>
  Uint8Array.from(atob(fixture.transactions[0]!.events[0]!), c => c.charCodeAt(0))

const u64 = (v: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, v, true)
  return b
}

const i64 = (v: bigint) => {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigInt64(0, v, true)
  return b
}

/** The tail the upgraded program appends: i64 ts, u64 rate, Option<String>. */
function tail(ts: bigint, rate: bigint, referralId: string | null): Uint8Array {
  const id = referralId === null ? new Uint8Array(0) : new TextEncoder().encode(referralId)
  // Borsh Option: a lone 0x00 tag for None, else 0x01 + u32 length + bytes.
  const out = new Uint8Array(referralId === null ? 17 : 21 + id.length)
  out.set(i64(ts), 0)
  out.set(u64(rate), 8)
  out[16] = referralId === null ? 0 : 1
  if (referralId !== null) {
    new DataView(out.buffer).setUint32(17, id.length, true)
    out.set(id, 21)
  }
  return out
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const TS = 1_789_995_600n
const RATE = 100_416n

describe('Staked across the referral release', () => {
  it('reads a pre-upgrade mainnet event, with no appended fields', () => {
    const event = decodeStakedEvent(oldStaked())
    expect(event).not.toBeNull()
    expect(event!.amount).toBeGreaterThan(0n)
    // The compatibility property historical accounting depends on.
    expect(event!.ts).toBeNull()
    expect(event!.stakeRate).toBeNull()
    expect(event!.referralId).toBeNull()
  })

  it('reads a post-upgrade event and surfaces the referral id', () => {
    const upgraded = concat(oldStaked(), tail(TS, RATE, 'partner-42'))
    const event = decodeStakedEvent(upgraded)
    expect(event).not.toBeNull()
    expect(event!.ts).toBe(TS)
    expect(event!.stakeRate).toBe(RATE)
    expect(event!.referralId).toBe('partner-42')
  })

  it('reads a post-upgrade event with no referral id too', () => {
    const upgraded = concat(oldStaked(), tail(TS, RATE, null))
    const event = decodeStakedEvent(upgraded)
    expect(event!.referralId).toBeNull()
    expect(event!.ts).toBe(TS)
  })

  it('yields identical core fields in both shapes', () => {
    const before = decodeStakedEvent(oldStaked())!
    const after = decodeStakedEvent(concat(oldStaked(), tail(TS, RATE, 'partner-42')))!
    expect({
      pool: after.pool,
      staker: after.staker,
      amount: after.amount,
      receiptAmount: after.receiptAmount,
    }).toEqual({
      pool: before.pool,
      staker: before.staker,
      amount: before.amount,
      receiptAmount: before.receiptAmount,
    })
  })

  it('documents why the tolerant decoder exists: the generated codec cannot read history', () => {
    // The generated codec describes the current shape only, so a pre-upgrade
    // event throws. If this ever stops throwing, the wrapper may be redundant —
    // but only then.
    expect(() => getStakedEventCodec().decode(oldStaked())).toThrow()
  })
})

describe('Unstaked across the referral release', () => {
  const pool = new Uint8Array(32).fill(1)
  const claimer = new Uint8Array(32).fill(2)
  const prefix = concat(
    UNSTAKED_EVENT_DISCRIMINATOR,
    pool,
    claimer,
    u64(1_000_000n), // receipt_amount
    u64(990_000n), // payout
    u64(7n), // nonce
  )

  it('reads a pre-upgrade event with no appended fields', () => {
    const event = decodeUnstakedEvent(prefix)
    expect(event!.nonce).toBe(7n)
    expect(event!.payout).toBe(990_000n)
    expect(event!.unstakeRate).toBeNull()
    expect(event!.referralId).toBeNull()
  })

  it('reads a post-upgrade event and surfaces the referral id', () => {
    const event = decodeUnstakedEvent(concat(prefix, tail(TS + 3600n, 99_411n, 'partner-42')))
    expect(event!.nonce).toBe(7n)
    expect(event!.ts).toBe(TS + 3600n)
    expect(event!.unstakeRate).toBe(99_411n)
    expect(event!.referralId).toBe('partner-42')
  })

  it('the generated codec also rejects the pre-upgrade shape', () => {
    expect(() => getUnstakedEventCodec().decode(prefix)).toThrow()
  })
})

describe('eventsFromLogs', () => {
  it('picks lifecycle events out of log lines and skips everything else', () => {
    const b64 = Buffer.from(oldStaked()).toString('base64')
    const logs = [
      'Program 11111111111111111111111111111111 invoke [1]',
      `${PROGRAM_DATA_PREFIX}${b64}`,
      'Program log: Instruction: Stake',
      'Program data: not-base64!!',
      'Program 11111111111111111111111111111111 success',
    ]
    const events = eventsFromLogs(logs)
    expect(events.length).toBe(1)
    expect(events[0]!.name).toBe('Staked')
  })

  it('is empty for logs with no events', () => {
    expect(eventsFromLogs(['Program log: Instruction: Initialize'])).toEqual([])
  })
})
