import { memo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from '@xyflow/react'
import type {
  EdgeProps} from '@xyflow/react';
import type { RelationshipEdgeData } from '@/lib/react-flow/types'
import { Z_INDEX } from '@/lib/react-flow/types'

/**
 * Custom React Flow edge component for rendering ER diagram relationships
 * Displays relationship arrows with cardinality notation (crow's foot)
 * Uses SVG marker definitions for cardinality indicators
 */
export const RelationshipEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  }: EdgeProps<RelationshipEdgeData>) => {
    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    })

    const { cardinality, label, isHighlighted } = data || {}

    // Determine marker IDs based on cardinality and highlight state
    const getMarkerStart = () => {
      const suffix = isHighlighted || selected ? 'Highlight' : ''
      return `url(#zeroOrOneRight${suffix})`
    }

    const getMarkerEnd = () => {
      const suffix = isHighlighted || selected ? 'Highlight' : ''
      if (cardinality === 'ONE_TO_ONE') {
        return `url(#zeroOrOneLeft${suffix})`
      }
      return `url(#zeroOrManyLeft${suffix})`
    }

    return (
      <>
        {/* Main edge path with cardinality markers */}
        <BaseEdge
          id={id}
          path={edgePath}
          markerStart={getMarkerStart()}
          markerEnd={getMarkerEnd()}
          style={{
            stroke:
              selected || isHighlighted
                ? 'var(--rf-edge-stroke-selected)'
                : 'var(--rf-edge-stroke)',
            strokeWidth: selected || isHighlighted ? 3 : 2,
          }}
        />

        {/* Animated particles when highlighted */}
        {isHighlighted && (
          <g>
            <circle r="3" fill="var(--rf-edge-stroke-selected)">
              <animateMotion
                dur="2s"
                repeatCount="indefinite"
                path={edgePath}
              />
            </circle>
            <circle r="3" fill="var(--rf-edge-stroke-selected)">
              <animateMotion
                dur="2s"
                repeatCount="indefinite"
                path={edgePath}
                begin="0.5s"
              />
            </circle>
            <circle r="3" fill="var(--rf-edge-stroke-selected)">
              <animateMotion
                dur="2s"
                repeatCount="indefinite"
                path={edgePath}
                begin="1s"
              />
            </circle>
          </g>
        )}

        {/* Edge label */}
        {label && (
          <EdgeLabelRenderer>
            <div
              style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                pointerEvents: 'all',
                fontSize: '12px',
                fontWeight: 500,
                background: 'var(--rf-background)',
                padding: '2px 6px',
                borderRadius: '4px',
                border: '1px solid var(--rf-table-border)',
                color: 'var(--rf-table-text)',
                zIndex: Z_INDEX.EDGE_LABEL,
              }}
              className="nodrag nopan"
            >
              {label}
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    )
  },
)

RelationshipEdge.displayName = 'RelationshipEdge'
