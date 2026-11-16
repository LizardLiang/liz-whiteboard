// src/hooks/perf-tracker-enabled-store.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  PERF_ENABLED_KEY,
  getPerfEnabled,
  resetPerfEnabledStore,
  setPerfEnabled,
  togglePerfEnabled,
  usePerfEnabledValue,
} from './perf-tracker-enabled-store'
import { usePerfTrackerEnabled } from './use-perf-tracker-enabled'

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
  localStorage.clear()
  resetPerfEnabledStore()
})

describe('perf tracker enabled store', () => {
  it('defaults to off', () => {
    expect(getPerfEnabled()).toBe(false)
  })

  it('toggles, shares one value across hooks and persists', () => {
    const a = renderHook(() => usePerfEnabledValue())
    const b = renderHook(() => usePerfEnabledValue())

    act(() => togglePerfEnabled())
    expect(a.result.current).toBe(true)
    expect(b.result.current).toBe(true)
    expect(localStorage.getItem(PERF_ENABLED_KEY)).toBe('true')

    act(() => setPerfEnabled(false))
    expect(a.result.current).toBe(false)
    expect(localStorage.getItem(PERF_ENABLED_KEY)).toBe('false')
  })

  it('restores the persisted choice on the next load', () => {
    localStorage.setItem(PERF_ENABLED_KEY, 'true')
    resetPerfEnabledStore()
    expect(getPerfEnabled()).toBe(true)
  })

  it('keeps the value in memory when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const a = renderHook(() => usePerfEnabledValue())
    act(() => setPerfEnabled(true))
    expect(a.result.current).toBe(true)
  })

  it('?perf=1 forces it on without persisting', () => {
    window.history.replaceState(null, '', '/?perf=1')
    resetPerfEnabledStore()
    expect(getPerfEnabled()).toBe(true)
    expect(localStorage.getItem(PERF_ENABLED_KEY)).toBeNull()
  })

  it('Ctrl+Shift+P flips the shared value', () => {
    const hook = renderHook(() => usePerfTrackerEnabled())
    const press = () =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyP',
          ctrlKey: true,
          shiftKey: true,
        }),
      )
    act(press)
    expect(hook.result.current).toBe(true)
    act(press)
    expect(hook.result.current).toBe(false)
  })
})
