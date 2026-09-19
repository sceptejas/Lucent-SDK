/**
 * The five actions.
 *
 * Each returns an `ActionPlan`: instructions, fee, `simulate()`, `send()`.
 * Nothing here signs or sends on construction, and nothing reads state it does
 * not have to.
 *
 * Where these differ from v0:
 *
 *   * **stake** creates the ATAs it needs (idempotently, so a repeat is a no-op)
 *     and, for SOL, wraps and then closes the WSOL account. v0 wrapped but never
 *     closed, quietly locking ~0.002 SOL of the user's rent in an empty account.
 *   * **unstake** can rebuild itself, because the claim-record PDA is seeded with
 *     the pool's nonce and two unstakes in one slot collide.
 *   * **claim** takes settled records rather than re-deriving them, and refuses
 *     to build an empty transaction.
 *   * every amount is base-unit `bigint`; nothing takes a float.
 */
import {
  type Address,
  type Instruction,
  type Rpc,
  type RpcSubscriptions,
  type SolanaRpcApi,
  type SolanaRpcSubscriptionsApi,
  type TransactionSigner,
} from '@solana/kit'
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getSyncNativeInstruction,
} from '@solana-program/token'
import { getTransferSolInstruction } from '@solana-program/system'

import { POOLS, type PoolId, type PoolMetadata } from '../config'
import { InvalidAmountError, LucentError } from '../errors'
import { fetchPool } from '../generated/accounts/pool'
import { getCancelUnstakeInstructionAsync } from '../generated/instructions/cancelUnstake'
import { getClaimInstructionAsync } from '../generated/instructions/claim'
import { getSettleInstruction } from '../generated/instructions/settle'
import { getStakeInstructionAsync } from '../generated/instructions/stake'
import { getUnstakeInstructionAsync } from '../generated/instructions/unstake'
import type { ClaimRecord } from '../generated/accounts/claimRecord'
import type { Pool } from '../generated/accounts/pool'
import { findClaimRecordPda } from '../pdas'
import { RATE_DENOM, formatAmount } from '../amounts'
import { estimatePriorityFee, isHeliusEndpoint, type PriorityFeeLevel } from './fees'
import { createActionPlan, type ActionPlan } from './plan'

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address

export interface ActionContext {
  rpc: Rpc<SolanaRpcApi>
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>
  signer: TransactionSigner
  /** MicroLamports per CU, already resolved by the client. */
  microLamportsPerComputeUnit: number
}

/** Reject a zero or negative amount before it reaches the chain. */
function assertPositive(amount: bigint, what: string): void {
  if (typeof amount !== 'bigint' || amount <= 0n) throw new InvalidAmountError(amount)
  if (amount > 2n ** 64n - 1n) throw new InvalidAmountError(amount)
  void what
}

/**
 * Slippage, applied in the direction the caller is exposed to: the minimum
 * received. Returned on the plan so a UI can print "you will receive at least X"
 * instead of hiding the only number that matters on a bad fill.
 */
export function applySlippage(amount: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10_000) {
    throw new LucentError('INVALID_SLIPPAGE', `slippageBps must be between 0 and 10000, got ${slippageBps}`)
  }
  return (amount * BigInt(10_000 - Math.round(slippageBps))) / 10_000n
}

export interface StakeParams {
  poolId: PoolId
  /** Base units of the stake token, e.g. 100_000_000n for 100 USDC. */
  amount: bigint
  slippageBps?: number
  /**
   * Close the wrapped-SOL account after staking. Default true: wrapping leaves an
   * empty account holding rent, and there is no reason to make the user fund it
   * permanently. Only closes when the account existed with a zero balance before
   * this transaction, so a pre-existing WSOL balance is never stranded.
   */
  closeWsolAfterStake?: boolean
}

export async function buildStakePlan(
  context: ActionContext,
  params: StakeParams,
  metadata: PoolMetadata = POOLS[params.poolId],
): Promise<ActionPlan> {
  assertPositive(params.amount, 'amount')
  const slippageBps = params.slippageBps ?? 50

  const decoded = await fetchPool(context.rpc, metadata.pool)
  const stakeRate = decoded.data.stakeRate

  // Receipts this deposit should mint, and the floor we will accept.
  const expectedReceipts = (params.amount * RATE_DENOM) / stakeRate
  const minReceiptOut = applySlippage(expectedReceipts, slippageBps)

  const [stakeAta] = await findAssociatedTokenPda({
    owner: context.signer.address,
    mint: metadata.stakeMint,
    tokenProgram: TOKEN_PROGRAM,
  })
  const [receiptAta] = await findAssociatedTokenPda({
    owner: context.signer.address,
    mint: metadata.receiptMint,
    tokenProgram: TOKEN_PROGRAM,
  })

  const isSol = metadata.symbol === 'SOL'
  const symbol = metadata.symbol

  // Only close the wrapped-SOL account when it is empty beforehand: staking may
  // consume less than the account holds, and closing a non-empty account fails
  // the whole transaction.
  const shouldCloseWsol =
    isSol && (params.closeWsolAfterStake ?? true)
      ? (await context.rpc
          .getTokenAccountBalance(stakeAta)
          .send()
          .then(result => BigInt(result.value.amount))
          .catch(() => null)) === 0n
      : false

  return createActionPlan({
    action: 'stake',
    summary:
      `Stake ${formatAmount(params.amount, metadata.decimals)} ${symbol} into the ${symbol} pool and receive at least ` +
      `${formatAmount(minReceiptOut, metadata.decimals)} ${metadata.receiptSymbol}.`,
    // Built per attempt with the signer actually in use: kit rejects a message
    // carrying two different signer objects for one address, which is what a
    // separate simulation placeholder would otherwise introduce.
    build: async signer => {
      const instructions: Instruction[] = [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: stakeAta,
          owner: signer.address,
          mint: metadata.stakeMint,
        }),
        getCreateAssociatedTokenIdempotentInstruction({
          payer: signer,
          ata: receiptAta,
          owner: signer.address,
          mint: metadata.receiptMint,
        }),
      ]

      if (isSol) {
        // Wrapped SOL: move lamports in, then tell the token program the balance
        // changed.
        instructions.push(
          getTransferSolInstruction({
            source: signer,
            destination: stakeAta,
            amount: params.amount,
          }),
          getSyncNativeInstruction({ account: stakeAta }),
        )
      }

      instructions.push(
        await getStakeInstructionAsync({
          signer,
          pool: metadata.pool,
          stakeToken: metadata.stakeMint,
          receiptToken: metadata.receiptMint,
          userStakeAta: stakeAta,
          userReceiptAta: receiptAta,
          amount: params.amount,
          minReceiptOut,
        }),
      )

      if (shouldCloseWsol) {
        instructions.push(
          getCloseAccountInstruction({
            account: stakeAta,
            destination: signer.address,
            owner: signer,
          }),
        )
      }

      return instructions
    },
    signer: context.signer,
    rpc: context.rpc,
    rpcSubscriptions: context.rpcSubscriptions,
    microLamportsPerComputeUnit: context.microLamportsPerComputeUnit,
  })
}

export interface UnstakeParams {
  poolId: PoolId
  /** Base units of the receipt token to burn. */
  receiptAmount: bigint
  slippageBps?: number
}

export async function buildUnstakePlan(
  context: ActionContext,
  params: UnstakeParams,
  metadata: PoolMetadata = POOLS[params.poolId],
): Promise<ActionPlan> {
  assertPositive(params.receiptAmount, 'receiptAmount')
  const slippageBps = params.slippageBps ?? 50

  /**
   * The claim record is seeded with the pool's current nonce, so it has to be
   * read as late as possible and re-read on a collision. This closure is what
   * `plan.rebuild` calls.
   */
  // Read the pool once for the summary; `build` re-reads it on every attempt so
  // the nonce is as fresh as possible (the claim-record PDA is seeded with it).
  const preview = (await fetchPool(context.rpc, metadata.pool)).data
  const minPayoutOut = applySlippage((params.receiptAmount * preview.unstakeRate) / RATE_DENOM, slippageBps)

  return createActionPlan({
    action: 'unstake',
    summary:
      `Redeem ${formatAmount(params.receiptAmount, metadata.decimals)} ${metadata.receiptSymbol} for at least ` +
      `${formatAmount(minPayoutOut, metadata.decimals)} ${metadata.symbol}. The payout is queued and must be settled before it can be claimed.`,
    build: async signer => {
      const pool: Pool = (await fetchPool(context.rpc, metadata.pool)).data
      const payout = (params.receiptAmount * pool.unstakeRate) / RATE_DENOM

      return [
        await getUnstakeInstructionAsync({
          signer,
          pool: metadata.pool,
          receiptToken: metadata.receiptMint,
          userReceiptAta: (
            await findAssociatedTokenPda({
              owner: signer.address,
              mint: metadata.receiptMint,
              tokenProgram: TOKEN_PROGRAM,
            })
          )[0],
          claimRecord: (await findClaimRecordPda(params.poolId, pool.nonce))[0],
          receiptAmount: params.receiptAmount,
          minPayoutOut: applySlippage(payout, slippageBps),
        }),
      ]
    },
    signer: context.signer,
    rpc: context.rpc,
    rpcSubscriptions: context.rpcSubscriptions,
    microLamportsPerComputeUnit: context.microLamportsPerComputeUnit,
  })
}

export interface ClaimParams {
  poolId: PoolId
  /** Settled claim records to claim. Pass `client.getClaimable(wallet)`. */
  claims: { nonce: bigint }[]
}

export async function buildClaimPlan(
  context: ActionContext,
  params: ClaimParams,
  metadata: PoolMetadata = POOLS[params.poolId],
): Promise<ActionPlan> {
  if (params.claims.length === 0) {
    throw new LucentError(
      'NOTHING_TO_CLAIM',
      `No settled claims to claim in the ${metadata.symbol} pool. A redemption must be settled before its payout can be pulled.`,
    )
  }

  return createActionPlan({
    action: 'claim',
    summary: `Claim ${params.claims.length} settled payout${params.claims.length === 1 ? '' : 's'} from the ${metadata.symbol} pool.`,
    build: async signer => {
      const instructions: Instruction[] = []
      for (const claim of params.claims) {
        instructions.push(
          await getClaimInstructionAsync({
            signer,
            pool: metadata.pool,
            claimRecord: (await findClaimRecordPda(params.poolId, claim.nonce))[0],
            stakeToken: metadata.stakeMint,
            claimer: signer.address,
          }),
        )
      }
      return instructions
    },
    signer: context.signer,
    rpc: context.rpc,
    rpcSubscriptions: context.rpcSubscriptions,
    microLamportsPerComputeUnit: context.microLamportsPerComputeUnit,
  })
}

export interface CancelUnstakeParams {
  poolId: PoolId
  nonce: bigint
}

export async function buildCancelUnstakePlan(
  context: ActionContext,
  params: CancelUnstakeParams,
  metadata: PoolMetadata = POOLS[params.poolId],
): Promise<ActionPlan> {
  return createActionPlan({
    action: 'cancelUnstake',
    summary: `Cancel redemption ${params.nonce} in the ${metadata.symbol} pool and get the ${metadata.receiptSymbol} back.`,
    build: async signer => [
      await getCancelUnstakeInstructionAsync({
        signer,
        pool: metadata.pool,
        claimRecord: (await findClaimRecordPda(params.poolId, params.nonce))[0],
        receiptToken: metadata.receiptMint,
        userReceiptAta: (
          await findAssociatedTokenPda({
            owner: signer.address,
            mint: metadata.receiptMint,
            tokenProgram: TOKEN_PROGRAM,
          })
        )[0],
      }),
    ],
    signer: context.signer,
    rpc: context.rpc,
    rpcSubscriptions: context.rpcSubscriptions,
    microLamportsPerComputeUnit: context.microLamportsPerComputeUnit,
  })
}

export interface SettleParams {
  poolId: PoolId
  /** The claim at the head of the queue, as read from the pool's `settleHead`. */
  claim: { nonce: bigint; claimer: Address }
}

/** Settle the FIFO head. Permissionless — anyone can pay the fee to advance it. */
export async function buildSettlePlan(
  context: ActionContext,
  params: SettleParams,
  metadata: PoolMetadata = POOLS[params.poolId],
): Promise<ActionPlan> {
  return createActionPlan({
    action: 'settle',
    summary: `Settle redemption ${params.claim.nonce} at the head of the ${metadata.symbol} pool queue.`,
    build: async () => [
      getSettleInstruction({
        pool: metadata.pool,
        claimRecord: (await findClaimRecordPda(params.poolId, params.claim.nonce))[0],
        claimer: params.claim.claimer,
        receiptToken: metadata.receiptMint,
        poolStakeAta: (
          await findAssociatedTokenPda({
            owner: metadata.pool,
            mint: metadata.stakeMint,
            tokenProgram: TOKEN_PROGRAM,
          })
        )[0],
      }),
    ],
    signer: context.signer,
    rpc: context.rpc,
    rpcSubscriptions: context.rpcSubscriptions,
    microLamportsPerComputeUnit: context.microLamportsPerComputeUnit,
  })
}

/** Settled-but-unclaimed records, ready for `buildClaimPlan`. */
export function claimableFrom(records: ClaimRecord[]): { nonce: bigint; payout: bigint }[] {
  return records
    .filter(record => record.settled && !record.cancelled)
    .map(record => ({ nonce: record.nonce, payout: record.payout }))
}

export { estimatePriorityFee, isHeliusEndpoint, type PriorityFeeLevel }
