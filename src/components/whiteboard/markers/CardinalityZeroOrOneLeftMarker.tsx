import type { SVGProps } from 'react'

export type CardinalityZeroOrOneLeftMarkerProps = {
  id: string
  color?: string
  isHighlighted?: boolean
} & SVGProps<SVGSVGElement>

/**
 * SVG marker definition for "zero or one" cardinality on the left side
 * Displays as: O-| (circle with line)
 * Based on Liam ERD implementation
 */
export const CardinalityZeroOrOneLeftMarker = ({
  id,
  color = 'var(--rf-edge-stroke)',
  isHighlighted = false,
  ...props
}: CardinalityZeroOrOneLeftMarkerProps) => {
  return (
    <svg
      width="0"
      height="0"
      role="img"
      aria-label="Zero or One Left Marker"
      {...props}
    >
      <defs>
        <marker
          id={id}
          viewBox="0 -10 23.5 30"
          markerWidth="23.5"
          markerHeight="30"
          refX="1.5"
          refY="8"
          orient="auto"
          style={{ color }}
        >
          {/* Vertical line */}
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M23.2381 1.93974C22.6859 1.93974 22.2381 2.3875 22.2381 2.93974V13.06C22.2381 13.6123 22.6859 14.06 23.2381 14.06C23.7904 14.06 24.2381 13.6123 24.2381 13.06V2.93974C24.2381 2.3875 23.7904 1.93974 23.2381 1.93974Z"
            fill="currentColor"
          />
          {/* Circle (zero indicator) - transparent fill */}
          <path
            d="M6.665 13.16C9.24141 13.16 11.33 11.0714 11.33 8.495C11.33 5.91859 9.24141 3.83 6.665 3.83C4.08859 3.83 2 5.91859 2 8.495C2 11.0714 4.08859 13.16 6.665 13.16Z"
            fill="transparent"
          />
          {/* Circle border */}
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M6.665 4.33C4.36473 4.33 2.5 6.19473 2.5 8.495C2.5 10.7953 4.36473 12.66 6.665 12.66C8.96527 12.66 10.83 10.7953 10.83 8.495C10.83 6.19473 8.96527 4.33 6.665 4.33ZM1.5 8.495C1.5 5.64244 3.81244 3.33 6.665 3.33C9.51756 3.33 11.83 5.64244 11.83 8.495C11.83 11.3476 9.51756 13.66 6.665 13.66C3.81244 13.66 1.5 11.3476 1.5 8.495Z"
            fill="currentColor"
          />
        </marker>
      </defs>
    </svg>
  )
}
