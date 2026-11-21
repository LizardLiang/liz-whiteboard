// src/lib/auth/rate-limit.test.ts
// Per-email login failure counter (Turnstile challenge trigger).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOGIN_CHALLENGE_THRESHOLD,
  LOGIN_FAILURE_WINDOW_MS,
  _resetLoginFailuresForTests,
  clearLoginFailures,
  isLoginChallengeRequired,
  recordLoginFailure,
} from './rate-limit'

beforeEach(() => _resetLoginFailuresForTests())
afterEach(() => vi.useRealTimers())

describe('login failure counter', () => {
  it('requires a challenge only at the threshold', () => {
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD - 1; i++) {
      recordLoginFailure('a@example.com')
    }
    expect(isLoginChallengeRequired('a@example.com')).toBe(false)
    recordLoginFailure('a@example.com')
    expect(isLoginChallengeRequired('a@example.com')).toBe(true)
  })

  it('counts an email that has no account exactly like any other', () => {
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD; i++) {
      recordLoginFailure('ghost@example.com')
    }
    expect(isLoginChallengeRequired('ghost@example.com')).toBe(true)
  })

  it('keys by trimmed, lower-cased email', () => {
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD; i++) {
      recordLoginFailure(' Alice@Example.COM ')
    }
    expect(isLoginChallengeRequired('alice@example.com')).toBe(true)
    expect(isLoginChallengeRequired('bob@example.com')).toBe(false)
  })

  it('clearLoginFailures resets the counter', () => {
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD; i++) {
      recordLoginFailure('a@example.com')
    }
    clearLoginFailures('a@example.com')
    expect(isLoginChallengeRequired('a@example.com')).toBe(false)
  })

  it('the challenge ends when the window ends', () => {
    vi.useFakeTimers()
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD; i++) {
      recordLoginFailure('a@example.com')
    }
    vi.advanceTimersByTime(LOGIN_FAILURE_WINDOW_MS + 1)
    expect(isLoginChallengeRequired('a@example.com')).toBe(false)
  })
})
