/**
 * Priority fees.
 *
 * v0 sent transactions with no priority fee and no compute-unit limit. On a
 * congested mainnet that is not a slow transaction, it is a dropped one: the
 * fee market is per-block, and a zero-fee transaction is the first thing a
 * leader discards. A staking deposit that silently never lands is worse than one
 * that costs a fraction of a cent more.
 *
 * Two estimators, in preference order:
 *
 *   1. Helius `getPriorityFeeEstimate`, when the caller tells us the endpoint is
 *      Helius and gives us the URL. It returns a percentile for named levels
 *      computed from recent blocks touching the same accounts, which is what the
 *      Helius docs recommend for anything latency-sensitive.
 *   2. `getRecentPrioritizationFees` on any standard RPC, taking a percentile of
 *      the recent fees for the accounts the transaction touches.
 *
 * Both are advisory. `none` is a valid choice and means exactly what it says.
 */
import type { Address, Rpc, SolanaRpcApi } from '@solana/kit'

export type PriorityFeeLevel = 'none' | 'low' | 'medium' | 'high' | 'veryHigh'

/** Fallbacks in microLamports per compute unit, when no data is available. */
const FALLBACK_MICRO_LAMPORTS: Record<Exclude<PriorityFeeLevel, 'none'>, number> = {
  low: 1_000,
  medium: 10_000,
  high: 100_000,
  veryHigh: 1_000_000,
}

export interface PriorityFeeRequest {
  rpc: Rpc<SolanaRpcApi>
  level: PriorityFeeLevel
  /** Accounts the transaction touches; fees are sampled for these. */
  accountKeys?: Address[]
  /** Set when the endpoint is Helius, to use its percentile estimator. */
  heliusUrl?: string
  fetch?: typeof globalThis.fetch
}

/**
 * The fee in microLamports per compute unit.
 *
 * Never throws: a fee estimator that is down must not stop a user from staking.
 * It falls back to a fixed value per level and says so in the returned `source`,
 * so a caller can surface "we could not reach the fee oracle" rather than
 * silently overpaying.
 */
export async function estimatePriorityFee(
  request: PriorityFeeRequest,
): Promise<{ microLamportsPerComputeUnit: number; source: 'helius' | 'recent-fees' | 'fallback' }> {
  const { rpc, level, accountKeys = [], heliusUrl, fetch: doFetch = globalThis.fetch } = request

  if (level === 'none') {
    return { microLamportsPerComputeUnit: 0, source: 'fallback' }
  }

  if (heliusUrl) {
    try {
      const response = await doFetch(heliusUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'lucent-priority-fee',
          method: 'getPriorityFeeEstimate',
          params: [
            {
              accountKeys: accountKeys.map(String),
              options: { priorityLevel: level, includeAllPriorityFeeLevels: false },
            },
          ],
        }),
      })
      if (response.ok) {
        const body: unknown = await response.json()
        const estimate = (body as { result?: { priorityFeeEstimate?: number } })?.result
          ?.priorityFeeEstimate
        if (typeof estimate === 'number' && estimate >= 0) {
          return { microLamportsPerComputeUnit: Math.ceil(estimate), source: 'helius' }
        }
      }
    } catch {
      // Fall through to the standard method rather than failing the action.
    }
  }

  try {
    const recent = await rpc
      .getRecentPrioritizationFees(accountKeys.length > 0 ? accountKeys : undefined)
      .send()
    // `prioritizationFee` is MicroLamports — a branded bigint — so no narrowing
    // predicate is needed, and comparisons work directly.
    const fees = recent
      .map(entry => entry.prioritizationFee)
      .filter(fee => fee > 0n)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    if (fees.length > 0) {
      // Percentile by level: `low` sits near the bottom of what is landing, `high`
      // clears most of it. Indices are clamped so a short sample still resolves.
      const percentile = { low: 0.25, medium: 0.5, high: 0.75, veryHigh: 0.95 }[level]
      const index = Math.min(fees.length - 1, Math.floor(percentile * fees.length))
      const chosen = fees[index] ?? fees[fees.length - 1] ?? 0n
      return { microLamportsPerComputeUnit: Number(chosen), source: 'recent-fees' }
    }
  } catch {
    // Same reasoning: an unreachable estimator is not a reason to refuse to stake.
  }

  return { microLamportsPerComputeUnit: FALLBACK_MICRO_LAMPORTS[level], source: 'fallback' }
}

/** True when a URL points at Helius, which has the better fee estimator. */
export function isHeliusEndpoint(url: string | undefined): boolean {
  return typeof url === 'string' && /helius-rpc\.com/i.test(url)
}
