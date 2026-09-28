#!/usr/bin/env tsx
/**
 * Capture mainnet fixtures for the test suite.
 *
 * Tests that read the chain are tests that fail when the chain is busy, when a
 * rate moves, or when the RPC has a bad day. So the accounts the decoders are
 * tested against are frozen here, once, into `test/fixtures/` and committed: the
 * suite then runs offline and deterministically, and a decoder regression shows
 * up as a failing assertion rather than as a flake.
 *
 * Each fixture records the address, the owning program, the slot it was read at,
 * and the raw base64 account data — enough to prove where it came from, and
 * enough for a test to re-derive every field.
 *
 * Re-run by hand when the program layout changes, then review the diff like any
 * other code:
 *
 *     npx tsx scripts/capture-fixtures.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createSolanaRpc, type Address, type ClusterUrl } from '@solana/kit'

import { MAINNET, POOLS } from '../src/config'
import { findClaimRecordPda } from '../src/pdas'

import { resolveRpcUrlFor } from './rpc-url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturesDir = join(root, 'test', 'fixtures')

const rpcUrl = () => resolveRpcUrlFor('scripts/capture-fixtures.ts')

// kit types the RPC API per cluster; an env-provided URL is a ClusterUrl.
const rpc = createSolanaRpc(rpcUrl() as ClusterUrl)
mkdirSync(fixturesDir, { recursive: true })

interface AccountFixture {
  address: string
  programAddress: string
  slot: number
  /** Base64 account data, exactly as the RPC returned it. */
  data: string
  fetchedAt: string
  note: string
}

async function captureAccount(address: Address, note: string, file: string): Promise<void> {
  const { context, value } = await rpc.getAccountInfo(address, { encoding: 'base64' }).send()
  if (!value) throw new Error(`${address} not found`)

  const data = Array.isArray(value.data) ? (value.data[0] as string) : (value.data as string)
  const fixture: AccountFixture = {
    address,
    programAddress: value.owner,
    slot: Number(context.slot),
    data,
    fetchedAt: new Date().toISOString(),
    note,
  }
  writeFileSync(join(fixturesDir, file), `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`${file.padEnd(28)} ${address}  slot ${fixture.slot}  ${data.length} base64 chars`)
}

await captureAccount(MAINNET.GLOBAL, 'Global config, carries withdrawDelay', 'global.json')
await captureAccount(POOLS[0].pool, 'USDC pool', 'pool-0.json')
await captureAccount(POOLS[1].pool, 'SOL pool', 'pool-1.json')

// The claim at the USDC pool's settle head: a real, unsettled FIFO record.
const usdcPool = await rpc.getAccountInfo(POOLS[0].pool, { encoding: 'base64' }).send()
void usdcPool
const { value: poolValue } = await rpc.getAccountInfo(POOLS[0].pool, { encoding: 'base64' }).send()
const poolBytes = Uint8Array.from(atob(Array.isArray(poolValue!.data) ? poolValue!.data[0] : (poolValue!.data as string)), c =>
  c.charCodeAt(0),
)
// settleHead is the 6th u64 after the 8-byte discriminator: id, then 4 pubkeys
// (128 bytes) — see the Pool layout in src/generated/accounts/pool.ts.
let offset = 8 + 8 + 128
const readU64 = () => {
  const view = new DataView(poolBytes.buffer, poolBytes.byteOffset + offset, 8)
  offset += 8
  return view.getBigUint64(0, true)
}
readU64() // stakeRate
readU64() // unstakeRate
readU64() // receiptMaxSupply
readU64() // nonce
const settleHead = readU64()
const [headPda] = await findClaimRecordPda(0, settleHead)
await captureAccount(headPda, `USDC pool claim at settleHead ${settleHead}`, 'claim-record.json')

// Real events: the three Staked events for the lmSOL holder, decoded from the
// receipt account's history. These pin the event codecs the way the account
// fixtures pin the account codecs.
const RECEIPT_ATA = '8J9gxRcR9dQuxFdmZbUM3KwX7RgwdnFCEF2KCXuzWWno'
const response = await fetch(rpcUrl(), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'fixtures',
    method: 'getTransactionsForAddress',
    params: [
      RECEIPT_ATA,
      { transactionDetails: 'full', maxSupportedTransactionVersion: 0, commitment: 'confirmed', limit: 1000 },
    ],
  }),
})

interface EventFixture {
  signature: string
  slot: number
  blockTime: number | null
  /** The `Program data: ` payloads, already stripped of the prefix. */
  events: string[]
}

if (response.ok) {
  const body = (await response.json()) as {
    result?: { data?: { slot: number; blockTime: number | null; transaction: { signatures: string[] }; meta: { logMessages?: string[] } | null }[] }
  }
  const captured: EventFixture[] = (body.result?.data ?? []).map(tx => ({
    signature: tx.transaction.signatures[0] ?? '',
    slot: tx.slot,
    blockTime: tx.blockTime,
    events: (tx.meta?.logMessages ?? [])
      .filter(log => log.startsWith('Program data: '))
      .map(log => log.slice('Program data: '.length)),
  }))
  writeFileSync(
    join(fixturesDir, 'staking-events.json'),
    `${JSON.stringify({ receiptAccount: RECEIPT_ATA, fetchedAt: new Date().toISOString(), transactions: captured }, null, 2)}\n`,
  )
  console.log(`staking-events.json           ${captured.length} transactions, ${captured.reduce((n, t) => n + t.events.length, 0)} events`)
} else {
  console.warn(`could not capture events: HTTP ${response.status}`)
}

console.log(`\nwrote fixtures to test/fixtures/`)
