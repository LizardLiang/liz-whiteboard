// src/lib/auth/log-sample.test.ts
// Suite 2 — Unit: logSampledError dedup (Phase 1.3)
// TC-LOG-01 through TC-LOG-04

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We need to reset the internal Map between tests. The easiest way is to re-import
// after faking timers, or to just use fake timers to advance the window.
// The module uses a module-level Map; vi.resetModules + dynamic import give us fresh state.

describe('logSampledError', () => {
  let logSampledError: (args: {
    userId: string
    errorClass: string
    message: string
    eventName?: string
  }) => void

  beforeEach(async () => {
    vi.useFakeTimers()
    // Reset module so the internal Map starts empty for each test
    vi.resetModules()
    const mod = await import('./log-sample')
    logSampledError = mod.logSampledError
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // TC-LOG-01: First call within window logs to console.error
  it('TC-LOG-01: first call logs to console.error', () => {
    logSampledError({ userId: 'u1', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail' })
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  // TC-LOG-02: Second call within 60s window does NOT log (dedup)
  it('TC-LOG-02: second call within 60s is deduped', () => {
    logSampledError({ userId: 'u1', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail' })
    vi.advanceTimersByTime(30_000)
    logSampledError({ userId: 'u1', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail again' })
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  // TC-LOG-03: Call after 60s window resets and logs again
  it('TC-LOG-03: call after 60s window logs again', () => {
    logSampledError({ userId: 'u1', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail' })
    vi.advanceTimersByTime(61_000)
    logSampledError({ userId: 'u1', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail again' })
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  // TC-LOG-04: Different (userId, errorClass) combinations each log independently
  it('TC-LOG-04: different (userId, errorClass) combos each log independently', () => {
    logSampledError({ userId: 'u1', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail-1' })
    logSampledError({ userId: 'u2', errorClass: 'RBAC_LOOKUP_FAILED', message: 'fail-2' })
    logSampledError({ userId: 'u1', errorClass: 'DB_ERROR', message: 'fail-3' })
    expect(console.error).toHaveBeenCalledTimes(3)
  })
})
