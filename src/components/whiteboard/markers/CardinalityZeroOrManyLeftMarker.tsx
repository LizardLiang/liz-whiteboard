import type { SVGProps } from 'react'

export type CardinalityZeroOrManyLeftMarkerProps = {
  id: string
  color?: string
  isHighlighted?: boolean
} & SVGProps<SVGSVGElement>

/**
 * SVG marker definition for "zero or many" cardinality on the left side
 * Displays as: O-< (circle with crow's foot)
 * Based on Liam ERD implementation
 */
export const CardinalityZeroOrManyLeftMarker = ({
  id,
  color = 'var(--rf-edge-stroke)',
  isHighlighted = false,
  ...props
}: CardinalityZeroOrManyLeftMarkerProps) => {
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
          viewBox="0 -10 23.5 30"
          markerWidth="23.5"
          markerHeight="30"
          refX="1.5"
          refY="8"
          orient="auto"
          style={{ color }}
        >
          {/* Crow's foot (three lines forming a fan shape) */}
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M23.2381 1.93974C22.6859 1.93974 22.2381 2.3875 22.2381 2.93974V13.06C22.2381 13.6123 22.6859 14.06 23.2381 14.06C23.7904 14.06 24.2381 13.6123 24.2381 13.06V2.93974C24.2381 2.3875 23.7904 1.93974 23.2381 1.93974Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M23.2381 8.14941L18.9167 2.73137C18.5399 2.27485 17.8702 2.20732 17.4137 2.58414C16.9572 2.96096 16.8896 3.63065 17.2664 4.08717L21.3288 8.86941L17.2664 13.6516C16.8896 14.1082 16.9572 14.7778 17.4137 15.1547C17.8702 15.5315 18.5399 15.464 18.9167 15.0074L23.2381 9.58941V8.14941Z"
            fill="currentColor"
          />
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M23.2381 8.14941L18.9167 13.5674C18.5399 14.024 17.8702 14.0915 17.4137 13.7147C16.9572 13.3378 16.8896 12.6682 17.2664 12.2116L21.3288 7.42941L17.2664 2.64717C16.8896 2.19065 16.9572 1.52096 17.4137 1.14414C17.8702 0.767323 18.5399 0.834852 18.9167 1.29137L23.2381 6.70941V8.14941Z"
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
