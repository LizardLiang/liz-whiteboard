import { CardinalityZeroOrOneLeftMarker } from './markers/CardinalityZeroOrOneLeftMarker'
import { CardinalityZeroOrOneRightMarker } from './markers/CardinalityZeroOrOneRightMarker'
import { CardinalityZeroOrManyLeftMarker } from './markers/CardinalityZeroOrManyLeftMarker'

/**
 * Global SVG marker definitions for cardinality indicators
 * Renders all marker definitions once, referenced by edges via url(#id)
 * Based on Liam ERD implementation
 */
export const CardinalityMarkerDefs = () => {
  return (
    <div
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
      }}
    >
      {/* Normal state markers (default edge color) */}
      <CardinalityZeroOrOneLeftMarker
        id="zeroOrOneLeft"
        color="var(--rf-edge-stroke)"
      />
      <CardinalityZeroOrOneRightMarker
        id="zeroOrOneRight"
        color="var(--rf-edge-stroke)"
      />
      <CardinalityZeroOrManyLeftMarker
        id="zeroOrManyLeft"
        color="var(--rf-edge-stroke)"
      />

      {/* Highlighted state markers (selected/hovered edge color) */}
      <CardinalityZeroOrOneLeftMarker
        id="zeroOrOneLeftHighlight"
        color="var(--rf-edge-stroke-selected)"
        isHighlighted
      />
      <CardinalityZeroOrOneRightMarker
        id="zeroOrOneRightHighlight"
        color="var(--rf-edge-stroke-selected)"
        isHighlighted
      />
      <CardinalityZeroOrManyLeftMarker
        id="zeroOrManyLeftHighlight"
        color="var(--rf-edge-stroke-selected)"
        isHighlighted
      />
    </div>
  )
}
