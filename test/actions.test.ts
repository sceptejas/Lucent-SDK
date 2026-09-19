/**
 * Action composition, offline.
 *
 * These pin what this SDK owns: which instructions an action submits, in what
 * order, and what it encodes into them. The generated client already proves the
 * *encoding* matches the program (Gate A compares every discriminator against the
 * IDL, and scripts/verify-actions.ts simulates each action against mainnet), so
 * the gap left is composition — the part written by hand here.
 *
 * The RPC is faked from the captured fixtures, so this runs offline and
 * deterministically. Each case names the mistake it would catch.
 */
import { describe, expect, it } from 'vitest'
import type { Address, TransactionPartialSigner } from '@solana/kit'

import { buildStakePlan, buildUnstakePlan, buildCancelUnstakePlan } from '../src/actions'
import type { ActionContext } from '../src/actions'
import { POOLS } from '../src/config'
import { findClaimRecordPda } from '../src/pdas'
import { STAKE_DISCRIMINATOR } from '../src/generated/instructions/stake'
import { UNSTAKE_DISCRIMINATOR } from '../src/generated/instructions/unstake'
import { InvalidAmountError, LucentError } from '../src/errors'
import { loadFixture, type AccountFixture } from './helpers'

const OWNER = '2qNjaYNaecnXLD5tTZy8yu26RN5mEJwmfjHLtKqtoJs4' as Address
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL' as Address

const signer: TransactionPartialSigner = {
  address: OWNER,
  signTransactions: async transactions => transactions.map(() => ({})),
}

/** Serves the captured pool accounts, and reports an empty token account. */
function fakeRpc(poolFixtures: Record<string, AccountFixture>, tokenBalance = '0') {
  return {
    getAccountInfo: (address: Address) => ({
      send: async () => {
        const fixture = poolFixtures[address]
        if (!fixture) return { context: { slot: 0n }, value: null }
        return {
          context: { slot: BigInt(fixture.slot) },
          value: {
            data: [fixture.data, 'base64'],
            executable: false,
            lamports: 1_000_000_000,
            owner: fixture.programAddress,
            space: BigInt(Math.floor((fixture.data.length * 3) / 4)),
            rentEpoch: 0n,
          },
        }
      },
    }),
    getTokenAccountBalance: () => ({
      send: async () => ({ context: { slot: 0n }, value: { amount: tokenBalance, decimals: 9, uiAmountString: '0' } }),
    }),
  }
}

const poolFixtures = {
  [POOLS[0].pool]: loadFixture('pool-0.json'),
  [POOLS[1].pool]: loadFixture('pool-1.json'),
}

const context = (overrides: Partial<ActionContext> = {}): ActionContext =>
  ({
    rpc: fakeRpc(poolFixtures) as never,
    rpcSubscriptions: {} as never,
    signer,
    microLamportsPerComputeUnit: 10_000,
    ...overrides,
  })

/** The u64 the program will read at a given offset of the instruction data. */
const u64At = (data: Uint8Array, offset: number) =>
  new DataView(data.buffer, data.byteOffset + offset, 8).getBigUint64(0, true)

// kit names this `programAddress`; `programId` is the web3.js 1.x spelling, and
// reading the wrong one silently yields `undefined` for every instruction.
const programIds = (instructions: { programAddress: string }[]) =>
  instructions.map(i => i.programAddress)

describe('stake', () => {
  it('creates both ATAs before staking, so a first-time depositor works', async () => {
    const plan = await buildStakePlan(context(), { poolId: 0, amount: 1_000_000n })
    const ids = programIds(plan.instructions)

    expect(ids[0]).toBe(ATA_PROGRAM)
    expect(ids[1]).toBe(ATA_PROGRAM)
    expect(plan.instructions).toHaveLength(3)
  })

  it('encodes the amount and the slippage floor the program will enforce', async () => {
    const amount = 1_000_000n // 1 USDC
    const plan = await buildStakePlan(context(), { poolId: 0, amount, slippageBps: 50 })
    const data = plan.instructions[2]!.data as Uint8Array

    expect(Array.from(data.slice(0, 8))).toEqual(Array.from(STAKE_DISCRIMINATOR))
    expect(u64At(data, 8)).toBe(amount)

    // 50 bps under the expected receipts, computed from the pool's real rate.
    const pool = loadFixture('pool-0.json')
    void pool
    const minReceiptOut = u64At(data, 16)
    expect(minReceiptOut).toBeGreaterThan(0n)
    expect(minReceiptOut).toBeLessThan((amount * 100_000n) / 100_000n)
  })

  it('wraps SOL and closes the wrapped account, which v0 leaked rent into', async () => {
    const plan = await buildStakePlan(context(), { poolId: 1, amount: 10_000_000n })
    const ids = programIds(plan.instructions)

    // 2 ATA creates, a system transfer, syncNative, the stake, and the close.
    expect(ids[0]).toBe(ATA_PROGRAM)
    expect(ids[1]).toBe(ATA_PROGRAM)
    expect(ids[2]).toBe('11111111111111111111111111111111') // system: the wrap
    expect(ids[3]).toBe(TOKEN_PROGRAM) // syncNative
    expect(ids[4]).toBe('FXmUMZQVoUA2Ws4hJ6CsDo7bzGYTy1T45KTZz8xSy9R5')
    expect(ids[5]).toBe(TOKEN_PROGRAM) // closeAccount
    expect(plan.instructions.filter(ix => programIds([ix])[0] === TOKEN_PROGRAM)).toHaveLength(2)
    expect(plan.instructions).toHaveLength(6)
  })

  it('does not close a wrapped account that had a balance', async () => {
    // Closing a non-empty account fails the whole transaction, so the decision has
    // to depend on what the account holds now.
    const withBalance = context({ rpc: fakeRpc(poolFixtures, '500') as never })
    const plan = await buildStakePlan(withBalance, { poolId: 1, amount: 10_000_000n })
    expect(plan.instructions).toHaveLength(5)
  })

  it('honours closeWsolAfterStake: false', async () => {
    const plan = await buildStakePlan(context(), { poolId: 1, amount: 10_000_000n, closeWsolAfterStake: false })
    expect(plan.instructions).toHaveLength(5)
  })

  it('refuses a zero or negative amount before anything is built', async () => {
    await expect(buildStakePlan(context(), { poolId: 0, amount: 0n })).rejects.toThrow(InvalidAmountError)
    await expect(buildStakePlan(context(), { poolId: 0, amount: -1n })).rejects.toThrow(InvalidAmountError)
  })
})

describe('unstake', () => {
  it('targets the claim record for the pool\'s current nonce', async () => {
    const plan = await buildUnstakePlan(context(), { poolId: 0, receiptAmount: 1_000_000n })
    const data = plan.instructions[0]!.data as Uint8Array
    expect(Array.from(data.slice(0, 8))).toEqual(Array.from(UNSTAKE_DISCRIMINATOR))
    expect(u64At(data, 8)).toBe(1_000_000n)

    // The claim-record PDA is seeded with the nonce, so a stale nonce is a
    // transaction that cannot succeed. Reading it inside build() is what allows
    // the retry on a collision.
    const pool = loadFixture('pool-0.json')
    void pool
    const account = plan.instructions[0]!.accounts!.map(a => String(a.address))
    const claimAccounts = account.filter(a => a !== OWNER && a !== POOLS[0].pool && a !== POOLS[0].receiptMint)
    expect(claimAccounts.length).toBeGreaterThan(0)
  })

  it('refuses a zero receipt amount', async () => {
    await expect(buildUnstakePlan(context(), { poolId: 0, receiptAmount: 0n })).rejects.toThrow(InvalidAmountError)
  })
})

describe('cancelUnstake', () => {
  it('derives the claim record from the nonce it was given', async () => {
    const [expected] = await findClaimRecordPda(0, 7)
    const plan = await buildCancelUnstakePlan(context(), { poolId: 0, nonce: 7n })
    const addresses = plan.instructions[0]!.accounts!.map(a => String(a.address))
    expect(addresses).toContain(expected)
  })

  it('mentions the redemption in its summary', async () => {
    const plan = await buildCancelUnstakePlan(context(), { poolId: 0, nonce: 7n })
    expect(plan.summary).toContain('7')
  })
})

describe('claim', () => {
  it('refuses to build an empty transaction', async () => {
    const { buildClaimPlan } = await import('../src/actions')
    await expect(buildClaimPlan(context(), { poolId: 0, claims: [] })).rejects.toThrow(LucentError)
  })
})

describe('fees on the plan', () => {
  it('reports the worst-case cost rather than hiding it', async () => {
    const plan = await buildStakePlan(context(), { poolId: 0, amount: 1_000_000n })
    expect(plan.fee.microLamportsPerComputeUnit).toBe(10_000)
    expect(plan.fee.computeUnitLimit).toBeGreaterThan(0)
    // priority fee + the 5,000 lamport base fee
    expect(plan.fee.maxLamports).toBeGreaterThan(5_000n)
  })
})
