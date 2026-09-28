/**
 * Referral ids.
 *
 * Attribution is attested **on-chain**, not off it: when a stake or unstake
 * carries a referral id, the program writes that id into the `Staked` /
 * `Unstaked` event alongside the period's timestamps and the pool's rates. A
 * partner's share of the yield accrued over a period is computed from those
 * attested values, so the id has to be on every stake and unstake that partner
 * sends. That is why the SDK takes it once — at client construction — and puts it
 * on every action, rather than leaving each caller to remember.
 *
 * The rule mirrors the program exactly (`validate_referral_id` in the program's
 * `utils.rs`): non-blank, and at most 32 **UTF-8 bytes**. Bytes, not characters:
 * sixteen four-byte emoji are 16 characters and 64 bytes, which the program
 * rejects. So does this.
 *
 * The id is attested **verbatim** — the program neither trims nor normalises it —
 * so whatever a partner passes here is what lands on-chain and what their payout
 * is matched against. Trailing whitespace is not silently stripped.
 */
import { InvalidReferralIdError } from './errors'

/** Maximum referral id length in UTF-8 bytes. Mirrors the program. */
export const MAX_REFERRAL_ID_BYTES = 32

const encoder = new TextEncoder()

/** UTF-8 byte length — the unit the program bounds the id in. */
export function referralIdByteLength(referralId: string): number {
  return encoder.encode(referralId).length
}

/** Whether the program would accept this id. */
export function isValidReferralId(referralId: unknown): referralId is string {
  return (
    typeof referralId === 'string' &&
    referralId.trim().length > 0 &&
    referralIdByteLength(referralId) <= MAX_REFERRAL_ID_BYTES
  )
}

/**
 * Validate a referral id, throwing {@link InvalidReferralIdError} when the
 * program would reject it. Returns the id unchanged, since that is what gets
 * attested.
 */
export function assertReferralId(referralId: unknown): string {
  if (typeof referralId !== 'string' || referralId.trim().length === 0) {
    throw new InvalidReferralIdError('a referral id is required and must not be blank')
  }
  const bytes = referralIdByteLength(referralId)
  if (bytes > MAX_REFERRAL_ID_BYTES) {
    throw new InvalidReferralIdError(
      `referral id ${JSON.stringify(referralId)} is ${bytes} UTF-8 bytes; ` +
        `the program allows at most ${MAX_REFERRAL_ID_BYTES}`,
    )
  }
  return referralId
}
