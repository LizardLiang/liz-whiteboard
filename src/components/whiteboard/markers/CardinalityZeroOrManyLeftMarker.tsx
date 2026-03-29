import type { SVGProps } from 'react'

export type CardinalityZeroOrManyLeftMarkerProps = {
  id: string
  color?: string
  isHighlighted?: boolean
} & SVGProps<SVGSVGElement>

/**
 * Refined SVG marker for "zero or many" cardinality — left/target side
 * Displays: ○─◁  (open circle + crow's foot trident)
 *
 * refX is set at the crow's foot convergence point (right side)
 * so the trident fans OUT away from the table.
 */
export const CardinalityZeroOrManyLeftMarker = ({
  id,
  color = 'var(--rf-edge-stroke)',
  isHighlighted = false,
  ...props
}: CardinalityZeroOrManyLeftMarkerProps) => {
  const sw = isHighlighted ? 1.6 : 1.2

  return (
    <svg
      width="0"
      height="0"
      role="img"
      aria-label="Zero or Many Left Marker"
      {...props}
    >
      <defs>
        <marker
          id={id}
          viewBox="0 0 28 16"
          markerWidth="28"
          markerHeight="16"
          refX="26"
          refY="8"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          {/* Open circle — "zero/optional" indicator */}
          <circle
            cx="6"
            cy="8"
            r="4"
            fill="none"
            stroke={color}
            strokeWidth={sw}
          />
          {/* Crow's foot — three lines fanning from convergence point */}
          {/* Upper prong */}
          <line
            x1="25"
            y1="8"
            x2="15"
            y2="2"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          {/* Center line */}
          <line
            x1="25"
            y1="8"
            x2="15"
            y2="8"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          {/* Lower prong */}
          <line
            x1="25"
            y1="8"
            x2="15"
            y2="14"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </marker>
      </defs>
    </svg>
  )
}
