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
} from 'lucent-sdk'

export type StakeFailure =
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

export interface ExecuteStakeInput {
  rpcUrl: ClusterUrl
  rpcSubscriptionsUrl?: ClusterUrl
  signer: TransactionSigner
  referralId: string
  poolId: PoolId
  humanAmount: string
  slippageBps?: number
  assertDeploymentCompatible(): Promise<void>
  onPlan(plan: ActionPlan): void | Promise<void>
  onFailure(failure: StakeFailure): void
}

export async function executeStake(
  input: ExecuteStakeInput,
): Promise<{ signature: Signature }> {
  try {
    await input.assertDeploymentCompatible()

    const referralId = assertReferralId(input.referralId)
    const amount = parseAmount(
      input.humanAmount,
      POOLS[input.poolId].decimals,
    )
    const client = createLucentClient({
      rpcUrl: input.rpcUrl,
      signer: input.signer,
      referralId,
      ...(input.rpcSubscriptionsUrl
        ? { rpcSubscriptionsUrl: input.rpcSubscriptionsUrl }
        : {}),
    })
    const plan = await client.stake(input.poolId, amount, {
      ...(input.slippageBps === undefined
        ? {}
        : { slippageBps: input.slippageBps }),
    })

    await input.onPlan(plan)
    return await plan.send()
  } catch (error) {
    if (error instanceof ActionFailedError) {
      input.onFailure({
        kind: 'simulation',
        message: error.simulation.error ?? error.message,
      })
    } else if (error instanceof LucentError) {
      input.onFailure({
        kind: 'sdk',
        message: error.message,
        code: error.code,
      })
    } else {
      input.onFailure({
        kind: 'wallet-or-network',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      })
    }
    throw error
  }
}
