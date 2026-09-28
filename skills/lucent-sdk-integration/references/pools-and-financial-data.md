# Pools and financial data

Keep data provenance explicit. Do not turn raw protocol fields into unsupported financial claims.

## Data classes

| Class | Examples | Source |
| --- | --- | --- |
| Static protocol metadata | pool ID, asset symbol, decimals, receipt symbol, known addresses | exported `POOLS` / `MAINNET` |
| Dynamic chain data | pool rates, limits, queue state, receipt balance | RPC through the client |
| Hosted protocol data | activity and history-derived totals | configured `apiUrl` |
| User-specific data | receipt balance, position, claims | RPC and/or hosted API |
| Local transaction state | input, validation, plan, signing, confirming, result | host application |

Label and cache each class according to its source. Never persist a dynamic value as static UI copy.

## Pool reads

```ts
const pool = await client.getPool(poolId)
const global = await client.getGlobal()
```

Relevant `Pool` fields include:

- `stakeRate` and `unstakeRate`;
- `receiptMaxSupply`;
- `minDepositAmount`;
- `pendingPayouts` and `settledPayouts`;
- `reserveBps`;
- `nonce` and `settleHead`;
- `pendingWithdrawAmount` and `withdrawUnlocksAt`.

These are base-unit or protocol fields, not presentation-ready marketing metrics. Use host formatting and explain only values whose semantics are verified.

`getGlobal()` includes `withdrawDelay`, measured in seconds. In the reviewed contract it delays strategy changes and manager withdrawals so liquidity providers can react; it is not the user's unstake queue duration or a redemption-timing estimate. Do not present it as user withdrawal time.

## Amounts and rates

Use decimal strings for user input and base-unit `bigint` at SDK boundaries:

```ts
const amount = parseAmount(input, POOLS[poolId].decimals)
const label = formatAmount(amount, POOLS[poolId].decimals)
```

`parseAmount` rejects exponent notation, separators, negative values, and excess fractional precision rather than truncating.

Rates use `RATE_DENOM = 100_000n`:

- `receiptPrice(unstakeRate)` is current underlying redemption value per receipt;
- `stakePrice(stakeRate)` is receipts minted per stake token.

These are exchange/conversion values, not APY.

## APY limitation

The reviewed v1.0.0 SDK has no APY field, endpoint, or annualization helper.

- `Position.yieldPercent` is lifetime yield relative to the position's deposited amount.
- A current exchange rate is not an annualized return.
- One or two historical rate observations are not an approved APY methodology.

If the host asks for Lucent APY, inspect the installed SDK and approved product data source. If neither provides APY and its methodology, report the gap or omit/disable that field. Never hardcode or relabel another metric as APY.

## Capacity limitation

`pool.receiptMaxSupply` exposes the configured receipt supply cap. The reviewed SDK does not expose current receipt mint supply or a `getCapacity()`/remaining-capacity helper.

Do not label `receiptMaxSupply` as remaining capacity. To present remaining capacity, require all of the following:

1. a trusted current supply source already used by the host or approved for the integration;
2. verified protocol semantics for how current supply and the cap map to deposit capacity;
3. unit conversion that accounts for receipt/stake rates where required;
4. explicit handling of stale or unavailable data.

Without those, show only the raw total cap with accurate labeling or report that remaining capacity is unavailable from the installed SDK.

## Position display

Use `getReceiptBalance` for the chain-held receipt amount. Use `getPosition` only when the hosted `apiUrl` is configured and surface its `verified`/`note` state according to host conventions.

Never hardcode:

- APY or yield;
- TVL;
- current or remaining capacity;
- exchange rates;
- wallet balances;
- positions;
- pending or claimable amounts.

Mock values are acceptable only when explicitly requested and visibly labeled as mock/demo data.
