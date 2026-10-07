import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useZenMode } from './use-zen-mode'

afterEach(() => {
  vi.restoreAllMocks()
  const { result } = renderHook(() => useZenMode())
  act(() => result.current.exitZenMode())
  localStorage.clear()
})

describe('useZenMode', () => {
  it('keeps every instance in sync and can toggle off when storage rejects writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const a = renderHook(() => useZenMode())
    const b = renderHook(() => useZenMode())

    act(() => a.result.current.toggleZenMode())
    expect(a.result.current.isZenMode).toBe(true)
    expect(b.result.current.isZenMode).toBe(true)

    act(() => b.result.current.toggleZenMode())
    expect(a.result.current.isZenMode).toBe(false)
    expect(b.result.current.isZenMode).toBe(false)
  })
})
