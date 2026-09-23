/**
 * Client for the Lucent hosted history API.
 *
 * Why history comes from our API rather than from RPC:
 *
 *   * A wallet's staking history is read from its receipt-token accounts, which
 *     needs `getTransactionsForAddress` — a Helius-exclusive method. Standard
 *     RPC cannot do it at all.
 *   * Redemptions in flight come from `getProgramAccounts` over ClaimRecords,
 *     which the public endpoint blocks outright.
 *
 * So a consumer with a plain RPC cannot reconstruct the numbers. Our API can,
 * because it holds a keyed endpoint, does the receipt-index read, proves the
 * result against the on-chain receipt balance, and caches it.
 *
 * What that costs: history is a *hosted* read, not a trustless one. The SDK
 * therefore treats the balances and rates it gets here as claims to be checked —
 * `LucentClient.getPosition` re-reads them from chain and reports whether they
 * agreed. Nothing about a position's value depends on trusting this endpoint.
 *
 * This module validates everything it parses. A hosted API is a network
 * dependency and its JSON is untrusted input; `BigInt('')` throwing a raw
 * SyntaxError at a call site is not an acceptable failure mode.
 */
import { HistoryApiError } from './errors'

export const DEFAULT_HISTORY_API_URL = 'https://lmns.fi'

/** One pool's position, as the API serialises it (amounts are base-unit strings). */
export interface HostedPosition {
  poolId: number
  symbol: string
  receiptSymbol: string
  decimals: number
  receiptBalance: bigint
  currentValue: bigint
  pending: bigint
  claimable: bigint
  totalDeposited: bigint
  totalWithdrawn: bigint
  netYield: bigint
  stakeRate: bigint
  unstakeRate: bigint
  rateDenom: bigint
  transferReceipts: bigint
}

export interface HostedActivity {
  signature: string
  slot: number
  timestamp: number | null
  type: 'STAKE' | 'UNSTAKE' | 'CLAIM' | 'CANCEL'
  poolId: number
  amountRaw: bigint
  decimals: number
  display: string
}

export interface HostedProfile {
  wallet: string
  positions: HostedPosition[]
  activity: HostedActivity[]
  lastActivityAt: string | null
  /** True when the receipt index proved the history complete against chain. */
  historyExact: boolean
  historySource?: 'receipt-index' | 'wallet-scan'
  /** Why the history is not exact, when it is not. */
  historyNote?: string
  historyUnavailable?: boolean
}

export interface HistoryApiConfig {
  /** Base URL of the Lucent site, e.g. `https://lucent.finance`. No trailing slash. */
  apiUrl: string
  /** Injectable for tests. */
  fetch?: typeof globalThis.fetch
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/** Base-unit amounts arrive as decimal strings; anything else is a protocol error. */
function toBigInt(value: unknown, field: string, wallet: string): bigint {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    try {
      return BigInt(value)
    } catch {
      /* fall through */
    }
  }
  throw new HistoryApiError(
    `The history API returned ${JSON.stringify(value)} for ${field} of ${wallet}; expected a base-unit integer.`,
  )
}

function toNumber(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    throw new HistoryApiError(`The history API returned a non-numeric ${field}.`)
  }
  return parsed
}

function parsePosition(raw: unknown, wallet: string): HostedPosition {
  if (!isRecord(raw)) throw new HistoryApiError(`The history API returned a non-object position for ${wallet}.`)
  const poolId = toNumber(raw.poolId, 'poolId')
  return {
    poolId,
    symbol: String(raw.symbol ?? ''),
    receiptSymbol: String(raw.receiptSymbol ?? ''),
    decimals: toNumber(raw.decimals, 'decimals'),
    receiptBalance: toBigInt(raw.receiptBalance, 'receiptBalance', wallet),
    currentValue: toBigInt(raw.currentValue, 'currentValue', wallet),
    pending: toBigInt(raw.pending, 'pending', wallet),
    claimable: toBigInt(raw.claimable, 'claimable', wallet),
    totalDeposited: toBigInt(raw.totalDeposited, 'totalDeposited', wallet),
    totalWithdrawn: toBigInt(raw.totalWithdrawn, 'totalWithdrawn', wallet),
    netYield: toBigInt(raw.netYield, 'netYield', wallet),
    stakeRate: toBigInt(raw.stakeRate ?? '0', 'stakeRate', wallet),
    unstakeRate: toBigInt(raw.unstakeRate ?? '0', 'unstakeRate', wallet),
    rateDenom: toBigInt(raw.rateDenom ?? '100000', 'rateDenom', wallet),
    transferReceipts: toBigInt(raw.transferReceipts ?? '0', 'transferReceipts', wallet),
  }
}

function parseActivity(raw: unknown, wallet: string): HostedActivity {
  if (!isRecord(raw)) throw new HistoryApiError(`The history API returned a non-object activity for ${wallet}.`)
  const type = String(raw.type ?? '')
  if (type !== 'STAKE' && type !== 'UNSTAKE' && type !== 'CLAIM' && type !== 'CANCEL') {
    throw new HistoryApiError(`The history API returned an unknown activity type ${JSON.stringify(type)}.`)
  }
  return {
    signature: String(raw.signature ?? ''),
    slot: toNumber(raw.slot, 'slot'),
    timestamp: raw.timestamp === null || raw.timestamp === undefined ? null : toNumber(raw.timestamp, 'timestamp'),
    type,
    poolId: toNumber(raw.poolId, 'poolId'),
    amountRaw: toBigInt(raw.amountRaw, 'amountRaw', wallet),
    decimals: toNumber(raw.decimals, 'decimals'),
    display: String(raw.display ?? ''),
  }
}

/**
 * Fetch a wallet's position and history from the hosted API.
 *
 * Throws `HistoryApiError` for transport and shape problems. A 200 that says the
 * history is incomplete is NOT an error: it is returned with `historyExact:
 * false` and a `historyNote` explaining why, because that is actionable state
 * rather than a failure.
 */
export async function fetchHostedProfile(
  config: HistoryApiConfig,
  wallet: string,
): Promise<HostedProfile> {
  const base = config.apiUrl.replace(/\/+$/, '')
  if (!base) {
    throw new HistoryApiError(
      'No historyApiUrl configured. History needs the Lucent API: a plain RPC endpoint cannot read ' +
        'receipt-token history (getTransactionsForAddress) or ClaimRecords (getProgramAccounts).',
    )
  }

  const url = `${base}/api/profile?wallet=${encodeURIComponent(wallet)}`
  const doFetch = config.fetch ?? globalThis.fetch
  if (typeof doFetch !== 'function') {
    throw new HistoryApiError('No fetch implementation available in this environment.')
  }

  let response: Response
  try {
    response = await doFetch(url, { headers: { accept: 'application/json' } })
  } catch (cause) {
    throw new HistoryApiError(`Could not reach the Lucent history API at ${base}.`, { cause })
  }

  if (!response.ok) {
    // 400 for a bad address is our caller's bug; anything else is ours to report.
    let detail = ''
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && typeof body.error === 'string') detail = `: ${body.error}`
    } catch {
      /* the body was not JSON; the status is enough */
    }
    throw new HistoryApiError(`The history API responded ${response.status}${detail}.`, {
      status: response.status,
    })
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (cause) {
    throw new HistoryApiError('The history API returned a body that is not JSON.', { cause })
  }
  if (!isRecord(body)) {
    throw new HistoryApiError('The history API returned a body that is not an object.')
  }

  const rawPositions = Array.isArray(body.positions) ? body.positions : []
  const rawActivity = Array.isArray(body.activity) ? body.activity : []

  return {
    wallet: typeof body.wallet === 'string' ? body.wallet : wallet,
    positions: rawPositions.map(position => parsePosition(position, wallet)),
    activity: rawActivity.map(event => parseActivity(event, wallet)),
    lastActivityAt: typeof body.lastActivityAt === 'string' ? body.lastActivityAt : null,
    historyExact: body.historyExact === true,
    historySource:
      body.historySource === 'receipt-index' || body.historySource === 'wallet-scan'
        ? body.historySource
        : undefined,
    historyNote: typeof body.historyNote === 'string' ? body.historyNote : undefined,
    historyUnavailable: body.historyUnavailable === true,
  }
}
