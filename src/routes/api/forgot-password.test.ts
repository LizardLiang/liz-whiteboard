// src/routes/api/forgot-password.test.ts
// Integration tests for the forgot-password server functions (LizMeter
// #1283), mirroring src/routes/api/auth.test.ts's style: local handlers that
// exercise the SAME real data-layer/lib functions createServerFn's handlers
// use, since the createServerFn wrappers themselves need a server runtime
// context this test suite doesn't have. Only the TanStack Start server
// context (getRequest / setResponseHeader) is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { db, nowMs } from '@/db'
import { extractClientIp } from '@/lib/rate-limit'
import {
  _resetGlobalCapWarningForTests,
  _resetIpRateLimitForTests,
  canSendReset,
  checkResetIpRateLimit,
} from '@/lib/auth/reset-limits'
import { verifyTurnstile } from '@/lib/auth/turnstile'
import { findUserByEmail } from '@/data/user'
import {
  completePasswordReset,
  createResetToken,
  deleteResetTokensOlderThan,
  findValidResetToken,
} from '@/data/password-reset'
import { generateResetToken, hashResetToken } from '@/lib/auth/reset-token'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import { buildClearCookieHeader } from '@/lib/auth/cookies'
import { sendEmail } from '@/lib/email/resend'
import { makePasswordResetToken, makeUser, resetDb } from '@/test/db-helpers'

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: vi.fn(() => new Request('http://localhost/')),
  setResponseHeader: vi.fn(),
}))

vi.mock('@/lib/auth/turnstile', () => ({
  verifyTurnstile: vi.fn(),
}))

vi.mock('@/lib/email/resend', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

const GENERIC_SUCCESS = {
  success: true,
  message: 'If an account exists for that email, a reset link is on its way.',
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers mirroring src/routes/api/auth.ts's requestPasswordReset/
// resetPassword logic, using the REAL data layer.
// ─────────────────────────────────────────────────────────────────────────────

async function requestPasswordResetHandler(data: {
  email: string
  turnstileToken: string
}) {
  const request = (getRequest as any)()
  const ip = extractClientIp(request)

  if (!checkResetIpRateLimit(ip)) {
    return { success: false, error: 'RATE_LIMITED' }
  }

  const turnstileOk = await verifyTurnstile(data.turnstileToken, ip)
  if (!turnstileOk) {
    return { success: false, error: 'CAPTCHA_FAILED' }
  }

  await deleteResetTokensOlderThan(7 * 24 * 60 * 60 * 1000)

  const user = await findUserByEmail(data.email)
  if (user && (await canSendReset(user.id))) {
    const rawToken = generateResetToken()
    const tokenHash = hashResetToken(rawToken)
    await createResetToken(user.id, tokenHash)

    const baseUrl = process.env.APP_BASE_URL
    if (baseUrl) {
      const link = `${baseUrl.replace(/\/$/, '')}/reset-password?token=${rawToken}`
      void sendEmail({
        to: user.email,
        subject: 'Reset your password',
        text: `link: ${link}`,
        html: `<p>${link}</p>`,
      }).catch(() => {})
    }
  }

  return GENERIC_SUCCESS
}

async function resetPasswordHandler(data: {
  token: string
  password: string
}) {
  const tokenHash = hashResetToken(data.token)
  const resetToken = await findValidResetToken(tokenHash)
  if (!resetToken) {
    return { success: false, error: 'INVALID_TOKEN' }
  }

  const newPasswordHash = await hashPassword(data.password)
  completePasswordReset(resetToken.userId, newPasswordHash)
  ;(setResponseHeader as any)('Set-Cookie', buildClearCookieHeader())

  return { success: true, redirect: '/login?reset=success' }
}

beforeEach(() => {
  resetDb()
  vi.clearAllMocks()
  ;(getRequest as any).mockReturnValue(new Request('http://localhost/'))
  ;(verifyTurnstile as any).mockResolvedValue(true)
  _resetIpRateLimitForTests()
  _resetGlobalCapWarningForTests()
  process.env.APP_BASE_URL = 'https://example.test'
})

afterEach(() => {
  delete process.env.APP_BASE_URL
})

describe('requestPasswordReset', () => {
  it('returns the identical body for a known email and an unknown email', async () => {
    makeUser({ email: 'alice@example.com' })

    const knownResult = await requestPasswordResetHandler({
      email: 'alice@example.com',
      turnstileToken: 'tok',
    })
    const unknownResult = await requestPasswordResetHandler({
      email: 'nobody@example.com',
      turnstileToken: 'tok',
    })

    expect(knownResult).toEqual(GENERIC_SUCCESS)
    expect(unknownResult).toEqual(GENERIC_SUCCESS)
  })

  it('returns the identical body when the request is skipped by the per-user cooldown', async () => {
    const user = makeUser({ email: 'alice@example.com' })
    makePasswordResetToken({ userId: user.id, createdAt: nowMs() - 1_000 })

    const result = await requestPasswordResetHandler({
      email: 'alice@example.com',
      turnstileToken: 'tok',
    })

    expect(result).toEqual(GENERIC_SUCCESS)
    // No second email fired — the cooldown skipped it.
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('sends the email only for a known, eligible email', async () => {
    makeUser({ email: 'alice@example.com' })

    await requestPasswordResetHandler({
      email: 'alice@example.com',
      turnstileToken: 'tok',
    })
    await requestPasswordResetHandler({
      email: 'nobody@example.com',
      turnstileToken: 'tok',
    })

    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect((sendEmail as any).mock.calls[0][0].to).toBe('alice@example.com')
  })

  it('returns RATE_LIMITED once the per-IP limit is exceeded, without calling Turnstile', async () => {
    for (let i = 0; i < 5; i++) {
      await requestPasswordResetHandler({
        email: 'alice@example.com',
        turnstileToken: 'tok',
      })
    }
    vi.clearAllMocks()

    const result = await requestPasswordResetHandler({
      email: 'alice@example.com',
      turnstileToken: 'tok',
    })

    expect(result).toEqual({ success: false, error: 'RATE_LIMITED' })
    expect(verifyTurnstile).not.toHaveBeenCalled()
  })

  it('returns CAPTCHA_FAILED when Turnstile verification fails', async () => {
    ;(verifyTurnstile as any).mockResolvedValue(false)

    const result = await requestPasswordResetHandler({
      email: 'alice@example.com',
      turnstileToken: 'bad-tok',
    })

    expect(result).toEqual({ success: false, error: 'CAPTCHA_FAILED' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('resetPassword', () => {
  it('rejects an unknown/invalid token', async () => {
    const result = await resetPasswordHandler({
      token: 'not-a-real-token',
      password: 'newPassword123',
    })

    expect(result).toEqual({ success: false, error: 'INVALID_TOKEN' })
    expect(setResponseHeader).not.toHaveBeenCalled()
  })

  it('changes the password, clears the session cookie, and returns the login redirect for a valid token', async () => {
    const user = makeUser({ passwordHash: await hashPassword('oldPassword123') })
    const rawToken = generateResetToken()
    await createResetToken(user.id, hashResetToken(rawToken))

    const result = await resetPasswordHandler({
      token: rawToken,
      password: 'newPassword123',
    })

    expect(result).toEqual({ success: true, redirect: '/login?reset=success' })
    expect(setResponseHeader).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining('Max-Age=0'),
    )

    const updated = db
      .prepare('SELECT "passwordHash" FROM "User" WHERE "id" = ?')
      .get(user.id) as { passwordHash: string }
    await expect(
      verifyPassword('newPassword123', updated.passwordHash),
    ).resolves.toBe(true)
  })

  it('a used token cannot be replayed', async () => {
    const user = makeUser()
    const rawToken = generateResetToken()
    await createResetToken(user.id, hashResetToken(rawToken))

    const first = await resetPasswordHandler({
      token: rawToken,
      password: 'firstPassword123',
    })
    expect(first.success).toBe(true)

    const second = await resetPasswordHandler({
      token: rawToken,
      password: 'secondPassword123',
    })
    expect(second).toEqual({ success: false, error: 'INVALID_TOKEN' })
  })
})
