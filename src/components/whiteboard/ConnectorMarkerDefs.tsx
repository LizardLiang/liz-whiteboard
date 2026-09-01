// src/components/whiteboard/ConnectorMarkerDefs.tsx
// Static SVG <marker> arrowhead defs for shape-to-shape connectors, one per
// palette colour per selected-state (tech-spec §5, D-9). Mirrors
// CardinalityMarkerDefs.tsx exactly: a zero-size absolutely-positioned <div>
// rendering static defs once, referenced by url(#id). `fill="context-stroke"`
// is deliberately NOT used — browser support is uneven and this
// enumerated-defs pattern already exists in the codebase.
//
// A single marker per (colour, selected) pair serves BOTH markerStart and
// markerEnd: `orient="auto-start-reverse"` makes the SVG renderer itself flip
// the triangle 180° when the marker is used as marker-start vs marker-end,
// so there is no need for separate "start" and "end" shapes.

import { AREA_COLORS, resolveAreaColor } from '@/lib/area-colors'

export function connectorArrowMarkerId(
  colorId: string,
  selected: boolean,
): string {
  return `connector-arrow-${colorId}${selected ? '-selected' : ''}`
}

function ArrowMarker({
  id,
  color,
  selected,
}: {
  id: string
  color: string
  selected: boolean
}) {
  const sw = selected ? 1.6 : 1.2
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      markerWidth={selected ? 9 : 8}
      markerHeight={selected ? 9 : 8}
      refX="8.5"
      refY="5"
      orient="auto-start-reverse"
      markerUnits="userSpaceOnUse"
    >
      <path
        d="M 0 0 L 10 5 L 0 10 z"
        fill={color}
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </marker>
  )
}

/** Renders every connector arrowhead marker once, one per palette colour per selected-state. */
export function ConnectorMarkerDefs() {
  return (
    <div
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        overflow: 'hidden',
      }}
    >
      <svg
        width="0"
        height="0"
        role="img"
        aria-label="Connector arrowhead markers"
      >
        <defs>
          {AREA_COLORS.map((c) => (
            <ArrowMarker
              key={c.id}
              id={connectorArrowMarkerId(c.id, false)}
              color={resolveAreaColor(c.id).solid}
              selected={false}
            />
          ))}
          {AREA_COLORS.map((c) => (
            <ArrowMarker
              key={`${c.id}-selected`}
              id={connectorArrowMarkerId(c.id, true)}
              color="var(--rf-edge-stroke-selected)"
              selected
            />
          ))}
        </defs>
      </svg>
    </div>
  )
}
