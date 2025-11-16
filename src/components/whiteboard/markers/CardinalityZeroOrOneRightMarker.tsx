import type { SVGProps } from 'react'

export type CardinalityZeroOrOneRightMarkerProps = {
  id: string
  color?: string
  isHighlighted?: boolean
} & SVGProps<SVGSVGElement>

/**
 * SVG marker definition for "zero or one" cardinality on the right side
 * Displays as: |-O (line with circle)
 * Based on Liam ERD implementation
 */
export const CardinalityZeroOrOneRightMarker = ({
  id,
  color = 'var(--rf-edge-stroke)',
  isHighlighted = false,
  ...props
}: CardinalityZeroOrOneRightMarkerProps) => {
  return (
    <svg
      width="0"
      height="0"
      role="img"
      aria-label="Zero or One Right Marker"
      {...props}
    >
      <defs>
        <marker
          id={id}
          viewBox="0 -10 23.5 30"
          markerWidth="23.5"
          markerHeight="30"
          refX="22"
          refY="8"
          orient="auto"
          style={{ color }}
        >
          {/* Vertical line */}
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M0.761905 1.93974C0.209621 1.93974 -0.238095 2.3875 -0.238095 2.93974V13.06C-0.238095 13.6123 0.209621 14.06 0.761905 14.06C1.31419 14.06 1.7619 13.6123 1.7619 13.06V2.93974C1.7619 2.3875 1.31419 1.93974 0.761905 1.93974Z"
            fill="currentColor"
          />
          {/* Circle (zero indicator) - transparent fill */}
          <path
            d="M17.335 13.16C19.9114 13.16 22 11.0714 22 8.495C22 5.91859 19.9114 3.83 17.335 3.83C14.7586 3.83 12.67 5.91859 12.67 8.495C12.67 11.0714 14.7586 13.16 17.335 13.16Z"
            fill="transparent"
          />
          {/* Circle border */}
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M17.335 4.33C15.0347 4.33 13.17 6.19473 13.17 8.495C13.17 10.7953 15.0347 12.66 17.335 12.66C19.6353 12.66 21.5 10.7953 21.5 8.495C21.5 6.19473 19.6353 4.33 17.335 4.33ZM12.17 8.495C12.17 5.64244 14.4824 3.33 17.335 3.33C20.1876 3.33 22.5 5.64244 22.5 8.495C22.5 11.3476 20.1876 13.66 17.335 13.66C14.4824 13.66 12.17 11.3476 12.17 8.495Z"
            fill="currentColor"
          />
        </marker>
      </defs>
    </svg>
  )
}
