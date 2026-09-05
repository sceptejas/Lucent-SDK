import type { PublicKey } from '@solana/web3.js'

/** On-chain Pool account layout */
export interface Pool {
  id: number
  manager: PublicKey
  oracle: PublicKey
  stakeToken: PublicKey
  receiptToken: PublicKey
  /** Fixed-point rate. `RATE_DENOM = 100_000`. receipt = amount * RATE_DENOM / stakeRate */
  stakeRate: bigint
  /** Fixed-point rate. `RATE_DENOM = 100_000`. payout = receipts * unstakeRate / RATE_DENOM */
  unstakeRate: bigint
  receiptMaxSupply: bigint
  nonce: bigint
  settleHead: bigint
  pendingPayouts: bigint
  settledPayouts: bigint
  reserveBps: number
  strategy: PublicKey | null
  strategyActivatesAt: bigint
  pendingWithdrawAmount: bigint
  withdrawUnlocksAt: bigint
  bump: number
  receiptBump: number
  /** 0 = no minimum. Stakes below this fail with BelowMinimumDeposit. */
  minDepositAmount: bigint
}

/** On-chain ClaimRecord account layout */
export interface ClaimRecord {
  poolId: number
  claimer: PublicKey
  nonce: bigint
  receiptAmount: bigint
  payout: bigint
  settled: boolean
  cancelled: boolean
}

/** Decoded ClaimRecord with its on-chain address */
export interface UserClaim {
  address: PublicKey
  poolId: number
  claimer: PublicKey
  nonce: number
  receiptAmount: bigint
  payout: bigint
  settled: boolean
  cancelled: boolean
}

/** On-chain Global config account layout */
export interface Global {
  admin: PublicKey
  count: number
  withdrawDelay: bigint
  bump: number
}

/**
 * Lifecycle state of a UserClaim.
 * - `pending`   — in the FIFO queue, not yet settled
 * - `claimable` — settled, ready to claim
 * - `cancelled` — user left the queue via cancelUnstake
 */
export type ClaimState = 'pending' | 'claimable' | 'cancelled'

/** Token supported by the protocol */
export type SupportedToken = 'USDC' | 'SOL'

/** Pool IDs for supported tokens */
export const POOL_ID: Record<SupportedToken, number> = {
  USDC: 0,
  SOL: 1,
}

/** Decimals for supported tokens */
export const TOKEN_DECIMALS: Record<SupportedToken, number> = {
  USDC: 6,
  SOL: 9,
}

/** The fixed-point denominator used for rate math */
export const RATE_DENOM = 100_000n
