// src/components/whiteboard/field-window/use-field-windows.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createFieldWindowsState,
  fieldWindowsReducer as reduce,
} from './use-field-windows'
import {
  MODE_KEY,
  PINNED_KEY,
  POS_KEY,
  getFieldWindowPrefs,
  resetFieldWindowPrefs,
  setFieldWindowMode,
  setFieldWindowPinned,
  setFieldWindowPos,
} from './use-field-window-prefs'
import type { FieldWindowsAction, FieldWindowsState } from './use-field-windows'

function run(
  start: FieldWindowsState,
  ...actions: Array<FieldWindowsAction>
): FieldWindowsState {
  return actions.reduce(reduce, start)
}

const pinnedState = () => createFieldWindowsState({ pinned: true })

describe('fieldWindowsReducer', () => {
  it('unpinned plain click replaces the list', () => {
    const s = run(
      createFieldWindowsState(),
      { type: 'plainClick', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'plainClick', id: 'c' },
    )
    expect(s.tableIds).toEqual(['c'])
    expect(s.activeId).toBe('c')
  })

  it('pinned plain click appends and brings an existing table forward', () => {
    let s = run(
      pinnedState(),
      { type: 'plainClick', id: 'a' },
      { type: 'plainClick', id: 'b' },
      { type: 'plainClick', id: 'c' },
    )
    expect(s.tableIds).toEqual(['a', 'b', 'c'])
    expect(s.activeId).toBe('c')
    s = reduce(s, { type: 'plainClick', id: 'a' })
    expect(s.tableIds).toEqual(['a', 'b', 'c'])
    expect(s.activeId).toBe('a')
  })

  it('Ctrl/Cmd toggle adds, then removes, a table', () => {
    let s = run(createFieldWindowsState(), { type: 'plainClick', id: 'a' })
    s = reduce(s, { type: 'toggle', id: 'b' })
    expect(s.tableIds).toEqual(['a', 'b'])
    expect(s.activeId).toBe('b')
    s = reduce(s, { type: 'toggle', id: 'a' })
    expect(s.tableIds).toEqual(['b'])
    expect(s.activeId).toBe('b')
  })

  it('toggle adds to an unpinned list without replacing it', () => {
    const s = run(
      createFieldWindowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
    )
    expect(s.tableIds).toEqual(['a', 'b'])
  })

  it('close removes one table and moves focus to the last remaining', () => {
    let s = run(
      pinnedState(),
      { type: 'plainClick', id: 'a' },
      { type: 'plainClick', id: 'b' },
      { type: 'plainClick', id: 'c' },
    )
    s = reduce(s, { type: 'close', id: 'c' })
    expect(s.tableIds).toEqual(['a', 'b'])
    expect(s.activeId).toBe('b')
    s = reduce(s, { type: 'close', id: 'a' })
    expect(s.tableIds).toEqual(['b'])
    expect(s.activeId).toBe('b')
  })

  it('emptying the list clears the active tab and the minimized flag', () => {
    const s = run(
      createFieldWindowsState(),
      { type: 'plainClick', id: 'a' },
      { type: 'setMinimized', minimized: true },
      { type: 'close', id: 'a' },
    )
    expect(s.tableIds).toEqual([])
    expect(s.activeId).toBeNull()
    expect(s.minimized).toBe(false)
  })

  it('dismissUnpinned closes an unpinned window and keeps a pinned one', () => {
    const open = run(
      createFieldWindowsState(),
      { type: 'plainClick', id: 'a' },
      { type: 'toggle', id: 'b' },
    )
    expect(reduce(open, { type: 'dismissUnpinned' }).tableIds).toEqual([])

    const pinned = reduce(open, { type: 'setPinned', pinned: true })
    expect(reduce(pinned, { type: 'dismissUnpinned' })).toBe(pinned)
  })

  it('prune drops deleted tables and keeps the rest', () => {
    let s = run(
      pinnedState(),
      { type: 'plainClick', id: 'a' },
      { type: 'plainClick', id: 'b' },
      { type: 'plainClick', id: 'c' },
    )
    s = reduce(s, { type: 'prune', existingIds: new Set(['a', 'c']) })
    expect(s.tableIds).toEqual(['a', 'c'])
    expect(s.activeId).toBe('c')
    s = reduce(s, { type: 'prune', existingIds: new Set(['a']) })
    expect(s.tableIds).toEqual(['a'])
    expect(s.activeId).toBe('a')
  })

  it('prune with nothing to remove returns the same state', () => {
    const s = run(createFieldWindowsState(), { type: 'plainClick', id: 'a' })
    expect(reduce(s, { type: 'prune', existingIds: new Set(['a', 'z']) })).toBe(
      s,
    )
  })

  it('focus only switches to a listed table', () => {
    const s = run(
      pinnedState(),
      { type: 'plainClick', id: 'a' },
      { type: 'plainClick', id: 'b' },
    )
    expect(reduce(s, { type: 'focus', id: 'a' }).activeId).toBe('a')
    expect(reduce(s, { type: 'focus', id: 'zzz' })).toBe(s)
  })

  it('move stores the position without touching the list', () => {
    const s = run(
      createFieldWindowsState(),
      { type: 'plainClick', id: 'a' },
      { type: 'move', pos: { x: 10, y: 20 } },
    )
    expect(s.pos).toEqual({ x: 10, y: 20 })
    expect(s.tableIds).toEqual(['a'])
  })
})

describe('field window prefs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    resetFieldWindowPrefs()
    localStorage.clear()
  })

  it('seeds pin, mode and position from storage', () => {
    localStorage.setItem(PINNED_KEY, 'true')
    localStorage.setItem(MODE_KEY, 'windows')
    localStorage.setItem(POS_KEY, JSON.stringify({ x: 5, y: 6 }))
    resetFieldWindowPrefs()
    expect(getFieldWindowPrefs()).toEqual({
      pinned: true,
      mode: 'windows',
      pos: { x: 5, y: 6 },
    })
  })

  it('treats a corrupt stored position as unset', () => {
    localStorage.setItem(POS_KEY, '{"x":"a"}')
    resetFieldWindowPrefs()
    expect(getFieldWindowPrefs().pos).toBeNull()
  })

  it('keeps values in memory when storage rejects writes', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked')
      },
    })
    resetFieldWindowPrefs()
    setFieldWindowPinned(true)
    setFieldWindowMode('windows')
    setFieldWindowPos({ x: 1, y: 2 })
    expect(getFieldWindowPrefs()).toEqual({
      pinned: true,
      mode: 'windows',
      pos: { x: 1, y: 2 },
    })
  })
})
