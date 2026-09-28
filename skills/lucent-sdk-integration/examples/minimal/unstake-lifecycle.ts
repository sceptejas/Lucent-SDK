import type {
  ClusterUrl,
  Signature,
  TransactionSigner,
} from '@solana/kit'
import {
  ActionFailedError,
  LucentError,
  POOLS,
  assertReferralId,
  createLucentClient,
  parseAmount,
  type ActionPlan,
  type PoolId,
  type WalletClaims,
} from 'lucent-sdk'

export type RedemptionFailure =
  | {
      kind: 'simulation'
      message: string
    }
  | {
      kind: 'sdk'
      message: string
      code: string
    }
  | {
      kind: 'wallet-or-network'
      message: string
      cause: unknown
    }

export interface RedemptionContext {
  rpcUrl: ClusterUrl
  rpcSubscriptionsUrl?: ClusterUrl
  signer: TransactionSigner
  referralId: string
  poolId: PoolId
  assertNetworkCompatible(): Promise<void>
  assertReferralWritesDeployed(): Promise<void>
  onPlan(plan: ActionPlan): void | Promise<void>
  onFailure(failure: RedemptionFailure): void
}

function createClient(
  context: RedemptionContext,
  referralRequired: boolean,
) {
  return createLucentClient({
    rpcUrl: context.rpcUrl,
    signer: context.signer,
    ...(referralRequired
      ? { referralId: assertReferralId(context.referralId) }
      : {}),
    ...(context.rpcSubscriptionsUrl
      ? { rpcSubscriptionsUrl: context.rpcSubscriptionsUrl }
      : {}),
  })
}

function reportFailure(
  context: RedemptionContext,
  error: unknown,
): void {
  if (error instanceof ActionFailedError) {
    context.onFailure({
      kind: 'simulation',
      message: error.simulation.error ?? error.message,
    })
  } else if (error instanceof LucentError) {
    context.onFailure({
      kind: 'sdk',
      message: error.message,
      code: error.code,
    })
  } else {
    context.onFailure({
      kind: 'wallet-or-network',
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    })
  }
}

export async function requestUnstake(
  context: RedemptionContext,
  humanReceiptAmount: string,
): Promise<{ signature: Signature }> {
  try {
    await context.assertNetworkCompatible()
    await context.assertReferralWritesDeployed()

    const client = createClient(context, true)
    const receiptAmount = parseAmount(
      humanReceiptAmount,
      POOLS[context.poolId].decimals,
    )
    const plan = await client.unstake(context.poolId, receiptAmount)
    await context.onPlan(plan)
    return await plan.send()
  } catch (error) {
    reportFailure(context, error)
    throw error
  }
}

export async function readRedemptions(
  context: RedemptionContext,
): Promise<WalletClaims> {
  await context.assertNetworkCompatible()
  return createClient(context, false).getClaims(
    context.signer.address,
    context.poolId,
  )
}

export async function claimSettled(
  context: RedemptionContext,
): Promise<{ signature: Signature } | null> {
  try {
    await context.assertNetworkCompatible()

    const client = createClient(context, false)
    const claims = await client.getClaims(
      context.signer.address,
      context.poolId,
    )
    if (claims.claimable.length === 0) return null

    const plan = await client.claim(context.poolId)
    await context.onPlan(plan)
    return await plan.send()
  } catch (error) {
    reportFailure(context, error)
    throw error
  }
}

export async function cancelPending(
  context: RedemptionContext,
  nonce: bigint,
): Promise<{ signature: Signature }> {
  try {
    await context.assertNetworkCompatible()

    const client = createClient(context, false)
    const plan = await client.cancelUnstake(context.poolId, nonce)
    await context.onPlan(plan)
    return await plan.send()
  } catch (error) {
    reportFailure(context, error)
    throw error
  }
}
