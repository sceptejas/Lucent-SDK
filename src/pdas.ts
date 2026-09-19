/**
 * PDAs that the IDL does not declare.
 *
 * Codama generates `global` and `receiptToken` because the Anchor IDL carries
 * their seeds. It cannot generate `pool` or `claimRecord`: the deployed IDL
 * declares no seeds for either, so the generated `stake`/`unstake`/`claim`
 * builders take them as plain required accounts.
 *
 * Two seeds are not worth an IDL-patching pipeline, but they are worth pinning:
 * `scripts/verify-codegen.ts` asserts both against the deployed pool addresses
 * (and a live ClaimRecord) so a seed regression fails the build instead of
 * producing a transaction that fails on mainnet.
 */
import {
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  getUtf8Encoder,
  type Address,
  type ProgramDerivedAddress,
} from '@solana/kit'
import { SYTHSTAKING_PROGRAM_ADDRESS } from './generated/programs/sythstaking'

export { findGlobalPda, findReceiptTokenPda } from './generated/pdas'

/** `[b"pool", pool_id.to_le_bytes()]` */
export async function findPoolPda(
  poolId: number | bigint,
  config: { programAddress?: Address } = {},
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: config.programAddress ?? SYTHSTAKING_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode('pool'), getU64Encoder().encode(BigInt(poolId))],
  })
}

/** `[b"claim", pool_id.to_le_bytes(), nonce.to_le_bytes()]` */
export async function findClaimRecordPda(
  poolId: number | bigint,
  nonce: number | bigint,
  config: { programAddress?: Address } = {},
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: config.programAddress ?? SYTHSTAKING_PROGRAM_ADDRESS,
    seeds: [
      getUtf8Encoder().encode('claim'),
      getU64Encoder().encode(BigInt(poolId)),
      getU64Encoder().encode(BigInt(nonce)),
    ],
  })
}

/** The receipt mint for a pool, derived the same way the program does. */
export async function findReceiptMintPda(
  pool: Address,
  config: { programAddress?: Address } = {},
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: config.programAddress ?? SYTHSTAKING_PROGRAM_ADDRESS,
    seeds: [getUtf8Encoder().encode('mint'), getAddressEncoder().encode(pool)],
  })
}
