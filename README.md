# lucent-sdk

TypeScript SDK for the [Lucent](https://lucent.finance) staking protocol on Solana.

**Kit-native.** Built on [`@solana/kit`](https://github.com/anza-xyz/kit) 8, generated
from the deployed program's IDL with [Codama](https://github.com/codama-idl/codama),
and safe to import in a browser — no `Buffer`, no `process`, no Node polyfills.

## Install

```bash
npm install lucent-sdk @solana/kit
```

`@solana/kit` is a peer dependency, so your app pins one copy of the RPC layer.

## Quick start

```ts
import { createLucentClient } from 'lucent-sdk'

const client = createLucentClient({
  rpcUrl: 'https://your-rpc-endpoint',
  signer: wallet,          // @solana/kit TransactionSigner
  referralId: 'your-id',  // required for staking and unstaking
})

// Read pool state
const pool = await client.getPool(0)   // 0 = USDC, 1 = SOL

// Stake — returns an ActionPlan; nothing is signed until send()
const plan = await client.stake(0, 100_000_000n)   // 100 USDC in base units
await plan.send()

// Unstake
const unstakePlan = await client.unstake(0, receiptAmount)
await unstakePlan.send()
```

## Addresses

```ts
import { MAINNET, POOLS, assertMainnetProgram } from 'lucent-sdk'

MAINNET.USDC_POOL     // 3Cxcnyc7XqnfhnWu8FB7AU86VPZ2vifEvpju6aFveEG2
MAINNET.LM_USD_MINT   // 3mGBapHWB7moS1nBeacwDxNMF8PLBBnPSi4armyE2Qbe
MAINNET.SOL_POOL      // 7pbRQCzYR9NvXbdMDh7VgZD6qyzZzmpkckGQr1WPT5bS
MAINNET.LM_SOL_MINT   // 2Eg1tC22K7yFRAHgog9sQLEppvPyd1qzsn7gr6vi6EgG

POOLS[0]  // { symbol: 'USDC', decimals: 6, receiptSymbol: 'lmUSD', ... }
POOLS[1]  // { symbol: 'SOL',  decimals: 9, receiptSymbol: 'lmSOL', ... }

// Fails loudly if the generated client is addressed to a different program —
// a devnet IDL sits next to the mainnet one upstream.
assertMainnetProgram()
```

## PDA derivation

Accounts are `Address` strings. PDA derivation is async, as in kit.

```ts
import { findPoolPda, findReceiptMintPda, findClaimRecordPda, findGlobalPda } from 'lucent-sdk'

const [pool]   = await findPoolPda(0)
const [lmUsd]  = await findReceiptMintPda(pool)
const [claim]  = await findClaimRecordPda(0, 7n)
const [global] = await findGlobalPda()
```

## Referral id (partners)

Every integration that stakes or unstakes must send its own referral id. The
program records it **on-chain** in the `Staked` / `Unstaked` event, alongside the
period's timestamps and the pool's rates — that event is what a partner's share of
the yield accrued over the period is computed from. An integration without an id
accrues nothing for its partners, and nothing can attach it afterwards.

Pass it once at client creation — every stake and unstake carries it automatically:

```ts
const client = createLucentClient({
  rpcUrl: 'https://…',
  signer: wallet,
  referralId: 'your-partner-id',
})

await client.stake(0, 100_000_000n)   // referral id is wired in automatically
```

Rules:
- Non-blank, at most **32 UTF-8 bytes**. Bytes, not characters: nine four-byte
  emoji are 36 bytes and are rejected.
- Attested **verbatim** — not trimmed or normalised. Whatever you pass is what
  lands on-chain and what payouts are matched against.
- Validated eagerly at construction, so a typo fails on your first line rather
  than mid-transaction.
- `stake()` and `unstake()` **fail closed** without one (throwing
  `InvalidReferralIdError`) instead of quietly sending a stake no partner is
  credited for.
- Read-only clients need no id. `getPool`, `getPosition`, `getHistory`, and the
  rest work without it.

```ts
import { MAX_REFERRAL_ID_BYTES, assertReferralId, isValidReferralId } from 'lucent-sdk'

isValidReferralId('partner-42')   // true
assertReferralId('partner-42')    // 'partner-42' or throws InvalidReferralIdError
client.referralId                 // what's configured, as it will appear on-chain
```

> **Deployment note:** `stake_with_referral` and `unstake_with_referral` are new
> instructions added in v1.0.0. They must be live on the mainnet program before
> write operations will succeed. Read-only methods work today.

## Client API

```ts
const client = createLucentClient(config)

// Reads (no referral id needed)
client.getPool(poolId)                     // pool rates and state
client.getGlobal()                         // global config (withdraw delay, etc.)
client.getReceiptBalance(wallet, poolId)   // receipt token balance
client.getPosition(wallet)                 // position across pools (needs apiUrl)
client.getHistory(wallet)                  // full activity history (needs apiUrl)
client.getClaims(wallet, poolId?)          // pending / claimable / cancelled claims

// Writes (referral id required — returns ActionPlan, nothing sent until .send())
client.stake(poolId, amount, options?)
client.unstake(poolId, receiptAmount, options?)
client.claim(poolId)
client.cancelUnstake(poolId, nonce)
client.settle(poolId)
```

`ActionPlan` has a `summary` string (safe to show in a UI before signing) and a
`send()` method that signs, submits, and confirms the transaction.

## Event decoding

History spans pre- and post-v1.0.0 events. The tolerant decoders handle both:

```ts
import { eventsFromLogs, decodeStakedEvent, decodeUnstakedEvent } from 'lucent-sdk'

// From a transaction's logMessages
const events = eventsFromLogs(tx.meta.logMessages)
// events[0].name === 'Staked' | 'Unstaked'
// events[0].referralId  — string | null (null on pre-v1.0.0 events)
// events[0].ts          — bigint | null
// events[0].stakeRate   — bigint | null
```

## Generated client

`src/generated` is Codama output built from `idls/sythstaking.json` — instruction
builders, account codecs, event codecs, and typed errors covering all 16
instructions, 3 accounts, 10 events, and 21 error codes. It is committed, and CI
regenerates it and fails on any diff.

## Development

```bash
npm test                  # 67 tests, fully offline (fixtures are captured mainnet bytes)
npm run codegen           # regenerate src/generated from idls/sythstaking.json
npm run verify:codegen    # discriminators, accounts, events and PDAs vs mainnet
npm run verify:live       # read the deployed pools/global/claims from mainnet
npm run verify:position   # position maths against the hosted API + chain
npm run verify:actions    # build every action and simulate it on mainnet (no keys)
npm run verify            # everything CI runs
npm run capture           # re-capture test fixtures (only when the layout changes)
```

`idls/sythstaking.json` must be the **mainnet** IDL: upstream also carries one
addressed to the devnet program, and generating from the wrong file produces a
client that looks healthy and talks to the wrong program.

## AI agent integration skill

`skills/lucent-sdk-integration/` is a self-contained [Agent Skill](skills/lucent-sdk-integration/README.md)
that teaches coding agents (Kiro, Cursor, Windsurf, and others that support the
format) to add Lucent as a native feature of an existing application in one or two
prompts.

The skill covers host-application discovery, wallet and RPC wiring, referral id
gating, the full transaction lifecycle, and known deployment constraints. Drop it
into your agent's skills directory and point it at this repo:

```
.agents/skills/lucent-sdk-integration/   # Kiro
~/.cursor/skills/lucent-sdk-integration/ # Cursor (agent mode)
```

See [`skills/lucent-sdk-integration/README.md`](skills/lucent-sdk-integration/README.md)
for install instructions and trigger examples.

## License

MIT © Luminosity Labs
