/**
 * Fixture loading.
 *
 * The fixtures hold raw base64 account data captured from mainnet, so a test
 * needs kit's `EncodedAccount` shape (which names the owning program
 * `programAddress`) to hand to a generated decoder.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Address, EncodedAccount } from '@solana/kit'

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

export interface AccountFixture {
  address: string
  programAddress: string
  slot: number
  data: string
  fetchedAt: string
  note: string
}

export function loadFixture<T = AccountFixture>(file: string): T {
  return JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as T
}

export function toEncodedAccount(fixture: AccountFixture): EncodedAccount {
  const bytes = Uint8Array.from(atob(fixture.data), character => character.charCodeAt(0))
  return {
    address: fixture.address as Address,
    programAddress: fixture.programAddress as Address,
    data: bytes,
    executable: false,
    // Rent-exempt minimum for a small account; the decoders do not read lamports.
    lamports: 1_000_000n as never,
    space: BigInt(bytes.length),
  }
}
