// src/lib/auth/reset-limits.test.ts
// Unit tests for the forgot-password abuse limits:
// per-IP fixed window, per-user cooldown, per-user daily cap, global daily
// cap. Runs against the in-memory SQLite database (vitest.config sets
// DATABASE_URL=:memory:) since canSendReset reads real PasswordResetToken rows.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { nowMs } from '@/db'
import {
  RESET_COOLDOWN_MS,
  RESET_GLOBAL_DAILY_MAX,
  RESET_IP_LIMIT_MAX,
  RESET_PER_USER_DAILY_MAX,
  _resetGlobalCapWarningForTests,
  _resetIpRateLimitForTests,
  canSendReset,
  checkResetIpRateLimit,
} from '@/lib/auth/reset-limits'
import { makePasswordResetToken, makeUser, resetDb } from '@/test/db-helpers'

beforeEach(() => {
  resetDb()
  _resetIpRateLimitForTests()
  _resetGlobalCapWarningForTests()
})

describe('checkResetIpRateLimit', () => {
  it('allows up to the configured max requests from one IP', () => {
    for (let i = 0; i < RESET_IP_LIMIT_MAX; i++) {
      expect(checkResetIpRateLimit('203.0.113.9')).toBe(true)
    }
  })

  it('blocks the request after the max is exceeded', () => {
    for (let i = 0; i < RESET_IP_LIMIT_MAX; i++) {
      checkResetIpRateLimit('203.0.113.9')
    }
    expect(checkResetIpRateLimit('203.0.113.9')).toBe(false)
  })

  it('tracks each IP independently', () => {
    for (let i = 0; i < RESET_IP_LIMIT_MAX; i++) {
      checkResetIpRateLimit('203.0.113.9')
    }
    expect(checkResetIpRateLimit('203.0.113.9')).toBe(false)
    expect(checkResetIpRateLimit('198.51.100.7')).toBe(true)
  })
})

describe('canSendReset', () => {
  it('allows a user with no prior reset rows', async () => {
    const user = makeUser()
    expect(await canSendReset(user.id)).toBe(true)
  })

  it('blocks within the cooldown window (1 per 2 min)', async () => {
    const user = makeUser()
    makePasswordResetToken({ userId: user.id, createdAt: nowMs() - 1_000 })

    expect(await canSendReset(user.id)).toBe(false)
  })

  it('allows again once the cooldown window has passed', async () => {
    const user = makeUser()
    makePasswordResetToken({
      userId: user.id,
      createdAt: nowMs() - (RESET_COOLDOWN_MS + 1_000),
    })

    expect(await canSendReset(user.id)).toBe(true)
  })

  it('blocks at the per-user daily cap (5 / 24h)', async () => {
    const user = makeUser()
    const now = nowMs()
    // All well outside the 2-minute cooldown but inside the 24h window.
    for (let i = 0; i < RESET_PER_USER_DAILY_MAX; i++) {
      makePasswordResetToken({
        userId: user.id,
        createdAt: now - RESET_COOLDOWN_MS - 1_000 - i * 3_600_000,
      })
    }

    expect(await canSendReset(user.id)).toBe(false)
  })

  it('allows a different user even when one user is at their daily cap', async () => {
    const capped = makeUser()
    const other = makeUser()
    const now = nowMs()
    for (let i = 0; i < RESET_PER_USER_DAILY_MAX; i++) {
      makePasswordResetToken({
        userId: capped.id,
        createdAt: now - RESET_COOLDOWN_MS - 1_000 - i * 3_600_000,
      })
    }

    expect(await canSendReset(capped.id)).toBe(false)
    expect(await canSendReset(other.id)).toBe(true)
  })

  it('blocks every user once the global daily cap is reached, and warns once', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = nowMs()

    // GRESET_GLOBAL_DAILY_MAX rows spread across many users, all outside
    // their own cooldown/daily-cap windows.
    for (let i = 0; i < RESET_GLOBAL_DAILY_MAX; i++) {
      const u = makeUser()
      makePasswordResetToken({ userId: u.id, createdAt: now - 3_600_000 })
    }

    const freshUser = makeUser()
    expect(await canSendReset(freshUser.id)).toBe(false)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // A second blocked call does not warn again.
    const anotherUser = makeUser()
    expect(await canSendReset(anotherUser.id)).toBe(false)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
  })
})
