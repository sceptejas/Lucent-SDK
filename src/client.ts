/**
 * The Lucent client.
 *
 * Two data sources, and the split is deliberate:
 *
 *   * **chain** (kit RPC) — pools, global config, the wallet's receipt balance.
 *     Trustless, and all a position's *value* depends on.
 *   * **our hosted API** — staking history and the totals derived from it. Needed
 *     because receipt-token history requires a Helius-exclusive method, and
 *     ClaimRecords require `getProgramAccounts`, which the public endpoint blocks.
 *
 * The hosted numbers are therefore treated as claims, not facts: when an RPC is
 * configured, `getPosition` re-reads the receipt balance and the pool rates from
 * chain, prefers chain on disagreement, and reports `verified` accordingly. A
 * consumer can see at a glance whether the figures they are about to display came
 * from chain or from us.
 */
import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type ClusterUrl,
  type Rpc,
  type SolanaRpcApi,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
  type TransactionSigner,
} from '@solana/kit'

import { fetchHostedProfile, type HistoryApiConfig, type HostedProfile } from './api'
import { MAINNET, POOLS, type PoolId, type PoolMetadata } from './config'
import { InvalidAccountError, LucentError, RpcError } from './errors'
import { findClaimRecordPda } from './pdas'
import { toPosition, type Position } from './position'
import { fetchGlobal, type Global } from './generated/accounts/global'
import { decodeClaimRecord, type ClaimRecord } from './generated/accounts/claimRecord'
import type { Account } from '@solana/kit'
import { fetchPool, type Pool } from './generated/accounts/pool'
import { SYTHSTAKING_PROGRAM_ADDRESS } from './generated/programs/sythstaking'
import {
  buildCancelUnstakePlan,
  buildClaimPlan,
  buildSettlePlan,
  buildStakePlan,
  buildUnstakePlan,
  estimatePriorityFee,
  isHeliusEndpoint,
  type ActionContext,
  type PriorityFeeLevel,
} from './actions'
import type { ActionPlan } from './actions/plan'

/** Well-known program ids, so a position read needs no extra dependency. */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address

export interface LucentClientConfig extends Partial<HistoryApiConfig> {
  /** RPC for the trustless reads. Pass this or `rpcUrl`. */
  rpc?: Rpc<SolanaRpcApi>
  /**
   * RPC endpoint. Preferred over `rpc`: it is also what lets the fee estimator
   * recognise a Helius endpoint and use its percentile fee API.
   */
  rpcUrl?: ClusterUrl
  /** WebSocket endpoint for confirmation. Derived from `rpcUrl` when omitted. */
  rpcSubscriptions?: RpcSubscriptions<SolanaRpcSubscriptionsApi>
  /** WebSocket endpoint, when it is not derivable from `rpcUrl`. */
  rpcSubscriptionsUrl?: ClusterUrl
  /** Signs and pays. Required for anything that writes. */
  signer?: TransactionSigner
  /** How aggressively to price the transaction. Default `medium`. */
  priorityFeeLevel?: PriorityFeeLevel
  /** Pin a compute-unit limit instead of estimating one per transaction. */
  computeUnitLimit?: number
}

/** Claim records for a wallet, with their lifecycle state. */
export interface WalletClaims {
  pending: Account<ClaimRecord>[]
  claimable: Account<ClaimRecord>[]
  cancelled: Account<ClaimRecord>[]
}

export type { ActionPlan } from './actions/plan'
export type { PriorityFeeLevel } from './actions/fees'

export interface PositionResult {
  position: Position
  /**
   * True when the receipt balance and pool rates the API reported were confirmed
   * against chain. False when no RPC was configured, or when chain disagreed — in
   * which case the chain's numbers are the ones in `position`.
   */
  verified: boolean
  /** Why verification failed, when it did. */
  note?: string
}

export interface HistoryResult {
  profile: HostedProfile
  /** True when the API proved the history complete against the on-chain balance. */
  exact: boolean
  /** The API's explanation when it is not exact. */
  note?: string
}

export interface LucentClient {
  /** Pool account state. Throws `InvalidAccountError` if it does not decode. */
  getPool(poolId: PoolId): Promise<Pool>
  /** Global config, including `withdrawDelay` — the redemption timelock. */
  getGlobal(): Promise<Global>
  /** One entry per pool the wallet has touched, newest data available. */
  getPosition(wallet: Address): Promise<PositionResult[]>
  /** Raw hosted history, with its completeness verdict. */
  getHistory(wallet: Address): Promise<HistoryResult>
  /** The wallet's receipt-token balance, read straight from chain. */
  getReceiptBalance(wallet: Address, poolId: PoolId): Promise<bigint>
  /**
   * The wallet's claim records.
   *
   * Needs `getProgramAccounts`, so a full-node RPC (Helius, QuickNode, …). The
   * public endpoint blocks the method; the hosted API covers history for callers
   * who do not have one.
   */
  getClaims(wallet: Address, poolId?: PoolId): Promise<WalletClaims>
  /** Stake. Returns a plan — nothing is signed until `send()`. */
  stake(poolId: PoolId, amount: bigint, options?: { slippageBps?: number; closeWsolAfterStake?: boolean }): Promise<ActionPlan>
  /** Redeem receipts for a queued payout. Returns a plan. */
  unstake(poolId: PoolId, receiptAmount: bigint, options?: { slippageBps?: number }): Promise<ActionPlan>
  /** Claim settled payouts. Returns a plan covering every claimable record. */
  claim(poolId: PoolId): Promise<ActionPlan>
  /** Leave the redemption queue and get the receipts back. Returns a plan. */
  cancelUnstake(poolId: PoolId, nonce: bigint): Promise<ActionPlan>
  /** Settle the FIFO head of a pool. Permissionless. Returns a plan. */
  settle(poolId: PoolId): Promise<ActionPlan>
}

/**
 * The generated decoder wants kit's `EncodedAccount` (which names the owning
 * program `programAddress`), while `getProgramAccounts` returns the RPC's shape
 * (`owner`) and base64 payload as a string or a `[data, encoding]` tuple.
 * Bridging the two here keeps the rest of the client in one shape.
 */
function decodeClaimAccount(entry: {
  pubkey: Address
  account: {
    data: unknown
    executable: boolean
    lamports: bigint
    owner: Address
    space?: bigint
    rentEpoch?: bigint
  }
}): Account<ClaimRecord> {
  const raw = entry.account.data
  const base64 = Array.isArray(raw) ? (raw[0] as string) : (raw as string)
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0))

  return decodeClaimRecord({
    address: entry.pubkey,
    programAddress: entry.account.owner,
    data: bytes,
    executable: entry.account.executable,
    lamports: entry.account.lamports as never,
    space: entry.account.space ?? BigInt(bytes.length),
  } as never)
}

/** ATA derivation, so a caller can read a receipt balance without a token library. */
export async function findAssociatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const [address] = await getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM,
    seeds: [
      getAddressEncoder().encode(owner),
      getAddressEncoder().encode(TOKEN_PROGRAM),
      getAddressEncoder().encode(mint),
    ],
  })
  return address
}

/** https://host -> wss://host, so a single URL configures both channels. */
function toWebSocketUrl(url: string): string {
  return url.replace(/^http/, 'ws')
}

export function createLucentClient(config: LucentClientConfig): LucentClient {
  const { apiUrl, fetch } = config
  const historyConfig: HistoryApiConfig = { apiUrl: apiUrl ?? '', ...(fetch ? { fetch } : {}) }

  const rpc: Rpc<SolanaRpcApi> | undefined =
    config.rpc ?? (config.rpcUrl ? (createSolanaRpc(config.rpcUrl) as Rpc<SolanaRpcApi>) : undefined)
  const rpcSubscriptions =
    config.rpcSubscriptions ??
    (config.rpcUrl
      ? createSolanaRpcSubscriptions(
          (config.rpcSubscriptionsUrl ?? toWebSocketUrl(config.rpcUrl)) as ClusterUrl,
        )
      : undefined)

  const actionContext = async (): Promise<ActionContext> => {
    if (!rpc) throw new RpcError('This action needs an rpc client. Pass rpc or rpcUrl.')
    if (!rpcSubscriptions) {
      throw new RpcError(
        'Sending needs rpcSubscriptions. Pass rpcUrl, or an rpcSubscriptions client, to confirm transactions.',
      )
    }
    if (!config.signer) {
      throw new RpcError(
        'This action needs a signer. Pass signer to createLucentClient({ signer }) — a wallet adapter or a keypair signer.',
      )
    }
    const microLamportsPerComputeUnit = await resolveFee()
    return {
      rpc,
      rpcSubscriptions,
      signer: config.signer,
      microLamportsPerComputeUnit,
    }
  }

  /**
   * Price the transaction. The fee is resolved once per action so a caller can
   * see it on the plan, rather than being buried in the send call.
   */
  const resolveFee = async (accountKeys: Address[] = []): Promise<number> => {
    if (!rpc) return 0
    const level = config.priorityFeeLevel ?? 'medium'
    if (level === 'none') return 0
    const { microLamportsPerComputeUnit } = await estimatePriorityFee({
      rpc,
      level,
      accountKeys,
      ...(isHeliusEndpoint(config.rpcUrl) ? { heliusUrl: config.rpcUrl as string } : {}),
      ...(fetch ? { fetch } : {}),
    })
    return microLamportsPerComputeUnit
  }

  const requireRpc = (method: string): NonNullable<LucentClientConfig['rpc']> => {
    if (!rpc) throw new RpcError(`${method} needs an rpc client. Pass one to createLucentClient({ rpc }).`)
    return rpc
  }

  async function readChainPool(poolId: PoolId): Promise<Pick<Pool, 'stakeRate' | 'unstakeRate'>> {
    const client = requireRpc('getPool')
    try {
      const account = await fetchPool(client, POOLS[poolId].pool)
      return { stakeRate: account.data.stakeRate, unstakeRate: account.data.unstakeRate }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      throw new InvalidAccountError(POOLS[poolId].pool, message)
    }
  }

  async function getReceiptBalance(wallet: Address, poolId: PoolId): Promise<bigint> {
    const client = requireRpc('getReceiptBalance')
    const ata = await findAssociatedTokenAddress(wallet, POOLS[poolId].receiptMint)
    try {
      const { value } = await client.getTokenAccountBalance(ata).send()
      return BigInt(value.amount)
    } catch (cause) {
      // An absent token account is a zero balance, not an error: a wallet that has
      // never staked has no receipt account. Distinguishing that from a failed RPC
      // call is the reason v0's blanket `catch { return null }` was not copied.
      const message = cause instanceof Error ? cause.message : String(cause)
      if (/could not find account|not found|does not exist|Invalid param/i.test(message)) return 0n
      throw new RpcError(`Could not read the receipt balance for ${wallet}: ${message}`, { cause })
    }
  }

  return {
    getPool: async poolId => {
      await readChainPool(poolId)
      const client = requireRpc('getPool')
      const account = await fetchPool(client, POOLS[poolId].pool)
      return account.data
    },

    getGlobal: async () => {
      const client = requireRpc('getGlobal')
      const account = await fetchGlobal(client, MAINNET.GLOBAL)
      return account.data
    },

    getReceiptBalance,

    getHistory: async wallet => {
      const profile = await fetchHostedProfile(historyConfig, wallet)
      return {
        profile,
        exact: profile.historyExact,
        ...(profile.historyNote ? { note: profile.historyNote } : {}),
      }
    },

    getPosition: async wallet => {
      const profile = await fetchHostedProfile(historyConfig, wallet)

      return Promise.all(
        profile.positions.map(async hosted => {
          const metadata = POOLS[hosted.poolId as PoolId] as PoolMetadata | undefined
          if (!metadata) {
            // The API named a pool this SDK does not know about; surface it rather
            // than silently dropping a position that holds value.
            throw new InvalidAccountError(
              String(hosted.poolId),
              `the history API returned pool ${hosted.poolId}, which this SDK does not know`,
            )
          }

          // Without an RPC there is nothing to check against, and saying so beats
          // implying the numbers were verified.
          if (!rpc) {
            return {
              position: toPosition(hosted, metadata),
              verified: false,
              note: 'No rpc configured, so the API figures were not checked against chain.',
            }
          }

          const [chainBalance, chainRates] = await Promise.all([
            getReceiptBalance(wallet, hosted.poolId as PoolId),
            readChainPool(hosted.poolId as PoolId),
          ])

          const balanceMatches = chainBalance === hosted.receiptBalance
          const ratesMatch =
            chainRates.stakeRate === hosted.stakeRate && chainRates.unstakeRate === hosted.unstakeRate

          if (balanceMatches && ratesMatch) {
            return { position: toPosition(hosted, metadata), verified: true }
          }

          // Chain wins for balances and rates. The history-derived totals can only
          // come from the API, so they stay as reported and are flagged.
          const disagreements = [
            !balanceMatches && `receipt balance reported ${hosted.receiptBalance}, chain says ${chainBalance}`,
            !ratesMatch && 'pool rates moved since the API answered',
          ].filter((entry): entry is string => Boolean(entry))

          const rateDenom = hosted.rateDenom > 0n ? hosted.rateDenom : 100_000n
          return {
            position: toPosition(
              {
                ...hosted,
                receiptBalance: chainBalance,
                stakeRate: chainRates.stakeRate,
                unstakeRate: chainRates.unstakeRate,
                currentValue:
                  chainRates.unstakeRate > 0n
                    ? (chainBalance * chainRates.unstakeRate) / rateDenom
                    : hosted.currentValue,
              },
              metadata,
            ),
            verified: false,
            note: `Chain disagrees with the history API (${disagreements.join('; ')}). Balances and rates shown are from chain.`,
          }
        }),
      )
    },

    getClaims: async (wallet, poolId) => {
      const client = requireRpc('getClaims')
      // One filtered getProgramAccounts: ClaimRecords are seeded by
      // ["claim", poolId, nonce] and carry the claimer, so a memcmp on the claimer
      // returns exactly this wallet's records instead of the whole program's.
      const accounts = await client
        .getProgramAccounts(SYTHSTAKING_PROGRAM_ADDRESS, {
          encoding: 'base64',
          filters: [{ memcmp: { offset: 16n, bytes: wallet, encoding: 'base58' } }],
        })
        .send()

      const claims = accounts.map(account => decodeClaimAccount(account))
      const scoped =
        poolId === undefined ? claims : claims.filter(claim => claim.data.poolId === BigInt(poolId))
      return {
        pending: scoped.filter(claim => !claim.data.settled && !claim.data.cancelled),
        claimable: scoped.filter(claim => claim.data.settled && !claim.data.cancelled),
        cancelled: scoped.filter(claim => claim.data.cancelled),
      }
    },

    stake: async (poolId, amount, options = {}) =>
      buildStakePlan(await actionContext(), { poolId, amount, ...options }),

    unstake: async (poolId, receiptAmount, options = {}) =>
      buildUnstakePlan(await actionContext(), { poolId, receiptAmount, ...options }),

    claim: async poolId => {
      const client = requireRpc('claim')
      if (!config.signer) throw new RpcError('claim needs a signer.')
      const accounts = await client
        .getProgramAccounts(SYTHSTAKING_PROGRAM_ADDRESS, {
          encoding: 'base64',
          filters: [{ memcmp: { offset: 16n, bytes: config.signer.address, encoding: 'base58' } }],
        })
        .send()
      const claimable = accounts
        .map(account => decodeClaimAccount(account))
        .filter(
          claim =>
            Number(claim.data.poolId) === poolId && claim.data.settled && !claim.data.cancelled,
        )

      return buildClaimPlan(await actionContext(), {
        poolId,
        claims: claimable.map(claim => ({ nonce: claim.data.nonce })),
      })
    },

    cancelUnstake: async (poolId, nonce) =>
      buildCancelUnstakePlan(await actionContext(), { poolId, nonce }),

    settle: async poolId => {
      const client = requireRpc('settle')
      const pool = (await fetchPool(client, POOLS[poolId].pool)).data
      if (pool.nonce <= pool.settleHead) {
        throw new LucentError('QUEUE_EMPTY', `The ${POOLS[poolId].symbol} pool queue is empty.`)
      }
      const [headPda] = await findClaimRecordPda(poolId, pool.settleHead)
      const accounts = await client.getAccountInfo(headPda, { encoding: 'base64' }).send()
      if (!accounts.value) {
        throw new LucentError('CLAIM_NOT_FOUND', `No claim record at the head of the ${POOLS[poolId].symbol} queue.`)
      }
      const record = decodeClaimAccount({ pubkey: headPda, account: accounts.value })

      return buildSettlePlan(await actionContext(), {
        poolId,
        claim: { nonce: BigInt(pool.settleHead), claimer: record.data.claimer },
      })
    },
  }
}
