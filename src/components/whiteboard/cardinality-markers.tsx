/**
 * Cardinality Markers for ER Diagram Relationships
 * Implements crow's foot notation for relationship cardinality
 */

import type { CardinalityType } from '@/lib/react-flow/types'

export interface CardinalityMarkerProps {
  cardinality: CardinalityType
  angle: number
  isTarget: boolean
}

/**
 * Cardinality marker component for crow's foot notation
 * Renders appropriate marker based on relationship cardinality
 *
 * @param cardinality - Type of cardinality (ONE_TO_ONE, ONE_TO_MANY, etc.)
 * @param angle - Rotation angle in radians
 * @param isTarget - Whether this is the target end of the relationship
 */
export function CardinalityMarker({
  cardinality,
  angle,
  isTarget,
}: CardinalityMarkerProps) {
  const size = 12
  const rotation = (angle * 180) / Math.PI

  // Determine marker type based on cardinality and position
  const showCrowFoot =
    (cardinality === 'ONE_TO_MANY' && isTarget) ||
    (cardinality === 'MANY_TO_ONE' && !isTarget) ||
    cardinality === 'MANY_TO_MANY'

  const showOne =
    cardinality === 'ONE_TO_ONE' ||
    (cardinality === 'ONE_TO_MANY' && !isTarget) ||
    (cardinality === 'MANY_TO_ONE' && isTarget)

  if (showCrowFoot) {
    return <CrowFootMarker size={size} rotation={rotation} />
  }

  if (showOne) {
    return <OneMarker size={size} rotation={rotation} />
  }

  return null
}

/**
 * Crow's foot marker (three prongs for "many" side)
 */
function CrowFootMarker({
  size,
  rotation,
}: {
  size: number
  rotation: number
}) {
  return (
    <g transform={`rotate(${rotation})`}>
      {/* Upper prong */}
      <line
        x1={0}
        y1={0}
        x2={-size}
        y2={-size / 2}
        stroke="var(--rf-edge-stroke)"
        strokeWidth={2}
      />
      {/* Middle prong */}
      <line
        x1={0}
        y1={0}
        x2={-size}
        y2={0}
        stroke="var(--rf-edge-stroke)"
        strokeWidth={2}
      />
      {/* Lower prong */}
      <line
        x1={0}
        y1={0}
        x2={-size}
        y2={size / 2}
        stroke="var(--rf-edge-stroke)"
        strokeWidth={2}
      />
    </g>
  )
}

/**
 * Single line marker (for "one" side)
 */
function OneMarker({ size, rotation }: { size: number; rotation: number }) {
  return (
    <g transform={`rotate(${rotation})`}>
      <line
        x1={-size / 2}
        y1={-size / 2}
        x2={-size / 2}
        y2={size / 2}
        stroke="var(--rf-edge-stroke)"
        strokeWidth={2}
      />
    </g>
  )
}

/**
 * Optional circle marker (for optional relationships)
 * Not currently used but available for future enhancement
 */
export function OptionalMarker({
  size,
  rotation,
}: {
  size: number
  rotation: number
}) {
  return (
    <g transform={`rotate(${rotation})`}>
      <circle
        cx={-size / 2}
        cy={0}
        r={size / 4}
        fill="none"
        stroke="var(--rf-edge-stroke)"
        strokeWidth={2}
      />
    </g>
  )
}
