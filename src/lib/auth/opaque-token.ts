// src/lib/auth/opaque-token.ts
// The one opaque-token scheme for sessions, password-reset links, signup links
// and invite links: 32 random bytes as hex, and only the SHA-256 hash is
// stored, never the raw token. Each credential keeps its own TTL and table.

import { createHash, randomBytes } from 'node:crypto'

/**
 * Generate a secure opaque token. Uses Node's crypto.randomBytes (no secure
 * context required, so it works over HTTP). Never uses crypto.randomUUID().
 *
 * @returns 64-character hex string (32 bytes)
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Hash a raw token with SHA-256. The raw token goes to the user once (cookie,
 * email or link); only the hash is persisted.
 *
 * @returns SHA-256 hex digest (64 chars)
 */
export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
