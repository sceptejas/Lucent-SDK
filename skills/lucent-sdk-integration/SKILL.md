---
name: lucent-sdk-integration
description: Integrate the Lucent SDK into an existing application using its native architecture, design system, wallet, state, and transaction patterns. Use when asked to add or integrate Lucent staking, unstaking, positions, yield data, pool information, claims, or other `lucent-sdk` functionality; do not use for unrelated Solana development.
license: MIT
compatibility: Requires repository access and the host application's package-manager, typecheck, test, and build tools. Lucent writes require a compatible @solana/kit TransactionSigner.
metadata:
  version: "1.0.0"
  sdk-reference-version: "lucent-sdk@1.0.0"
---

# Integrate Lucent natively

Lucent provides functionality. The host application provides the UX.

Apply this priority order to every decision:

> existing application > existing design system > existing UX patterns > Lucent SDK > Lucent UI conventions

Do not begin by writing Lucent code. Inspect the host repository, prove the integration path, and then make the smallest clean change that makes Lucent feel native to the application.

## Mandatory workflow

1. **Understand the request.** Identify the requested capability and likely surface without assuming a new page, card, dialog, or flow.
2. **Inspect the host.** Follow [host application discovery](references/host-application-discovery.md). Record concrete files and existing patterns for the framework, rendering boundaries, package manager, UI, wallet, state, transactions, terminology, responsive behavior, accessibility, and validation commands.
3. **Inspect the installed SDK.** Follow [installation and API inspection](references/installation-and-api-inspection.md). The installed package, lockfile, exports, declarations, and source outrank this skill when versions differ.
4. **Read the required v1 references.** Always read [the SDK overview](references/sdk-overview-v1.0.0.md) and [deployment constraints](references/deployment-and-troubleshooting.md). Load only the other references relevant to the requested capability.
5. **Map functionality into existing UX.** Ask: “How would this application implement this feature if Lucent did not exist?” Reuse that location, component hierarchy, language, and transaction experience; use Lucent only underneath it.
6. **Prove prerequisites.** Confirm network compatibility, RPC and WebSocket access, hosted API configuration when needed, and a real `@solana/kit` `TransactionSigner` for writes. Fail closed when any prerequisite is unverified.
7. **Implement narrowly.** Extend existing components and service/hook boundaries. Add no unrelated refactor, parallel architecture, branding layer, or speculative functionality.
8. **Handle the complete lifecycle.** Cover disconnected wallet, validation, plan construction, simulation/preflight, wallet signing, submission, confirmation, success, failure, refresh, retry, and cancellation using host conventions.
9. **Validate with the host's commands.** Run relevant typecheck, lint, tests, and build. Exercise responsive and accessible behavior where the repository supports it.
10. **Report exactly what changed.** Use [the completion template](templates/completion-summary.md). State files changed, behavior, checks run, assumptions, and unresolved SDK or deployment gaps.

## Host-native UX rules

- Search for the nearest existing analogue before creating UI: deposit, withdraw, swap, send, asset action, yield row, position view, transaction review, or status flow.
- Reuse the host's buttons, cards, forms, dialogs, drawers, bottom sheets, tables, toasts, loaders, errors, icons, typography, spacing, breakpoints, and copy style.
- Extend an existing asset or transaction component when it is the natural owner. Do not create a Lucent-specific parallel component merely to hold Lucent behavior.
- Reuse mobile and accessibility primitives. Preserve keyboard operation, labels, dialog semantics, focus behavior, actionable errors, and non-blocking status updates.
- Use host terminology by default. Mention Lucent only where protocol attribution or product requirements make it useful.
- Do not copy Lucent branding, colors, gradients, typography, navigation, cards, staking terminal, page structure, or frontend terminology unless explicitly requested.
- Do not introduce components such as `LucentCard`, `LucentModal`, `LucentTerminal`, `LucentTheme`, or `LucentDashboard` by default.
- Do not introduce a new UI library, styling system, wallet provider, RPC context, state manager, query library, toast system, or transaction tracker when the host already has one.

## SDK truth and safety gates

- Never invent an SDK method, import, type, address, endpoint, APY, capacity figure, or transaction result.
- Use only package entry points exported by the installed version. For v1.0.0 these are `lucent-sdk` and `lucent-sdk/keeper`.
- Treat every write method as plan construction. `stake`, `unstake`, `claim`, `cancelUnstake`, and `settle` return an `ActionPlan`; nothing is sent until `plan.send()`.
- Do not report success before `plan.send()` returns after confirmation. Never fabricate, optimistically assert, or silently sign transaction success.
- Never request, store, log, or expose private keys, seed phrases, signing material, RPC secrets, or hosted API credentials. Wallet approval remains under the host wallet infrastructure.
- Lucent v1.0.0 requires a real `@solana/kit` `TransactionSigner` for writes. Do not cast a legacy wallet object with `as TransactionSigner` and do not invent a transaction adapter. Use host-native Kit support or an official version-matched bridge verified from installed package documentation and types.
- The v1.0.0 client is mainnet-addressed. A devnet RPC URL does not retarget its fixed program, pool, or mint addresses.
- Stake and unstake require a nonblank referral ID no longer than 32 UTF-8 bytes. Validate bytes, not JavaScript character count.
- The reviewed v1.0.0 snapshot builds referral instructions that its accompanying deployment notes say are not yet live on mainnet. Do not expose production stake or unstake until deployment support is independently verified for the selected program.
- `getPosition` and `getHistory` require a configured hosted `apiUrl`. Do not guess that URL.
- The SDK has no APY API. `yieldPercent` is not APY, and exchange-rate movement is not automatically an annualized rate.
- The SDK has no complete remaining-capacity API. `receiptMaxSupply` without current mint supply is not remaining capacity.
- Never hardcode dynamic APY, TVL, pool capacity, exchange rates, balances, positions, or transaction state unless explicitly asked for labeled mock data.

## Architecture decisions

- Put SDK creation in the host's existing service, client, provider, or hook boundary. Do not make components own infrastructure when the host centralizes it.
- Map reads into the existing query/cache/state pattern. Scope keys by wallet, pool, network, and other inputs as the host normally does.
- Map writes into the existing mutation and transaction-status path. Reuse host notifications, explorer links, error normalization, analytics, and refresh behavior.
- Invalidate or refetch pool data, receipt balances, positions, claims, and history that can change after a confirmed action.
- Keep wallet-dependent code in the browser/client boundary required by the framework. Do not move private signing to a server.
- Preserve the distinction between static pool metadata, dynamic chain data, hosted history, user-specific data, and local transaction state.
- Use base-unit `bigint` values at SDK boundaries and the SDK's exact amount helpers where appropriate. Do not use floating-point arithmetic for token amounts.

## Questions policy

Answer repository questions by inspection. Do not ask which framework, component library, wallet, state manager, modal, toast, package manager, or test command is used when the codebase reveals it.

Ask only when a material product or operational decision remains unresolved, such as:

- the intended cluster or deployment when repository evidence conflicts;
- the approved referral ID or hosted API URL when neither exists in configuration;
- whether to hide or disable writes whose deployment compatibility cannot be proven, but only when the host has no established unavailable-feature pattern;
- product copy or placement when multiple existing patterns are equally plausible.

Do not stop for a question when a safe host-native default exists. Infer hide versus disable from existing unavailable-feature behavior. Missing referral or hosted API configuration disables only dependent functionality; continue verified read-only work and report the unresolved prerequisite.

Batch unresolved questions. Continue any safe read-only analysis while waiting.

## Reference routing

| Need | Read |
| --- | --- |
| Repository and design-system inspection | [Host application discovery](references/host-application-discovery.md) |
| Install or inspect the actual package | [Installation and API inspection](references/installation-and-api-inspection.md) |
| Exact v1.0.0 methods and types | [SDK overview](references/sdk-overview-v1.0.0.md) |
| RPC, client lifetime, and wallet signer | [Client and wallet integration](references/client-and-wallet-integration.md) |
| Pools, balances, rates, APY, capacity | [Pools and financial data](references/pools-and-financial-data.md) |
| Stake flow | [Staking](references/staking.md) |
| Unstake, claims, cancel, settlement | [Unstaking and claims](references/unstaking-and-claims.md) |
| Positions and activity | [Positions and history](references/positions-and-history.md) |
| Plans, confirmation, errors, refresh | [Transactions and errors](references/transactions-and-errors.md) |
| Deployment checks and known gaps | [Deployment and troubleshooting](references/deployment-and-troubleshooting.md) |

Use [the integration plan template](templates/integration-plan.md) for nontrivial work. Do not open or adapt examples until host discovery, installed-package inspection, signer verification, and deployment gating are complete. Examples are non-authoritative transaction primitives and must not determine architecture. Framework-neutral examples are under `examples/minimal/`; React and Next.js files are adaptation recipes, not component libraries.

## Completion standard

An integration is complete only when it:

- looks and reads like an existing host feature;
- reuses the host wallet and transaction architecture;
- uses methods and types confirmed in the installed SDK;
- represents pending, signing, confirming, success, rejection, and failure honestly;
- fetches dynamic financial data rather than hardcoding it;
- remains responsive and accessible under host conventions;
- passes the relevant host checks; and
- reports any unverified deployment, signer, hosted API, APY, or capacity limitation instead of hiding it.
