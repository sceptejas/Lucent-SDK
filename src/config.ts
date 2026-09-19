/**
 * Deployed mainnet addresses, and the guard that keeps them honest.
 *
 * These are the values the public docs promise, so they are exported under the
 * same names (`MAINNET.USDC_POOL`, `MAINNET.LM_USD_MINT`, …) and the SDK asserts
 * at read time that the program it is talking to is the one the IDL describes —
 * a client generated from the devnet IDL upstream would otherwise look perfectly
 * healthy and talk to the wrong program.
 */
import type { Address } from '@solana/kit'

import { SYTHSTAKING_PROGRAM_ADDRESS } from './generated/programs/sythstaking'

export { SYTHSTAKING_PROGRAM_ADDRESS }

/** The deployed sythstaking program. */
export const MAINNET_PROGRAM_ADDRESS = 'FXmUMZQVoUA2Ws4hJ6CsDo7bzGYTy1T45KTZz8xSy9R5' as Address

/** The devnet program, which the IDL next to the mainnet one is addressed to. */
export const DEVNET_PROGRAM_ADDRESS = 'AwDwa1V3bZo7nbEhXBYaFPugK2xCj7ywc42kbwi5sztk' as Address

export const MAINNET = {
  GLOBAL: '8yp99agjgfUy9jfx5baZ2LD3QkZ4TQriHY8Qy7Ns1gmC' as Address,
  USDC_POOL: '3Cxcnyc7XqnfhnWu8FB7AU86VPZ2vifEvpju6aFveEG2' as Address,
  LM_USD_MINT: '3mGBapHWB7moS1nBeacwDxNMF8PLBBnPSi4armyE2Qbe' as Address,
  SOL_POOL: '7pbRQCzYR9NvXbdMDh7VgZD6qyzZzmpkckGQr1WPT5bS' as Address,
  LM_SOL_MINT: '2Eg1tC22K7yFRAHgog9sQLEppvPyd1qzsn7gr6vi6EgG' as Address,
  USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' as Address,
  WSOL_MINT: 'So11111111111111111111111111111111111111112' as Address,
} as const

export type PoolId = 0 | 1

export interface PoolMetadata {
  poolId: PoolId
  /** Stake token symbol, as the docs and UI present it. */
  symbol: 'USDC' | 'SOL'
  decimals: number
  /** Receipt token symbol, e.g. lmUSD. */
  receiptSymbol: 'lmUSD' | 'lmSOL'
  /** Receipt mint minted by this pool. */
  receiptMint: Address
  /** Stake token mint. */
  stakeMint: Address
  pool: Address
}

/**
 * Pool 0 and 1, matching the deployed program. `decimals` is the stake token's,
 * which is also the receipt token's (the program mints receipts 1:1 in decimals).
 */
export const POOLS: Record<PoolId, PoolMetadata> = {
  0: {
    poolId: 0,
    symbol: 'USDC',
    decimals: 6,
    receiptSymbol: 'lmUSD',
    receiptMint: MAINNET.LM_USD_MINT,
    stakeMint: MAINNET.USDC_MINT,
    pool: MAINNET.USDC_POOL,
  },
  1: {
    poolId: 1,
    symbol: 'SOL',
    decimals: 9,
    receiptSymbol: 'lmSOL',
    receiptMint: MAINNET.LM_SOL_MINT,
    stakeMint: MAINNET.WSOL_MINT,
    pool: MAINNET.SOL_POOL,
  },
}

export const POOL_BY_MINT: Record<string, PoolMetadata> = {
  [MAINNET.USDC_MINT]: POOLS[0],
  [MAINNET.WSOL_MINT]: POOLS[1],
  [MAINNET.LM_USD_MINT]: POOLS[0],
  [MAINNET.LM_SOL_MINT]: POOLS[1],
}

/** Throws if the generated client is not addressed to the deployed program. */
export function assertMainnetProgram(): void {
  if (SYTHSTAKING_PROGRAM_ADDRESS !== MAINNET_PROGRAM_ADDRESS) {
    throw new Error(
      `The generated client is addressed to ${SYTHSTAKING_PROGRAM_ADDRESS}, but this release targets ` +
        `${MAINNET_PROGRAM_ADDRESS}. Regenerate the client from the mainnet IDL (npm run codegen).`,
    )
  }
}
