// src/lib/auth/signup-token.ts
// Email-link signup token generation and hashing. Same scheme as
// src/lib/auth/reset-token.ts: 32 random bytes as hex, only the SHA-256 hash
// is stored.

import { createHash, randomBytes } from 'node:crypto'

/** A signup link is valid for 24 hours from issuance. */
export const SIGNUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** Generate a signup token. Uses randomBytes, not crypto.randomUUID(). */
export function generateSignupToken(): string {
  return randomBytes(32).toString('hex')
}

/** SHA-256 hex digest of a raw signup token. */
export function hashSignupToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
