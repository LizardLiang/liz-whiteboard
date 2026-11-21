// src/lib/auth/login-flow.test.ts
// Login Turnstile challenge (replaces the lockout), per-IP limiter and the auth-enumeration lows.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DUMMY_PASSWORD_HASH,
  checkCredentials,
  failureNeedsChallenge,
} from './login-flow'
import {
  LOGIN_IP_LIMIT_MAX,
  REGISTER_IP_LIMIT_MAX,
  _resetAuthLimitsForTests,
  checkLoginIpRateLimit,
  checkRegisterIpRateLimit,
} from './auth-limits'
import { hashPassword } from './password'
import * as passwordMod from './password'
import { _resetLoginFailuresForTests } from './rate-limit'
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
  _resetLoginFailuresForTests()
})

vi.mock('./turnstile', () => ({
  verifyTurnstile: vi.fn((token: string | null | undefined) => Promise.resolve(token === 'good-token')),
}))

const CHALLENGE = { turnstileToken: undefined, ip: '1.1.1.1' }
const PASS = { turnstileToken: 'good-token', ip: '1.1.1.1' }

async function failTimes(email: string, n: number) {
  for (let i = 0; i < n; i++) {
    await checkCredentials(email, 'wrong-password', CHALLENGE)
  }
}

describe('login challenge instead of lockout', () => {
  it('after 5 wrong passwords a registered email requires the challenge, and the correct password without a token is refused', async () => {
    makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 5)
    expect(
      await checkCredentials('a@example.com', PASSWORD, CHALLENGE),
    ).toEqual({ ok: false, reason: 'challenge' })
  })

  it('an unknown email gets the identical challenge after 5 failures', async () => {
    await failTimes('ghost@example.com', 5)
    expect(
      await checkCredentials('ghost@example.com', 'x', CHALLENGE),
    ).toEqual({ ok: false, reason: 'challenge' })
  })

  it('no challenge before the 5th failure', async () => {
    makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 4)
    expect(
      (await checkCredentials('a@example.com', 'wrong', CHALLENGE)).ok,
    ).toBe(false)
    const res = await checkCredentials('a@example.com', 'wrong', CHALLENGE)
    expect(res).toEqual({ ok: false, reason: 'challenge' })
  })

  it('a bad token is refused before the password is checked', async () => {
    makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 5)
    const spy = vi.spyOn(passwordMod, 'verifyPassword')
    const res = await checkCredentials('a@example.com', PASSWORD, {
      turnstileToken: 'bad-token',
      ip: '1.1.1.1',
    })
    expect(res).toEqual({ ok: false, reason: 'challenge' })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('the correct password with a valid token logs in and resets the counter', async () => {
    const user = makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 5)
    expect(await checkCredentials('a@example.com', PASSWORD, PASS)).toEqual({
      ok: true,
      userId: user.id,
    })
    // Counter reset: no token needed any more.
    expect(await checkCredentials('a@example.com', PASSWORD, CHALLENGE)).toEqual({
      ok: true,
      userId: user.id,
    })
  })

  it('a wrong password with a valid token is a normal failure', async () => {
    makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 5)
    const res = await checkCredentials('a@example.com', 'nope', PASS)
    expect(res).toEqual({
      ok: false,
      reason: 'bad_password',
      challengePassed: true,
    })
  })

  it('W4: a valid token with a wrong password, or an unknown email, answers AUTH_FAILED; a missing or bad token answers CHALLENGE_REQUIRED', async () => {
    makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 5)
    await failTimes('ghost@example.com', 5)
    for (const email of ['a@example.com', 'ghost@example.com']) {
      const wrong = await checkCredentials(email, 'nope', PASS)
      if (wrong.ok) throw new Error('unexpected success')
      expect(failureNeedsChallenge(wrong, email)).toBe(false)
      for (const token of [undefined, 'bad-token']) {
        const refused = await checkCredentials(email, 'nope', {
          turnstileToken: token,
          ip: '1.1.1.1',
        })
        if (refused.ok) throw new Error('unexpected success')
        expect(failureNeedsChallenge(refused, email)).toBe(true)
      }
    }
  })

  it('W4: the failure that reaches the threshold still answers CHALLENGE_REQUIRED', async () => {
    makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 4)
    const fifth = await checkCredentials('a@example.com', 'wrong', CHALLENGE)
    if (fifth.ok) throw new Error('unexpected success')
    expect(failureNeedsChallenge(fifth, 'a@example.com')).toBe(true)
  })

  it('20 parallel wrong passwords: 5 reach bcrypt, the rest are refused at the challenge', async () => {
    makeUser({ email: 'a@example.com', passwordHash: HASH })
    const spy = vi.spyOn(passwordMod, 'verifyPassword')
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        checkCredentials('a@example.com', 'wrong-password', CHALLENGE),
      ),
    )
    const reasons = results.map((r) => (r.ok ? 'ok' : r.reason))
    expect(reasons.filter((r) => r === 'bad_password')).toHaveLength(5)
    expect(reasons.filter((r) => r === 'challenge')).toHaveLength(15)
    expect(spy).toHaveBeenCalledTimes(5)
    spy.mockRestore()
  }, 60_000)

  it('writes nothing to the User row (no lock)', async () => {
    const user = makeUser({ email: 'a@example.com', passwordHash: HASH })
    await failTimes('a@example.com', 6)
    const r = db
      .prepare('SELECT "failedLoginAttempts", "lockedUntil" FROM "User" WHERE "id" = ?')
      .get(user.id) as { failedLoginAttempts: number; lockedUntil: number | null }
    expect(r.failedLoginAttempts).toBe(0)
    expect(r.lockedUntil).toBeNull()
  })
})

describe('unknown email and enumeration', () => {
  it('unknown email still runs a bcrypt verification against the dummy hash', async () => {
    const spy = vi.spyOn(passwordMod, 'verifyPassword')
    const res = await checkCredentials('nobody@example.com', 'whatever', CHALLENGE)
    expect(res).toEqual({
      ok: false,
      reason: 'unknown',
      challengePassed: false,
    })
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

  it('failed attempts count across email casing', async () => {
    makeUser({ email: 'Mixed@Example.com', passwordHash: HASH })
    await failTimes('mixed@example.com', 3)
    await failTimes('MIXED@example.com', 2)
    expect(
      await checkCredentials('Mixed@Example.com', PASSWORD, CHALLENGE),
    ).toEqual({ ok: false, reason: 'challenge' })
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
