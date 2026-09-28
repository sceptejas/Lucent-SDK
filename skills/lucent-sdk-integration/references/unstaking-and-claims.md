# Unstaking and claims

Lucent redemption is queued. Do not present unstake as an immediate receipt-token-to-underlying transfer.

## Lifecycle

```text
receipt balance
  → unstake burns receipts and creates a pending claim
  → permissionless settlement advances the FIFO head
  → the claim becomes claimable
  → claim transfers the underlying payout
```

A pending redemption may instead be cancelled, which remints its receipt tokens. Cancellation is not a claim.

## Read claim state

```ts
const claims = await client.getClaims(walletAddress, poolId)
```

The result has `pending`, `claimable`, and `cancelled` arrays. Each entry is an account whose decoded data includes `nonce`, `receiptAmount`, `payout`, `settled`, and `cancelled`.

`getClaims` requires an RPC that supports `getProgramAccounts`; public endpoints may reject it. Reuse the host's full-node RPC or show the host's established unavailable/error state. Do not silently treat a failed read as an empty queue.

## Start unstaking

```ts
const plan = await client.unstake(poolId, receiptAmount, {
  slippageBps: 50,
})
const { signature } = await plan.send()
```

- `receiptAmount` is positive base-unit `bigint`.
- Default slippage is 50 basis points.
- The payout is fixed from the current unstake rate and queued in a claim record.
- The builder refreshes the pool nonce for transaction attempts.
- v1.0.0 unstake uses the referral instruction and requires the same referral/deployment gates as stake.

After confirmation, refresh receipt balance, position, claims, pool queue state, and history. Show a pending redemption, not a completed withdrawal.

## Claim settled payouts

```ts
const plan = await client.claim(poolId)
const { signature } = await plan.send()
```

The high-level method discovers every settled, non-cancelled claim for the configured signer in that pool and puts them into one plan. It throws a `LucentError` with code `NOTHING_TO_CLAIM` when none exist.

Because all claimable records are combined, a wallet with many records may hit transaction size or compute limits. Do not invent a batching API. Report the limitation or inspect a newer installed SDK.

## Cancel a pending redemption

```ts
const plan = await client.cancelUnstake(poolId, claim.data.nonce)
const { signature } = await plan.send()
```

Use the nonce from the selected claim record. Present cancellation as receipt restoration. Refresh claims, receipt balance, position, and activity after confirmation.

## Settlement

```ts
const plan = await client.settle(poolId)
const { signature } = await plan.send()
```

Settlement is permissionless but still needs a signer to pay and submit. It advances the FIFO head and is usually operational/keeper behavior, not automatically a user-facing action. Do not make an integrating user pay settlement fees unless the product explicitly chooses that experience.

The `lucent-sdk/keeper` entry point provides keeper helpers. Add an operational keeper only when requested, with explicit signer custody, funding, monitoring, and deployment ownership.

## UX requirements

Use the host's existing pending/processing/claimable patterns. Clearly distinguish:

- receipts currently held;
- amount queued/pending;
- amount settled and claimable;
- cancelled records;
- completed claims.

Do not show a pending payout as wallet balance. Do not promise a settlement time unless its unit and operational process are verified. Reuse host transaction status, toasts, explorer links, error handling, mobile patterns, and accessible controls for each separate action.
