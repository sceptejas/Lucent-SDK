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
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type GetAccountInfoApi,
  type GetMultipleAccountsApi,
  type GetTokenAccountBalanceApi,
  type Rpc,
} from '@solana/kit'

import { fetchHostedProfile, type HistoryApiConfig, type HostedProfile } from './api'
import { MAINNET, POOLS, type PoolId, type PoolMetadata } from './config'
import { InvalidAccountError, RpcError } from './errors'
import { toPosition, type Position } from './position'
import { fetchGlobal, type Global } from './generated/accounts/global'
import { fetchPool, type Pool } from './generated/accounts/pool'

/** Well-known program ids, so a position read needs no extra dependency. */
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address

export interface LucentClientConfig extends Partial<HistoryApiConfig> {
  /** RPC for the trustless reads. Without it, positions cannot be verified. */
  rpc?: Rpc<GetAccountInfoApi & GetMultipleAccountsApi & GetTokenAccountBalanceApi>
}

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

export function createLucentClient(config: LucentClientConfig): LucentClient {
  const { rpc, apiUrl, fetch } = config
  const historyConfig: HistoryApiConfig = { apiUrl: apiUrl ?? '', ...(fetch ? { fetch } : {}) }

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
  }
}
