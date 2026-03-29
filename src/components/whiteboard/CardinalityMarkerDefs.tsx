import { CardinalityZeroOrOneLeftMarker } from './markers/CardinalityZeroOrOneLeftMarker'
import { CardinalityZeroOrOneRightMarker } from './markers/CardinalityZeroOrOneRightMarker'
import { CardinalityZeroOrManyLeftMarker } from './markers/CardinalityZeroOrManyLeftMarker'
import { CardinalityZeroOrManyRightMarker } from './markers/CardinalityZeroOrManyRightMarker'

/**
 * Global SVG marker definitions for cardinality indicators
 *
 * Renders all marker variants (normal + highlighted) once,
 * referenced by edges via url(#id).
 *
 * Naming convention: cardinality-{type}-{side}[-highlight]
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
      {/* ── Normal state markers ────────────────────────── */}
      <CardinalityZeroOrOneLeftMarker
        id="cardinality-one-left"
        color="var(--rf-edge-stroke)"
      />
      <CardinalityZeroOrOneRightMarker
        id="cardinality-one-right"
        color="var(--rf-edge-stroke)"
      />
      <CardinalityZeroOrManyLeftMarker
        id="cardinality-many-left"
        color="var(--rf-edge-stroke)"
      />
      <CardinalityZeroOrManyRightMarker
        id="cardinality-many-right"
        color="var(--rf-edge-stroke)"
      />

      {/* ── Highlighted state markers ───────────────────── */}
      <CardinalityZeroOrOneLeftMarker
        id="cardinality-one-left-highlight"
        color="var(--rf-edge-stroke-selected)"
        isHighlighted
      />
      <CardinalityZeroOrOneRightMarker
        id="cardinality-one-right-highlight"
        color="var(--rf-edge-stroke-selected)"
        isHighlighted
      />
      <CardinalityZeroOrManyLeftMarker
        id="cardinality-many-left-highlight"
        color="var(--rf-edge-stroke-selected)"
        isHighlighted
      />
      <CardinalityZeroOrManyRightMarker
        id="cardinality-many-right-highlight"
        color="var(--rf-edge-stroke-selected)"
        isHighlighted
      />
    </div>
  )
}
