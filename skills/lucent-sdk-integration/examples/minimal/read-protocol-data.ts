import type { Address, ClusterUrl } from '@solana/kit'
import {
  POOLS,
  createLucentClient,
  formatAmount,
  type PoolId,
} from 'lucent-sdk'

export interface ReadProtocolDataInput {
  rpcUrl: ClusterUrl
  wallet: Address
  poolId: PoolId
  apiUrl?: string
}

export async function readProtocolData(input: ReadProtocolDataInput) {
  const client = createLucentClient({
    rpcUrl: input.rpcUrl,
    ...(input.apiUrl ? { apiUrl: input.apiUrl } : {}),
  })

  const [pool, global, receiptBalance] = await Promise.all([
    client.getPool(input.poolId),
    client.getGlobal(),
    client.getReceiptBalance(input.wallet, input.poolId),
  ])

  const hosted = input.apiUrl
    ? await Promise.all([
        client.getPosition(input.wallet),
        client.getHistory(input.wallet),
      ])
    : null

  return {
    pool,
    global,
    receiptBalance,
    formattedReceiptBalance: formatAmount(
      receiptBalance,
      POOLS[input.poolId].decimals,
    ),
    positions: hosted?.[0] ?? null,
    history: hosted?.[1] ?? null,
  }
}
