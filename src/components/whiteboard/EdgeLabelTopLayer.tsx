// src/components/whiteboard/EdgeLabelTopLayer.tsx
// A label layer that sits ABOVE CanvasNodeLayer (z-[4]). The normal
// EdgeLabelRenderer lives inside the React Flow renderer, which the canvas
// table layer paints over. A relationship label that no point of its line can
// keep clear of every table is portalled into this layer so it stays readable.
import { useStore } from '@xyflow/react'
import type { ReactFlowState } from '@xyflow/react'

export const EDGE_LABEL_TOP_LAYER_TESTID = 'edge-label-top-layer'

/**
 * Selector for an edge: the layer element inside this board's React Flow root,
 * or null when canvas mode is off (nothing then covers labels).
 */
export function selectEdgeLabelTopLayer(s: ReactFlowState): HTMLElement | null {
  return (
    s.domNode?.querySelector<HTMLElement>(
      `[data-testid="${EDGE_LABEL_TOP_LAYER_TESTID}"]`,
    ) ?? null
  )
}

export function EdgeLabelTopLayer({ enabled }: { enabled: boolean }) {
  const transform = useStore((s) => s.transform)
  if (!enabled) return null
  return (
    <div
      data-testid={EDGE_LABEL_TOP_LAYER_TESTID}
      className="pointer-events-none absolute left-0 top-0 z-[5] origin-top-left select-none"
      style={{
        transform: `translate(${transform[0]}px, ${transform[1]}px) scale(${transform[2]})`,
      }}
    />
  )
}
