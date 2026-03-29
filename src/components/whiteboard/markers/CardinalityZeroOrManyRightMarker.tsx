import type { SVGProps } from 'react'

export type CardinalityZeroOrManyRightMarkerProps = {
  id: string
  color?: string
  isHighlighted?: boolean
} & SVGProps<SVGSVGElement>

/**
 * Refined SVG marker for "zero or many" cardinality — right/source side
 * Displays: ▷─○  (crow's foot trident + open circle)
 *
 * refX is set at the crow's foot convergence point (left side)
 * so the trident fans OUT away from the source table.
 */
export const CardinalityZeroOrManyRightMarker = ({
  id,
  color = 'var(--rf-edge-stroke)',
  isHighlighted = false,
  ...props
}: CardinalityZeroOrManyRightMarkerProps) => {
  const sw = isHighlighted ? 1.6 : 1.2

  return (
    <svg
      width="0"
      height="0"
      role="img"
      aria-label="Zero or Many Right Marker"
      {...props}
    >
      <defs>
        <marker
          id={id}
          viewBox="0 0 28 16"
          markerWidth="28"
          markerHeight="16"
          refX="2"
          refY="8"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          {/* Crow's foot — three lines fanning from convergence point (mirrored) */}
          {/* Upper prong */}
          <line
            x1="3"
            y1="8"
            x2="13"
            y2="2"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          {/* Center line */}
          <line
            x1="3"
            y1="8"
            x2="13"
            y2="8"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          {/* Lower prong */}
          <line
            x1="3"
            y1="8"
            x2="13"
            y2="14"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          {/* Open circle — "zero/optional" indicator */}
          <circle
            cx="22"
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
