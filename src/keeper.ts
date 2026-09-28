/**
 * Keeper: advancing the redemption queue.
 *
 * `settle` is permissionless — anyone can pay the fee to advance the FIFO head —
 * so a depositor's payout is claimable only once *somebody* settles it. Left to
 * users, that means a redemption sits pending until the person who wants their
 * money also happens to know they must push the queue. This entry point exists so
 * a keeper can do it on a schedule.
 *
 * Three things it has to get right:
 *
 *   * **Idempotency.** Two keepers racing is normal, not an error. The loser's
 *     transaction fails with the head already advanced, which is reported as
 *     "someone else settled it" and skipped.
 *   * **Fresh state.** Every iteration re-reads the pool and the head claim
 *     record, because both move. A nonce cached across iterations is a
 *     transaction that fails for no reason.
 *   * **A way out.** A dry-run mode that simulates without spending, a bound on
 *     settlements per call, and an abort signal.
 *
 * Import from the subpath so a browser bundle never pulls this in:
 *
 *     import { settleLoop } from 'lucent-sdk/keeper'
 */
import type { Signature } from '@solana/kit'

import type { LucentClient } from './client'
import { POOLS, type PoolId } from './config'
import { LucentError } from './errors'

export interface SettleOutcome {
  poolId: PoolId
  /** True when this call advanced the queue. */
  settled: boolean
  /** The nonce this call settled, when it settled one. */
  nonce?: bigint
  signature?: Signature
  /** True when the work was simulated rather than sent. */
  simulated?: boolean
  /** Why nothing happened, when nothing did. */
  skipped?: 'queue-empty' | 'raced' | 'simulation-failed'
  /** Detail for a skip or a failure. */
  detail?: string
}

/**
 * Advance one pool's queue by one claim.
 *
 * Returns rather than throws for the expected outcomes: an empty queue and a race
 * with another keeper are both normal, and a loop that throws on them is a loop
 * that needs try/catch around every iteration.
 */
export async function settleOnce(
  client: LucentClient,
  poolId: PoolId,
  options: { dryRun?: boolean } = {},
): Promise<SettleOutcome> {
  let plan
  try {
    plan = await client.settle(poolId)
  } catch (error) {
    if (error instanceof LucentError && (error.code === 'QUEUE_EMPTY' || error.code === 'CLAIM_NOT_FOUND')) {
      return { poolId, settled: false, skipped: 'queue-empty', detail: error.message }
    }
    throw error
  }

  if (options.dryRun) {
    const simulation = await plan.simulate()
    return simulation.ok
      ? { poolId, settled: false, simulated: true, detail: 'simulated successfully; nothing sent' }
      : { poolId, settled: false, skipped: 'simulation-failed', detail: simulation.error ?? undefined }
  }

  try {
    const { signature } = await plan.send()
    return { poolId, settled: true, signature }
  } catch (error) {
    // Another keeper got there first. The queue moved, which is the goal; the
    // next iteration reads the new head.
    const message = error instanceof Error ? error.message : String(error)
    if (/AlreadySettled|NotNextInQueue|already been settled|0x177[0-9a-f]/i.test(message)) {
      return { poolId, settled: false, skipped: 'raced', detail: message }
    }
    throw error
  }
}

export interface SettleLoopOptions {
  /** Pools to advance. Default: both. */
  poolIds?: PoolId[]
  /** Delay between passes. Default 30s. */
  intervalMs?: number
  /** Simulate instead of sending. */
  dryRun?: boolean
  /** Stop after this many settlements in one pass, so a long queue cannot run away. */
  maxPerPass?: number
  /** Abort to stop the loop. */
  signal?: AbortSignal
  onOutcome?: (outcome: SettleOutcome) => void
  onError?: (error: unknown, poolId: PoolId) => void
}

export interface SettleLoop {
  /** One pass over every configured pool. */
  runPass(): Promise<SettleOutcome[]>
  /** Run until aborted. Resolves when the signal fires. */
  start(): Promise<void>
  /** Ask the loop to finish the current pass and stop. */
  stop(): void
}

export function settleLoop(client: LucentClient, options: SettleLoopOptions = {}): SettleLoop {
  const poolIds = options.poolIds ?? ([0, 1] as PoolId[])
  const intervalMs = options.intervalMs ?? 30_000
  const maxPerPass = options.maxPerPass ?? poolIds.length * 8
  let running = true

  const stop = () => {
    running = false
  }
  options.signal?.addEventListener('abort', stop, { once: true })

  async function runPass(): Promise<SettleOutcome[]> {
    const outcomes: SettleOutcome[] = []
    let attempts = 0

    // Keep going while there is a queue to advance: a pool with ten pending
    // redemptions should not take ten passes.
    while (running && attempts < maxPerPass) {
      let advancedSomething = false

      for (const poolId of poolIds) {
        if (!running || attempts >= maxPerPass) break
        attempts += 1
        try {
          const outcome = await settleOnce(client, poolId, {
            ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
          })
          outcomes.push(outcome)
          options.onOutcome?.(outcome)
          if (outcome.settled) advancedSomething = true
        } catch (error) {
          options.onError?.(error, poolId)
        }
      }

      // Nothing advanced anywhere: every queue is empty (or every attempt raced),
      // so this pass is done.
      if (!advancedSomething) break
    }

    return outcomes
  }

  return {
    runPass,
    stop,
    start: async () => {
      while (running) {
        await runPass()
        if (!running) break
        await new Promise(resolve => setTimeout(resolve, intervalMs))
      }
    },
  }
}

/** One pass over both pools, for a cron job rather than a long-running process. */
export async function settleAll(
  client: LucentClient,
  options: Omit<SettleLoopOptions, 'intervalMs'> = {},
): Promise<SettleOutcome[]> {
  return settleLoop(client, options).runPass()
}

export { POOLS }
