// src/lib/auth/password.test.ts
// Unit tests for password hashing functions (TC-P2-01 through TC-P2-03)

import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  // TC-P2-01: hashPassword produces non-plaintext output
  describe('TC-P2-01: hashPassword', () => {
    it('produces a non-plaintext string', async () => {
      const hash = await hashPassword('testPassword1!')

      expect(typeof hash).toBe('string')
      expect(hash).not.toBe('testPassword1!')
    }, 30000)

    it('produces a bcrypt hash (starts with $2)', async () => {
      const hash = await hashPassword('testPassword1!')

      expect(hash).toMatch(/^\$2[aby]\$/)
    }, 30000)

    it('produces different hashes for the same password (salted)', async () => {
      const hash1 = await hashPassword('samePassword')
      const hash2 = await hashPassword('samePassword')

      expect(hash1).not.toBe(hash2)
    }, 30000)
  })

  // TC-P2-02: verifyPassword returns true for correct, false for wrong
  describe('TC-P2-02: verifyPassword', () => {
    it('returns true for correct password', async () => {
      const hash = await hashPassword('correctPassword')

      expect(await verifyPassword('correctPassword', hash)).toBe(true)
    }, 30000)

    it('returns false for wrong password', async () => {
      const hash = await hashPassword('correctPassword')

      expect(await verifyPassword('wrongPassword', hash)).toBe(false)
    }, 30000)

    it('returns false for empty string', async () => {
      const hash = await hashPassword('correctPassword')

      expect(await verifyPassword('', hash)).toBe(false)
    }, 30000)
  })

  // TC-P2-03: SHA-256 pre-hash handles long passwords
  describe('TC-P2-03: SHA-256 pre-hash differentiates long passwords', () => {
    it('produces different hashes for passwords differing at char 73', async () => {
      // Without SHA-256 pre-hashing, bcrypt would truncate at 72 bytes
      // and both passwords would hash to the same value
      const base = 'a'.repeat(72)
      const pwd128char = base + 'B' + 'x'.repeat(55) // 128 chars total
      const pwd73char = base + 'Z' // 73 chars total

      const hash128 = await hashPassword(pwd128char)
      const hash73 = await hashPassword(pwd73char)

      expect(hash128).not.toBe(hash73)
    }, 30000)

    it('verifies 128-char password correctly', async () => {
      const pwd = 'a'.repeat(128)
      const hash = await hashPassword(pwd)

      expect(await verifyPassword(pwd, hash)).toBe(true)
    }, 30000)

    it('rejects wrong password for 128-char hash', async () => {
      const pwd128 = 'a'.repeat(128)
      const pwd73 = 'a'.repeat(73)

      const hash128 = await hashPassword(pwd128)

      expect(await verifyPassword(pwd73, hash128)).toBe(false)
    }, 30000)
  })
})
