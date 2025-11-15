import { memo } from 'react';
import { BaseEdge, EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';
import type { RelationshipEdgeData } from '@/lib/react-flow/types';
import { CardinalityMarker } from './cardinality-markers';

/**
 * Custom React Flow edge component for rendering ER diagram relationships
 * Displays relationship arrows with cardinality notation (crow's foot)
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
    });

    const { cardinality, label, isHighlighted } = data || {};

    // Calculate angle for cardinality markers
    const angle = Math.atan2(targetY - sourceY, targetX - sourceX);

    return (
      <>
        {/* Main edge path */}
        <BaseEdge
          id={id}
          path={edgePath}
          style={{
            stroke: selected || isHighlighted ? 'var(--rf-edge-stroke-selected)' : 'var(--rf-edge-stroke)',
            strokeWidth: selected || isHighlighted ? 3 : 2,
          }}
        />

        {/* Animated particles when highlighted */}
        {isHighlighted && (
          <g>
            <circle r="3" fill="var(--rf-edge-stroke-selected)">
              <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} />
            </circle>
            <circle r="3" fill="var(--rf-edge-stroke-selected)">
              <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} begin="0.5s" />
            </circle>
            <circle r="3" fill="var(--rf-edge-stroke-selected)">
              <animateMotion dur="2s" repeatCount="indefinite" path={edgePath} begin="1s" />
            </circle>
          </g>
        )}

        {/* Cardinality marker at target */}
        {cardinality && (
          <g transform={`translate(${targetX}, ${targetY})`}>
            <CardinalityMarker cardinality={cardinality} angle={angle} isTarget={true} />
          </g>
        )}

        {/* Cardinality marker at source */}
        {cardinality && (
          <g transform={`translate(${sourceX}, ${sourceY})`}>
            <CardinalityMarker
              cardinality={cardinality}
              angle={angle + Math.PI}
              isTarget={false}
            />
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
              }}
              className="nodrag nopan"
            >
              {label}
            </div>
          </EdgeLabelRenderer>
        )}
      </>
    );
  }
);

RelationshipEdge.displayName = 'RelationshipEdge';

