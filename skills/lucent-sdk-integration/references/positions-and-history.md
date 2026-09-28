# Positions and history

Positions combine hosted history with optional chain verification. Preserve that provenance in data handling and UI.

## Hosted API requirement

Both calls require `apiUrl` in client configuration:

```ts
const positions = await client.getPosition(walletAddress)
const history = await client.getHistory(walletAddress)
```

The reviewed SDK requests `${apiUrl}/api/profile?wallet=...`. It does not provide a production default. Use the host's approved environment/configuration value; never guess an endpoint.

## Position result

Each item is:

```ts
interface PositionResult {
  position: Position
  verified: boolean
  note?: string
}
```

Important fields on `position` include:

- `receipts`: receipt tokens held now;
- `receiptValue`: current underlying redemption value;
- `price`: underlying redemption price per receipt;
- `rates`: stake, unstake, and denominator used;
- `inFlight.pending`, `inFlight.claimable`, `inFlight.total`;
- `staked`, `received`, and `withdrawn`, in receipt units;
- `yieldEarned`: lifetime accrued yield in receipt units, excluding unrealized entry spread;
- `yieldPercent`: the same lifetime yield relative to deposits, not APY;
- `netRedemptionValue`: redemption-basis net;
- `underlying`: deposited, withdrawn, pending, claimable, net yield, and entry spread.

Use `isClosed(position)` to detect a position with no held receipts and nothing in flight.

## Verification meaning

With RPC configured, `getPosition` re-reads receipt balance and pool rates. When hosted data disagrees, chain balance/rates replace those fields and the result is marked `verified: false` with a note. History-derived totals still come from the hosted API.

Without RPC, positions can still be returned from the hosted API but are unverified. Do not remove or relabel this distinction. Use the host's normal stale/partial-data treatment where it matters to the requested UI.

## History result

```ts
interface HistoryResult {
  profile: HostedProfile
  exact: boolean
  note?: string
}
```

`profile.activity` entries have transaction signature, slot, nullable timestamp, action type (`STAKE`, `UNSTAKE`, `CLAIM`, or `CANCEL`), pool ID, base-unit amount, decimals, and a display string.

`exact: false` is actionable partial state, not necessarily a transport failure. Surface the note where the host normally explains incomplete data. `HistoryApiError` represents configuration, transport, status, or response-shape failures.

## Query integration

Use the host's existing data layer. Scope caches by at least wallet and relevant pool/network context. Apply the host's enabled conditions so disconnected wallets do not trigger invalid reads.

After a confirmed action, refresh the data it can affect:

| Action | Refresh |
| --- | --- |
| Stake | receipt balance, pool, positions, history, wallet stake-token balance |
| Unstake | receipt balance, claims, pool, positions, history |
| Claim | claims, positions, history, wallet stake-token balance |
| Cancel | receipt balance, claims, positions, history |
| Settle | claims, pool, positions/history where displayed |

Do not add aggressive polling without following existing host patterns and understanding hosted API/RPC cost.

## Presentation rules

- Format base units with SDK or host exact token helpers.
- Never call `yieldPercent` APY.
- Do not hide unverified/inexact status when it changes the meaning of a displayed value.
- Reuse existing position cards, rows, tables, charts, empty states, and history items.
- Do not create a Lucent dashboard when the requested information naturally belongs in an existing portfolio or asset view.
