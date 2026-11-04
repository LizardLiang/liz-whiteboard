// src/lib/auth/login-flow.test.ts
// M6 (lockout race, per-IP limiter) and the auth-enumeration lows.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { DUMMY_PASSWORD_HASH, checkCredentials } from './login-flow'
import {
  LOGIN_IP_LIMIT_MAX,
  REGISTER_IP_LIMIT_MAX,
  _resetAuthLimitsForTests,
  checkLoginIpRateLimit,
  checkRegisterIpRateLimit,
} from './auth-limits'
import { hashPassword } from './password'
import * as passwordMod from './password'
import { db } from '@/db'
import { loginInputSchema, registerInputSchema } from '@/data/schema'
import { makeUser, resetDb } from '@/test/db-helpers'

const PASSWORD = 'correctPassword123'
let HASH = ''

beforeAll(async () => {
  HASH = await hashPassword(PASSWORD)
})
beforeEach(() => {
  resetDb()
  _resetAuthLimitsForTests()
})

function row(id: string) {
  return db
    .prepare('SELECT "failedLoginAttempts", "lockedUntil" FROM "User" WHERE "id" = ?')
    .get(id) as { failedLoginAttempts: number; lockedUntil: number | null }
}

describe('concurrent login burst (M6)', () => {
  it('20 parallel wrong passwords lock the account at the threshold and the rest are refused before bcrypt', async () => {
    const user = makeUser({ email: 'a@example.com', passwordHash: HASH })
    const spy = vi.spyOn(passwordMod, 'verifyPassword')

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        checkCredentials('a@example.com', 'wrong-password'),
      ),
    )

    expect(results.every((r) => !r.ok)).toBe(true)
    const reasons = results.map((r) => (r.ok ? 'ok' : r.reason))
    expect(reasons.filter((r) => r === 'bad_password')).toHaveLength(5)
    expect(reasons.filter((r) => r === 'locked')).toHaveLength(15)
    const r = row(user.id)
    expect(r.failedLoginAttempts).toBe(5)
    expect(r.lockedUntil).toBeGreaterThan(Date.now())

    // The correct password is refused while locked.
    expect(await checkCredentials('a@example.com', PASSWORD)).toMatchObject({
      ok: false,
      reason: 'locked',
    })
    spy.mockRestore()
  }, 60_000)
})

describe('unknown email and enumeration', () => {
  it('unknown email still runs a bcrypt verification against the dummy hash', async () => {
    const spy = vi.spyOn(passwordMod, 'verifyPassword')
    const res = await checkCredentials('nobody@example.com', 'whatever')
    expect(res).toEqual({ ok: false, reason: 'unknown' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('whatever', DUMMY_PASSWORD_HASH)
    spy.mockRestore()
  })

  it('the dummy hash is a valid bcrypt hash', () => {
    expect(DUMMY_PASSWORD_HASH).toMatch(/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/)
  })
})

describe('email case-insensitivity', () => {
  it('schemas lowercase and trim email', () => {
    expect(
      loginInputSchema.parse({ email: ' Alice@Example.COM ', password: 'x' }).email,
    ).toBe('alice@example.com')
    expect(
      registerInputSchema.parse({
        username: 'alice',
        email: 'Alice@Example.COM',
        password: 'Passw0rd!Long1',
      }).email,
    ).toBe('alice@example.com')
  })

  it('logs in against a mixed-case stored email', async () => {
    const user = makeUser({ email: 'Mixed@Example.com', passwordHash: HASH })
    expect(await checkCredentials('mixed@example.com', PASSWORD)).toEqual({
      ok: true,
      userId: user.id,
    })
  })

  it('failed attempts count against a mixed-case stored email', async () => {
    const user = makeUser({ email: 'Mixed@Example.com', passwordHash: HASH })
    await checkCredentials('mixed@example.com', 'nope')
    expect(row(user.id).failedLoginAttempts).toBe(1)
  })
})

describe('per-IP limiters (M6)', () => {
  it('login allows LOGIN_IP_LIMIT_MAX then refuses; other IPs unaffected', () => {
    for (let i = 0; i < LOGIN_IP_LIMIT_MAX; i++) {
      expect(checkLoginIpRateLimit('1.1.1.1')).toBe(true)
    }
    expect(checkLoginIpRateLimit('1.1.1.1')).toBe(false)
    expect(checkLoginIpRateLimit('2.2.2.2')).toBe(true)
  })

  it('register allows REGISTER_IP_LIMIT_MAX then refuses', () => {
    for (let i = 0; i < REGISTER_IP_LIMIT_MAX; i++) {
      expect(checkRegisterIpRateLimit('1.1.1.1')).toBe(true)
    }
    expect(checkRegisterIpRateLimit('1.1.1.1')).toBe(false)
  })
})
