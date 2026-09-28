# Host application discovery

Inspect before editing. The objective is not a technology inventory for its own sake; it is evidence for where Lucent belongs and how the host normally implements a financial action.

## 1. Establish repository boundaries

Identify:

- workspace/package roots and the package containing the requested screen;
- package manager from lockfiles and workspace configuration;
- framework, language, router, rendering model, and client/server boundaries;
- validation scripts in package manifests and CI;
- local agent instructions and contribution conventions.

Do not install packages or edit files until the owning package and package manager are clear.

## 2. Trace the requested surface

Start from the route, page, component, or feature named in the request. Trace its imports and data flow. Record concrete paths for:

- the route or screen;
- its nearest reusable feature component;
- its data/query owner;
- its action or mutation owner;
- its tests and stories, if present.

Search for structurally similar features before designing anything new. For portfolio staking, useful analogues usually include asset rows/cards, send/receive actions, deposit/withdraw flows, yield opportunities, transaction review, and position details.

## 3. Infer the design language

Inspect implementation rather than asking what the app uses:

- component primitives: buttons, fields, cards, rows, tables, tabs, menus;
- overlays: dialogs, drawers, sheets, popovers, confirmation screens;
- feedback: toasts, banners, inline errors, skeletons, spinners, empty states;
- tokens: CSS variables, themes, Tailwind configuration, spacing, radius, shadows, color, typography;
- icons, motion, focus styles, breakpoints, and mobile navigation;
- copy conventions for assets, yields, fees, pending transactions, and errors.

Find the closest existing interaction and extend it. Do not reproduce Lucent's frontend.

## 4. Trace wallet ownership

Find the provider/context and every hook or service used by the target feature. Determine:

- wallet package and exact locked version;
- connected address representation;
- whether a real `@solana/kit` `TransactionSigner` is exposed;
- whether an official installed bridge produces that signer type;
- version-0 transaction support;
- connect/disconnect and network-mismatch behavior;
- whether the wallet or the application owns submission and confirmation.

A conventional object with `publicKey`, `signTransaction`, or `sendTransaction` is not proven compatible with Lucent. Do not cast it. See [client and wallet integration](client-and-wallet-integration.md).

## 5. Trace state and data patterns

Determine whether the feature uses component state, context, Redux, Zustand, TanStack Query, SWR, framework loaders/actions, or another pattern. Record:

- query/mutation wrappers;
- key construction and wallet/network scoping;
- cache invalidation or refetch conventions;
- polling/subscription behavior;
- form and validation libraries;
- decimal and token amount utilities.

Use the existing pattern. Do not add a state or query library just for Lucent.

## 6. Trace the transaction architecture

Follow one existing successful financial action end to end:

1. input validation;
2. quote/review state;
3. wallet prompt;
4. submission;
5. confirmation;
6. success UI and explorer link;
7. cache refresh;
8. wallet rejection, simulation failure, RPC failure, timeout, and retry.

Locate transaction status components, normalizers, analytics, logging, error boundaries, and notification helpers. Lucent must enter this flow rather than create a second one.

## 7. Check responsive and accessible behavior

Inspect how the analogous flow changes across breakpoints. Reuse mobile sheets, stacked layouts, touch targets, and navigation. Verify existing patterns for:

- labels and descriptions;
- keyboard operation and focus restoration;
- dialog/sheet semantics;
- live transaction status announcements;
- actionable visible errors;
- loading states that do not trap interaction.

## 8. Record evidence

Before implementation, be able to fill this table with paths or package versions:

| Decision | Evidence |
| --- | --- |
| Owning package and package manager | |
| Framework and rendering boundary | |
| Target route/component | |
| Closest existing action flow | |
| UI primitives to reuse | |
| Wallet provider and signer type | |
| RPC/network configuration | |
| State/query/mutation pattern | |
| Transaction status and error path | |
| Mobile pattern | |
| Accessibility pattern | |
| Typecheck/lint/test/build commands | |

If a row cannot be resolved by inspection and materially changes the implementation, ask one focused question. Otherwise proceed from the evidence.
