/**
 * Referral ids.
 *
 * The id is attested on-chain in the `Staked` / `Unstaked` event, so these cases
 * pin the two things that matter: the rule matches the program's exactly (blank
 * rejected, at most 32 UTF-8 **bytes**), and the id is passed through verbatim —
 * the program neither trims nor normalises it, so what a partner passes is what
 * their payout is matched against.
 */
import { describe, expect, it } from 'vitest'

import { InvalidReferralIdError } from '../src/errors'
import {
  MAX_REFERRAL_ID_BYTES,
  assertReferralId,
  isValidReferralId,
  referralIdByteLength,
} from '../src/referral'

describe('referral id validation', () => {
  it('accepts an ordinary partner id', () => {
    expect(assertReferralId('partner-42')).toBe('partner-42')
    expect(isValidReferralId('partner-42')).toBe(true)
  })

  it('accepts an id of exactly the byte limit', () => {
    const id = 'x'.repeat(MAX_REFERRAL_ID_BYTES)
    expect(referralIdByteLength(id)).toBe(MAX_REFERRAL_ID_BYTES)
    expect(assertReferralId(id)).toBe(id)
  })

  it('rejects one byte over the limit', () => {
    expect(() => assertReferralId('x'.repeat(MAX_REFERRAL_ID_BYTES + 1))).toThrow(
      InvalidReferralIdError,
    )
    expect(isValidReferralId('x'.repeat(MAX_REFERRAL_ID_BYTES + 1))).toBe(false)
  })

  it('bounds bytes, not characters', () => {
    // Nine four-byte emoji: 9 characters, 36 bytes. The program counts bytes, so
    // counting characters here would let a rejected id reach the chain.
    const emoji = '\u{1F680}'.repeat(9)
    expect(Array.from(emoji).length).toBe(9)
    expect(referralIdByteLength(emoji)).toBe(36)
    expect(() => assertReferralId(emoji)).toThrow(InvalidReferralIdError)
  })

  it('rejects blank, whitespace-only and non-string ids', () => {
    for (const bad of ['', '   ', '\t\n', undefined, null, 42, {}, ['partner']]) {
      expect(isValidReferralId(bad)).toBe(false)
      expect(() => assertReferralId(bad)).toThrow(InvalidReferralIdError)
    }
  })

  it('returns the id verbatim, never trimmed', () => {
    // The program validates `trim()` is non-empty but attests the raw string, so
    // trimming here would make the SDK disagree with the chain.
    expect(assertReferralId(' partner-42 ')).toBe(' partner-42 ')
  })

  it('carries a code a caller can branch on', () => {
    try {
      assertReferralId('')
      throw new Error('should have thrown')
    } catch (error) {
      expect((error as InvalidReferralIdError).code).toBe('INVALID_REFERRAL_ID')
      expect((error as InvalidReferralIdError).name).toBe('InvalidReferralIdError')
    }
  })
})
