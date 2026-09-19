/**
 * Lucent SDK — public surface.
 *
 * Kit-native (`@solana/kit`), no `@solana/web3.js` 1.x, no Node globals: the
 * package has to work in a browser, which is where the protocol's users are.
 *
 * Layers:
 *   ./generated  Codama output, decoded and encoded from the deployed IDL
 *   ./config     deployed addresses + the guard that they are the right ones
 *   ./pdas       the two PDAs the IDL does not declare seeds for
 *
 * Everything above that — positions, history, transaction plans — is added in
 * later phases of the v1 plan.
 */

export { SYTHSTAKING_PROGRAM_ADDRESS } from './generated/programs/sythstaking'

export {
  MAINNET,
  MAINNET_PROGRAM_ADDRESS,
  DEVNET_PROGRAM_ADDRESS,
  POOLS,
  POOL_BY_MINT,
  assertMainnetProgram,
  type PoolId,
  type PoolMetadata,
} from './config'

export {
  createLucentClient,
  findAssociatedTokenAddress,
  type HistoryResult,
  type LucentClient,
  type LucentClientConfig,
  type PositionResult,
} from './client'

export { toPosition, isClosed, type Position, type PositionInFlight } from './position'

export {
  fetchHostedProfile,
  type HistoryApiConfig,
  type HostedActivity,
  type HostedPosition,
  type HostedProfile,
} from './api'

export {
  RATE_DENOM,
  formatAmount,
  formatAmountExact,
  formatPercent,
  formatSignedAmount,
  parseAmount,
  percentOf,
  receiptPrice,
  stakePrice,
} from './amounts'

export {
  HistoryApiError,
  HistoryIncompleteError,
  InvalidAccountError,
  InvalidAmountError,
  LucentError,
  RpcError,
} from './errors'

export {
  findGlobalPda,
  findReceiptTokenPda,
  findReceiptMintPda,
  findPoolPda,
  findClaimRecordPda,
} from './pdas'
