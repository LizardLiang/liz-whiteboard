// src/lib/auth/reset-token.ts
// Forgot-password reset token generation and hashing.
// Mirrors src/lib/auth/invite-token.ts exactly — 32-byte crypto.randomBytes
// -> hex, SHA-256 hash of the raw token stored, never the raw token itself.
// Kept as its own module (not a re-export of invite-token.ts) for the same
// reason invite tokens are namespaced separately from session tokens: reset
// tokens are a distinct credential with their own TTL and their own table.

import { createHash, randomBytes } from 'node:crypto'

/** A reset link is valid for 30 minutes from issuance. */
export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000

/**
 * Generate a secure password-reset token.
 * Uses Node's crypto.randomBytes (no secure context required — works over
 * HTTP). Never uses crypto.randomUUID().
 *
 * @returns 64-character hex string (32 bytes)
 */
export function generateResetToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Hash a reset token with SHA-256.
 * The raw token is emailed to the user once, at issuance; only the hash is
 * ever persisted.
 *
 * @param token - Raw reset token
 * @returns SHA-256 hex digest (64 chars)
 */
export function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
