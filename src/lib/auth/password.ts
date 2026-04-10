// src/lib/auth/password.ts
// Password hashing using bcryptjs with SHA-256 pre-hash

import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'

const BCRYPT_ROUNDS = 12

/**
 * Pre-hash with SHA-256 to avoid bcrypt's 72-byte truncation,
 * then hash with bcrypt at cost factor 12.
 *
 * This is the standard mitigation used for passwords longer than 72 bytes
 * (see: Dropbox password security). SHA-256 maps any-length passwords into
 * a fixed 64-hex-char string that bcrypt can handle without truncation.
 *
 * @param password - Plain-text password
 * @returns bcrypt hash string
 */
export async function hashPassword(password: string): Promise<string> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.hash(sha256, BCRYPT_ROUNDS)
}

/**
 * Verify a plain-text password against a stored bcrypt hash.
 *
 * @param password - Plain-text password to verify
 * @param hash - Stored bcrypt hash
 * @returns true if password matches, false otherwise
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  const sha256 = createHash('sha256').update(password).digest('hex')
  return bcrypt.compare(sha256, hash)
}
