/**
 * High-level client for the Lucent staking protocol.
 *
 * Handles transaction building, signing and sending.
 * Requires a `Connection` and a wallet that can sign transactions.
 */

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  type Signer,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  createSyncNativeInstruction,
} from '@solana/spl-token'
import BN from 'bn.js'
import { WSOL_MINT, USDC_MINT, MAINNET, findPoolPda, findReceiptMintPda } from './addresses'
import { stakeIx, unstakeIx, claimIx, settleIx, cancelUnstakeIx } from './instructions'
import { fetchPool, fetchClaimsForUser, deriveClaimState } from './queries'
import { POOL_ID, TOKEN_DECIMALS, type SupportedToken } from './types'

// ── Wallet interface ───────────────────────────────────────────────────────

/** Minimal wallet interface — compatible with Phantom, Solflare and wallet-adapter */
export interface LucentWallet {
  publicKey: PublicKey
  signTransaction(tx: Transaction): Promise<Transaction>
}

// ── Options ────────────────────────────────────────────────────────────────

export interface StakeOptions {
  /** Slippage tolerance in basis points. Default: 50 (0.5%) */
  slippageBps?: number
}

export interface UnstakeOptions {
  /** Slippage tolerance in basis points. Default: 50 (0.5%) */
  slippageBps?: number
}

// ── Result types ───────────────────────────────────────────────────────────

export interface TxResult {
  signature: string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n
}

async function sendTx(
  connection: Connection,
  wallet: LucentWallet,
  tx: Transaction,
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = wallet.publicKey
  const signed = await wallet.signTransaction(tx)
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  })
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig })
  return sig
}

// ── LucentClient ──────────────────────────────────────────────────────────

export class LucentClient {
  constructor(
    public readonly connection: Connection,
    public readonly wallet: LucentWallet,
  ) {}

  /**
   * Stake tokens into the protocol and receive receipt tokens (lmUSD / lmSOL).
   *
   * @param token  - 'USDC' or 'SOL'
   * @param amount - Amount in human units (e.g. 100 for $100 USDC, 1.5 for 1.5 SOL)
   *
   * @example
   * const { signature } = await client.stake('USDC', 100)
   */
  async stake(
    token: SupportedToken,
    amount: number,
    opts: StakeOptions = {},
  ): Promise<TxResult> {
    const slippageBps = opts.slippageBps ?? 50
    const poolId = POOL_ID[token]
    const decimals = TOKEN_DECIMALS[token]
    const stakeMint = token === 'USDC' ? USDC_MINT : WSOL_MINT
    const rawAmount = BigInt(Math.floor(amount * 10 ** decimals))

    const pool = await fetchPool(this.connection, poolId)
    if (!pool) throw new Error(`Pool ${poolId} not found`)

    const receiptAmountRaw = (rawAmount * 100_000n) / pool.stakeRate
    const minReceiptOut = applySlippage(receiptAmountRaw, slippageBps)

    const [poolKey] = findPoolPda(poolId)
    const [receiptMint] = findReceiptMintPda(poolKey)
    const userStakeAta = getAssociatedTokenAddressSync(stakeMint, this.wallet.publicKey)
    const userReceiptAta = getAssociatedTokenAddressSync(receiptMint, this.wallet.publicKey)

    const tx = new Transaction()

    // Ensure ATAs exist
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      this.wallet.publicKey, userStakeAta, this.wallet.publicKey, stakeMint
    ))
    tx.add(createAssociatedTokenAccountIdempotentInstruction(
      this.wallet.publicKey, userReceiptAta, this.wallet.publicKey, receiptMint
    ))

    // For SOL: wrap lamports into WSOL
    if (token === 'SOL') {
      tx.add(SystemProgram.transfer({
        fromPubkey: this.wallet.publicKey,
        toPubkey: userStakeAta,
        lamports: Number(rawAmount),
      }))
      tx.add(createSyncNativeInstruction(userStakeAta))
    }

    tx.add(stakeIx(
      this.wallet.publicKey,
      stakeMint,
      poolId,
      new BN(rawAmount.toString()),
      new BN(minReceiptOut.toString()),
    ))

    const signature = await sendTx(this.connection, this.wallet, tx)
    return { signature }
  }

  /**
   * Unstake by burning receipt tokens and opening a claim in the FIFO queue.
   *
   * The payout is settled by a keeper (typically within 4–5 hours) and then
   * claimable via `claim()`.
   *
   * @param token         - 'USDC' or 'SOL'
   * @param receiptAmount - Amount of receipt tokens to burn (human units)
   *
   * @example
   * const { signature } = await client.unstake('USDC', 100)
   */
  async unstake(
    token: SupportedToken,
    receiptAmount: number,
    opts: UnstakeOptions = {},
  ): Promise<TxResult> {
    const slippageBps = opts.slippageBps ?? 50
    const poolId = POOL_ID[token]
    const decimals = TOKEN_DECIMALS[token]
    const rawAmount = BigInt(Math.floor(receiptAmount * 10 ** decimals))

    const pool = await fetchPool(this.connection, poolId)
    if (!pool) throw new Error(`Pool ${poolId} not found`)

    const payoutRaw = (rawAmount * pool.unstakeRate) / 100_000n
    const minPayoutOut = applySlippage(payoutRaw, slippageBps)
    const nonce = Number(pool.nonce)

    const tx = new Transaction().add(unstakeIx(
      this.wallet.publicKey,
      poolId,
      nonce,
      new BN(rawAmount.toString()),
      new BN(minPayoutOut.toString()),
    ))

    const signature = await sendTx(this.connection, this.wallet, tx)
    return { signature }
  }

  /**
   * Claim all settled payouts for the connected wallet.
   *
   * Requires a full-node RPC that supports `getProgramAccounts`.
   *
   * @example
   * const results = await client.claimAll()
   */
  async claimAll(): Promise<TxResult[]> {
    const claims = await fetchClaimsForUser(this.connection, this.wallet.publicKey)
    const claimable = claims.filter(c => deriveClaimState(c) === 'claimable')
    if (claimable.length === 0) return []

    const results: TxResult[] = []
    for (const claim of claimable) {
      const stakeMint = claim.poolId === POOL_ID.USDC ? USDC_MINT : WSOL_MINT
      const tx = new Transaction().add(claimIx(
        this.wallet.publicKey,
        claim.poolId,
        stakeMint,
        this.wallet.publicKey,
        claim.nonce,
      ))
      const signature = await sendTx(this.connection, this.wallet, tx)
      results.push({ signature })
    }
    return results
  }

  /**
   * Cancel a pending (unsettled) unstake request and re-mint receipt tokens.
   *
   * @param poolId - Pool ID of the claim to cancel
   * @param nonce  - Nonce of the claim record
   *
   * @example
   * await client.cancelUnstake(0, 3)
   */
  async cancelUnstake(poolId: number, nonce: number): Promise<TxResult> {
    const tx = new Transaction().add(
      cancelUnstakeIx(this.wallet.publicKey, poolId, nonce)
    )
    const signature = await sendTx(this.connection, this.wallet, tx)
    return { signature }
  }

  /**
   * Settle the FIFO-head claim for a pool.
   * Permissionless — any wallet can call this.
   *
   * @param poolId - Pool ID to settle
   *
   * @example
   * await client.settle(0) // settle USDC pool head
   */
  async settle(poolId: number): Promise<TxResult> {
    const pool = await fetchPool(this.connection, poolId)
    if (!pool) throw new Error(`Pool ${poolId} not found`)
    if (pool.nonce <= pool.settleHead) throw new Error('Queue is empty')

    const stakeMint = poolId === POOL_ID.USDC ? USDC_MINT : WSOL_MINT
    const nonce = Number(pool.settleHead)

    // fetch claimer from claim record
    const { fetchClaimRecord } = await import('./queries')
    const record = await fetchClaimRecord(this.connection, poolId, nonce)
    if (!record) throw new Error(`Claim record at nonce ${nonce} not found`)

    const tx = new Transaction().add(
      settleIx(poolId, stakeMint, record.claimer, nonce)
    )
    const signature = await sendTx(this.connection, this.wallet, tx)
    return { signature }
  }
}
