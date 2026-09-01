// src/components/canvas/use-frame-loop.test.ts
// Regression tests for the draw-loop lifecycle.
//
// These exist because of a defect that 1820 unit tests and two review rounds
// all missed, and that only a real browser exposed: the board rendered NOTHING
// — backing store stuck at the 300x150 HTML default, zero painted pixels — on
// every load, forever.
//
// The mechanism is entirely lifecycle and needs no 2D context, which is what
// makes it testable here. `StrictMode` is not decoration: it is the reproducer.
// React re-runs effects on the SAME instance under it (and Fast Refresh does
// the same in development), so refs survive a cleanup while the frame they
// describe does not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useEffect } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useFrameLoop } from './use-frame-loop'

// ── controllable animation frames ────────────────────────────────────────────

let pending: Map<number, FrameRequestCallback>
let nextFrameId: number
let scheduled: number
let cancelled: Array<number>

function flushFrames() {
  const due = [...pending.values()]
  pending.clear()
  act(() => {
    for (const cb of due) cb(0)
  })
}

beforeEach(() => {
  pending = new Map()
  nextFrameId = 1
  scheduled = 0
  cancelled = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextFrameId++
    pending.set(id, cb)
    scheduled += 1
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    cancelled.push(id)
    pending.delete(id)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Mirrors how CanvasBoard drives the loop: an effect with no dependency array
 * that requests a redraw on every effect pass, standing in for the real
 * "scene, camera, viewport or theme changed" dependency list.
 */
function useLoopHarness(draw: () => void) {
  const loop = useFrameLoop(draw)
  useEffect(() => {
    loop.requestRedraw()
  })
  return loop
}

describe('the loop survives a cleanup-and-remount on the same instance', () => {
  it('still paints after StrictMode re-runs its effects', () => {
    // THE regression. Old code: the cleanup cancelled the pending frame but
    // left its id in the ref, so the second effect pass early-returned on a
    // frame that would never fire — and so did every request after it. The
    // board never painted a pixel.
    const draw = vi.fn()

    renderHook(() => useLoopHarness(draw), { wrapper: StrictMode })
    flushFrames()

    expect(draw).toHaveBeenCalled()
  })

  it('keeps accepting redraw requests after the remount', () => {
    const draw = vi.fn()
    const { result } = renderHook(() => useLoopHarness(draw), {
      wrapper: StrictMode,
    })
    flushFrames()
    draw.mockClear()

    act(() => result.current.requestRedraw())
    flushFrames()

    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('cancels the frame it queued rather than leaking it', () => {
    renderHook(() => useLoopHarness(vi.fn()), { wrapper: StrictMode })
    expect(cancelled.length).toBeGreaterThan(0)
  })
})

describe('scheduling', () => {
  it('coalesces several requests into one frame', () => {
    const draw = vi.fn()
    const { result } = renderHook(() => useFrameLoop(draw))
    scheduled = 0

    act(() => {
      result.current.requestRedraw()
      result.current.requestRedraw()
      result.current.requestRedraw()
    })

    expect(scheduled).toBe(1)
    flushFrames()
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it('schedules nothing until something asks for a redraw', () => {
    renderHook(() => useFrameLoop(vi.fn()))
    expect(scheduled).toBe(0)
  })

  it('calls the LATEST draw closure, not the one captured at schedule time', () => {
    // A frame queued before a state change must paint the state that exists
    // when it runs.
    const stale = vi.fn()
    const fresh = vi.fn()
    const { result, rerender } = renderHook(
      ({ draw }: { draw: () => void }) => useFrameLoop(draw),
      { initialProps: { draw: stale } },
    )

    act(() => result.current.requestRedraw())
    rerender({ draw: fresh })
    flushFrames()

    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending frame on unmount', () => {
    const draw = vi.fn()
    const { result, unmount } = renderHook(() => useFrameLoop(draw))
    act(() => result.current.requestRedraw())

    unmount()
    flushFrames()

    expect(draw).not.toHaveBeenCalled()
  })
})

describe('hidden tabs', () => {
  function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => hidden,
    })
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
  }

  afterEach(() => setHidden(false))

  it('stops scheduling while the document is hidden', () => {
    const draw = vi.fn()
    const { result } = renderHook(() => useFrameLoop(draw))

    setHidden(true)
    scheduled = 0
    act(() => result.current.requestRedraw())

    expect(scheduled).toBe(0)
    flushFrames()
    expect(draw).not.toHaveBeenCalled()
  })

  it('repaints as soon as the tab is visible again', () => {
    const draw = vi.fn()
    renderHook(() => useFrameLoop(draw))

    setHidden(true)
    setHidden(false)
    flushFrames()

    expect(draw).toHaveBeenCalledTimes(1)
  })
})
