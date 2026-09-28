/**
 * Event history decoding.
 *
 * `emit!` writes an event into the transaction log as `Program data: <base64>`:
 * an 8-byte discriminator, then Borsh fields. The program **appends** fields to
 * `Staked` / `Unstaked` over time — `ts`, the rate, and an optional referral id
 * arrived with the referral release — while on-chain history spans both shapes.
 *
 * The generated codecs describe the current shape only, and that cuts both ways:
 * decoding a pre-upgrade event with them throws, and decoding a new event with a
 * stale codec silently drops the tail. History here is read *retroactively*
 * (there is no indexer), so both directions matter. Everything below therefore
 * reads the fields that have always existed, then reads the appended ones only
 * if the payload still has bytes for them.
 *
 * Pre-upgrade events decode with `ts`, the rate and `referralId` as `null`;
 * post-upgrade events carry them. Callers that just total deposits cannot tell
 * the difference — which is exactly the property that keeps historical
 * accounting intact across the upgrade.
 */
import {
  addDecoderSizePrefix,
  getAddressDecoder,
  getI64Decoder,
  getOptionDecoder,
  getU32Decoder,
  getU64Decoder,
  getUtf8Decoder,
  isSome,
  type Address,
  type ReadonlyUint8Array,
} from '@solana/kit'

import { STAKED_EVENT_DISCRIMINATOR } from './generated/events/staked'
import { UNSTAKED_EVENT_DISCRIMINATOR } from './generated/events/unstaked'

/** Prefix of an Anchor event line in `meta.logMessages`. */
export const PROGRAM_DATA_PREFIX = 'Program data: '

/** Smallest well-formed appended tail: i64 ts + u64 rate + Option tag (None). */
const APPENDED_MIN_BYTES = 8 + 8 + 1

export type StakedHistoryEvent = {
  name: 'Staked'
  pool: Address
  staker: Address
  amount: bigint
  receiptAmount: bigint
  /** Appended by the referral release; `null` on pre-upgrade events. */
  ts: bigint | null
  stakeRate: bigint | null
  referralId: string | null
}

export type UnstakedHistoryEvent = {
  name: 'Unstaked'
  pool: Address
  claimer: Address
  receiptAmount: bigint
  payout: bigint
  nonce: bigint
  ts: bigint | null
  unstakeRate: bigint | null
  referralId: string | null
}

export type LifecycleEvent = StakedHistoryEvent | UnstakedHistoryEvent

const addressDecoder = getAddressDecoder()
const u64Decoder = getU64Decoder()
const i64Decoder = getI64Decoder()
const optionIdDecoder = getOptionDecoder(
  addDecoderSizePrefix(getUtf8Decoder(), getU32Decoder()),
)

function matchesDiscriminator(bytes: Uint8Array, discriminator: ReadonlyUint8Array): boolean {
  if (bytes.length < 8) return false
  for (let i = 0; i < 8; i++) if (bytes[i] !== discriminator[i]) return false
  return true
}

/**
 * Read the fields appended after the original four/five, if the payload has
 * room for them. A truncated tail is treated as absent rather than fatal: the
 * original fields are already decoded and are what accounting depends on.
 */
function decodeAppended(
  bytes: Uint8Array,
  offset: number,
): [bigint | null, bigint | null, string | null, number] {
  if (bytes.length - offset < APPENDED_MIN_BYTES) return [null, null, null, offset]
  let ts: bigint
  let rate: bigint
  let referralId: string | null
  ;[ts, offset] = i64Decoder.read(bytes, offset)
  ;[rate, offset] = u64Decoder.read(bytes, offset)
  const [option, next] = optionIdDecoder.read(bytes, offset)
  // kit models `Option<T>` as a discriminated union, not `T | null`.
  return [ts, rate, isSome(option) ? option.value : null, next]
}

/** Decode a `Staked` event payload, tolerating both pre- and post-upgrade shapes. */
export function decodeStakedEvent(bytes: Uint8Array): StakedHistoryEvent | null {
  if (!matchesDiscriminator(bytes, STAKED_EVENT_DISCRIMINATOR)) return null
  let offset = 8
  let pool: Address
  let staker: Address
  let amount: bigint
  let receiptAmount: bigint
  ;[pool, offset] = addressDecoder.read(bytes, offset)
  ;[staker, offset] = addressDecoder.read(bytes, offset)
  ;[amount, offset] = u64Decoder.read(bytes, offset)
  ;[receiptAmount, offset] = u64Decoder.read(bytes, offset)
  const [ts, stakeRate, referralId] = decodeAppended(bytes, offset)
  return { name: 'Staked', pool, staker, amount, receiptAmount, ts, stakeRate, referralId }
}

/** Decode an `Unstaked` event payload, tolerating both shapes. */
export function decodeUnstakedEvent(bytes: Uint8Array): UnstakedHistoryEvent | null {
  if (!matchesDiscriminator(bytes, UNSTAKED_EVENT_DISCRIMINATOR)) return null
  let offset = 8
  let pool: Address
  let claimer: Address
  let receiptAmount: bigint
  let payout: bigint
  let nonce: bigint
  ;[pool, offset] = addressDecoder.read(bytes, offset)
  ;[claimer, offset] = addressDecoder.read(bytes, offset)
  ;[receiptAmount, offset] = u64Decoder.read(bytes, offset)
  ;[payout, offset] = u64Decoder.read(bytes, offset)
  ;[nonce, offset] = u64Decoder.read(bytes, offset)
  const [ts, unstakeRate, referralId] = decodeAppended(bytes, offset)
  return {
    name: 'Unstaked',
    pool,
    claimer,
    receiptAmount,
    payout,
    nonce,
    ts,
    unstakeRate,
    referralId,
  }
}

/** Decode either lifecycle event, or `null` for any other program log line. */
export function decodeLifecycleEvent(bytes: Uint8Array): LifecycleEvent | null {
  return decodeStakedEvent(bytes) ?? decodeUnstakedEvent(bytes)
}

/**
 * Decode every lifecycle event out of a transaction's `meta.logMessages`.
 *
 * Unknown and unparseable lines are skipped, so a whole transaction's logs can
 * be passed in safely.
 */
export function eventsFromLogs(logMessages: readonly string[]): LifecycleEvent[] {
  const events: LifecycleEvent[] = []
  for (const line of logMessages) {
    if (!line.startsWith(PROGRAM_DATA_PREFIX)) continue
    let bytes: Uint8Array
    try {
      const binary = atob(line.slice(PROGRAM_DATA_PREFIX.length))
      bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    } catch {
      continue
    }
    const event = decodeLifecycleEvent(bytes)
    if (event) events.push(event)
  }
  return events
}
