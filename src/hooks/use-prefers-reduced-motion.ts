/**
 * usePrefersReducedMotion — single source of truth for prefers-reduced-motion
 *
 * Returns true when the user's OS/browser has "prefers-reduced-motion: reduce" enabled.
 * Consumed by TableNode (DragOverlay dropAnimation, sensor easing), InsertionLine
 * (CSS transition), and auto-scroll velocity (REQ-09).
 *
 * Implementation: checks matchMedia once at render time rather than subscribing to
 * changes, because the media query is extremely unlikely to change during a drag session.
 */

import { useCallback } from 'react'

/**
 * Returns whether the current user prefers reduced motion.
 * Reads window.matchMedia('(prefers-reduced-motion: reduce)').
 * Falls back to false in environments without matchMedia (e.g. SSR, test jsdom without mock).
 */
export function usePrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Returns a stable callback that checks the current prefers-reduced-motion value.
 * Use this when you need to read the preference at drag-start time rather than
 * at hook-call time.
 */
export function usePrefersReducedMotionCallback(): () => boolean {
  return useCallback(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return false
    }
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])
}
