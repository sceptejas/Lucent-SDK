/**
 * Typed errors.
 *
 * v0's failure mode was `catch { return null }`: `fetchPool` swallowed every
 * error, so a rate limit, a network blip and a genuinely absent pool were
 * indistinguishable, and `client.stake()` reported **"Pool 0 not found"** to a
 * user mid-transaction. Every failure here carries a code and a human message so
 * a caller can branch on it and a UI can explain it.
 */

/** Base class, so callers can catch everything this SDK throws in one place. */
export class LucentError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LucentError'
    this.code = code
  }
}

/** A pool, global or claim account did not decode as the program's own data. */
export class InvalidAccountError extends LucentError {
  constructor(address: string, detail: string) {
    super('INVALID_ACCOUNT', `${address} is not a valid sythstaking account: ${detail}`)
    this.name = 'InvalidAccountError'
  }
}

/** An on-chain read failed (network, rate limit, RPC method unavailable). */
export class RpcError extends LucentError {
  constructor(detail: string, options?: { cause?: unknown }) {
    super('RPC_ERROR', detail, options)
    this.name = 'RpcError'
  }
}

/** The hosted history API refused or failed the request. */
export class HistoryApiError extends LucentError {
  readonly status?: number
  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super('HISTORY_API_ERROR', message, options)
    this.name = 'HistoryApiError'
    this.status = options?.status
  }
}

/**
 * The history is unavailable or not provably complete.
 *
 * Separate from `HistoryApiError` because this is a *state*, not a fault: the
 * API answered, but says the figures are partial (see `note`, which is the reason
 * the API classified — a missing key, an unreconciled balance, or paging).
 */
export class HistoryIncompleteError extends LucentError {
  readonly note?: string
  constructor(message: string, note?: string) {
    super('HISTORY_INCOMPLETE', message)
    this.name = 'HistoryIncompleteError'
    this.note = note
  }
}

/** An amount was not a non-negative integer in base units. */
export class InvalidAmountError extends LucentError {
  constructor(value: unknown) {
    super('INVALID_AMOUNT', `Expected a non-negative bigint of base units, received ${String(value)}`)
    this.name = 'InvalidAmountError'
  }
}

/**
 * A referral id the program would reject: blank, or longer than 32 UTF-8 bytes.
 *
 * Raised when the client is constructed, so a partner integration fails on its
 * first line instead of when a user presses "stake" — the id is attested
 * on-chain and cannot be corrected after the fact.
 */
export class InvalidReferralIdError extends LucentError {
  constructor(detail: string) {
    super('INVALID_REFERRAL_ID', `Invalid referral id: ${detail}`)
    this.name = 'InvalidReferralIdError'
  }
}
