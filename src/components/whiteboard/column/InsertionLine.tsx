/**
 * InsertionLine — 2px horizontal drop indicator for column reordering
 *
 * Absolutely-positioned inside the column list container.
 * Position = targetIndex * rowHeight (or at bottom of last row).
 * When prefersReducedMotion, no CSS transition — instant position changes (AC-13b).
 */

import { memo } from 'react'

export interface InsertionLineProps {
  /** Whether the line is visible (only during active drag) */
  visible: boolean
  /** Target insert-before index (0 = before first row, N = after last row) */
  targetIndex: number
  /** Height of each column row in px */
  rowHeight: number
  /** Whether the user prefers reduced motion */
  prefersReducedMotion: boolean
}

export const InsertionLine = memo(
  ({
    visible,
    targetIndex,
    rowHeight,
    prefersReducedMotion,
  }: InsertionLineProps) => {
    const topPx = targetIndex * rowHeight

    return (
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: topPx,
          height: '2px',
          background: 'var(--rf-edge-stroke-selected, #6366f1)',
          opacity: visible ? 1 : 0,
          pointerEvents: 'none',
          zIndex: 10,
          transition: prefersReducedMotion
            ? 'none'
            : 'top 80ms ease, opacity 80ms ease',
        }}
      />
    )
  },
)

InsertionLine.displayName = 'InsertionLine'
