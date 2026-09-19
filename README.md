# lucent-sdk

TypeScript SDK for the [Lucent](https://lucent.finance) staking protocol on Solana.

**Kit-native.** Built on [`@solana/kit`](https://github.com/anza-xyz/kit) 8, generated
from the deployed program's IDL with [Codama](https://github.com/codama-idl/codama),
and safe to import in a browser — no `Buffer`, no `process`, no Node polyfills.

> **v1.0.0 in progress.** The generated client, address configuration and PDA
> derivation are in place and gated in CI. Positions, history and transaction plans
> land in the next phases. `0.1.x` remains on npm and is **broken in browsers** (it
> computed discriminators with `Buffer.from` at import time) — do not use it.

## Install

```bash
npm install lucent-sdk @solana/kit
```

`@solana/kit` is a peer dependency, so your app pins one copy of the RPC layer.

## Addresses

```ts
import { MAINNET, POOLS, assertMainnetProgram } from 'lucent-sdk'

MAINNET.USDC_POOL     // 3Cxcnyc7XqnfhnWu8FB7AU86VPZ2vifEvpju6aFveEG2
MAINNET.LM_USD_MINT   // 3mGBapHWB7moS1nBeacwDxNMF8PLBBnPSi4armyE2Qbe
MAINNET.SOL_POOL      // 7pbRQCzYR9NvXbdMDh7VgZD6qyzZzmpkckGQr1WPT5bS
MAINNET.LM_SOL_MINT   // 2Eg1tC22K7yFRAHgog9sQLEppvPyd1qzsn7gr6vi6EgG

POOLS[0]              // { symbol: 'USDC', decimals: 6, receiptSymbol: 'lmUSD', ... }

// Fails loudly if the generated client is addressed to a different program —
// a devnet IDL sits next to the mainnet one upstream.
assertMainnetProgram()
```

## PDA derivation

Accounts are `Address` strings. PDA derivation is async, as in kit.

```ts
import { findPoolPda, findReceiptMintPda, findClaimRecordPda, findGlobalPda } from 'lucent-sdk'

const [pool] = await findPoolPda(0)
const [lmUsd] = await findReceiptMintPda(pool)
const [claim] = await findClaimRecordPda(0, 7)
const [global] = await findGlobalPda()
```

## Generated client

`src/generated` is Codama output built from `idls/sythstaking.json` — instruction
builders, account codecs, event codecs and typed errors covering all 15
instructions, 3 accounts, 10 events and 21 error codes. It is committed, and CI
regenerates it and fails on any diff.

The generated fetchers validate account size and discriminator. They do **not**
assert the account owner, so the SDK layer checks `SYTHSTAKING_PROGRAM_ADDRESS` on
every read.

## Development

```bash
npm test                  # 44 tests, offline (fixtures are captured mainnet bytes)
npm run codegen           # regenerate src/generated from idls/sythstaking.json
npm run verify:codegen    # gate: discriminators, accounts, events and PDAs vs mainnet
npm run verify:live       # read the deployed pools/global/claims from mainnet
npm run verify:position   # position maths against the hosted API + chain
npm run verify:actions    # build every action and simulate it on mainnet (no keys)
npm run verify            # everything CI runs (attw checked at --profile node16)

npm run capture           # re-capture test fixtures (only when the layout changes)
```

`idls/sythstaking.json` must be the **mainnet** IDL: upstream also carries one
addressed to the devnet program, and generating from the wrong file produces a
client that looks healthy and talks to the wrong program.

MIT © Luminosity Labs
