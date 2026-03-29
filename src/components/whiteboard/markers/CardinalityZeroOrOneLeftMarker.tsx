import type { SVGProps } from 'react'

export type CardinalityZeroOrOneLeftMarkerProps = {
  id: string
  color?: string
  isHighlighted?: boolean
} & SVGProps<SVGSVGElement>

/**
 * Refined SVG marker for "zero or one" cardinality — left/target side
 * Displays: ○─│  (open circle + vertical bar)
 *
 * refX is set to the rightmost element (the vertical bar) so the marker
 * extends AWAY from the table, not into it.
 */
export const CardinalityZeroOrOneLeftMarker = ({
  id,
  color = 'var(--rf-edge-stroke)',
  isHighlighted = false,
  ...props
}: CardinalityZeroOrOneLeftMarkerProps) => {
  const sw = isHighlighted ? 1.6 : 1.2

  return (
    <svg width="0" height="0" role="img" aria-label="Zero or One Left Marker" {...props}>
      <defs>
        <marker
          id={id}
          viewBox="0 0 24 16"
          markerWidth="24"
          markerHeight="16"
          refX="22"
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
          {/* Vertical bar — "one" indicator */}
          <line
            x1="21"
            y1="2.5"
            x2="21"
            y2="13.5"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </marker>
      </defs>
    </svg>
  )
}
