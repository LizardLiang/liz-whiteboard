// src/components/canvas/use-canvas-highlight.ts
// Transient post-undo/redo highlight pulse (board-undo tactical plan, Wave
// 4, step 12 — "Canvas Undo Reports What It Did").
//
// `src/lib/canvas-engine/*` is deliberately time-free: no timers, no
// `Date.now()`, nothing that behaves differently on a second call with the
// same arguments (see render.ts's own header on `RenderSelection.highlight`).
// This hook is where the TIME lives instead — a small, self-contained React
// hook, the same division of labour `use-frame-loop.ts` already draws
// between "when does a frame run" (this layer) and "what does a frame draw"
// (canvas-engine/render.ts).
//
// This hook does NOT call the board's own `requestRedraw` (use-frame-loop.ts)
// directly, and deliberately does not import or modify that module — its own
// file header warns that a stale frame id left in a ref once wedged the loop
// shut permanently, and this feature does not need to go near that risk.
// Instead, every tick updates ordinary React state; CanvasBoard.tsx already
// folds this hook's `highlight` value into the `selection` object it passes
// to `drawScene`, and the EXISTING dirty-flag effect there (`useEffect(() =>
// requestRedraw(), [... selection ...])`) already re-fires whenever
// `selection` gets a new reference — which a changing `intensity` guarantees
// on every tick. The animation rides the pipeline that already exists rather
// than adding a second one.

import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a pulse lasts, in milliseconds. */
export const HIGHLIGHT_DURATION_MS = 900

export interface CanvasHighlightState {
  elementId: string
  /** 1 the moment the pulse starts, decaying linearly to 0. */
  intensity: number
}

export interface CanvasHighlight {
  highlight: CanvasHighlightState | null
  /** Start (or restart) a brief highlight pulse on this element. */
  trigger: (elementId: string) => void
}

export function useCanvasHighlight(): CanvasHighlight {
  const [highlight, setHighlight] = useState<CanvasHighlightState | null>(null)
  const frameRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const elementIdRef = useRef<string | null>(null)

  const tick = useCallback(() => {
    const elementId = elementIdRef.current
    if (!elementId) {
      frameRef.current = null
      return
    }
    const elapsed = Date.now() - startedAtRef.current
    if (elapsed >= HIGHLIGHT_DURATION_MS) {
      elementIdRef.current = null
      frameRef.current = null
      setHighlight(null)
      return
    }
    setHighlight({ elementId, intensity: 1 - elapsed / HIGHLIGHT_DURATION_MS })
    frameRef.current = requestAnimationFrame(tick)
  }, [])

  const trigger = useCallback(
    (elementId: string) => {
      elementIdRef.current = elementId
      startedAtRef.current = Date.now()
      // Restarting an already-running pulse (a second undo landing on the
      // same element before the first pulse finished) must not double-queue
      // a frame — `use-frame-loop.ts`'s own file header is the reminder of
      // what a leaked, un-cleared frame id does to a loop.
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      // Set synchronously rather than waiting for the first `tick`: the
      // pulse must be visible at full intensity the instant it starts, not
      // one animation frame later.
      setHighlight({ elementId, intensity: 1 })
      frameRef.current = requestAnimationFrame(tick)
    },
    [tick],
  )

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      elementIdRef.current = null
    },
    [],
  )

  return { highlight, trigger }
}
