// src/data/user.test.ts
// Integration tests for user data-access functions (TC-P1-05).
// Runs against an in-memory SQLite DB (vitest.config sets DATABASE_URL=:memory:).

import { beforeEach, describe, expect, it } from 'vitest'

import { createUser, findUserByEmail, findUserById } from './user'
import { db } from '@/db'
import { makeUser, resetDb } from '@/test/db-helpers'

describe('user data-access', () => {
  beforeEach(() => resetDb())

  describe('TC-P1-05: createUser', () => {
    it('persists a user with the given fields and returns the mapped row', async () => {
      const result = await createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$12$hashedpassword',
      })

      // Returned value reflects the inserted row.
      expect(result.id).toEqual(expect.any(String))
      expect(result.username).toBe('alice')
      expect(result.email).toBe('alice@example.com')
      expect(result.passwordHash).toBe('$2b$12$hashedpassword')
      expect(result.failedLoginAttempts).toBe(0)
      expect(result.lockedUntil).toBeNull()
      // Mappers return real types: dates are Date instances.
      expect(result.createdAt).toBeInstanceOf(Date)
      expect(result.updatedAt).toBeInstanceOf(Date)

      // Read back via raw db to confirm it was actually written.
      const row = db
        .prepare('SELECT * FROM "User" WHERE "id" = ?')
        .get(result.id) as Record<string, unknown>
      expect(row.username).toBe('alice')
      expect(row.email).toBe('alice@example.com')
      expect(row.passwordHash).toBe('$2b$12$hashedpassword')
    })
  })

  describe('TC-P1-05: findUserByEmail', () => {
    it('returns the user when one exists with that email', async () => {
      await createUser({
        username: 'alice',
        email: 'alice@example.com',
        passwordHash: '$2b$12$hashedpassword',
      })

      const result = await findUserByEmail('alice@example.com')

      expect(result).not.toBeNull()
      expect(result?.email).toBe('alice@example.com')
      expect(result?.username).toBe('alice')
    })

    it('returns null when no user has that email', async () => {
      const result = await findUserByEmail('notfound@example.com')

      expect(result).toBeNull()
    })
  })

  describe('TC-P1-05: findUserById', () => {
    it('returns the user when one exists with that ID', async () => {
      const user = makeUser({
        username: 'bob',
        email: 'bob@example.com',
      })

      const result = await findUserById(user.id)

      expect(result).not.toBeNull()
      expect(result?.id).toBe(user.id)
      expect(result?.username).toBe('bob')
      expect(result?.email).toBe('bob@example.com')
    })

    it('returns null when no user has that ID', async () => {
      const result = await findUserById('00000000-0000-0000-0000-000000000000')

      expect(result).toBeNull()
    })
  })
})
