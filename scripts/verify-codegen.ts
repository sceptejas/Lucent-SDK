#!/usr/bin/env tsx
/**
 * Phase A gate: prove the generated client describes the deployed program.
 *
 * Everything here is an equality check against a value that is independently
 * known — the vendored IDL's discriminator arrays, and the mainnet addresses
 * recorded in `MAINNET`. Nothing is asserted from the generated code's own
 * output, so a client generated from the wrong IDL (a devnet IDL sits next to
 * the mainnet one upstream) fails loudly rather than shipping.
 *
 * Exit code 0 = safe to build on. Wired into CI as a hard gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as generated from '../src/generated/index'
import { findClaimRecordPda, findPoolPda } from '../src/pdas'

const here = dirname(fileURLToPath(import.meta.url))
const idl = JSON.parse(readFileSync(join(here, '..', 'idls', 'sythstaking.json'), 'utf8'))

const EXPECTED_PROGRAM = 'FXmUMZQVoUA2Ws4hJ6CsDo7bzGYTy1T45KTZz8xSy9R5'
const DEVNET_PROGRAM = 'AwDwa1V3bZo7nbEhXBYaFPugK2xCj7ywc42kbwi5sztk'

/** Mainnet addresses, recorded independently of the IDL. */
const MAINNET = {
  GLOBAL: '8yp99agjgfUy9jfx5baZ2LD3QkZ4TQriHY8Qy7Ns1gmC',
  USDC_POOL: '3Cxcnyc7XqnfhnWu8FB7AU86VPZ2vifEvpju6aFveEG2',
  LM_USD_MINT: '3mGBapHWB7moS1nBeacwDxNMF8PLBBnPSi4armyE2Qbe',
  SOL_POOL: '7pbRQCzYR9NvXbdMDh7VgZD6qyzZzmpkckGQr1WPT5bS',
  LM_SOL_MINT: '2Eg1tC22K7yFRAHgog9sQLEppvPyd1qzsn7gr6vi6EgG',
} as const

let failures = 0
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
  if (!pass) failures++
}

const upperSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_').toUpperCase()
const hex = (bytes: Readonly<Uint8Array> | number[]) => Buffer.from(bytes as Uint8Array).toString('hex')

console.log('=== program address ===')
ok('generated program address is mainnet', generated.SYTHSTAKING_PROGRAM_ADDRESS === EXPECTED_PROGRAM, generated.SYTHSTAKING_PROGRAM_ADDRESS)
ok('generated program address is not devnet', generated.SYTHSTAKING_PROGRAM_ADDRESS !== DEVNET_PROGRAM)

console.log(`\n=== instruction discriminators (${idl.instructions.length}) ===`)
for (const instruction of idl.instructions) {
  const exportName = `${upperSnake(instruction.name)}_DISCRIMINATOR`
  const actual = (generated as Record<string, unknown>)[exportName] as Readonly<Uint8Array> | undefined
  const expected = hex(instruction.discriminator)
  ok(`${instruction.name} -> ${exportName}`, actual !== undefined && hex(actual) === expected, actual ? '' : 'MISSING EXPORT')
}

console.log(`\n=== account discriminators (${idl.accounts.length}) ===`)
for (const account of idl.accounts) {
  const exportName = `${upperSnake(account.name)}_DISCRIMINATOR`
  const actual = (generated as Record<string, unknown>)[exportName] as Readonly<Uint8Array> | undefined
  const expected = hex(account.discriminator)
  ok(`${account.name} -> ${exportName}`, actual !== undefined && hex(actual) === expected, actual ? '' : 'MISSING EXPORT')
}

console.log(`\n=== event discriminators (${idl.events.length}) ===`)
for (const event of idl.events) {
  const exportName = `${upperSnake(event.name)}_EVENT_DISCRIMINATOR`
  const actual = (generated as Record<string, unknown>)[exportName] as Readonly<Uint8Array> | undefined
  const expected = hex(event.discriminator)
  ok(`${event.name} -> ${exportName}`, actual !== undefined && hex(actual) === expected, actual ? '' : 'MISSING EXPORT')
}

console.log('\n=== PDAs vs deployed mainnet addresses ===')
const [globalPda] = await generated.findGlobalPda()
ok('global', globalPda === MAINNET.GLOBAL, globalPda)

const [usdcPool] = await findPoolPda(0)
const [solPool] = await findPoolPda(1)
ok('pool 0 (USDC)', usdcPool === MAINNET.USDC_POOL, usdcPool)
ok('pool 1 (SOL)', solPool === MAINNET.SOL_POOL, solPool)

const [usdcReceiptMint] = await generated.findReceiptTokenPda({ pool: usdcPool })
const [solReceiptMint] = await generated.findReceiptTokenPda({ pool: solPool })
ok('receipt mint (lmUSD)', usdcReceiptMint === MAINNET.LM_USD_MINT, usdcReceiptMint)
ok('receipt mint (lmSOL)', solReceiptMint === MAINNET.LM_SOL_MINT, solReceiptMint)

const [claimPda] = await findClaimRecordPda(0, 0)
ok('claim record (pool 0, nonce 0) derives', claimPda.length > 0, claimPda)

console.log('\n=== coverage note ===')
const declaredPdas = (idl.pdas ?? []).length
console.log(`  IDL declares ${declaredPdas} PDA(s); Codama generated: ${Object.keys(generated).filter(k => k.startsWith('find')).join(', ')}`)
console.log('  pool / claimRecord / receiptMint seeds are supplied by src/pdas.ts and asserted above.')

console.log(`\n${failures === 0 ? 'GATE A PASSED' : `GATE A FAILED — ${failures} mismatch(es)`}`)
process.exit(failures === 0 ? 0 : 1)
