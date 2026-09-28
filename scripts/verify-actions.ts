#!/usr/bin/env tsx
/**
 * Phase D verification: build each action and simulate it against mainnet.
 *
 * Simulation is the honest test here. It runs the real program against real
 * accounts through the real encoding, with `sigVerify: false`, so it proves:
 *
 *   * the instructions this SDK composes are accepted by the program (v0's
 *     hand-encoded instructions were accepted too, but nothing ever checked);
 *   * the accounts are right — ATAs, the claim-record PDA for the live nonce, the
 *     pool vault;
 *   * the plan machinery works end to end including fee attachment.
 *
 * It costs nothing, needs no key, and cannot move funds. Nothing is sent.
 *
 * Usage: npx tsx scripts/verify-actions.ts
 */

import type { Address, ClusterUrl, Signature, TransactionPartialSigner } from '@solana/kit'

import { createLucentClient } from '../src/client'
import { formatAmount } from '../src/amounts'
import { parseAmount } from '../src/amounts'
import { LucentError } from '../src/errors'
import { ActionFailedError } from '../src/actions/plan'
import { POOLS } from '../src/config'

import { resolveRpcUrlFor } from './rpc-url'

const rpcUrl = () => resolveRpcUrlFor('scripts/verify-actions.ts')

/**
 * A signer that can never sign anything.
 *
 * `plan.simulate()` uses its own placeholder internally, so this exists only to
 * satisfy the client's "actions need a signer" rule — it carries the address the
 * transaction is built for and writes an empty signature. No key is involved.
 */
function readOnlySigner(address: Address): TransactionPartialSigner {
  return {
    address,
    signTransactions: async transactions =>
      transactions.map(transaction => ({
        ...transaction,
        signatures: { ...transaction.signatures, [address]: '1'.repeat(64) as Signature },
      })) as typeof transactions,
  }
}

const HOLDER = '2qNjaYNaecnXLD5tTZy8yu26RN5mEJwmfjHLtKqtoJs4' as Address
const SOL_HOLDER = '8NgGEQ8pYX58HX6hZKXWdBPQWjstjVEQa54ksHSLwPQp' as Address

/**
 * Referral id for the simulation client. Real ids are issued per partner; this
 * one only has to be well formed, since the script simulates and never sends.
 * Without one the stake and unstake plans refuse to build — which is the point.
 */
const REFERRAL_ID = 'sdk-verify-actions'

const client = createLucentClient({
  rpcUrl: rpcUrl() as ClusterUrl,
  signer: readOnlySigner(HOLDER),
  priorityFeeLevel: 'medium',
  referralId: REFERRAL_ID,
})

let failures = 0
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!pass) failures++
}

async function simulate(label: string, build: () => Promise<{ simulate: () => Promise<{ ok: boolean; error: string | null; unitsConsumed: number | null }>; summary: string; fee: { computeUnitLimit: number; microLamportsPerComputeUnit: number; maxLamports: bigint } }>) {
  try {
    const plan = await build()
    const result = await plan.simulate()
    console.log(`\n${label}`)
    console.log(`  ${plan.summary}`)
    console.log(`  fee: ${plan.fee.computeUnitLimit} CU @ ${plan.fee.microLamportsPerComputeUnit} µLamports/CU = ${plan.fee.maxLamports} lamports max`)
    console.log(`  simulation: ${result.ok ? 'OK' : 'REJECTED'}${result.unitsConsumed ? `, ${result.unitsConsumed} CU` : ''}${result.error ? ` — ${result.error}` : ''}`)
    return result
  } catch (error) {
    console.log(`\n${label}`)
    if (error instanceof LucentError) {
      console.log(`  refused before simulating: [${error.code}] ${error.message}`)
      return { ok: false, error: error.message, unitsConsumed: null, refused: error.code }
    }
    const message = error instanceof Error ? error.message : String(error)
    console.log(`  FAILED to build: ${message}`)
    return { ok: false, error: message, unitsConsumed: null }
  }
}

console.log(`=== actions against mainnet, simulation only (no keys, nothing sent) ===`)
console.log(`holder: ${HOLDER}`)
console.log(`USDC balance is read by the program itself during simulation.`)

// ── stake
const stake = await simulate('stake 1 USDC', () => client.stake(0, parseAmount('1', 6)))
ok('stake simulation is accepted by the program', stake.ok, stake.error ?? '')

// ── unstake
const unstake = await simulate('unstake 1 lmUSD', () => client.unstake(0, parseAmount('1', 6)))
ok('unstake simulation is accepted by the program', unstake.ok, unstake.error ?? '')

// ── claim, with nothing claimable: the guard should refuse, not build an empty tx
const claim = await simulate('claim (nothing settled)', () => client.claim(0))
ok('claim refuses when there is nothing claimable', 'refused' in claim && claim.refused === 'NOTHING_TO_CLAIM',
  JSON.stringify(claim).slice(0, 90))

// ── cancel a pending redemption
const claims = await client.getClaims(HOLDER)
console.log(`\nclaims for the holder: ${claims.pending.length} pending, ${claims.claimable.length} claimable, ${claims.cancelled.length} cancelled`)
ok('getClaims reads the wallet\'s records from chain', claims.pending.length + claims.claimable.length > 0,
  `pending nonces: ${claims.pending.map(c => c.data.nonce).join(', ')}`)

if (claims.pending.length > 0) {
  const nonce = claims.pending[0]!.data.nonce
  const cancel = await simulate(`cancelUnstake nonce ${nonce}`, () => client.cancelUnstake(0, nonce))
  ok('cancelUnstake simulation is accepted by the program', cancel.ok, cancel.error ?? '')
}

// ── settle the FIFO head of the USDC pool
const settle = await simulate('settle the USDC pool head', () => client.settle(0))
ok('settle simulation is accepted by the program', settle.ok, settle.error ?? '')

// ── a SOL-pool stake, which exercises the wrap/unwrap path
const solClient = createLucentClient({
  rpcUrl: rpcUrl() as ClusterUrl,
  signer: readOnlySigner(SOL_HOLDER),
  priorityFeeLevel: 'medium',
  referralId: REFERRAL_ID,
})
const solStake = await simulate('stake 0.01 SOL (wrap + sync + close)', () =>
  solClient.stake(1, parseAmount('0.01', 9)),
)
ok('SOL stake simulation is accepted by the program', solStake.ok, solStake.error ?? '')

console.log('\n=== the guard rails ===')
// send() must refuse a transaction the program rejects, rather than paying for it
try {
  const plan = await createLucentClient({
    rpcUrl: rpcUrl() as ClusterUrl,
    signer: readOnlySigner(SOL_HOLDER),
    referralId: REFERRAL_ID,
  }).stake(0, parseAmount('1000000', 6)) // more USDC than the holder has
  await plan.send()
  ok('send() refuses a transaction that would fail', false, 'it tried to send')
} catch (error) {
  ok('send() refuses a transaction that would fail',
    error instanceof ActionFailedError || error instanceof LucentError,
    error instanceof Error ? error.message.slice(0, 100) : String(error))
}

// ── keeper: advance the queue without spending
const { settleAll, settleOnce } = await import('../src/keeper')
console.log('\n=== keeper (dry run: simulates, never sends) ===')
const outcomes = await settleAll(client, { dryRun: true, poolIds: [0] })
for (const outcome of outcomes) {
  console.log(`  pool ${outcome.poolId}: settled=${outcome.settled} simulated=${outcome.simulated ?? false} skipped=${outcome.skipped ?? '-'} ${outcome.detail ?? ''}`)
}
ok('keeper simulates a settlement without sending', outcomes.length > 0 && outcomes.every(o => !o.settled))
ok('keeper reports a simulated settlement as such', outcomes.some(o => o.simulated === true) || outcomes.some(o => o.skipped === 'queue-empty'))

// A pool with an empty queue must report that, not throw.
const empty = await settleOnce(client, 1)
console.log(`  pool 1: settled=${empty.settled} skipped=${empty.skipped ?? '-'} ${empty.detail ?? ''}`)
ok('an empty queue is reported, not thrown', empty.settled === false, empty.skipped ?? '')

console.log(`\n${failures === 0 ? 'ACTION CHECK PASSED' : `ACTION CHECK: ${failures} failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
