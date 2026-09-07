# @lucent/sdk

TypeScript SDK for the [Lucent](https://lucent.finance) delta-neutral staking protocol on Solana.

## Installation

```bash
npm install lucent-sdk @solana/web3.js @solana/spl-token
```

## Quick Start

```ts
import { Connection } from '@solana/web3.js'
import { LucentClient } from 'lucent-sdk'

const connection = new Connection('https://api.mainnet-beta.solana.com')

// wallet must have { publicKey, signTransaction }
// compatible with Phantom, Solflare, and @solana/wallet-adapter
const client = new LucentClient(connection, wallet)

// Stake 100 USDC
const { signature } = await client.stake('USDC', 100)

// Unstake 100 lmUSD
const { signature } = await client.unstake('USDC', 100)

// Claim all settled payouts
const results = await client.claimAll()

// Cancel a pending unstake
await client.cancelUnstake(0, nonce)
```

## API Reference

### `LucentClient`

High-level client — handles transaction building, signing and sending.

```ts
new LucentClient(connection: Connection, wallet: LucentWallet)
```

| Method | Description |
|---|---|
| `stake(token, amount, opts?)` | Stake USDC or SOL, receive receipt tokens |
| `unstake(token, amount, opts?)` | Burn receipt tokens, open a claim |
| `claimAll()` | Claim all settled payouts for the wallet |
| `cancelUnstake(poolId, nonce)` | Cancel a pending unstake, re-mint receipts |
| `settle(poolId)` | Settle the FIFO-head claim (permissionless) |

### Raw Instruction Builders

For protocols that want full control over transaction construction:

```ts
import { stakeIx, unstakeIx, claimIx, settleIx, cancelUnstakeIx } from '@lucent/sdk'
```

Each function returns a `TransactionInstruction` ready to add to a `Transaction`.

### Read Functions

```ts
import { fetchPool, fetchClaimsForUser, deriveClaimState, receiptTokenPrice, stakeTokenPrice } from 'lucent-sdk'

// Fetch pool state
const pool = await fetchPool(connection, 0) // 0 = USDC, 1 = SOL

// Price of 1 lmUSD in USDC (reflects accrued yield)
const lmUsdPrice = receiptTokenPrice(pool.unstakeRate) // e.g. 1.01

// Price of 1 USDC in lmUSD
const usdcPrice = stakeTokenPrice(pool.stakeRate) // e.g. 1.0

// Fetch all claims for a user
const claims = await fetchClaimsForUser(connection, walletPublicKey)

// Get claim state
const state = deriveClaimState(claim) // 'pending' | 'claimable' | 'cancelled'
```

### Addresses

```ts
import { MAINNET, USDC_MINT, WSOL_MINT, PROGRAM_ID } from '@lucent/sdk'

MAINNET.USDC_POOL    // USDC pool PDA
MAINNET.SOL_POOL     // SOL pool PDA
MAINNET.LM_USD_MINT  // lmUSD receipt token mint
MAINNET.LM_SOL_MINT  // lmSOL receipt token mint
```

## Pool IDs

| Pool | ID | Stake Token | Receipt Token |
|---|---|---|---|
| USDC | 0 | USDC | lmUSD |
| SOL  | 1 | WSOL | lmSOL |

## Notes

- `fetchClaimsForUser` and `fetchAllClaimRecords` require a full-node RPC that supports `getProgramAccounts` (e.g. Helius, QuickNode). The public endpoint blocks this method.
- For SOL staking, the SDK automatically wraps SOL into WSOL before staking.
- Unstake settlements are processed by a keeper bot — typically within 4–5 hours.

## License

MIT
