import { memo, useMemo } from 'react';
import {
  EdgeProps,
  getSmoothStepPath,
  EdgeLabelRenderer,
  Position,
} from '@xyflow/react';
import type { RelationshipEdgeData } from '@/lib/react-flow/types';
import { Z_INDEX } from '@/lib/react-flow/types';

// ── Layout constants ──
// How far past the handle to push the base toward the table (negative = toward table)
const TABLE_INSET = 10;
// Crow's foot length (from prong tips at table to convergence point)
const CROW_LENGTH = 2;
// Crow's foot half-spread (perpendicular distance of outer prongs)
const CROW_SPREAD = 6;
// Curvature of outer prongs (quadratic bezier bow)
const CROW_CURVE = 3;
// "One" bar distance from handle
const BAR_DIST = 4;
// "One" bar half-height
const BAR_HALF = 5;
// Circle radius
const CIRCLE_R = 3;
// Gap between last icon element and circle center
const CIRCLE_GAP = 4;

function outwardAngle(position: Position): number {
  switch (position) {
    case Position.Right:  return 0;
    case Position.Left:   return Math.PI;
    case Position.Top:    return -Math.PI / 2;
    case Position.Bottom: return Math.PI / 2;
  }
}

/**
 * Render all cardinality indicators for one end of the edge.
 *
 * Layout along the outward direction from handle:
 *   [table border] ← handle ← crowfoot/bar ← circle ← edge line
 *
 * - Crow's foot: prong tips at the handle point (touching the table),
 *   convergence at CROW_LENGTH outward.
 * - One bar: perpendicular line at BAR_DIST outward.
 * - Zero circle: after the bar or crow tip, at CIRCLE_GAP further out.
 *
 * Returns the total extent (distance from handle to outermost icon edge)
 * so the caller can clip the edge line.
 */
function CardinalityIndicator(props: {
  x: number; y: number; angle: number;
  isMany: boolean; color: string; sw: number;
}) {
  const { x, y, angle, isMany, color, sw } = props;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const px = Math.sin(angle);
  const py = -Math.cos(angle);

  if (isMany) {
    // Crow's foot: base (prong tips) pushed past handle toward the table
    const baseX = x - cos * TABLE_INSET;
    const baseY = y - sin * TABLE_INSET;
    const tipX = x + cos * CROW_LENGTH;
    const tipY = y + sin * CROW_LENGTH;
    const midX = (tipX + baseX) / 2;
    const midY = (tipY + baseY) / 2;

    // Circle right after the convergence point
    const circleX = tipX + cos * CIRCLE_GAP;
    const circleY = tipY + sin * CIRCLE_GAP;

    return (
      <g>
        {/* Upper prong */}
        <path
          d={`M ${tipX} ${tipY} Q ${midX - px * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${midY - py * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${baseX - px * CROW_SPREAD} ${baseY - py * CROW_SPREAD}`}
          fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
        />
        {/* Center line */}
        <line x1={tipX} y1={tipY} x2={baseX} y2={baseY}
          stroke={color} strokeWidth={sw} strokeLinecap="round" />
        {/* Lower prong */}
        <path
          d={`M ${tipX} ${tipY} Q ${midX + px * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${midY + py * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${baseX + px * CROW_SPREAD} ${baseY + py * CROW_SPREAD}`}
          fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
        />
        {/* Zero circle */}
        <circle cx={circleX} cy={circleY} r={CIRCLE_R}
          fill="var(--rf-background)" stroke={color} strokeWidth={sw} />
      </g>
    );
  }

  // "One" bar + circle
  const barX = x + cos * BAR_DIST;
  const barY = y + sin * BAR_DIST;
  const circleX = barX + cos * CIRCLE_GAP;
  const circleY = barY + sin * CIRCLE_GAP;

  return (
    <g>
      <line
        x1={barX - px * BAR_HALF} y1={barY - py * BAR_HALF}
        x2={barX + px * BAR_HALF} y2={barY + py * BAR_HALF}
        stroke={color} strokeWidth={sw} strokeLinecap="round"
      />
      <circle cx={circleX} cy={circleY} r={CIRCLE_R}
        fill="var(--rf-background)" stroke={color} strokeWidth={sw} />
    </g>
  );
}

/** Total extent of the indicator icons from the handle point */
function indicatorExtent(isMany: boolean): number {
  if (isMany) return CROW_LENGTH + CIRCLE_GAP + CIRCLE_R;
  return BAR_DIST + CIRCLE_GAP + CIRCLE_R;
}

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
    const { cardinality, label, isHighlighted } = data || {};
    const isActive = selected || isHighlighted;

    const srcAngle = useMemo(() => outwardAngle(sourcePosition), [sourcePosition]);
    const tgtAngle = useMemo(() => outwardAngle(targetPosition), [targetPosition]);

    const sourceIsMany = cardinality === 'MANY_TO_ONE' || cardinality === 'MANY_TO_MANY';
    const targetIsMany = cardinality === 'ONE_TO_MANY' || cardinality === 'MANY_TO_MANY';

    // Shorten the path so it stops before the cardinality icons.
    // Move source/target inward by the icon extent.
    const srcExt = indicatorExtent(sourceIsMany);
    const tgtExt = indicatorExtent(targetIsMany);
    const adjSourceX = sourceX + Math.cos(srcAngle) * srcExt;
    const adjSourceY = sourceY + Math.sin(srcAngle) * srcExt;
    const adjTargetX = targetX + Math.cos(tgtAngle) * tgtExt;
    const adjTargetY = targetY + Math.sin(tgtAngle) * tgtExt;

    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX: adjSourceX,
      sourceY: adjSourceY,
      sourcePosition,
      targetX: adjTargetX,
      targetY: adjTargetY,
      targetPosition,
      borderRadius: 16,
    });

    const gradientId = `edge-gradient-${id}`;
    const glowFilterId = `edge-glow-${id}`;

    const color = isActive ? 'var(--rf-edge-stroke-selected)' : 'var(--rf-edge-stroke)';
    const sw = isActive ? 1.6 : 1.2;

    return (
      <>
        <defs>
          <linearGradient
            id={gradientId}
            x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={
              isActive ? 'var(--rf-edge-gradient-start-active)' : 'var(--rf-edge-gradient-start)'
            } />
            <stop offset="100%" stopColor={
              isActive ? 'var(--rf-edge-gradient-end-active)' : 'var(--rf-edge-gradient-end)'
            } />
          </linearGradient>
          {isActive && (
            <filter id={glowFilterId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        {/* Glow underlay */}
        {isActive && (
          <path d={edgePath} fill="none"
            stroke="var(--rf-edge-glow)" strokeWidth={8} strokeLinecap="round"
            style={{ filter: `url(#${glowFilterId})`, opacity: 0.4 }}
          />
        )}

        {/* Main edge path — shortened to stop before icons */}
        <path
          id={id}
          className="react-flow__edge-path"
          d={edgePath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={isActive ? 2.5 : 1.5}
          strokeLinecap="round"
          style={{ transition: 'stroke-width 0.2s ease' }}
        />

        {/* Source cardinality */}
        <CardinalityIndicator
          x={sourceX} y={sourceY} angle={srcAngle}
          isMany={sourceIsMany} color={color} sw={sw}
        />

        {/* Target cardinality */}
        <CardinalityIndicator
          x={targetX} y={targetY} angle={tgtAngle}
          isMany={targetIsMany} color={color} sw={sw}
        />

        {/* Animated dots */}
        {isHighlighted && (
          <g>
            <circle r="2.5" fill="var(--rf-edge-stroke-selected)" opacity="0.7">
              <animateMotion dur="3s" repeatCount="indefinite" path={edgePath} />
            </circle>
            <circle r="2.5" fill="var(--rf-edge-stroke-selected)" opacity="0.7">
              <animateMotion dur="3s" repeatCount="indefinite" path={edgePath} begin="1.5s" />
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
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '0.02em',
                background: 'var(--rf-edge-label-bg)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                padding: '3px 10px',
                borderRadius: '6px',
                border: '1px solid var(--rf-edge-label-border)',
                color: isActive ? 'var(--rf-edge-stroke-selected)' : 'var(--rf-table-text)',
                boxShadow: isActive
                  ? '0 0 12px var(--rf-edge-glow)'
                  : '0 1px 4px rgba(0,0,0,0.06)',
                transition: 'color 0.2s, box-shadow 0.2s',
                zIndex: Z_INDEX.EDGE_LABEL,
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
