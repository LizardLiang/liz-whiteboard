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
import { CASCADE_STEP_PX, cascadePlacement } from './FieldWindows'
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

describe('fieldWindowsReducer - windows mode', () => {
  const windowsState = (pinned = false) =>
    createFieldWindowsState({ mode: 'windows', pinned })

  it('switching tabs to windows keeps the list and gives each table a cascade slot', () => {
    let s = run(
      pinnedState(),
      { type: 'plainClick', id: 'a' },
      { type: 'plainClick', id: 'b' },
      { type: 'plainClick', id: 'c' },
    )
    s = reduce(s, { type: 'setMode', mode: 'windows' })
    expect(s.mode).toBe('windows')
    expect(s.tableIds).toEqual(['a', 'b', 'c'])
    expect(Object.keys(s.windows)).toEqual(['a', 'b', 'c'])
    expect(s.windows.a.slot).toBe(0)
    expect(s.windows.c.slot).toBe(2)
    expect(s.windows.a.pinned).toBe(true)
    // The active tab ends in front.
    expect(s.activeId).toBe('c')
    expect(s.windows.c.z).toBeGreaterThan(s.windows.b.z)
  })

  it('switching back to tabs keeps the list, takes the front window position, pins if any was pinned', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'setWindowPinned', id: 'a', pinned: true },
      { type: 'moveWindow', id: 'b', pos: { x: 30, y: 40 } },
    )
    s = reduce(s, { type: 'setMode', mode: 'tabs' })
    expect(s.mode).toBe('tabs')
    expect(s.tableIds).toEqual(['a', 'b'])
    expect(s.windows).toEqual({})
    expect(s.activeId).toBe('b')
    expect(s.pinned).toBe(true)
    expect(s.pos).toEqual({ x: 30, y: 40 })
    expect(reduce(s, { type: 'setMode', mode: 'tabs' })).toBe(s)
  })

  it('an explicit frontPos wins over the window position', () => {
    const s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'setMode', mode: 'tabs', frontPos: { x: 1, y: 2 } },
    )
    expect(s.pos).toEqual({ x: 1, y: 2 })
  })

  it('close removes one window and leaves the others', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'toggle', id: 'c' },
    )
    s = reduce(s, { type: 'close', id: 'b' })
    expect(s.tableIds).toEqual(['a', 'c'])
    expect(Object.keys(s.windows)).toEqual(['a', 'c'])
    expect(s.activeId).toBe('c')
  })

  it('closing the front window activates the next front window', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'toggle', id: 'c' },
      { type: 'focus', id: 'a' },
    )
    expect(s.activeId).toBe('a')
    s = reduce(s, { type: 'close', id: 'a' })
    expect(s.activeId).toBe('c')
  })

  it('plain click keeps pinned windows, replaces unpinned ones and opens the new table', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'setWindowPinned', id: 'a', pinned: true },
    )
    s = reduce(s, { type: 'plainClick', id: 'c' })
    expect(s.tableIds).toEqual(['a', 'c'])
    expect(s.windows.c.pinned).toBe(false)
    expect(s.activeId).toBe('c')
  })

  it('plain click on a listed window raises it without recreating it', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
    )
    const slotOfB = s.windows.b.slot
    s = reduce(s, { type: 'plainClick', id: 'b' })
    expect(s.tableIds).toEqual(['b'])
    expect(s.windows.b.slot).toBe(slotOfB)
    expect(s.activeId).toBe('b')
  })

  it('a new set starts with the remembered pin; later windows do not', () => {
    let s = reduce(windowsState(true), { type: 'plainClick', id: 'a' })
    expect(s.windows.a.pinned).toBe(true)
    s = reduce(s, { type: 'plainClick', id: 'b' })
    expect(s.tableIds).toEqual(['a', 'b'])
    expect(s.windows.b.pinned).toBe(false)
  })

  it('each window owns its pin, minimize and position', () => {
    const s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'setWindowPinned', id: 'a', pinned: true },
      { type: 'setWindowMinimized', id: 'b', minimized: true },
      { type: 'moveWindow', id: 'a', pos: { x: 5, y: 6 } },
    )
    expect(s.windows.a).toMatchObject({
      pinned: true,
      minimized: false,
      pos: { x: 5, y: 6 },
    })
    expect(s.windows.b).toMatchObject({
      pinned: false,
      minimized: true,
      pos: null,
    })
  })

  it('dismissUnpinned closes only the unpinned windows', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
      { type: 'setWindowPinned', id: 'a', pinned: true },
    )
    s = reduce(s, { type: 'dismissUnpinned' })
    expect(s.tableIds).toEqual(['a'])
    expect(reduce(s, { type: 'dismissUnpinned' })).toBe(s)
  })

  it('focus raises a window above the others; raising the front one is a no-op', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
    )
    s = reduce(s, { type: 'focus', id: 'a' })
    expect(s.windows.a.z).toBeGreaterThan(s.windows.b.z)
    expect(reduce(s, { type: 'focus', id: 'a' })).toBe(s)
  })

  it('prune drops the deleted table window', () => {
    let s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'toggle', id: 'b' },
    )
    s = reduce(s, { type: 'prune', existingIds: new Set(['a']) })
    expect(s.tableIds).toEqual(['a'])
    expect(Object.keys(s.windows)).toEqual(['a'])
  })

  it('closeAll empties the set', () => {
    const s = run(
      windowsState(),
      { type: 'toggle', id: 'a' },
      { type: 'closeAll' },
    )
    expect(s.tableIds).toEqual([])
    expect(s.windows).toEqual({})
  })
})

describe('cascadePlacement', () => {
  it('steps left and down by one title row from the default anchor', () => {
    const p0 = cascadePlacement(null, 0, 1600, 1000, 78)
    const p2 = cascadePlacement(null, 2, 1600, 1000, 78)
    expect(CASCADE_STEP_PX).toBe(44)
    expect(p0).toEqual({ x: 1600 - 12 - 768, y: 76 })
    expect(p2).toEqual({
      x: p0.x - 2 * CASCADE_STEP_PX,
      y: 76 + 2 * CASCADE_STEP_PX,
    })
  })

  it('steps right and down from a remembered position', () => {
    expect(cascadePlacement({ x: 100, y: 100 }, 1, 1600, 1000)).toEqual({
      x: 100 + CASCADE_STEP_PX,
      y: 100 + CASCADE_STEP_PX,
    })
  })

  it('wraps to the start when a step would leave the viewport', () => {
    const steps = Math.floor((600 - 78 - 76 - 160) / CASCADE_STEP_PX) + 1
    expect(cascadePlacement(null, steps, 1600, 600, 78)).toEqual(
      cascadePlacement(null, 0, 1600, 600, 78),
    )
  })

  it('stays inside the viewport width on a phone', () => {
    const p = cascadePlacement(null, 3, 390, 844, 78)
    expect(p.x).toBeGreaterThanOrEqual(0)
    expect(p.x + (390 - 24)).toBeLessThanOrEqual(390)
  })

  it('moves the same slot back inside after the viewport shrinks', () => {
    const wide = cascadePlacement(null, 2, 1600, 1000, 78)
    const phone = cascadePlacement(null, 2, 390, 844, 78)
    expect(wide.x).toBeGreaterThan(390)
    expect(phone.x).toBeLessThanOrEqual(390 - 366)
  })

  it('pulls a remembered origin back inside a smaller viewport', () => {
    const p = cascadePlacement({ x: 1200, y: 900 }, 0, 390, 844, 78)
    expect(p.x).toBeLessThanOrEqual(390 - 366)
    expect(p.y).toBeLessThanOrEqual(844 - 78 - 160)
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
