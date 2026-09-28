# Client and wallet integration

Fit Lucent into the host's existing infrastructure. Do not create a second wallet, RPC, or provider stack.

## Client placement

Follow the host's established lifetime:

- service/module singleton when clients are centralized;
- provider/context when network and wallet dependencies are contextual;
- hook or mutation factory when clients are built from connected-wallet state;
- request-scoped read client on a server only for public reads that do not need wallet signing.

Do not instantiate a new client on every render unless the host intentionally does that for comparable SDKs. Do not put a signing client in server-only code.

Separate read and write configuration when useful:

- read client: RPC and optional hosted `apiUrl`;
- write client: RPC, subscriptions, signer, and referral ID.

A missing referral ID is valid for read-only use but causes v1.0.0 stake/unstake construction to fail.

## RPC and subscriptions

`createLucentClient` accepts Kit RPC objects or URLs. Reads require RPC as documented in [the SDK overview](sdk-overview-v1.0.0.md). Writes require:

- `rpc` or `rpcUrl`;
- `rpcSubscriptions`, or an `rpcUrl` from which WebSocket subscriptions can be derived;
- a `TransactionSigner`.

If the host already owns compatible Kit clients, pass them rather than constructing parallel clients. When passing a prebuilt `rpc` without `rpcUrl`, also pass `rpcSubscriptions`; the SDK cannot derive a WebSocket endpoint from an opaque client.

The reviewed high-level client uses fixed mainnet addresses. Do not let a cluster selector imply devnet support by merely changing `rpcUrl`. Gate or hide Lucent when the host is on an unsupported network.

## Required signer contract

The public type is:

```ts
import type { TransactionSigner } from '@solana/kit'
```

Lucent reads `signer.address`, creates a version-0 transaction message, installs the signer as fee payer and instruction authority, and invokes Kit's signer pipeline during `plan.send()`.

A typical legacy Wallet Adapter-shaped object exposes `publicKey`, `signTransaction`, `signAllTransactions`, or `sendTransaction`. That shape is not proven to satisfy Kit's `TransactionSigner` and is not directly supported by evidence in the v1.0.0 package.

Never do this:

```ts
const signer = wallet as TransactionSigner
```

Never write an adapter by guessing how to convert Kit transactions into legacy web3.js transactions or signature dictionaries.

## Safe wallet decision tree

1. Inspect the exact host wallet package and locked version.
2. Check whether its hook/provider already exposes a value typed as the installed Kit `TransactionSigner`.
3. If not, inspect installed declarations and official version-matched documentation for an explicit bridge that returns that type.
4. Verify the bridge supports Kit v8 and version-0 transactions.
5. Typecheck the result without casts.
6. Verify with the actual wallet in the host transaction flow.
7. If no supported path exists, stop write implementation and report the incompatibility. Read-only Lucent data can still be integrated when its prerequisites are met.

Do not add a second wallet provider solely to work around incompatibility without an explicit architecture decision.

## Wallet states

Map these into existing host conventions:

- disconnected: use the existing connect action;
- connecting: reuse wallet loading state;
- connected but unsupported signer: disable writes with an actionable explanation;
- wrong network: use the host network-switch or unsupported-network pattern;
- signing: show the host wallet-approval state;
- rejection: preserve the host's rejection wording and retry path.

Do not request private keys or replace user-mediated wallet approval.

## Configuration ownership

Use the host's existing environment/configuration layer for:

- RPC HTTP and WebSocket endpoints;
- hosted `apiUrl`;
- referral ID;
- explorer/network metadata.

Do not expose secret RPC/API credentials in browser bundles. Public client-safe values must follow the framework's existing public-environment convention. Lucent does not supply a default hosted API URL in v1.0.0; do not guess one.

## Dependency consistency

Lucent v1.0.0 peers on `@solana/kit >=8 <9`. Ensure the host and SDK resolve compatible Kit types. Do not install duplicate major versions or bypass peer warnings. Re-run typecheck and the host's browser build after integration.
