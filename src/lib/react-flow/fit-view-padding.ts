// src/lib/react-flow/fit-view-padding.ts
// Fit-to-screen padding for the main whiteboard. The floating bottom dock
// covers the lower edge of the canvas, so the bottom side reserves its height
// and the other sides keep the usual 20% margin.

import type { FitViewOptions } from '@xyflow/react'

export const DOCK_FIT_PADDING = {
  top: 0.2,
  right: 0.2,
  left: 0.2,
  bottom: '96px',
} as const satisfies NonNullable<FitViewOptions['padding']>
