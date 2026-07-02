// src/lib/auth/invite-token.test.ts
// Unit tests for invite token generation/hashing (mirrors
// src/lib/auth/session.test.ts's TC-P2-04 style for generateSessionToken).

import { describe, expect, it } from 'vitest'

import { generateInviteToken, hashInviteToken } from './invite-token'

describe('generateInviteToken', () => {
  it('returns a 64-character hex string', () => {
    const token = generateInviteToken()

    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns different tokens on each call (sufficient entropy)', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateInviteToken()),
    )
    expect(tokens.size).toBe(20)
  })

  it('is NOT a UUID format (confirms randomBytes not randomUUID)', () => {
    const token = generateInviteToken()
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

    expect(token).not.toMatch(uuidPattern)
  })
})

describe('hashInviteToken', () => {
  it('returns a 64-character SHA-256 hex digest', () => {
    const hash = hashInviteToken('some-invite-token')

    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same input produces the same hash', () => {
    const token = generateInviteToken()

    expect(hashInviteToken(token)).toBe(hashInviteToken(token))
  })

  it('produces different hashes for different tokens', () => {
    const a = hashInviteToken('token-a')
    const b = hashInviteToken('token-b')

    expect(a).not.toBe(b)
  })
})
