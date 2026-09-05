/**
 * Raw Anchor instruction builders.
 *
 * Each function returns a `TransactionInstruction` ready to be added to a
 * `Transaction`. No RPC calls are made — everything is derived locally from
 * the arguments.
 *
 * For a higher-level API that handles transaction building, signing and
 * sending, see `client.ts`.
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { sha256 } from '@noble/hashes/sha2'
import BN from 'bn.js'
import {
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  findPoolPda,
  findReceiptMintPda,
  findClaimRecordPda,
  findAssociatedTokenAddress,
} from './addresses'

// ── Discriminator helpers ──────────────────────────────────────────────────

function disc(name: string): Buffer {
  return Buffer.from(sha256(Buffer.from(`global:${name}`, 'utf8'))).subarray(0, 8)
}

function writeU64LE(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8)
  new DataView(buf).setBigUint64(0, n, true)
  return new Uint8Array(buf)
}

// ── Precomputed discriminators ─────────────────────────────────────────────

const DISC_STAKE          = disc('stake')
const DISC_UNSTAKE        = disc('unstake')
const DISC_SETTLE         = disc('settle')
const DISC_CLAIM          = disc('claim')
const DISC_CANCEL_UNSTAKE = disc('cancel_unstake')

// ── Instruction builders ───────────────────────────────────────────────────

/**
 * Stake `amount` of `stakeMint` tokens into pool `poolId`.
 *
 * The caller's stake ATA must already hold the tokens. If it doesn't exist
 * yet, create it with `createAssociatedTokenAccountIdempotentInstruction`
 * and prepend it to the transaction.
 *
 * @param signer       - Wallet paying and signing
 * @param stakeMint    - Mint of the token being staked (USDC or WSOL)
 * @param poolId       - Pool ID (0 = USDC, 1 = SOL)
 * @param amount       - Amount in native token units (e.g. 1_000_000 = 1 USDC)
 * @param minReceiptOut - Minimum receipt tokens expected (slippage guard)
 */
export function stakeIx(
  signer: PublicKey,
  stakeMint: PublicKey,
  poolId: number,
  amount: BN,
  minReceiptOut: BN,
): TransactionInstruction {
  const [poolKey] = findPoolPda(poolId)
  const [receiptMint] = findReceiptMintPda(poolKey)

  const data = Buffer.concat([
    DISC_STAKE,
    writeU64LE(BigInt(amount.toString())),
    writeU64LE(BigInt(minReceiptOut.toString())),
  ])

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: signer,                                                              isSigner: true,  isWritable: true  },
      { pubkey: poolKey,                                                             isSigner: false, isWritable: false },
      { pubkey: stakeMint,                                                           isSigner: false, isWritable: false },
      { pubkey: receiptMint,                                                         isSigner: false, isWritable: true  },
      { pubkey: getAssociatedTokenAddressSync(stakeMint, signer),                   isSigner: false, isWritable: true  },
      { pubkey: getAssociatedTokenAddressSync(receiptMint, signer),                 isSigner: false, isWritable: true  },
      { pubkey: getAssociatedTokenAddressSync(stakeMint, poolKey, true),            isSigner: false, isWritable: true  },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,                                        isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,                                                   isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID,                                                  isSigner: false, isWritable: false },
    ],
  })
}

/**
 * Burn `receiptAmount` receipt tokens and open a claim record.
 *
 * The payout is locked in at the current `unstakeRate`. The claim enters the
 * FIFO settle queue and must be settled before it can be claimed.
 *
 * @param signer        - Wallet paying and signing (must hold the receipt tokens)
 * @param poolId        - Pool ID (0 = USDC, 1 = SOL)
 * @param nonce         - Current pool nonce (`pool.nonce`) — fetch with `fetchPool`
 * @param receiptAmount - Receipt tokens to burn
 * @param minPayoutOut  - Minimum payout expected (slippage guard)
 */
export function unstakeIx(
  signer: PublicKey,
  poolId: number,
  nonce: number,
  receiptAmount: BN,
  minPayoutOut: BN,
): TransactionInstruction {
  const [poolKey] = findPoolPda(poolId)
  const [receiptMint] = findReceiptMintPda(poolKey)
  const [claimRecord] = findClaimRecordPda(poolId, nonce)

  const data = Buffer.concat([
    DISC_UNSTAKE,
    writeU64LE(BigInt(receiptAmount.toString())),
    writeU64LE(BigInt(minPayoutOut.toString())),
  ])

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data,
    keys: [
      { pubkey: signer,                                             isSigner: true,  isWritable: true  },
      { pubkey: poolKey,                                            isSigner: false, isWritable: true  },
      { pubkey: receiptMint,                                        isSigner: false, isWritable: true  },
      { pubkey: findAssociatedTokenAddress(signer, receiptMint),   isSigner: false, isWritable: true  },
      { pubkey: claimRecord,                                        isSigner: false, isWritable: true  },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,                        isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,                                   isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID,                                  isSigner: false, isWritable: false },
    ],
  })
}

/**
 * Settle the FIFO-head claim for a pool.
 *
 * Permissionless — any wallet can call this. The `claimer` account must match
 * the claimer stored on the head claim record. Fetch the current head with
 * `fetchPool(connection, poolId).settleHead` then `fetchClaimRecord`.
 *
 * @param poolId    - Pool ID
 * @param stakeMint - Stake token mint of the pool
 * @param claimer   - Wallet that originally called unstake
 * @param nonce     - Must equal `pool.settleHead`
 */
export function settleIx(
  poolId: number,
  stakeMint: PublicKey,
  claimer: PublicKey,
  nonce: number,
): TransactionInstruction {
  const [poolKey] = findPoolPda(poolId)
  const [receiptMint] = findReceiptMintPda(poolKey)
  const [claimRecord] = findClaimRecordPda(poolId, nonce)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(DISC_SETTLE),
    keys: [
      { pubkey: poolKey,                                                   isSigner: false, isWritable: true  },
      { pubkey: claimRecord,                                               isSigner: false, isWritable: true  },
      { pubkey: claimer,                                                   isSigner: false, isWritable: true  },
      { pubkey: receiptMint,                                               isSigner: false, isWritable: false },
      { pubkey: getAssociatedTokenAddressSync(stakeMint, poolKey, true),  isSigner: false, isWritable: false },
    ],
  })
}

/**
 * Claim a settled payout.
 *
 * Funds always go to `claimer` regardless of who signs. Closes the
 * ClaimRecord and refunds its rent to `claimer`.
 *
 * @param signer    - Wallet paying the transaction fee (can be anyone)
 * @param poolId    - Pool ID
 * @param stakeMint - Stake token mint of the pool
 * @param claimer   - Original unstaker — receives the payout
 * @param nonce     - Nonce of the claim record
 */
export function claimIx(
  signer: PublicKey,
  poolId: number,
  stakeMint: PublicKey,
  claimer: PublicKey,
  nonce: number,
): TransactionInstruction {
  const [poolKey] = findPoolPda(poolId)
  const [claimRecord] = findClaimRecordPda(poolId, nonce)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(DISC_CLAIM),
    keys: [
      { pubkey: signer,                                                             isSigner: true,  isWritable: true  },
      { pubkey: poolKey,                                                            isSigner: false, isWritable: true  },
      { pubkey: claimRecord,                                                        isSigner: false, isWritable: true  },
      { pubkey: stakeMint,                                                          isSigner: false, isWritable: false },
      { pubkey: claimer,                                                            isSigner: false, isWritable: true  },
      { pubkey: getAssociatedTokenAddressSync(stakeMint, poolKey, true),           isSigner: false, isWritable: true  },
      { pubkey: getAssociatedTokenAddressSync(stakeMint, claimer),                 isSigner: false, isWritable: true  },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,                                       isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,                                                  isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID,                                                 isSigner: false, isWritable: false },
    ],
  })
}

/**
 * Cancel an unsettled unstake request and re-mint receipt tokens.
 *
 * Only valid while the claim has not yet been settled. The claim record stays
 * on-chain as a cancelled FIFO marker until the settle keeper advances past it.
 *
 * @param signer - Original unstaker (must match claim_record.claimer)
 * @param poolId - Pool ID
 * @param nonce  - Nonce of the claim record to cancel
 */
export function cancelUnstakeIx(
  signer: PublicKey,
  poolId: number,
  nonce: number,
): TransactionInstruction {
  const [poolKey] = findPoolPda(poolId)
  const [receiptMint] = findReceiptMintPda(poolKey)
  const [claimRecord] = findClaimRecordPda(poolId, nonce)

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    data: Buffer.from(DISC_CANCEL_UNSTAKE),
    keys: [
      { pubkey: signer,                                           isSigner: true,  isWritable: true  },
      { pubkey: poolKey,                                          isSigner: false, isWritable: true  },
      { pubkey: claimRecord,                                      isSigner: false, isWritable: true  },
      { pubkey: receiptMint,                                      isSigner: false, isWritable: true  },
      { pubkey: findAssociatedTokenAddress(signer, receiptMint), isSigner: false, isWritable: true  },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,                      isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID,                                 isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID,                                isSigner: false, isWritable: false },
    ],
  })
}
