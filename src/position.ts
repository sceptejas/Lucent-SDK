/**
 * The position model.
 *
 * Denominated in the receipt token — what the wallet actually holds — because
 * that is the unit the protocol speaks and the unit that makes the entry spread
 * disappear without hiding anything. A deposit converts to receipts at the rate
 * it was minted at, so "what I hold" minus "what I staked" is already pure
 * accrued yield: there is no spread to explain, subtract, or apologise for.
 *
 * The maths here is a port of the accounting already verified against mainnet
 * wallets in the website:
 *
 *   v0 / naive:  net = receipts + inFlight + withdrawn − deposited
 *                (this is the redemption basis; a fresh deposit reads ~1% down)
 *
 *   what we show: yield = net + entrySpread
 *                (the round-trip spread is unrealised while the position is held,
 *                 so it is netted back out; the redemption figure stays available)
 *
 * Two things it deliberately does NOT do: count a spread already paid on a
 * completed redemption as recoverable, or count receipts received from another
 * holder as yield — that value was never staked, so its worth is subtracted.
 */
import type { HostedPosition } from './api'
import type { PoolMetadata } from './config'
import { RATE_DENOM, percentOf, receiptPrice } from './amounts'

export interface PositionInFlight {
  /** Receipts burned, payout queued in the FIFO settlement queue. */
  pending: bigint
  /** Receipts burned, payout settled and waiting to be pulled. */
  claimable: bigint
  /** Pending + claimable, in receipt units. */
  total: bigint
}

export interface Position {
  poolId: number
  symbol: string
  receiptSymbol: string
  decimals: number

  /** Receipts held right now — the headline number. */
  receipts: bigint
  /** What those receipts redeem for today, in stake-token units. */
  receiptValue: bigint
  /** Redemption price of one receipt, e.g. 0.99407. */
  price: number
  /** The pool rates this position was derived from, for exact recomputation. */
  rates: { stake: bigint; unstake: bigint; denom: bigint }

  /** Redemptions in flight, in receipt units. */
  inFlight: PositionInFlight

  /** Receipts staked, i.e. what the deposits would mint at today's rate. */
  staked: bigint
  /** Receipts received by transfer from another holder — never staked. */
  received: bigint
  /** Receipts already redeemed. */
  withdrawn: bigint

  /**
   * Accrued yield, in receipt units, with the unrealised round-trip spread
   * excluded. This is the figure a UI should lead with.
   */
  yieldEarned: bigint
  /** The same yield as a percentage of what was staked. */
  yieldPercent: number | null

  /**
   * Redemption-basis net: receipts + in-flight + withdrawn − staked. Lower than
   * `yieldEarned` by the entry spread. Exposed for completeness — a UI that leads
   * with it will show every fresh deposit as a loss.
   */
  netRedemptionValue: bigint

  /** Underlying amounts, for callers that want them. */
  underlying: {
    deposited: bigint
    withdrawn: bigint
    pending: bigint
    claimable: bigint
    netYield: bigint
    entrySpread: bigint
  }
}

/** Convert an underlying amount into receipt units at the rate that produced it. */
const toReceipts = (amount: bigint, rate: bigint, rateDenom: bigint): bigint =>
  amount === 0n || rate <= 0n ? 0n : (amount * rateDenom) / rate

/**
 * Build the display model from a hosted position.
 *
 * Pure: no network, no clock, no globals — so it is the part worth testing
 * exhaustively, and it is where every rounding decision lives.
 */
export function toPosition(position: HostedPosition, metadata: PoolMetadata): Position {
  const rateDenom = position.rateDenom > 0n ? position.rateDenom : RATE_DENOM
  const { stakeRate, unstakeRate } = position

  const inFlightReceipts = toReceipts(position.pending + position.claimable, unstakeRate, rateDenom)
  const stakedReceipts = toReceipts(position.totalDeposited, stakeRate, rateDenom)
  const withdrawnReceipts = toReceipts(position.totalWithdrawn, unstakeRate, rateDenom)

  // The spread a round trip would cost on what was staked, in underlying units.
  const entrySpread =
    stakeRate > 0n ? (position.totalDeposited * (stakeRate - unstakeRate)) / stakeRate : 0n

  // `netYield` already has the value of transferred-in receipts taken off, so a
  // gift never shows up as profit.
  const yieldUnderlying = position.netYield + entrySpread
  const yieldReceipts = toReceipts(yieldUnderlying, unstakeRate, rateDenom)

  return {
    poolId: position.poolId,
    symbol: metadata?.symbol ?? position.symbol,
    receiptSymbol: metadata?.receiptSymbol ?? position.receiptSymbol,
    decimals: position.decimals,

    receipts: position.receiptBalance,
    receiptValue: position.currentValue,
    price: receiptPrice(unstakeRate, rateDenom),
    rates: { stake: stakeRate, unstake: unstakeRate, denom: rateDenom },

    inFlight: {
      pending: toReceipts(position.pending, unstakeRate, rateDenom),
      claimable: toReceipts(position.claimable, unstakeRate, rateDenom),
      total: inFlightReceipts,
    },

    staked: stakedReceipts,
    received: position.transferReceipts,
    withdrawn: withdrawnReceipts,

    yieldEarned: yieldReceipts,
    yieldPercent: percentOf(yieldUnderlying, position.totalDeposited),

    netRedemptionValue: position.netYield,

    underlying: {
      deposited: position.totalDeposited,
      withdrawn: position.totalWithdrawn,
      pending: position.pending,
      claimable: position.claimable,
      netYield: position.netYield,
      entrySpread,
    },
  }
}

/** True when the wallet holds nothing and has nothing in flight. */
export function isClosed(position: Position): boolean {
  return position.receipts === 0n && position.inFlight.total === 0n
}
