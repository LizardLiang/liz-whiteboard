// src/hooks/use-navigator-pin.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { setNavigatorPinned, useNavigatorPin } from './use-navigator-pin'

afterEach(() => {
  vi.restoreAllMocks()
  setNavigatorPinned(false)
  localStorage.clear()
})

describe('useNavigatorPin', () => {
  it('shares one value across instances and persists it', () => {
    const a = renderHook(() => useNavigatorPin())
    const b = renderHook(() => useNavigatorPin())
    expect(a.result.current.isPinned).toBe(false)

    act(() => a.result.current.setPinned(true))

    expect(a.result.current.isPinned).toBe(true)
    expect(b.result.current.isPinned).toBe(true)
    expect(localStorage.getItem('navigator-pinned')).toBe('true')
  })

  it('keeps the pin when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const a = renderHook(() => useNavigatorPin())
    const b = renderHook(() => useNavigatorPin())

    act(() => a.result.current.setPinned(true))

    expect(a.result.current.isPinned).toBe(true)
    expect(b.result.current.isPinned).toBe(true)
  })

  it('follows a storage event from another tab', () => {
    const a = renderHook(() => useNavigatorPin())
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'navigator-pinned',
          newValue: 'true',
          storageArea: localStorage,
        }),
      )
    })
    expect(a.result.current.isPinned).toBe(true)
  })
})
