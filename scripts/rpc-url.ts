/**
 * Where the verification scripts get an RPC endpoint.
 *
 * These scripts are run by hand, not in CI, and they read the chain. The endpoint
 * comes from the environment so that nothing machine-specific is committed:
 *
 *     HELIUS_API_KEY=... npx tsx scripts/verify-position.ts
 *
 * A `.env.local` in the working directory is also read, which is the same file
 * Next.js uses, so a contributor who already has one needs no extra setup.
 * Preferring a keyed endpoint matters because two of the reads these scripts need
 * — `getProgramAccounts` and `getTransactionsForAddress` — are blocked on the
 * public endpoint.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type RpcSource = 'HELIUS_API_KEY' | 'SOLANA_RPC_URL' | 'public'

export interface ResolvedRpc {
  url: string
  source: RpcSource
  /** True when the endpoint can serve getProgramAccounts and history. */
  keyed: boolean
}

function fromDotEnvLocal(name: string): string | undefined {
  const path = join(process.cwd(), '.env.local')
  if (!existsSync(path)) return undefined
  const match = readFileSync(path, 'utf8').match(new RegExp(`^${name}=(.+)$`, 'm'))
  return match?.[1]?.trim() || undefined
}

export function resolveRpcUrl(): ResolvedRpc {
  const key = process.env.HELIUS_API_KEY ?? fromDotEnvLocal('HELIUS_API_KEY')
  if (key) {
    return {
      url: `https://mainnet.helius-rpc.com/?api-key=${key}`,
      source: 'HELIUS_API_KEY',
      keyed: true,
    }
  }

  const url = process.env.SOLANA_RPC_URL ?? fromDotEnvLocal('SOLANA_RPC_URL')
  if (url) return { url, source: 'SOLANA_RPC_URL', keyed: true }

  return { url: 'https://api.mainnet-beta.solana.com', source: 'public', keyed: false }
}

/**
 * Resolve, and say so when the endpoint cannot do what the caller needs.
 * Returns the URL regardless: a partial answer beats no answer.
 */
export function resolveRpcUrlFor(script: string, needsKeyed = true): string {
  const resolved = resolveRpcUrl()
  if (needsKeyed && !resolved.keyed) {
    console.warn(
      `[${script}] No HELIUS_API_KEY or SOLANA_RPC_URL set, so this is using the public endpoint.\n` +
        '  getProgramAccounts and getTransactionsForAddress are blocked there, so some checks will fail.\n' +
        '  Re-run as: HELIUS_API_KEY=... npx tsx ' + script,
    )
  }
  return resolved.url
}
