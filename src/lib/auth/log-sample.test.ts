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
    logSampledError({
      userId: 'u1',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'fail',
    })
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  // TC-LOG-02: Second call within 60s window does NOT log (dedup)
  it('TC-LOG-02: second call within 60s is deduped', () => {
    logSampledError({
      userId: 'u1',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'fail',
    })
    vi.advanceTimersByTime(30_000)
    logSampledError({
      userId: 'u1',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'fail again',
    })
    expect(console.error).toHaveBeenCalledTimes(1)
  })

  // TC-LOG-03: Call after 60s window resets and logs again
  it('TC-LOG-03: call after 60s window logs again', () => {
    logSampledError({
      userId: 'u1',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'fail',
    })
    vi.advanceTimersByTime(61_000)
    logSampledError({
      userId: 'u1',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'fail again',
    })
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  // TC-LOG-04: Different (userId, errorClass) combinations each log independently
  it('TC-LOG-04: different (userId, errorClass) combos each log independently', () => {
    logSampledError({
      userId: 'u1',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'fail-1',
    })
    logSampledError({
      userId: 'u2',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'fail-2',
    })
    logSampledError({ userId: 'u1', errorClass: 'DB_ERROR', message: 'fail-3' })
    expect(console.error).toHaveBeenCalledTimes(3)
  })

  // TC-LOG-BOUNDED: lastLogAt Map is size-bounded (Hermes BLOCKER-2)
  // Fill to 1000 entries then add one more — oldest must be evicted and allow re-logging.
  it('TC-LOG-BOUNDED: lastLogAt Map evicts oldest entry at 1000-entry capacity', () => {
    // The map starts fresh each test (vi.resetModules in beforeEach)
    // Fill 1000 unique entries
    for (let i = 0; i < 1000; i++) {
      logSampledError({
        userId: `bulk-user-${i}`,
        errorClass: 'RBAC_LOOKUP_FAILED',
        message: 'fill',
      })
    }
    // console.error was called 1000 times (one per unique key)
    expect(console.error).toHaveBeenCalledTimes(1000)

    // The first entry logged was user 'u-first' — not in the 1000 above.
    // Adding entry 1001 (a new unique key) triggers eviction of the oldest bulk entry.
    // The evicted oldest entry (bulk-user-0) is no longer in the map.
    // Calling logSampledError for bulk-user-0 again should log (not be deduped).
    vi.mocked(console.error).mockClear()
    // Trigger the 1001st unique key to cause eviction
    logSampledError({
      userId: 'trigger-eviction',
      errorClass: 'EVICT_TEST',
      message: 'trigger',
    })
    expect(console.error).toHaveBeenCalledTimes(1) // trigger-eviction logs

    // bulk-user-0 was evicted — calling it again should log (within the window, but not in map)
    logSampledError({
      userId: 'bulk-user-0',
      errorClass: 'RBAC_LOOKUP_FAILED',
      message: 'after eviction',
    })
    expect(console.error).toHaveBeenCalledTimes(2) // bulk-user-0 logs again
  })
})
