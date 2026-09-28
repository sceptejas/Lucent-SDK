# Lucent integration plan

Use this for nontrivial integrations. Replace each evidence cell with concrete paths, versions, or commands. Remove an irrelevant row only with a stated reason.

## Requested outcome

- Requested capability:
- Target route/surface:
- User-visible acceptance criteria:
- Explicitly out of scope:

## Host evidence

| Area | Evidence | Decision |
| --- | --- | --- |
| Owning package and package manager | | |
| Framework/version and rendering boundary | | |
| Existing feature/component to extend | | |
| UI primitives and design tokens | | |
| Similar financial action | | |
| Wallet provider/package/version | | |
| Compatible Kit signer path | | |
| RPC and WebSocket ownership | | |
| State/query/mutation pattern | | |
| Transaction status/error path | | |
| Mobile pattern | | |
| Accessibility pattern | | |
| Existing terminology | | |

## SDK evidence

- Resolved `lucent-sdk` version:
- Resolved `@solana/kit` version:
- Export declarations inspected:
- Methods and exact signatures selected:
- Hosted `apiUrl` required and source:
- Referral ID required and source:
- Target network/program:
- Deployment compatibility evidence:
- Known API gaps affecting scope:

## UX mapping

| Lucent capability/state | Existing host location/component/pattern |
| --- | --- |
| Entry point | |
| Input and validation | |
| Review and fees | |
| Wallet approval | |
| Submission/confirmation | |
| Success and explorer link | |
| Failure and retry | |
| Position/pending/claimable data | |
| Responsive behavior | |

## Data and transaction flow

- Static metadata source:
- Dynamic chain reads:
- Hosted reads:
- User-specific reads:
- Cache keys/state ownership:
- Refresh/invalidation after each action:
- Error normalization:
- Analytics/telemetry:

## Intended changes

| File | Minimal change and reason |
| --- | --- |
| | |

## Verification

- Typecheck:
- Lint:
- Tests:
- Production build:
- Responsive/accessibility checks:
- Wallet/deployment manual check:

## Unresolved decisions

List only product or operational decisions that repository and package inspection cannot answer. Do not stop for a question when a safe host-native default exists. Fail closed for writes, continue verified read-only work, and report unresolved prerequisites. Batch only the decisions that still require product or operational input.
