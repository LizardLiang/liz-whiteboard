// src/data/signup-token.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SIGNUP_TOKEN_CLEANUP_AGE_MS,
  clearExpiredSignupRedirects,
  completeSignup,
  deleteSignupTokensOlderThan,
  findLatestSignupTokenForEmail,
  getSignupTokenState,
  tryCreateSignupToken,
} from './signup-token'
import { db } from '@/db'
import { hashOpaqueToken } from '@/lib/auth/opaque-token'
import { makeUser, resetDb } from '@/test/db-helpers'

const create = (
  over: Partial<Parameters<typeof tryCreateSignupToken>[0]> = {},
) =>
  tryCreateSignupToken({
    email: 'new@example.com',
    username: 'newbie',
    redirectTo: null,
    tokenHash: hashOpaqueToken(Math.random().toString()),
    voided: false,
    ...over,
  })

const age = (email: string, ms: number) =>
  db
    .prepare(
      'UPDATE "SignupToken" SET "createdAt" = "createdAt" - ?, "expiresAt" = "expiresAt" - ? WHERE "email" = ?',
    )
    .run(ms, ms, email)

const userCount = () =>
  Number(
    (db.prepare('SELECT count(*) AS c FROM "User"').get() as { c: number }).c,
  )

beforeEach(() => resetDb())

describe('tryCreateSignupToken', () => {
  it('stores a hashed, 24h, unused row', () => {
    const row = create({ tokenHash: 'h1' })
    expect(row).not.toBeNull()
    expect(row!.tokenHash).toBe('h1')
    expect(row!.usedAt).toBeNull()
    const ttl = row!.expiresAt.getTime() - row!.createdAt.getTime()
    expect(ttl).toBe(24 * 60 * 60 * 1000)
  })

  it('refuses a second send inside the cooldown', () => {
    expect(create()).not.toBeNull()
    expect(create()).toBeNull()
  })

  it('a second request leaves the first link usable', () => {
    create({ tokenHash: 'old', username: 'first', redirectTo: '/invite/a' })
    age('new@example.com', 3 * 60_000)
    create({ tokenHash: 'fresh', username: 'second', redirectTo: null })
    expect(getSignupTokenState('old').state).toBe('valid')
    expect(getSignupTokenState('fresh').state).toBe('valid')
    expect(getSignupTokenState('old').token).toMatchObject({
      username: 'first',
      redirectTo: '/invite/a',
    })
  })

  it('completing through one link voids the other unused links', () => {
    create({ tokenHash: 'old' })
    age('new@example.com', 3 * 60_000)
    create({ tokenHash: 'fresh' })
    const done = completeSignup({
      tokenHash: 'fresh',
      username: 'newbie',
      passwordHash: 'h',
    })
    expect(done.ok).toBe(true)
    expect(getSignupTokenState('old').state).toBe('used')
    expect(
      completeSignup({ tokenHash: 'old', username: 'zed', passwordHash: 'h' }),
    ).toEqual({ ok: false, reason: 'invalid' })
  })

  it('stores an attempt for an existing account already voided', () => {
    const row = create({ tokenHash: 'v', voided: true })
    expect(row!.usedAt).not.toBeNull()
    expect(getSignupTokenState('v').state).toBe('used')
  })

  it('stops at the per-email daily cap', () => {
    for (let i = 0; i < 5; i++) {
      expect(create({ tokenHash: `t${i}` })).not.toBeNull()
      age('new@example.com', 3 * 60_000)
    }
    expect(create({ tokenHash: 't5' })).toBeNull()
  })

  it('findLatestSignupTokenForEmail returns the newest row', () => {
    create({ tokenHash: 'a', username: 'first' })
    age('new@example.com', 3 * 60_000)
    create({ tokenHash: 'b', username: 'second' })
    expect(findLatestSignupTokenForEmail('new@example.com')!.username).toBe(
      'second',
    )
  })
})

describe('getSignupTokenState', () => {
  it('reports invalid and expired', () => {
    expect(getSignupTokenState('nope').state).toBe('invalid')
    create({ tokenHash: 'e' })
    db.prepare('UPDATE "SignupToken" SET "expiresAt" = 1').run()
    expect(getSignupTokenState('e').state).toBe('expired')
  })
})

describe('completeSignup', () => {
  it('creates the user, voids the token, and returns the return path', () => {
    create({ tokenHash: 'ok', redirectTo: '/invite/abc' })
    const result = completeSignup({
      tokenHash: 'ok',
      username: 'newbie',
      passwordHash: 'hash',
    })
    expect(result).toMatchObject({ ok: true, redirectTo: '/invite/abc' })
    expect(userCount()).toBe(1)
    expect(getSignupTokenState('ok').state).toBe('used')
  })

  it('is single-use', () => {
    create({ tokenHash: 'once' })
    completeSignup({ tokenHash: 'once', username: 'newbie', passwordHash: 'h' })
    const again = completeSignup({
      tokenHash: 'once',
      username: 'other',
      passwordHash: 'h',
    })
    expect(again).toEqual({ ok: false, reason: 'invalid' })
    expect(userCount()).toBe(1)
  })

  it('re-checks the username and leaves the token usable', () => {
    makeUser({ username: 'taken', email: 'someone@example.com' })
    create({ tokenHash: 'u' })
    const result = completeSignup({
      tokenHash: 'u',
      username: 'taken',
      passwordHash: 'h',
    })
    expect(result).toEqual({ ok: false, reason: 'username_taken' })
    expect(getSignupTokenState('u').state).toBe('valid')
    const retry = completeSignup({
      tokenHash: 'u',
      username: 'free_name',
      passwordHash: 'h',
    })
    expect(retry.ok).toBe(true)
  })

  it('refuses an expired token', () => {
    create({ tokenHash: 'x' })
    db.prepare('UPDATE "SignupToken" SET "expiresAt" = 1').run()
    expect(
      completeSignup({ tokenHash: 'x', username: 'newbie', passwordHash: 'h' }),
    ).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses when the email got an account meanwhile', () => {
    create({ tokenHash: 'm' })
    makeUser({ username: 'other', email: 'new@example.com' })
    expect(
      completeSignup({ tokenHash: 'm', username: 'newbie', passwordHash: 'h' }),
    ).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('deleteSignupTokensOlderThan', () => {
  it('removes rows older than the cleanup age and keeps newer ones', () => {
    create({ email: 'old@example.com', tokenHash: 'o' })
    age('old@example.com', SIGNUP_TOKEN_CLEANUP_AGE_MS + 1000)
    create({ email: 'young@example.com', tokenHash: 'y' })
    expect(deleteSignupTokensOlderThan(SIGNUP_TOKEN_CLEANUP_AGE_MS)).toBe(1)
    expect(getSignupTokenState('o').state).toBe('invalid')
    expect(getSignupTokenState('y').state).toBe('valid')
  })
})

describe('the return path holds a raw invite token, so it is short-lived', () => {
  const redirectOf = (hash: string) =>
    (
      db
        .prepare('SELECT "redirectTo" AS r FROM "SignupToken" WHERE "tokenHash" = ?')
        .get(hash) as { r: string | null }
    ).r

  it('a voided row (existing account) stores no return path', () => {
    create({ tokenHash: 'v', redirectTo: '/invite/raw', voided: true })
    expect(redirectOf('v')).toBeNull()
  })

  it('completing the signup wipes the return path from the email rows', () => {
    create({ tokenHash: 'c1', redirectTo: '/invite/raw' })
    completeSignup({ tokenHash: 'c1', username: 'newbie', passwordHash: 'h' })
    expect(redirectOf('c1')).toBeNull()
  })

  it('the sweep wipes the return path of an expired link and keeps a live one', () => {
    create({ tokenHash: 'dead', redirectTo: '/invite/raw' })
    db.prepare('UPDATE "SignupToken" SET "expiresAt" = 1').run()
    create({ email: 'other@example.com', tokenHash: 'live', redirectTo: '/invite/raw2' })
    expect(clearExpiredSignupRedirects()).toBe(1)
    expect(redirectOf('dead')).toBeNull()
    expect(redirectOf('live')).toBe('/invite/raw2')
  })
})
