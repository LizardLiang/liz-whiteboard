// src/components/canvas/use-canvas-highlight.test.ts
// Unit tests for the transient post-undo/redo highlight pulse (board-undo
// tactical plan, Wave 4, step 12).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { HIGHLIGHT_DURATION_MS, useCanvasHighlight } from './use-canvas-highlight'

// ── controllable animation frames, mirroring use-frame-loop.test.ts ─────────

let pending: Map<number, FrameRequestCallback>
let nextFrameId: number
let cancelled: Array<number>

function flushOneFrame() {
  const due = [...pending.values()]
  pending.clear()
  act(() => {
    for (const cb of due) cb(0)
  })
}

// `Date.now` is spied directly (not `vi.useFakeTimers()`): fake timers mock
// the same scheduling primitives React's effect flusher relies on, and
// unmounting a hook (this project's global `afterEach(cleanup)` in
// src/test/setup.ts runs on every test) while they are faked can defer the
// cleanup effect until AFTER `vi.useRealTimers()`/`vi.unstubAllGlobals()`
// already ran — the exact moment this file's own `cancelAnimationFrame` stub
// would already be gone. Spying `Date.now` alone leaves React's own timing
// untouched.
let now = 0

beforeEach(() => {
  pending = new Map()
  nextFrameId = 1
  cancelled = []
  now = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++
    pending.set(id, cb)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelled.push(id)
    pending.delete(id)
  })
  vi.spyOn(Date, 'now').mockImplementation(() => now)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('trigger', () => {
  it('starts at full intensity for the triggered element', () => {
    const { result } = renderHook(() => useCanvasHighlight())
    act(() => result.current.trigger('el-1'))
    expect(result.current.highlight).toEqual({ elementId: 'el-1', intensity: 1 })
  })

  it('decays intensity over successive frames', () => {
    const { result } = renderHook(() => useCanvasHighlight())
    act(() => result.current.trigger('el-1'))

    now = HIGHLIGHT_DURATION_MS / 2
    flushOneFrame()
    expect(result.current.highlight?.elementId).toBe('el-1')
    expect(result.current.highlight?.intensity).toBeCloseTo(0.5, 5)
  })

  it('clears the highlight once the duration elapses', () => {
    const { result } = renderHook(() => useCanvasHighlight())
    act(() => result.current.trigger('el-1'))

    now = HIGHLIGHT_DURATION_MS
    flushOneFrame()
    expect(result.current.highlight).toBeNull()
  })

  it('restarting an in-flight pulse cancels the previous frame rather than double-scheduling', () => {
    const { result } = renderHook(() => useCanvasHighlight())
    act(() => result.current.trigger('el-1'))
    expect(cancelled).toHaveLength(0)

    act(() => result.current.trigger('el-2'))
    expect(cancelled).toHaveLength(1)
    expect(result.current.highlight).toEqual({ elementId: 'el-2', intensity: 1 })
  })

  it('a new trigger on a different element replaces (not queues behind) the old one', () => {
    const { result } = renderHook(() => useCanvasHighlight())
    act(() => result.current.trigger('el-1'))
    now = HIGHLIGHT_DURATION_MS / 2

    act(() => result.current.trigger('el-2'))
    expect(result.current.highlight).toEqual({ elementId: 'el-2', intensity: 1 })
  })
})

describe('unmount', () => {
  it('cancels a pending frame on unmount rather than leaking it', () => {
    const { result, unmount } = renderHook(() => useCanvasHighlight())
    act(() => result.current.trigger('el-1'))

    unmount()
    expect(cancelled.length).toBeGreaterThan(0)
  })
})

describe('idle state', () => {
  it('starts with no highlight and schedules no frame', () => {
    const { result } = renderHook(() => useCanvasHighlight())
    expect(result.current.highlight).toBeNull()
    expect(pending.size).toBe(0)
  })
})
