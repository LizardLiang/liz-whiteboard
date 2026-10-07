import { afterEach, describe, expect, it, vi } from 'vitest'
import { safeGetItem, safeSetItem } from './safe-storage'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  sessionStorage.clear()
})

describe('safe-storage', () => {
  it('reads and writes both storage areas', () => {
    expect(safeSetItem('k', 'v')).toBe(true)
    expect(safeGetItem('k')).toBe('v')
    expect(safeSetItem('s', 'x', 'session')).toBe(true)
    expect(safeGetItem('s', 'session')).toBe('x')
    expect(safeGetItem('missing')).toBeNull()
  })

  it('does not throw when storage rejects reads or writes', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(safeSetItem('k', 'v')).toBe(false)
    expect(safeGetItem('k')).toBeNull()
  })
})
