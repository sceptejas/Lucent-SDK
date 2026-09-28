#!/usr/bin/env tsx
/**
 * End-to-end check of the domain layer: SDK -> hosted API -> chain.
 *
 * Needs the website running (`npm run dev` in lucent-frontend) for the history
 * half, and a keyed RPC for the chain half. Not a CI gate — it is the check to
 * run after touching the position maths or the API contract.
 *
 * What it asserts is the invariant that matters: the receipt balance the API
 * reports must equal the balance read from chain, and the yield must be
 * reconstructive from the API's own numbers. Figures are printed rather than
 * pinned, because they move with the pool.
 *
 * Usage: npx tsx scripts/verify-position.ts [apiUrl]
 */

import type { Address, ClusterUrl } from '@solana/kit'

import { createLucentClient } from '../src/client'
import {
  formatAmount,
  formatPercent,
  formatSignedAmount,
  parseAmount,
  percentOf,
  receiptPrice,
} from '../src/amounts'
import { HistoryApiError, InvalidAmountError } from '../src/errors'

import { resolveRpcUrlFor } from './rpc-url'

const WALLETS: { label: string; address: Address }[] = [
  { label: 'lmUSD holder', address: '2qNjaYNaecnXLD5tTZy8yu26RN5mEJwmfjHLtKqtoJs4' as Address },
  { label: 'lmSOL holder', address: '8NgGEQ8pYX58HX6hZKXWdBPQWjstjVEQa54ksHSLwPQp' as Address },
]

const rpcUrl = () => resolveRpcUrlFor('scripts/verify-position.ts')

const apiUrl = process.argv[2] ?? 'http://localhost:3000'
const client = createLucentClient({ rpcUrl: rpcUrl() as ClusterUrl, apiUrl })

let failures = 0
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!pass) failures++
}

console.log(`=== positions via ${apiUrl} + chain ===`)
for (const { label, address } of WALLETS) {
  const results = await client.getPosition(address)
  const open = results.filter(r => r.position.receipts > 0n || r.position.inFlight.total > 0n)
  if (open.length === 0) {
    console.log(`\n${label} ${address.slice(0, 8)}…: no open position`)
    continue
  }

  for (const { position, verified, note } of open) {
    console.log(`\n${label} ${address.slice(0, 8)}… — ${position.symbol} pool`)
    console.log(`  receipts      ${formatAmount(position.receipts, position.decimals)} ${position.receiptSymbol}`)
    console.log(`  receipt value ${formatAmount(position.receiptValue, position.decimals)} ${position.symbol}  @ ${position.price.toFixed(6)} each`)
    console.log(`  staked        ${formatAmount(position.staked, position.decimals)} ${position.receiptSymbol}`)
    if (position.received > 0n) {
      console.log(`  received      ${formatAmount(position.received, position.decimals)} ${position.receiptSymbol} (transferred in, not yield)`)
    }
    if (position.inFlight.total > 0n) {
      console.log(`  in flight     ${formatAmount(position.inFlight.total, position.decimals)} ${position.receiptSymbol}`)
    }
    if (position.withdrawn > 0n) {
      console.log(`  withdrawn     ${formatAmount(position.withdrawn, position.decimals)} ${position.receiptSymbol}`)
    }
    console.log(`  yield earned  ${formatSignedAmount(position.yieldEarned, position.decimals)} ${position.receiptSymbol} (${formatPercent(position.yieldPercent)})`)
    console.log(`  net (redeem)  ${formatSignedAmount(position.netRedemptionValue, position.decimals)} ${position.symbol}`)

    // The point of the whole split: the API's balance must equal the chain's.
    const chainBalance = await client.getReceiptBalance(address, position.poolId as 0 | 1)
    ok('API receipt balance equals chain', position.receipts === chainBalance,
      `${position.receipts} vs ${chainBalance}`)
    ok('verified', verified, note ?? '')
    const pool = await client.getPool(position.poolId as 0 | 1)
    const expectedPrice = receiptPrice(pool.unstakeRate)
    ok('price matches the pool rate read from chain',
      Math.abs(position.price - expectedPrice) < 1e-9, `${position.price} vs ${expectedPrice}`)

    // The yield must be reconstructable, in integer maths, from the API's own
    // numbers: (net + entry spread) converted to receipts at the live rate.
    const expectedYield = position.underlying.netYield + position.underlying.entrySpread
    const expectedYieldReceipts = (expectedYield * position.rates.denom) / position.rates.unstake
    ok('yield is reconstructable from net + entry spread',
      position.yieldEarned === expectedYieldReceipts,
      `${position.yieldEarned} vs ${expectedYieldReceipts}`)

    const pct = percentOf(expectedYield, position.underlying.deposited)
    ok('yieldPercent matches the underlying ratio', pct === null || Math.abs((position.yieldPercent ?? 0) - pct) < 0.011,
      `${position.yieldPercent} vs ${pct}`)
  }

  const history = await client.getHistory(address)
  ok(`${address.slice(0, 8)}… history is exact`, history.exact, history.note ?? '')
}

console.log('\n=== errors and boundaries ===')
const noHistoryUrl = createLucentClient({ rpcUrl: rpcUrl() as ClusterUrl })
try {
  await noHistoryUrl.getPosition('2qNjaYNaecnXLD5tTZy8yu26RN5mEJwmfjHLtKqtoJs4' as Address)
  ok('a missing apiUrl is refused', false, 'expected HistoryApiError')
} catch (error) {
  ok('a missing apiUrl is refused', error instanceof HistoryApiError, (error as Error).message.slice(0, 70))
}

const badApi = createLucentClient({ apiUrl: 'https://127.0.0.1:9' })
try {
  await badApi.getHistory('2qNjaYNaecnXLD5tTZy8yu26RN5mEJwmfjHLtKqtoJs4' as Address)
  ok('an unreachable API raises HistoryApiError', false)
} catch (error) {
  ok('an unreachable API raises HistoryApiError', error instanceof HistoryApiError)
}

const unverified = createLucentClient({ apiUrl })
const [first] = await unverified.getPosition(WALLETS[0]!.address)
ok('no rpc means unverified, and says so', first !== undefined && !first.verified && Boolean(first.note))

console.log('\n=== amount helpers ===')
ok('parseAmount("1.5", 9)', parseAmount('1.5', 9) === 1_500_000_000n, String(parseAmount('1.5', 9)))
ok('parseAmount("1", 6)', parseAmount('1', 6) === 1_000_000n)
ok('formatAmount trims to 2dp above 1,000', formatAmount(parseAmount('1234.567891', 9), 9) === '1,234.56',
  formatAmount(parseAmount('1234.567891', 9), 9))
ok('formatAmount keeps 4dp in the 1-1,000 band', formatAmount(parseAmount('12.345678', 9), 9) === '12.3456',
  formatAmount(parseAmount('12.345678', 9), 9))
ok('formatAmount keeps 6dp below 1', formatAmount(parseAmount('0.123456789', 9), 9) === '0.123456',
  formatAmount(parseAmount('0.123456789', 9), 9))
ok('formatAmount(1n, 9) shows it is small, not zero', formatAmount(1n, 9) === '<0.000001', formatAmount(1n, 9))
try {
  parseAmount('1.0000001', 6)
  ok('parseAmount refuses more decimals than the token has', false, 'truncated silently!')
} catch (error) {
  ok('parseAmount refuses more decimals than the token has', error instanceof InvalidAmountError)
}

console.log(`\n${failures === 0 ? 'POSITION CHECK PASSED' : `POSITION CHECK: ${failures} failure(s)`}`)
process.exit(failures === 0 ? 0 : 1)
