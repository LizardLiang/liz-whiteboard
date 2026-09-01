// src/components/whiteboard/ConnectorEdge.tsx
// The `connector` React Flow edge — derived geometry (FR-031a), real
// markerEnd (D-9, the dead-marker trap: RelationshipEdge.tsx never applies
// markerStart/markerEnd to any SVG element; this component must, so it
// renders through <BaseEdge> and passes markerEnd/markerStart explicitly).
//
// Memoisation (60fps NFR): useInternalNode(id) subscribes only to that one
// node, and the endpoint maths is wrapped in useMemo keyed on both
// endpoints' absolute position and measured size — dragging shape A
// re-renders only edges incident to A. Verified as a correctness property,
// not just a perf one, by e2e case 11 (zero connector writes during a drag).

import { memo, useMemo } from 'react'
import { BaseEdge, getStraightPath, useInternalNode } from '@xyflow/react'
import { connectorArrowMarkerId } from './ConnectorMarkerDefs'
import type { EdgeProps } from '@xyflow/react'
import type { ConnectorEdgeType, ShapeNodeType } from '@/lib/react-flow/types'
import type { ShapeBounds } from '@/lib/react-flow/shape-geometry'
import { DASHED_STROKE_PATTERN } from '@/lib/react-flow/types'
import {
  connectorEndpoints,
  resolveMeasuredSize,
} from '@/lib/react-flow/shape-geometry'
import { resolveAreaColor } from '@/lib/area-colors'

function boundsOf(
  node: ReturnType<typeof useInternalNode<ShapeNodeType>>,
): ShapeBounds | null {
  if (!node) return null
  const { width, height } = resolveMeasuredSize(node.measured, {
    width: node.data.shape.width,
    height: node.data.shape.height,
  })
  return {
    kind: node.data.shape.kind,
    x: node.internals.positionAbsolute.x,
    y: node.internals.positionAbsolute.y,
    width,
    height,
  }
}

export const ConnectorEdge = memo(
  ({ id, source, target, data, selected }: EdgeProps<ConnectorEdgeType>) => {
    const sourceNode = useInternalNode<ShapeNodeType>(source)
    const targetNode = useInternalNode<ShapeNodeType>(target)

    const endpoints = useMemo(() => {
      const s = boundsOf(sourceNode)
      const t = boundsOf(targetNode)
      if (!s || !t) return null
      return connectorEndpoints(s, t)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      sourceNode?.internals.positionAbsolute.x,
      sourceNode?.internals.positionAbsolute.y,
      sourceNode?.measured.width,
      sourceNode?.measured.height,
      sourceNode?.data.shape.kind,
      targetNode?.internals.positionAbsolute.x,
      targetNode?.internals.positionAbsolute.y,
      targetNode?.measured.width,
      targetNode?.measured.height,
      targetNode?.data.shape.kind,
    ])

    if (!endpoints || !data) return null

    const { sx, sy, tx, ty } = endpoints
    const [path] = getStraightPath({
      sourceX: sx,
      sourceY: sy,
      targetX: tx,
      targetY: ty,
    })

    const style = data.connector.style
    const colorId = style.stroke
    const strokeColor = selected
      ? 'var(--rf-edge-stroke-selected)'
      : resolveAreaColor(colorId).solid
    const markerId = connectorArrowMarkerId(colorId, !!selected)

    return (
      <BaseEdge
        id={id}
        path={path}
        markerEnd={style.arrowEnd ? `url(#${markerId})` : undefined}
        markerStart={style.arrowStart ? `url(#${markerId})` : undefined}
        style={{
          stroke: strokeColor,
          strokeWidth: style.strokeWidth,
          strokeDasharray:
            style.strokeStyle === 'dashed' ? DASHED_STROKE_PATTERN : undefined,
        }}
      />
    )
  },
)
ConnectorEdge.displayName = 'ConnectorEdge'
