# Staking

Treat staking as a host-native financial action backed by a Lucent `ActionPlan`, not as a Lucent widget.

## Prerequisites

Before exposing a stake action, prove:

- the host is on the mainnet deployment targeted by the installed client;
- referral stake instructions are deployed and compatible with the selected program;
- a valid client-level referral ID exists;
- the wallet exposes a real compatible `@solana/kit` `TransactionSigner`;
- RPC and WebSocket subscriptions are available;
- the host has a transaction status and error path to reuse.

The reviewed v1.0.0 snapshot's deployment notes say referral instructions are not yet live on mainnet. Follow [deployment and troubleshooting](deployment-and-troubleshooting.md); fail closed until current support is verified.

## Build the action

```ts
const plan = await client.stake(poolId, amount, {
  slippageBps: 50,
})
```

- `poolId` is `0` for USDC or `1` for SOL.
- `amount` is a positive base-unit `bigint` within `u64`.
- Parse human input with `parseAmount(input, POOLS[poolId].decimals)`.
- Default slippage is 50 basis points when omitted.
- `closeWsolAfterStake` applies to SOL and defaults to true in the builder.

The plan creates required associated token accounts idempotently. SOL staking wraps SOL to WSOL inside the transaction. Do not add a separate manual wrapping flow unless the installed SDK contract changes.

In reviewed v1.0.0, automatic WSOL cleanup is decided from the account balance before construction. A previously absent WSOL account is treated differently from an existing zero-balance account and may remain open after a first SOL stake, retaining rent. Do not promise cleanup; verify installed behavior and report the residual account using host conventions rather than adding an unsafe close transaction.

## Review and execute

`client.stake()` only constructs a plan. Integrate its lifecycle into the host:

1. Validate wallet, network, amount, available balance, and host form rules.
2. Build the plan.
3. Present the host's existing review/confirmation UI using verified values. `plan.summary` and `plan.fee` are available inputs, not mandated copy or layout.
4. Call `plan.send()` through the host mutation/transaction path.
5. Keep the action pending while the promise covers simulation, wallet signing, submission, and confirmed confirmation.
6. On success, use the returned signature in the host's existing success/explorer treatment.
7. Refresh affected pool, stake-token balance, receipt balance, position, and activity queries.
8. On failure, normalize it through the host's existing error system without claiming funds moved.

`send()` simulates by default. Do not pass `skipSimulation: true` as a routine optimization.

## Host UI mapping

Prefer the existing asset action and transaction-review structures. For example, an existing SOL card or row should gain the same kind of action used by Send, Receive, Deposit, or Withdraw. Do not wrap it in a new Lucent card or apply Lucent colors.

Use host conventions for:

- input and max controls;
- fee and minimum-output disclosure;
- slippage settings, if the host exposes them elsewhere;
- signing and confirmation states;
- wallet rejection and retry;
- balance refresh and success notification;
- mobile sheet/drawer behavior.

Do not expose SDK language such as `ActionPlan`, `receiptAmount`, or `stakeRate` directly unless the host uses protocol-level terminology.

## Validation and errors

Handle at least:

- empty, malformed, zero, negative, or over-precision input;
- amount above available balance;
- missing/unsupported signer;
- unsupported network or unverified deployment;
- invalid referral ID;
- plan construction/RPC failure;
- simulation failure (`ActionFailedError`);
- wallet rejection;
- submission or confirmation failure.

Never report success before `plan.send()` resolves.
