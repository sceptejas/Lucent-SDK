#!/usr/bin/env tsx
/**
 * Live verification of the generated client against mainnet.
 *
 * Not a CI gate (it needs the network and drifts with chain state) — run it by
 * hand after regenerating, or before a release. It answers three questions the
 * offline gate cannot:
 *
 *   1. Does the generated `Pool`/`Global`/`ClaimRecord` codec actually decode
 *      real accounts? A codec can pass a discriminator check and still be wrong
 *      about field order.
 *   2. Does the decoder reject foreign account data, or will it happily hand back
 *      garbage?
 *   3. What is the deployed `Global.withdrawDelay`, which v0 exported a type for
 *      but gave no way to fetch?
 *
 * Usage: npx tsx scripts/verify-live.ts
 */
import { readFileSync, existsSync } from 'node:fs'

import { createSolanaRpc, type Address } from '@solana/kit'

import { fetchGlobal } from '../src/generated/accounts/global'
import { fetchMaybeClaimRecord } from '../src/generated/accounts/claimRecord'
import { fetchMaybePool, fetchPool } from '../src/generated/accounts/pool'
import { findClaimRecordPda, findPoolPda } from '../src/pdas'

import { resolveRpcUrlFor } from './rpc-url'

const MAINNET = {
  GLOBAL: '8yp99agjgfUy9jfx5baZ2LD3QkZ4TQriHY8Qy7Ns1gmC' as Address,
  USDC_POOL: '3Cxcnyc7XqnfhnWu8FB7AU86VPZ2vifEvpju6aFveEG2' as Address,
  LM_USD_MINT: '3mGBapHWB7moS1nBeacwDxNMF8PLBBnPSi4armyE2Qbe' as Address,
  SOL_POOL: '7pbRQCzYR9NvXbdMDh7VgZD6qyzZzmpkckGQr1WPT5bS' as Address,
}

/** Local key if present, otherwise the public endpoint (reads only). */
const rpcUrl = () => resolveRpcUrlFor('scripts/verify-live.ts')

/** kit's Option<Address> is `{ __option: 'Some', value }` or `{ __option: 'None' }`. */
function unwrapOptionAddress(option: unknown): string | null {
  if (!option || typeof option !== 'object') return null
  const candidate = option as { __option?: string; value?: unknown }
  return candidate.__option === 'Some' && typeof candidate.value === 'string' ? candidate.value : null
}

const rpc = createSolanaRpc(rpcUrl())
let failures = 0
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!pass) failures++
}

console.log('=== Pool accounts ===')
for (const [label, address] of [
  ['pool 0 (USDC)', MAINNET.USDC_POOL],
  ['pool 1 (SOL)', MAINNET.SOL_POOL],
] as const) {
  const account = await fetchPool(rpc, address)
  const p = account.data
  const ratesSane = p.stakeRate > 90_000n && p.stakeRate < 200_000n && p.unstakeRate > 90_000n && p.unstakeRate < 200_000n
  ok(`${label} decodes with sane rates`, ratesSane,
    `stakeRate=${p.stakeRate} unstakeRate=${p.unstakeRate} nonce=${p.nonce} settleHead=${p.settleHead}`)
  ok(`${label} owner is the program`, account.programAddress === 'FXmUMZQVoUA2Ws4hJ6CsDo7bzGYTy1T45KTZz8xSy9R5',
    account.programAddress)
  // Anchor's `Option<Pubkey>` arrives as kit's Option wrapper, not a plain
  // address — the SDK's domain layer has to unwrap these, which is exactly the
  // kind of shape difference worth knowing before writing it.
  const strategy = unwrapOptionAddress(p.strategy)
  console.log(`        manager=${p.manager.slice(0, 8)}… strategy=${strategy ? `${strategy.slice(0, 8)}…` : 'none'} minDeposit=${p.minDepositAmount} reserveBps=${p.reserveBps}`)
}

console.log('\n=== Global (v0 exported a type with no way to fetch it) ===')
const global = await fetchGlobal(rpc, MAINNET.GLOBAL)
ok('global decodes', global.data.admin.length > 0,
  `admin=${global.data.admin.slice(0, 8)}… count=${global.data.count} withdrawDelay=${global.data.withdrawDelay}s`)
ok('decode without owner assertion still reports the owner',
  global.programAddress === 'FXmUMZQVoUA2Ws4hJ6CsDo7bzGYTy1T45KTZz8xSy9R5', global.programAddress)

console.log('\n=== ClaimRecord at the current FIFO head ===')
const usdc = await fetchPool(rpc, MAINNET.USDC_POOL)
const [headPda] = await findClaimRecordPda(0, usdc.data.settleHead)
const maybeClaim = await fetchMaybeClaimRecord(rpc, headPda)
ok('claim record at (pool 0, settleHead) decodes',
  maybeClaim.exists &&
    Number(maybeClaim.data.poolId) === 0 &&
    maybeClaim.data.nonce === usdc.data.settleHead,
  maybeClaim.exists
    ? `nonce=${maybeClaim.data.nonce} receipt=${maybeClaim.data.receiptAmount} payout=${maybeClaim.data.payout} settled=${maybeClaim.data.settled} cancelled=${maybeClaim.data.cancelled}`
    : 'does not exist')

console.log('\n=== Negative: does the decoder reject foreign data? ===')
try {
  // A MaybeAccount means "may not exist" — it does not mean "may be the wrong
  // shape". Feeding it a token account is expected to throw, not to return
  // garbage, and that distinction is the point of this check.
  const foreign = await fetchMaybePool(rpc, MAINNET.LM_USD_MINT)
  ok('foreign account rejected', !foreign.exists, foreign.exists
    ? 'decoded the lmUSD mint as a Pool — no validation!'
    : 'reported as non-existent')
} catch (error) {
  const message = error instanceof Error ? (error.message.split('\n').at(0) ?? '') : String(error)
  ok('foreign account rejected (throws on wrong shape)', true, message.slice(0, 80))
  console.log('        note: fetchMaybePool THROWS on an existing but wrong-shaped account;')
  console.log('        the SDK layer must catch this and surface a typed error, not a raw SolanaError.')
}

console.log(`\n${failures === 0 ? 'LIVE CHECK PASSED' : `LIVE CHECK: ${failures} failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
