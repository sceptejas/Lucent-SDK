# Next.js adaptation recipe

Apply the [React recipe](../react/integration-recipe.md) plus the rendering and configuration boundaries below. Inspect the installed Next.js version and router before choosing files or directives.

## Client/server boundary

Wallet-dependent Lucent actions belong in the existing client-side wallet boundary. Do not move signing into a route handler, server action, or server component. Never send private keys or signing material to the server.

Chain-only public reads may run where the host runs comparable reads, provided the package and RPC configuration are supported in that runtime. Position and history reads require the hosted `apiUrl`; follow the host's existing server/client data-fetching architecture rather than exposing server-only credentials to the browser.

Add a client directive only where required by the host's App Router component boundary. Do not convert an entire server-rendered page to a client component when a small existing client island can own the interaction.

## Configuration

Use the repository's established environment schema and validation. Classify each value:

- browser-safe RPC endpoint if the host already exposes one;
- browser-safe referral ID;
- approved hosted API base URL;
- server-only credentials embedded in provider URLs or headers.

Do not invent a public environment variable name or expose a secret merely to satisfy client construction. If an approved browser-safe endpoint is absent, report the configuration requirement.

## Data loading

Follow existing App Router, Pages Router, loader, query, or client-fetching patterns. Avoid duplicating a server fetch and client query for the same data unless hydration is already established.

Wallet-scoped position, claim, and action state normally belongs in the client boundary. Public pool data can be prefetched only when that matches host caching and staleness rules. Do not cache user-specific data across wallets.

## Navigation and transaction UX

Reuse the host's route-level loading/error boundaries, transaction provider, toasts, explorer links, dialogs/drawers, and responsive layout. Preserve state across navigation only if comparable financial actions do.

Do not create a Lucent route when the feature naturally extends an existing asset, portfolio, deposit, or yield route.

## Build verification

Run the owning package's typecheck, lint, tests, and production Next.js build. A development render is insufficient: the production build catches server/client import violations and environment access mistakes.
