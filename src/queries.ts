/**
 * Read-only functions for fetching on-chain state.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { getAccount, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { sha256 } from '@noble/hashes/sha2'
import { PROGRAM_ID, findPoolPda, findReceiptMintPda, findClaimRecordPda } from './addresses'
import type { Pool, UserClaim, Global, ClaimState } from './types'

// ── Account discriminators ─────────────────────────────────────────────────

function accountDisc(name: string): Uint8Array {
  return sha256(Buffer.from(`account:${name}`, 'utf8')).subarray(0, 8)
}

const CLAIM_RECORD_DISC = accountDisc('ClaimRecord')
const CLAIM_RECORD_SIZE = 74
const CLAIM_RECORD_CLAIMER_OFFSET = 16

// ── Pool ───────────────────────────────────────────────────────────────────

/**
 * Fetch and decode a Pool account.
 * Returns `null` if the pool does not exist yet.
 */
export async function fetchPool(
  connection: Connection,
  poolId: number,
): Promise<Pool | null> {
  try {
    const [poolKey] = findPoolPda(poolId)
    const info = await connection.getAccountInfo(poolKey)
    if (!info) return null

    const data = info.data
    let offset = 8

    const readU64 = (): bigint => {
      const v = new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true)
      offset += 8; return v
    }
    const readU16 = (): number => {
      const v = new DataView(data.buffer, data.byteOffset + offset, 2).getUint16(0, true)
      offset += 2; return v
    }
    const readU8 = (): number => { return data[offset++] }
    const readI64 = (): bigint => {
      const v = new DataView(data.buffer, data.byteOffset + offset, 8).getBigInt64(0, true)
      offset += 8; return v
    }
    const readPubkey = (): PublicKey => {
      const p = new PublicKey(data.subarray(offset, offset + 32))
      offset += 32; return p
    }
    const readOptionPubkey = (): PublicKey | null => {
      const flag = data[offset++]
      return flag === 1 ? readPubkey() : null
    }
    const readTrailingU64 = (): bigint =>
      offset + 8 <= data.length ? readU64() : 0n

    return {
      id: Number(readU64()),
      manager: readPubkey(),
      oracle: readPubkey(),
      stakeToken: readPubkey(),
      receiptToken: readPubkey(),
      stakeRate: readU64(),
      unstakeRate: readU64(),
      receiptMaxSupply: readU64(),
      nonce: readU64(),
      settleHead: readU64(),
      pendingPayouts: readU64(),
      settledPayouts: readU64(),
      reserveBps: readU16(),
      strategy: readOptionPubkey(),
      strategyActivatesAt: readI64(),
      pendingWithdrawAmount: readU64(),
      withdrawUnlocksAt: readI64(),
      bump: readU8(),
      receiptBump: readU8(),
      minDepositAmount: readTrailingU64(),
    }
  } catch {
    return null
  }
}

// ── Claim records ──────────────────────────────────────────────────────────

function decodeClaimRecord(address: PublicKey, data: Uint8Array): UserClaim | null {
  if (data.length < CLAIM_RECORD_SIZE) return null
  for (let i = 0; i < 8; i++) {
    if (data[i] !== CLAIM_RECORD_DISC[i]) return null
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return {
    address,
    poolId: Number(view.getBigUint64(8, true)),
    claimer: new PublicKey(data.subarray(16, 48)),
    nonce: Number(view.getBigUint64(48, true)),
    receiptAmount: view.getBigUint64(56, true),
    payout: view.getBigUint64(64, true),
    settled: data[72] === 1,
    cancelled: data[73] === 1,
  }
}

/**
 * Fetch a single ClaimRecord by pool ID and nonce.
 * Returns `null` if the record doesn't exist (already claimed or cancelled+settled).
 */
export async function fetchClaimRecord(
  connection: Connection,
  poolId: number,
  nonce: number,
): Promise<UserClaim | null> {
  const [pda] = findClaimRecordPda(poolId, nonce)
  const info = await connection.getAccountInfo(pda)
  return info ? decodeClaimRecord(pda, info.data) : null
}

/**
 * Fetch all live ClaimRecords for a specific user, sorted oldest-first.
 *
 * Requires a full-node RPC that supports `getProgramAccounts` with filters
 * (e.g. Helius, QuickNode). The public endpoint blocks this method.
 */
export async function fetchClaimsForUser(
  connection: Connection,
  user: PublicKey,
): Promise<UserClaim[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { dataSize: CLAIM_RECORD_SIZE },
      { memcmp: { offset: CLAIM_RECORD_CLAIMER_OFFSET, bytes: user.toBase58() } },
    ],
  })
  return accounts
    .map(({ pubkey, account }) => decodeClaimRecord(pubkey, account.data))
    .filter((c): c is UserClaim => c !== null)
    .sort((a, b) => a.nonce - b.nonce)
}

/**
 * Fetch every live ClaimRecord in the program across all users.
 *
 * Requires a full-node RPC that supports `getProgramAccounts`.
 * Best suited for keeper bots and dashboards, not end-user UIs.
 */
export async function fetchAllClaimRecords(
  connection: Connection,
): Promise<UserClaim[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [{ dataSize: CLAIM_RECORD_SIZE }],
  })
  return accounts
    .map(({ pubkey, account }) => decodeClaimRecord(pubkey, account.data))
    .filter((c): c is UserClaim => c !== null)
}

// ── Token balances ─────────────────────────────────────────────────────────

/**
 * Get the raw token balance for a wallet + mint pair.
 * Returns 0 if the ATA does not exist.
 */
export async function getTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner)
    const account = await getAccount(connection, ata)
    return account.amount
  } catch {
    return 0n
  }
}

// ── Derived state ──────────────────────────────────────────────────────────

/** Derive the lifecycle state of a claim. */
export function deriveClaimState(claim: UserClaim): ClaimState {
  if (claim.cancelled) return 'cancelled'
  if (claim.settled)   return 'claimable'
  return 'pending'
}

/**
 * Queue position of a pending claim (0 = next to be settled).
 * Only meaningful for `pending` claims.
 */
export function queuePosition(claim: UserClaim, pool: Pool): number {
  return Math.max(0, claim.nonce - Number(pool.settleHead))
}

/**
 * Compute how many receipt tokens you get for staking `amount`.
 * Uses the pool's current `stakeRate`.
 */
export function computeReceiptAmount(amount: bigint, stakeRate: bigint): bigint {
  return (amount * 100_000n) / stakeRate
}

/**
 * Compute how many stake tokens you get for unstaking `receiptAmount`.
 * Uses the pool's current `unstakeRate`.
 */
export function computePayoutAmount(receiptAmount: bigint, unstakeRate: bigint): bigint {
  return (receiptAmount * unstakeRate) / 100_000n
}

/**
 * Price of one receipt token in terms of the underlying stake token.
 *
 * Uses the `unstakeRate` — the rate at which receipts are redeemed —
 * so it reflects what 1 lmUSD / lmSOL is actually worth right now.
 *
 * Example: if unstakeRate = 101_000, then 1 lmUSD = 1.01 USDC.
 *
 * @param unstakeRate - Pool's current unstakeRate (from fetchPool)
 * @returns Price as a plain number (e.g. 1.01)
 */
export function receiptTokenPrice(unstakeRate: bigint): number {
  return Number(unstakeRate) / 100_000
}

/**
 * Price of one stake token in terms of receipt tokens (inverse of receiptTokenPrice).
 *
 * Uses the `stakeRate` — how many receipts you get per unit staked.
 *
 * Example: if stakeRate = 100_000, then 1 USDC = 1.0 lmUSD.
 *
 * @param stakeRate - Pool's current stakeRate (from fetchPool)
 * @returns Price as a plain number (e.g. 1.0)
 */
export function stakeTokenPrice(stakeRate: bigint): number {
  return 100_000 / Number(stakeRate)
}
