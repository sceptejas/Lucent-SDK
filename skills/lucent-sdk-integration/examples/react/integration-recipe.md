# React adaptation recipe

Use this only after [host discovery](../../references/host-application-discovery.md). It is a mapping recipe, not a component library.

## 1. Reuse providers

Locate the existing wallet and data providers. Do not mount a Lucent provider or a second wallet provider unless the installed SDK explicitly requires one; v1.0.0 does not export a React provider.

Obtain the connected address and a real `@solana/kit` `TransactionSigner` from the host's wallet boundary. If the host exposes only a conventional legacy Wallet Adapter, follow [the signer decision tree](../../references/client-and-wallet-integration.md) and stop writes when no official compatible bridge exists.

## 2. Place the client at the host boundary

Follow the nearest comparable integration:

- if clients live in a service module, add Lucent there;
- if hooks build clients from wallet/network context, add a host-named hook there;
- if RPC clients come from context, pass those compatible Kit clients instead of constructing duplicates.

Memoize according to host practice using only stable configuration dependencies. Recreate a write client when signer, network, or referral configuration changes.

## 3. Map reads into existing data state

Use the host's established query or state mechanism. Do not install one for Lucent.

- Enable wallet-specific reads only when an address exists.
- Scope keys by wallet, pool, and network as the host normally does.
- Keep hosted `apiUrl` reads distinct from chain-only reads when their error/staleness treatment differs.
- Preserve `verified`, `note`, `exact`, and history notes in the state model.
- Reuse existing skeleton, empty, stale, and error states.

## 4. Extend the nearest UI

For staking on an asset surface, add an action to the existing asset action group. For positions, add a row/section to the existing portfolio model. For claims, reuse the existing pending-action or withdrawal lifecycle UI.

Use existing fields, buttons, review dialog/drawer, toasts, icons, and copy. Do not add `LucentStakeButton`, `LucentCard`, or a Lucent visual theme by default.

## 5. Map writes into existing mutations

Use the host mutation/transaction helper around the functions in `../minimal/`:

1. validate connected wallet, supported network, input, balance, referral, and deployment;
2. build the plan and feed verified summary/fee data into the host review UI;
3. call `plan.send()` from the mutation;
4. keep the mutation pending through confirmation;
5. show success only after the returned signature;
6. invalidate affected queries listed in [positions and history](../../references/positions-and-history.md);
7. normalize `ActionFailedError`, `LucentError`, wallet rejection, and network errors through existing error UI.

Do not optimistically mark the transaction confirmed.

## 6. Preserve responsive and accessible behavior

Reuse the host's mobile sheet or layout, focus management, field labels, keyboard actions, live status, and error semantics. Test disconnected, signing, rejected, confirming, success, and failure states at existing breakpoints.

## 7. Verify

Run the owning package's typecheck, lint, component/unit tests, and production build. Exercise the real wallet path in an approved environment; SDK simulation does not prove wallet signer compatibility.
