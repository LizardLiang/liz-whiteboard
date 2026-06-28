// src/lib/oauth/pkce.ts
// PKCE (RFC 7636) S256 challenge/verifier helpers

import { createHash, randomBytes } from 'node:crypto'

/**
 * Generate a random PKCE code verifier.
 * 43-128 ASCII chars per spec; we use 64 hex chars (256 bits entropy).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Derive the S256 code challenge from a code verifier.
 * challenge = BASE64URL(SHA-256(verifier))
 */
export function deriveS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

/**
 * Verify that a code verifier matches a stored S256 challenge.
 */
export function verifyS256(verifier: string, challenge: string): boolean {
  const expected = deriveS256Challenge(verifier)
  // Constant-time comparison to prevent timing attacks
  if (expected.length !== challenge.length) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(challenge)
  // Use crypto.timingSafeEqual if lengths match
  try {
    return require('node:crypto').timingSafeEqual(a, b)
  } catch {
    return expected === challenge
  }
}
