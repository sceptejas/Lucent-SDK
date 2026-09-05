import { PublicKey } from '@solana/web3.js'

// ── Program ────────────────────────────────────────────────────────────────

export const PROGRAM_ID = new PublicKey(
  'FXmUMZQVoUA2Ws4hJ6CsDo7bzGYTy1T45KTZz8xSy9R5'
)

// ── Well-known SPL mints ───────────────────────────────────────────────────

/** USDC on Solana mainnet */
export const USDC_MINT = new PublicKey(
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
)

/** Wrapped SOL mint */
export const WSOL_MINT = new PublicKey(
  'So11111111111111111111111111111111111111112'
)

export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
)

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
)

export const SYSTEM_PROGRAM_ID = new PublicKey(
  '11111111111111111111111111111111'
)

// ── Deployed mainnet addresses ─────────────────────────────────────────────

export const MAINNET = {
  GLOBAL:      new PublicKey('8yp99agjgfUy9jfx5baZ2LD3QkZ4TQriHY8Qy7Ns1gmC'),
  USDC_POOL:   new PublicKey('3Cxcnyc7XqnfhnWu8FB7AU86VPZ2vifEvpju6aFveEG2'),
  LM_USD_MINT: new PublicKey('3mGBapHWB7moS1nBeacwDxNMF8PLBBnPSi4armyE2Qbe'),
  SOL_POOL:    new PublicKey('7pbRQCzYR9NvXbdMDh7VgZD6qyzZzmpkckGQr1WPT5bS'),
  LM_SOL_MINT: new PublicKey('2Eg1tC22K7yFRAHgog9sQLEppvPyd1qzsn7gr6vi6EgG'),
} as const

// ── PDA derivation helpers ─────────────────────────────────────────────────

function u64le(n: number | bigint): Uint8Array {
  const arr = new Uint8Array(8)
  new DataView(arr.buffer).setBigUint64(0, BigInt(n), true)
  return arr
}

export function findGlobalPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('global')],
    PROGRAM_ID
  )
}

export function findPoolPda(poolId: number | bigint): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pool'), u64le(poolId)],
    PROGRAM_ID
  )
}

export function findReceiptMintPda(poolKey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint'), poolKey.toBuffer()],
    PROGRAM_ID
  )
}

export function findClaimRecordPda(
  poolId: number | bigint,
  nonce: number | bigint
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('claim'), u64le(poolId), u64le(nonce)],
    PROGRAM_ID
  )
}

export function findAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0]
}
