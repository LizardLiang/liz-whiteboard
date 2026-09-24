// src/lib/auth/reset-token.test.ts
// Unit tests for reset token generation/hashing (mirrors
// src/lib/auth/invite-token.test.ts's style for generateInviteToken).

import { describe, expect, it } from 'vitest'

import { generateResetToken, hashResetToken } from './reset-token'

describe('generateResetToken', () => {
  it('returns a 64-character hex string', () => {
    const token = generateResetToken()

    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns different tokens on each call (sufficient entropy)', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateResetToken()),
    )
    expect(tokens.size).toBe(20)
  })

  it('is NOT a UUID format (confirms randomBytes not randomUUID)', () => {
    const token = generateResetToken()
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

    expect(token).not.toMatch(uuidPattern)
  })
})

describe('hashResetToken', () => {
  it('returns a 64-character SHA-256 hex digest', () => {
    const hash = hashResetToken('some-reset-token')

    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same input produces the same hash', () => {
    const token = generateResetToken()

    expect(hashResetToken(token)).toBe(hashResetToken(token))
  })

  it('produces different hashes for different tokens', () => {
    const a = hashResetToken('token-a')
    const b = hashResetToken('token-b')

    expect(a).not.toBe(b)
  })
})
