// src/lib/auth/rate-limit.test.ts
// Per-email login failure counter (Turnstile challenge trigger).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LOGIN_CHALLENGE_THRESHOLD,
  LOGIN_FAILURE_MAX_KEYS,
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

describe('bounded counter never evicts a live entry', () => {
  function fill(n: number) {
    for (let i = 0; i < n; i++) recordLoginFailure(`bot-${i}@x.test`)
  }

  it('10,000+ other emails cannot remove a victim count', () => {
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD; i++) {
      recordLoginFailure('victim@example.com')
    }
    fill(LOGIN_FAILURE_MAX_KEYS + 500)
    expect(isLoginChallengeRequired('victim@example.com')).toBe(true)
  })

  it('with the map full, an untracked email requires the challenge', () => {
    fill(LOGIN_FAILURE_MAX_KEYS)
    expect(isLoginChallengeRequired('new-person@example.com')).toBe(true)
    recordLoginFailure('new-person@example.com')
    expect(isLoginChallengeRequired('new-person@example.com')).toBe(true)
  })

  it('a tracked email keeps counting normally while the map is full', () => {
    recordLoginFailure('known@example.com')
    fill(LOGIN_FAILURE_MAX_KEYS)
    expect(isLoginChallengeRequired('known@example.com')).toBe(false)
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD; i++) {
      recordLoginFailure('known@example.com')
    }
    expect(isLoginChallengeRequired('known@example.com')).toBe(true)
  })

  it('expiry frees space and the challenge lifts after the window', () => {
    vi.useFakeTimers()
    fill(LOGIN_FAILURE_MAX_KEYS)
    expect(isLoginChallengeRequired('new-person@example.com')).toBe(true)
    vi.advanceTimersByTime(LOGIN_FAILURE_WINDOW_MS + 1)
    expect(isLoginChallengeRequired('new-person@example.com')).toBe(false)
    recordLoginFailure('new-person@example.com')
    expect(isLoginChallengeRequired('new-person@example.com')).toBe(false)
  })

  it('success clears the count and frees its slot', () => {
    fill(LOGIN_FAILURE_MAX_KEYS - 1)
    for (let i = 0; i < LOGIN_CHALLENGE_THRESHOLD; i++) {
      recordLoginFailure('victim@example.com')
    }
    clearLoginFailures('victim@example.com')
    expect(isLoginChallengeRequired('victim@example.com')).toBe(false)
  })
})
