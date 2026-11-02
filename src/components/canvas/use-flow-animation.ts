// src/components/canvas/use-flow-animation.ts
// The clock for flow dots. `src/lib/canvas-engine/*` is time-free, so the
// phase of the dots (0..1 along each connector) is produced here and handed to
// `drawScene` through `selection.flow.dotPhase`, riding the same React-state
// pipeline `use-canvas-highlight.ts` uses: a changing value gives `selection`
// a new reference, which the board's dirty-flag effect turns into a frame.

import { useEffect, useRef, useState } from 'react'

/** One dot trip from source to target, in milliseconds. */
export const FLOW_CYCLE_MS = 1800

export interface FlowAnimationInput {
  diagramStyle: 'card' | 'classic'
  flowDots: 'path' | 'always'
  /** A hovered or selected shape has a non-empty flow path. */
  pathActive: boolean
  /** The board has at least one connector. */
  hasConnectors: boolean
}

/** Whether the dots should run for this input, ignoring the environment. */
export function flowDotsWanted(input: FlowAnimationInput): boolean {
  if (input.diagramStyle !== 'card') return false
  return input.flowDots === 'always' ? input.hasConnectors : input.pathActive
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The dot phase for this frame, or null when the dots are not running: wrong
 * style, nothing to animate, reduced motion, or a hidden tab. While it is
 * null no timer or animation frame is held, so an idle board draws nothing.
 */
export function useFlowAnimation(input: FlowAnimationInput): number | null {
  const wanted = flowDotsWanted(input)
  const [phase, setPhase] = useState<number | null>(null)
  const [environmentOk, setEnvironmentOk] = useState(
    () => !prefersReducedMotion() && !document.hidden,
  )
  const frameRef = useRef<number | null>(null)

  useEffect(() => {
    const update = () =>
      setEnvironmentOk(!prefersReducedMotion() && !document.hidden)
    document.addEventListener('visibilitychange', update)
    const query =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
    query?.addEventListener('change', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      query?.removeEventListener('change', update)
    }
  }, [])

  const running = wanted && environmentOk

  useEffect(() => {
    if (!running) {
      setPhase(null)
      return
    }
    const startedAt = Date.now()
    const tick = () => {
      setPhase(((Date.now() - startedAt) % FLOW_CYCLE_MS) / FLOW_CYCLE_MS)
      frameRef.current = requestAnimationFrame(tick)
    }
    setPhase(0)
    frameRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }, [running])

  return running ? phase : null
}
