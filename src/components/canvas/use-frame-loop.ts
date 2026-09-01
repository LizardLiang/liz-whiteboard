// src/components/canvas/use-frame-loop.ts
// The canvas board's dirty-flag animation-frame loop.
//
// Extracted from CanvasBoard so the LIFECYCLE can be tested without a 2D
// context. The bug that forced the extraction was invisible to 1820 passing
// unit tests and to every code review: the unmount cleanup cancelled the
// pending frame but left its id in the ref, and because React re-runs effects
// on the SAME component instance in development, `requestRedraw` then
// early-returned forever on a frame id that would never fire. The board never
// sized its backing store and never painted a single pixel.
//
// A frame is scheduled ONLY when something marked the scene dirty. There is no
// permanently running rAF waking 60 times a second to decide it has nothing to
// do — and the loop stops entirely while the document is hidden, so a
// backgrounded tab costs nothing.

import { useCallback, useEffect, useRef } from 'react'

export interface FrameLoop {
  /** Mark the scene dirty and schedule a frame if one is not already queued. */
  requestRedraw: () => void
}

/**
 * @param draw Painting callback. Always invoked with the LATEST closure the
 * caller passed, never the one captured when the frame was queued — a frame
 * scheduled before a state change must paint the state that exists when it
 * runs.
 */
export function useFrameLoop(draw: () => void): FrameLoop {
  const drawRef = useRef(draw)
  useEffect(() => {
    drawRef.current = draw
  }, [draw])

  const dirtyRef = useRef(true)
  const frameRef = useRef<number | null>(null)
  const pausedRef = useRef(false)

  const requestRedraw = useCallback(() => {
    dirtyRef.current = true
    if (pausedRef.current || frameRef.current !== null) return
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null
      if (!dirtyRef.current) return
      dirtyRef.current = false
      drawRef.current()
    })
  }, [])

  // Stop the loop while the tab is hidden, and repaint when it comes back.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        pausedRef.current = true
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current)
          frameRef.current = null
        }
        return
      }
      pausedRef.current = false
      requestRedraw()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [requestRedraw])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      // Resetting these is NOT redundant with cancelling, and it is the whole
      // reason this hook exists as its own unit.
      //
      // React re-runs effects on the SAME instance in development (and may do
      // so at any time via Fast Refresh), so refs survive this cleanup while
      // the frame they describe does not. A cancelled id left in `frameRef`
      // wedges `requestRedraw` shut permanently — it early-returns on a frame
      // that will never fire and never clears it. `pausedRef` fails the same
      // way if the tab happened to be hidden when the cleanup ran.
      //
      // Verified in a real browser: without these two lines the backing store
      // stays at the 300x150 HTML default and the board paints zero pixels.
      frameRef.current = null
      pausedRef.current = false
      // Re-mounting must repaint from scratch, so the next mount starts dirty.
      dirtyRef.current = true
    },
    [],
  )

  return { requestRedraw }
}
