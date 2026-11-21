// src/lib/auth/opaque-token.test.ts
// Unit tests for the opaque token generation/hashing shared by sessions, reset, signup and invite links.

import { describe, expect, it } from 'vitest'

import { generateOpaqueToken, hashOpaqueToken } from './opaque-token'

describe('generateOpaqueToken', () => {
  it('returns a 64-character hex string', () => {
    const token = generateOpaqueToken()

    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns different tokens on each call (sufficient entropy)', () => {
    const tokens = new Set(
      Array.from({ length: 20 }, () => generateOpaqueToken()),
    )
    expect(tokens.size).toBe(20)
  })

  it('is NOT a UUID format (confirms randomBytes not randomUUID)', () => {
    const token = generateOpaqueToken()
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

    expect(token).not.toMatch(uuidPattern)
  })
})

describe('hashOpaqueToken', () => {
  it('returns a 64-character SHA-256 hex digest', () => {
    const hash = hashOpaqueToken('some-opaque-token')

    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic — same input produces the same hash', () => {
    const token = generateOpaqueToken()

    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token))
  })

  it('produces different hashes for different tokens', () => {
    const a = hashOpaqueToken('token-a')
    const b = hashOpaqueToken('token-b')

    expect(a).not.toBe(b)
  })
})
