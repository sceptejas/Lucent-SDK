# Deployment and troubleshooting

Deployment compatibility is a production gate, not a detail to discover after a wallet prompt.

## Reviewed v1.0.0 status

The source accompanying the reviewed SDK states:

- `client.stake()` builds `stake_with_referral`;
- `client.unstake()` builds `unstake_with_referral`;
- both require a referral ID;
- the referral ID annotates events but moves no funds and gates no program logic;
- referral-period compensation is described as a 2% off-chain payout computed from attested event timestamps/rates, and a later `cancel_unstake` voids that period through its nonce-linked cancellation event;
- the live mainnet program in that snapshot was still the previous build and did not yet expose those referral instructions.

Therefore the reviewed package can typecheck and compose write plans while live stake/unstake still fail with an unknown instruction. This status can change after the skill is distributed, so verify current deployment evidence rather than treating either availability or unavailability as permanent.

## Production deployment gate

Before enabling stake or unstake:

1. Confirm the installed SDK version and generated program address.
2. Confirm the host is using the mainnet network targeted by the client.
3. Check version-matched release notes, deployment manifests, official program/IDL publication, or another approved authoritative source for referral instruction support.
4. Confirm the referral ID and program deployment belong to the same integration environment.
5. Record the evidence in the implementation summary.

Do not use a value-bearing transaction as a deployment probe. If support cannot be proven, hide or disable writes using the host's established unavailable-feature pattern and report the blocker.

Read-only methods may remain usable when their own RPC/hosted API prerequisites are met.

## Known v1.0.0 gaps and stale claims

The reviewed source and prose documentation disagree in several places. Relevant integration facts are:

- `stake()` returns an `ActionPlan`; it does not execute by itself.
- positions, history, and action plans are implemented despite stale prose describing them as future work;
- `rpc` is selected ahead of `rpcUrl` when both are supplied, despite a comment saying `rpcUrl` is preferred;
- `computeUnitLimit` is declared in client configuration but is not forwarded by the high-level client;
- comments referring to `getClaimable()` are stale; use `getClaims()` and its `claimable` array;
- `HistoryIncompleteError` is exported but reviewed client paths return `exact: false`/`note` instead of throwing it;
- the SDK has no APY API or complete remaining-capacity API;
- no generic conventional Wallet Adapter bridge is shipped or verified;
- the client is mainnet-addressed even though a devnet program constant is exported;
- exported pool metadata names pool 0's receipt symbol `lmUSD`, while the accompanying program-change note calls the existing mint `lmUSDC`. Use the installed SDK's exported `POOLS[0].receiptSymbol` unless approved product metadata establishes another display name.

Installed package declarations and behavior win over these notes.

## Troubleshooting matrix

| Symptom | Check | Action |
| --- | --- | --- |
| Unknown instruction on stake/unstake | Referral instruction deployment | Disable writes until deployment is verified |
| Missing signer or signing type error | Exact wallet return type and Kit version | Use native Kit signer or official compatible bridge; never cast |
| Confirmation setup error | `rpcSubscriptions` or derivable `rpcUrl` | Reuse/configure host WebSocket RPC |
| Position/history says no API URL | `apiUrl` configuration | Obtain approved hosted endpoint; do not guess |
| `getClaims` RPC failure | `getProgramAccounts` support | Use host full-node RPC or show unavailable state |
| `NOTHING_TO_CLAIM` | Claim records are not settled | Refresh claims and show pending state |
| `QUEUE_EMPTY` | No FIFO head to settle | Treat as no work, not transaction success |
| `ActionFailedError` | `simulation.error` and logs | Map decoded failure into host error UX |
| Invalid referral ID | Nonblank and UTF-8 byte length ≤ 32 | Use exported referral validation helpers |
| Pool read on devnet fails/mismatches | Client has fixed mainnet addresses | Gate Lucent to supported mainnet deployment |
| APY requested | No approved APY source/methodology | Report gap; do not relabel `yieldPercent` |
| Remaining capacity requested | Current receipt supply/semantics absent | Show only verified cap or obtain approved source |
| First SOL stake leaves empty WSOL ATA | v1.0.0 close logic may not close a previously absent ATA | Do not add unsafe cleanup; report/verify with installed version |
| Claim plan too large | High-level claim includes all claimable records | Report limitation or inspect newer SDK; do not invent batching |

## Security checks

- Never request or store private keys or seed phrases.
- Keep wallet signing user-mediated.
- Keep secret RPC/API credentials out of client bundles.
- Do not log signed transactions, signing material, or sensitive provider URLs.
- Do not assume simulation, submission, or optimistic state equals confirmed success.
- Do not bypass preflight to make an incompatible deployment appear functional.
