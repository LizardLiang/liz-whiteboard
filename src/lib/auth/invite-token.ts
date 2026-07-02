// src/lib/auth/invite-token.ts
// Invite token generation and hashing.
//
// Mirrors the existing precedent exactly — src/lib/auth/session.ts's
// generateSessionToken/hashToken and src/lib/oauth/tokens.ts's locally-scoped
// hashToken helper both use this same random-then-hash shape (32-byte
// crypto.randomBytes -> hex; SHA-256 hash of the raw token, stored, never the
// raw token itself).
//
// Kept as a separate module (not a re-export of session.ts's functions) so
// invite tokens are namespaced independently from session tokens, matching
// the existing pattern where OAuth refresh tokens also define their own
// local hash helper rather than importing session.ts's.

import { createHash, randomBytes } from 'node:crypto'

/**
 * Generate a secure invite token.
 * Uses Node's crypto.randomBytes (no secure context required — works over
 * HTTP). Never uses crypto.randomUUID().
 *
 * @returns 64-character hex string (32 bytes)
 */
export function generateInviteToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Hash an invite token with SHA-256.
 * The raw token is returned to the client once at creation time; only the
 * hash is ever persisted.
 *
 * @param token - Raw invite token
 * @returns SHA-256 hex digest (64 chars)
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
