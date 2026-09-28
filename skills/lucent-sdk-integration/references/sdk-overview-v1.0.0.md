# Lucent SDK v1.0.0 contract

This is a versioned map of the reviewed `lucent-sdk@1.0.0` public surface. Reinspect the installed package before implementation.

## Package contract

- Package: `lucent-sdk@1.0.0`
- Runtime: Node.js 20 or newer for package tooling; root bundle is browser-checked.
- Peer: `@solana/kit >=8.0.0 <9`
- Public entry points: `lucent-sdk`, `lucent-sdk/keeper`
- High-level client: mainnet program, pools, and mints are fixed in exported configuration.

## Client configuration

```ts
interface LucentClientConfig extends Partial<HistoryApiConfig> {
  rpc?: Rpc<SolanaRpcApi>
  rpcUrl?: ClusterUrl
  rpcSubscriptions?: RpcSubscriptions<SolanaRpcSubscriptionsApi>
  rpcSubscriptionsUrl?: ClusterUrl
  signer?: TransactionSigner
  priorityFeeLevel?: 'none' | 'low' | 'medium' | 'high' | 'veryHigh'
  computeUnitLimit?: number
  referralId?: string
}

declare function createLucentClient(config: LucentClientConfig): LucentClient
```

`HistoryApiConfig` contributes `apiUrl?: string` and `fetch?: typeof globalThis.fetch` through the partial extension. A URL supplied as `rpcUrl` can also derive WebSocket subscriptions. If only a constructed `rpc` is supplied, pass `rpcSubscriptions` for writes.

`computeUnitLimit` is declared but is not forwarded by the reviewed high-level client into action plans. Do not promise that it changes v1.0.0 transactions.

## Pools

```ts
type PoolId = 0 | 1
```

| Pool | Asset | Decimals | Receipt |
| --- | --- | ---: | --- |
| `0` | USDC | 6 | lmUSD |
| `1` | SOL/WSOL | 9 | lmSOL |

Use exported `POOLS` metadata rather than duplicating addresses. The high-level client is mainnet-addressed; changing the RPC endpoint does not retarget these accounts.

## Read methods

```ts
interface LucentReads {
  getPool(poolId: PoolId): Promise<Pool>
  getGlobal(): Promise<Global>
  getReceiptBalance(wallet: Address, poolId: PoolId): Promise<bigint>
  getClaims(wallet: Address, poolId?: PoolId): Promise<WalletClaims>
  getPosition(wallet: Address): Promise<PositionResult[]>
  getHistory(wallet: Address): Promise<HistoryResult>
}
```

Requirements:

| Method | RPC | Hosted `apiUrl` | Notes |
| --- | --- | --- | --- |
| `getPool` | Required | No | Raw pool account state |
| `getGlobal` | Required | No | Includes `withdrawDelay` |
| `getReceiptBalance` | Required | No | Missing token account returns `0n` |
| `getClaims` | Full-node RPC | No | Requires `getProgramAccounts` |
| `getPosition` | Optional for verification | Required | Chain balance/rates replace hosted disagreement |
| `getHistory` | No | Required | Returns exactness metadata |

The root package does not export named `Pool`, `Global`, or `ClaimRecord` types. Let method return types infer them rather than deep-importing internals.

## Write methods

```ts
interface LucentWrites {
  stake(
    poolId: PoolId,
    amount: bigint,
    options?: { slippageBps?: number; closeWsolAfterStake?: boolean },
  ): Promise<ActionPlan>

  unstake(
    poolId: PoolId,
    receiptAmount: bigint,
    options?: { slippageBps?: number },
  ): Promise<ActionPlan>

  claim(poolId: PoolId): Promise<ActionPlan>
  cancelUnstake(poolId: PoolId, nonce: bigint): Promise<ActionPlan>
  settle(poolId: PoolId): Promise<ActionPlan>
}
```

These methods build plans. They do not send transactions.

```ts
interface ActionPlan {
  action: string
  summary: string
  instructions: readonly Instruction[]
  fee: {
    computeUnitLimit: number
    microLamportsPerComputeUnit: number
    maxLamports: bigint
  }
  simulate(): Promise<SimulationResult>
  send(options?: { skipSimulation?: boolean }): Promise<{ signature: Signature }>
}
```

`send()` simulates unless explicitly skipped, signs through the configured signer, submits, confirms at `confirmed`, and returns the signature. See [transactions and errors](transactions-and-errors.md).

## Amount and rate helpers

```ts
declare const RATE_DENOM: 100_000n
declare function parseAmount(human: string, decimals: number): bigint
declare function formatAmount(
  raw: bigint,
  decimals: number,
  options?: { maxFractionDigits?: number; grouping?: boolean },
): string
declare function formatAmountExact(raw: bigint, decimals: number): string
declare function formatSignedAmount(
  raw: bigint,
  decimals: number,
  maxFractionDigits?: number,
): string
declare function formatPercent(percent: number | null, digits?: number): string
declare function receiptPrice(unstakeRate: bigint, rateDenom?: bigint): number
declare function stakePrice(stakeRate: bigint, rateDenom?: bigint): number
```

Pass human input as a decimal string to `parseAmount`; keep base units as `bigint`. Do not convert token amounts through floating-point numbers.

## Referral helpers

```ts
declare const MAX_REFERRAL_ID_BYTES: 32
declare function referralIdByteLength(referralId: string): number
declare function isValidReferralId(referralId: unknown): referralId is string
declare function assertReferralId(referralId: unknown): string
```

Stake and unstake require a client-level referral ID. It must be nonblank and at most 32 UTF-8 bytes. It is attested verbatim, including surrounding whitespace when the value is otherwise nonblank.

## Position and history results

```ts
interface PositionResult {
  position: Position
  verified: boolean
  note?: string
}

interface HistoryResult {
  profile: HostedProfile
  exact: boolean
  note?: string
}
```

`verified` concerns chain verification of receipt balance and rates. It does not make history-derived totals trustless. `exact` reports the hosted history completeness verdict.

## Exported errors

- `LucentError` with a branchable `code`
- `InvalidAccountError`
- `RpcError`
- `HistoryApiError`
- `HistoryIncompleteError` (exported but not thrown by reviewed client paths)
- `InvalidAmountError`
- `InvalidReferralIdError`
- `ActionFailedError` with `simulation`; this extends `Error`, not `LucentError`

Wallet rejection and lower-level signing/submission failures may pass through as non-Lucent errors.

## Keeper entry point

`lucent-sdk/keeper` exports `settleOnce`, `settleLoop`, `settleAll`, related types, and `POOLS`. It is operational settlement functionality, not a browser UI requirement. Do not add a keeper to a host application unless explicitly requested and operational ownership is defined.
