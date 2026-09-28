# Transactions and errors

Lucent writes are plans. Integrate the plan lifecycle into the host's transaction architecture without overstating what the SDK exposes.

## Action plan lifecycle

```ts
const plan = await client.stake(poolId, amount)
const simulation = await plan.simulate()
const { signature } = await plan.send()
```

`ActionPlan` exposes:

- `action`: machine-readable action name;
- `summary`: SDK-generated one-line description;
- `instructions`: current built instructions;
- `fee`: compute limit, priority price, and rough maximum lamports;
- `simulate()`: no-wallet simulation result;
- `send()`: sign, submit, and confirm.

`send()` simulates by default. If that simulation fails, it throws `ActionFailedError`. An explicit earlier `simulate()` followed by normal `send()` simulates again; do not disable the second preflight unless the product deliberately accepts state drift and the behavior is reviewed.

## State mapping

Use the host's existing state model. At minimum represent:

1. idle;
2. validating input and prerequisites;
3. building/reviewing the plan;
4. awaiting wallet approval;
5. submitting/confirming;
6. confirmed success;
7. validation failure;
8. wallet rejection;
9. simulation/program failure;
10. RPC/network/confirmation failure.

The v1.0.0 `send()` promise does not provide a callback when submission occurs. It returns the signature only after confirmed confirmation. A host can show a combined submitting/confirming state, but must not claim to know a transaction ID or exact phase before the SDK exposes it.

The reviewed `send()` implementation may rebuild, sign, and submit once more after an error it classifies as stale. Its classifier is broad and includes any message containing `custom program error`, so a deterministic program failure can cause a second wallet approval attempt. Do not add another automatic retry around `send()`. Make repeated wallet prompts tolerable in host status copy, keep actions idempotency-aware, and recheck this behavior in the installed SDK.

Closing a local review dialog before signing is not an on-chain cancellation. Once `plan.send()` starts, v1.0.0 exposes no cancellation API. Do not show an in-flight transaction as cancellable unless the installed SDK and host transaction layer prove it. `cancelUnstake()` is a separate protocol action that cancels a pending redemption record.

## Simulation

```ts
interface SimulationResult {
  ok: boolean
  unitsConsumed: number | null
  logs: string[]
  error: string | null
}
```

Simulation uses a placeholder signature and does not prove the configured wallet can sign. It proves transaction construction/program execution against a chain snapshot. The transaction is rebuilt before sending, so on-chain slippage and account constraints remain authoritative.

## Error handling

Handle `ActionFailedError` before `LucentError` if presenting its simulation detail:

```ts
try {
  const { signature } = await plan.send()
  return signature
} catch (error) {
  if (error instanceof ActionFailedError) {
    return hostFailure(error.simulation.error ?? error.message)
  }
  if (error instanceof LucentError) {
    return hostFailure(error.message, error.code)
  }
  throw error
}
```

Use the host's error normalizer instead of exposing raw logs or adding a Lucent toast system. Preserve useful diagnostic context for logging without leaking secrets.

Common typed SDK codes/classes include:

- `INVALID_ACCOUNT` / `InvalidAccountError`;
- `RPC_ERROR` / `RpcError`;
- `HISTORY_API_ERROR` / `HistoryApiError`;
- `INVALID_AMOUNT` / `InvalidAmountError`;
- `INVALID_REFERRAL_ID` / `InvalidReferralIdError`;
- ad hoc `LucentError` codes such as `INVALID_SLIPPAGE`, `NOTHING_TO_CLAIM`, `QUEUE_EMPTY`, and `CLAIM_NOT_FOUND`.

`ActionFailedError` is not a `LucentError`. Wallet rejection and Kit/RPC signing or submission failures may be untyped lower-level errors; identify them using the host's existing wallet/error conventions rather than brittle message matching when possible.

## Fees and review

`plan.fee.maxLamports` includes priority fee plus a rough 5,000-lamport single-signature base assumption. It is not guaranteed to be the exact final network fee. Present it only with wording consistent with that limitation and the host's existing fee UI.

`plan.summary` is valid SDK output but is not required product copy. Adapt reviewed values into the host's terminology and component hierarchy.

## Success and refresh

Only enter success after `plan.send()` resolves. Then:

- store/show the returned signature using the host explorer-link pattern;
- invalidate/refetch affected chain, hosted, and wallet data;
- close/reset forms using host conventions;
- send existing analytics/telemetry if comparable actions do;
- preserve retry for post-confirmation refresh failures without pretending the transaction failed.

Never fabricate success, bypass wallet confirmation, silently sign, or treat optimistic local state as confirmation.
