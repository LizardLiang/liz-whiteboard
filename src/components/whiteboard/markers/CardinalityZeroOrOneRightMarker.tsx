import type { SVGProps } from 'react'

export type CardinalityZeroOrOneRightMarkerProps = {
  id: string
  color?: string
  isHighlighted?: boolean
} & SVGProps<SVGSVGElement>

/**
 * Refined SVG marker for "zero or one" cardinality — right/source side
 * Displays: │─○  (vertical bar + open circle)
 *
 * refX is set to the leftmost element (the vertical bar) so the marker
 * extends AWAY from the source table.
 */
export const CardinalityZeroOrOneRightMarker = ({
  id,
  color = 'var(--rf-edge-stroke)',
  isHighlighted = false,
  ...props
}: CardinalityZeroOrOneRightMarkerProps) => {
  const sw = isHighlighted ? 1.6 : 1.2

  return (
    <svg width="0" height="0" role="img" aria-label="Zero or One Right Marker" {...props}>
      <defs>
        <marker
          id={id}
          viewBox="0 0 24 16"
          markerWidth="24"
          markerHeight="16"
          refX="2"
          refY="8"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          {/* Vertical bar — "one" indicator */}
          <line
            x1="3"
            y1="2.5"
            x2="3"
            y2="13.5"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          {/* Open circle — "zero/optional" indicator */}
          <circle
            cx="18"
            cy="8"
            r="4"
            fill="none"
            stroke={color}
            strokeWidth={sw}
          />
        </marker>
      </defs>
    </svg>
  )
}
