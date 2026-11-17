import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  useStore,
} from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import { selectEdgeLabelTopLayer } from './EdgeLabelTopLayer'
import type { ReactElement } from 'react'
import type { EdgeProps, ReactFlowState } from '@xyflow/react'
import type { RelationshipEdgeType } from '@/lib/react-flow/types'
import type { Rect } from '@/lib/react-flow/edge-label-placement'
import { Z_INDEX } from '@/lib/react-flow/types'
import {
  clampSameSideLabelX,
  computeLabelPillHeight,
  computeLabelPillWidth,
} from '@/lib/auto-layout/d3-force-layout'
import {
  LABEL_OBSTACLE_MARGIN,
  flattenSmoothPath,
  nodeObstacleRect,
  placeEdgeLabel,
} from '@/lib/react-flow/edge-label-placement'
import {
  buildRoundedOrthogonalPath,
  pathMidpoint,
} from '@/lib/react-flow/orthogonal-path'
import { useT } from '@/lib/i18n/use-t'

// ── Layout constants ──
// A line and its marker start ON the table border (not at the connect dot), so
// the crow's foot prongs and the bars end 1 px outside it (negative inset) so
// the table border does not clip them.
const TABLE_INSET = -1
// Crow's foot length outward from the table border: the foot lies entirely
// outside the table, its prongs on the border and its tip CROW_LENGTH out
const CROW_LENGTH = 5
// Crow's foot half-spread (perpendicular distance of outer prongs)
const CROW_SPREAD = 6
// Curvature of outer prongs (quadratic bezier bow)
const CROW_CURVE = 3
// Multiplicity bar inset toward the table from the border
const MULT_BAR_INSET = -1
// Bar half-height (perpendicular extent of a bar symbol)
const BAR_HALF = 6
// Open circle radius (for zero/optional symbol)
const CIRCLE_R = 4
// Distance from the table border to the optionality symbol centre, after a
// crow's foot (the circle touches the tip) and after a bar
const OPT_DIST_MANY = 9
const OPT_DIST_ONE = 7

const CARDINALITY_COLORS: Record<string, string> = {
  ONE_TO_ONE: '#60a5fa', // blue
  ONE_TO_MANY: '#34d399', // green
  MANY_TO_ONE: '#a78bfa', // purple
  MANY_TO_MANY: '#f97316', // orange
  ZERO_TO_ONE: '#22d3ee', // cyan
  ZERO_TO_MANY: '#facc15', // yellow
  SELF_REFERENCING: '#f87171', // red
  MANY_TO_ZERO_OR_ONE: '#fb7185', // rose
  MANY_TO_ZERO_OR_MANY: '#e879f9', // fuchsia
  ZERO_OR_ONE_TO_ONE: '#4ade80', // lime green
  ZERO_OR_ONE_TO_MANY: '#86efac', // light green
  ZERO_OR_ONE_TO_ZERO_OR_ONE: '#67e8f9', // light cyan
  ZERO_OR_ONE_TO_ZERO_OR_MANY: '#a5f3fc', // lighter cyan
  ZERO_OR_MANY_TO_ONE: '#c084fc', // light purple
  ZERO_OR_MANY_TO_MANY: '#d8b4fe', // lighter purple
  ZERO_OR_MANY_TO_ZERO_OR_ONE: '#fda4af', // light rose
  ZERO_OR_MANY_TO_ZERO_OR_MANY: '#fbbf24', // amber
}

const CARDINALITY_FLAGS: Record<
  string,
  { srcMany: boolean; srcOpt: boolean; tgtMany: boolean; tgtOpt: boolean }
> = {
  ONE_TO_ONE: { srcMany: false, srcOpt: false, tgtMany: false, tgtOpt: false },
  ONE_TO_MANY: { srcMany: false, srcOpt: false, tgtMany: true, tgtOpt: false },
  MANY_TO_ONE: { srcMany: true, srcOpt: false, tgtMany: false, tgtOpt: false },
  MANY_TO_MANY: { srcMany: true, srcOpt: false, tgtMany: true, tgtOpt: false },
  ZERO_TO_ONE: { srcMany: false, srcOpt: false, tgtMany: false, tgtOpt: true },
  ZERO_TO_MANY: { srcMany: false, srcOpt: false, tgtMany: true, tgtOpt: true },
  SELF_REFERENCING: {
    srcMany: false,
    srcOpt: false,
    tgtMany: true,
    tgtOpt: true,
  },
  MANY_TO_ZERO_OR_ONE: {
    srcMany: true,
    srcOpt: false,
    tgtMany: false,
    tgtOpt: true,
  },
  MANY_TO_ZERO_OR_MANY: {
    srcMany: true,
    srcOpt: false,
    tgtMany: true,
    tgtOpt: true,
  },
  ZERO_OR_ONE_TO_ONE: {
    srcMany: false,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: false,
  },
  ZERO_OR_ONE_TO_MANY: {
    srcMany: false,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: false,
  },
  ZERO_OR_ONE_TO_ZERO_OR_ONE: {
    srcMany: false,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: true,
  },
  ZERO_OR_ONE_TO_ZERO_OR_MANY: {
    srcMany: false,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: true,
  },
  ZERO_OR_MANY_TO_ONE: {
    srcMany: true,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: false,
  },
  ZERO_OR_MANY_TO_MANY: {
    srcMany: true,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: false,
  },
  ZERO_OR_MANY_TO_ZERO_OR_ONE: {
    srcMany: true,
    srcOpt: true,
    tgtMany: false,
    tgtOpt: true,
  },
  ZERO_OR_MANY_TO_ZERO_OR_MANY: {
    srcMany: true,
    srcOpt: true,
    tgtMany: true,
    tgtOpt: true,
  },
}

function getCardinalityColor(cardinality: string | undefined): string {
  return CARDINALITY_COLORS[cardinality ?? ''] ?? '#94a3b8'
}

function outwardAngle(position: Position): number {
  switch (position) {
    case Position.Right:
      return 0
    case Position.Left:
      return Math.PI
    case Position.Top:
      return -Math.PI / 2
    case Position.Bottom:
      return Math.PI / 2
  }
}

/**
 * Render proper two-symbol crow's foot notation for one end of an edge.
 *
 * Standard crow's foot layout (reading outward from the table border toward the edge line):
 *   [table] ← border ← [multiplicity: crow/bar] ··· [optionality: circle/bar] ← edge line
 *
 * Multiplicity symbol (closest to table, at the table border):
 *   - Crow's foot (⋈) = many
 *   - Single perpendicular bar (|) = one
 *
 * Optionality symbol (further out, OPT_DIST_* from the table border):
 *   - Open circle (○) = zero / optional
 *   - Single perpendicular bar (|) = mandatory / one
 *
 * Combined meanings:
 *   bar  + bar    = exactly one  (||)
 *   crow + bar    = one or many  (|⋈)
 *   bar  + circle = zero or one  (○|)
 *   crow + circle = zero or many (○⋈)
 */
function CardinalityIndicator(props: {
  x: number
  y: number
  angle: number
  isMany: boolean
  isOptional: boolean
  color: string
  sw: number
}) {
  const { x, y, angle, isMany, isOptional, color, sw } = props
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // Perpendicular unit vector (rotated 90°)
  const px = Math.sin(angle)
  const py = -Math.cos(angle)

  // ── Multiplicity symbol (at the table border, touching the table) ──
  const multSymbol = isMany ? (
    (() => {
      // Crow's foot: prong tips at border - TABLE_INSET, convergence at border + CROW_LENGTH
      const baseX = x - cos * TABLE_INSET
      const baseY = y - sin * TABLE_INSET
      const tipX = x + cos * CROW_LENGTH
      const tipY = y + sin * CROW_LENGTH
      const midX = (tipX + baseX) / 2
      const midY = (tipY + baseY) / 2
      return (
        <g>
          <path
            d={`M ${tipX} ${tipY} Q ${midX - px * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${midY - py * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${baseX - px * CROW_SPREAD} ${baseY - py * CROW_SPREAD}`}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <line
            x1={tipX}
            y1={tipY}
            x2={baseX}
            y2={baseY}
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <path
            d={`M ${tipX} ${tipY} Q ${midX + px * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${midY + py * (CROW_SPREAD * 0.5 + CROW_CURVE)} ${baseX + px * CROW_SPREAD} ${baseY + py * CROW_SPREAD}`}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </g>
      )
    })()
  ) : (
    // Single perpendicular bar, slightly inset toward table
    <line
      x1={x - cos * MULT_BAR_INSET - px * BAR_HALF}
      y1={y - sin * MULT_BAR_INSET - py * BAR_HALF}
      x2={x - cos * MULT_BAR_INSET + px * BAR_HALF}
      y2={y - sin * MULT_BAR_INSET + py * BAR_HALF}
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
    />
  )

  // ── Optionality symbol (outward from multiplicity) ──
  // Position: OPT_DIST_* out from the table border
  const optDist = isMany ? OPT_DIST_MANY : OPT_DIST_ONE
  const optX = x + cos * optDist
  const optY = y + sin * optDist

  const optSymbol = isOptional ? (
    // Open circle = zero / optional
    <circle
      cx={optX}
      cy={optY}
      r={CIRCLE_R}
      fill="var(--rf-background)"
      stroke={color}
      strokeWidth={sw}
    />
  ) : (
    // Single perpendicular bar = mandatory / one
    <line
      x1={optX - px * BAR_HALF}
      y1={optY - py * BAR_HALF}
      x2={optX + px * BAR_HALF}
      y2={optY + py * BAR_HALF}
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
    />
  )

  return (
    <g>
      {multSymbol}
      {optSymbol}
    </g>
  )
}

/** Total extent (outward from the table border) that the indicator occupies — used to shorten the edge path */
function indicatorExtent(isMany: boolean): number {
  return (isMany ? OPT_DIST_MANY : OPT_DIST_ONE) + CIRCLE_R
}

/**
 * X of the table border the line starts on: the node's left edge for a Left
 * handle, its right edge for a Right one. Undefined while the node is missing
 * or unmeasured.
 */
function borderXOf(
  s: ReactFlowState,
  nodeId: string,
  position: Position,
): number | undefined {
  const n = s.nodeLookup.get(nodeId)
  if (!n) return undefined
  const x = n.internals.positionAbsolute.x
  if (position === Position.Left) return x
  const width = n.measured.width
  return width ? x + width : undefined
}

/** How close (px) a route end must be to the live table border for the route to count as fresh. */
const ROUTE_END_TOLERANCE = 1

/**
 * The route to draw: the cached route when both ends still sit on the live
 * table borders, shortened at each end to stop before the cardinality icon. Null
 * when there is no route or it is stale.
 */
function freshRoutePoints(
  route: ReadonlyArray<{ x: number; y: number }> | undefined,
  source: { x: number; y: number },
  target: { x: number; y: number },
  srcExt: number,
  tgtExt: number,
): Array<{ x: number; y: number }> | null {
  if (!route || route.length < 2) return null
  const first = route[0]
  const last = route[route.length - 1]
  if (
    Math.abs(first.x - source.x) > ROUTE_END_TOLERANCE ||
    Math.abs(first.y - source.y) > ROUTE_END_TOLERANCE ||
    Math.abs(last.x - target.x) > ROUTE_END_TOLERANCE ||
    Math.abs(last.y - target.y) > ROUTE_END_TOLERANCE
  ) {
    return null
  }
  const pts = route.map((p) => ({ ...p }))
  const shorten = (from: number, toward: number, by: number) => {
    const a = pts[from]
    const b = pts[toward]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len === 0) return
    const d = Math.min(by, len / 2)
    a.x += ((b.x - a.x) / len) * d
    a.y += ((b.y - a.y) / len) * d
  }
  shorten(0, 1, srcExt)
  shorten(pts.length - 1, pts.length - 2, tgtExt)
  return pts
}

// Label box = pill + flex gap (4) + delete button slot (24, always in the DOM).
const LABEL_BUTTON_SLOT = 28
const LABEL_BUTTON_SIZE = 24
const NO_OBSTACLES: ReadonlyArray<Rect> = []

function rectsEqual(a: ReadonlyArray<Rect>, b: ReadonlyArray<Rect>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].x !== b[i].x ||
      a[i].y !== b[i].y ||
      a[i].width !== b[i].width ||
      a[i].height !== b[i].height
    ) {
      return false
    }
  }
  return true
}

/** Rect the cardinality symbols occupy at one end, outward from the table border. */
function markerRect(
  x: number,
  y: number,
  position: Position,
  extent: number,
): Rect {
  const reach = extent + TABLE_INSET
  switch (position) {
    case Position.Right:
      return {
        x: x - TABLE_INSET,
        y: y - BAR_HALF,
        width: reach,
        height: 2 * BAR_HALF,
      }
    case Position.Left:
      return {
        x: x - extent,
        y: y - BAR_HALF,
        width: reach,
        height: 2 * BAR_HALF,
      }
    case Position.Top:
      return {
        x: x - BAR_HALF,
        y: y - extent,
        width: 2 * BAR_HALF,
        height: reach,
      }
    case Position.Bottom:
      return {
        x: x - BAR_HALF,
        y: y - TABLE_INSET,
        width: 2 * BAR_HALF,
        height: reach,
      }
  }
}

export const RelationshipEdge = memo(
  ({
    id,
    source,
    target,
    sourceX: handleSourceX,
    sourceY,
    targetX: handleTargetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  }: EdgeProps<RelationshipEdgeType>) => {
    const t = useT()
    // React Flow reports each end at its connect dot, about 24 px outside the
    // table. The line and its marker start on the table border instead (design
    // rule, user 2026-11-17); the dots only serve drag-to-connect. Y is the
    // dot's, which is the column row's centre.
    const sourceBorderX = useStore(
      useCallback(
        (s: ReactFlowState) => borderXOf(s, source, sourcePosition),
        [source, sourcePosition],
      ),
    )
    const targetBorderX = useStore(
      useCallback(
        (s: ReactFlowState) => borderXOf(s, target, targetPosition),
        [target, targetPosition],
      ),
    )
    const sourceX = sourceBorderX ?? handleSourceX
    const targetX = targetBorderX ?? handleTargetX
    const {
      cardinality,
      label,
      isHighlighted,
      bundleHandleYOffset,
      bundleCenterXOffset,
    } = data || {}
    const isActive = selected || isHighlighted

    // Bundle offsets — 0 when edge is not in a multi-edge bundle
    const bundleYOff = bundleHandleYOffset ?? 0
    const bundleXOff = bundleCenterXOffset ?? 0

    // Delete button visibility state
    const [isHovered, setIsHovered] = useState(false)
    const [isFocused, setIsFocused] = useState(false)
    const isVisible = isHovered || selected || isFocused

    // Label editing state
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(label ?? '')
    const inputRef = useRef<HTMLInputElement>(null)

    // Sync editValue when label updates from collaboration
    useEffect(() => {
      if (!isEditing) setEditValue(label ?? '')
    }, [label, isEditing])

    const commitLabel = useCallback(() => {
      setIsEditing(false)
      const trimmed = editValue.trim()
      if (trimmed !== (label ?? '')) {
        data?.onLabelUpdate?.(id, trimmed)
      }
    }, [editValue, label, data, id])

    const cancelEdit = useCallback(() => {
      setIsEditing(false)
      setEditValue(label ?? '')
    }, [label])

    const srcAngle = useMemo(
      () => outwardAngle(sourcePosition),
      [sourcePosition],
    )
    const tgtAngle = useMemo(
      () => outwardAngle(targetPosition),
      [targetPosition],
    )

    // Derive multiplicity and optionality from lookup table
    const flags = CARDINALITY_FLAGS[cardinality ?? ''] ?? {
      srcMany: false,
      srcOpt: false,
      tgtMany: false,
      tgtOpt: false,
    }
    const sourceIsMany = flags.srcMany
    const sourceIsOptional = flags.srcOpt
    const targetIsMany = flags.tgtMany
    const targetIsOptional = flags.tgtOpt

    // Shorten the path so it stops before the cardinality icons.
    // Move source/target inward by the icon extent.
    const srcExt = indicatorExtent(sourceIsMany)
    const tgtExt = indicatorExtent(targetIsMany)
    const adjSourceX = sourceX + Math.cos(srcAngle) * srcExt
    const adjSourceY = sourceY + Math.sin(srcAngle) * srcExt
    const adjTargetX = targetX + Math.cos(tgtAngle) * tgtExt
    const adjTargetY = targetY + Math.sin(tgtAngle) * tgtExt

    // Bundle Y offset — stacks on top of the cardinality-indicator shortening.
    // Separates horizontal entry/exit segments for same-table-pair multi-edges.
    const bundledSourceY = adjSourceY + bundleYOff
    const bundledTargetY = adjTargetY + bundleYOff

    // Bundle X offset — fans vertical step segments within the column corridor.
    const defaultCenterX = (adjSourceX + adjTargetX) / 2
    const bundledCenterX = defaultCenterX + bundleXOff

    // A router path replaces the smooth-step one while its ends still sit on
    // the live table borders. A stale route (a table moved and the pass has not run
    // yet) or no route at all draws the smooth-step path below.
    const routedPoints = useMemo(
      () =>
        freshRoutePoints(
          data?.route,
          { x: sourceX, y: sourceY + bundleYOff },
          { x: targetX, y: targetY + bundleYOff },
          srcExt,
          tgtExt,
        ),
      [
        data?.route,
        sourceX,
        sourceY,
        targetX,
        targetY,
        bundleYOff,
        srcExt,
        tgtExt,
      ],
    )

    const [edgePath, labelX, labelY] = useMemo(() => {
      if (routedPoints) {
        const mid = pathMidpoint(routedPoints)
        return [buildRoundedOrthogonalPath(routedPoints), mid.x, mid.y] as const
      }
      return getSmoothStepPath({
        sourceX: adjSourceX,
        sourceY: bundledSourceY,
        sourcePosition,
        targetX: adjTargetX,
        targetY: bundledTargetY,
        targetPosition,
        borderRadius: 16,
        centerX: bundledCenterX,
      })
    }, [
      routedPoints,
      adjSourceX,
      bundledSourceY,
      sourcePosition,
      adjTargetX,
      bundledTargetY,
      targetPosition,
      bundledCenterX,
    ])

    // Clamp the label's X position so the pill doesn't overlap either endpoint
    // table body. getSmoothStepPath returns the geometric path midpoint; for
    // same-side (right→right or left→left) C-curves with long labels the pill
    // can extend back over the source table. The clamp ensures:
    //   right→right: pill left edge ≥ max(sourceX, targetX) + margin
    //   left→left:   pill right edge ≤ min(sourceX, targetX) − margin
    // A router path already clears the tables, so it skips the clamp.
    const labelPillWidth = computeLabelPillWidth(label ?? '')
    const displayLabelX = routedPoints
      ? labelX
      : clampSameSideLabelX(
          labelX,
          labelPillWidth,
          sourceX,
          sourcePosition,
          targetX,
          targetPosition,
        )

    // Slide the label along its own line to the nearest point no table covers.
    // The canvas layer paints tables above edge labels, so a covered label is
    // invisible. The same-side clamp above stays as the preferred anchor: it
    // is the existing look when nothing is in the way, and the slide only
    // takes over when that anchor sits on a table.
    //
    // Perf: the obstacle list comes from a per-edge `useStore` selector with
    // an equality function, and only for LABELLED edges. It keeps just the
    // table rects that overlap this edge's padded bounds, so a drag frame
    // re-renders an edge only when a table near its line moved or resized.
    const hasLabel = !!label
    const labelBoxWidth = labelPillWidth + LABEL_BUTTON_SLOT
    const labelBoxHeight = Math.max(computeLabelPillHeight(), LABEL_BUTTON_SIZE)
    const pathPoints = useMemo(
      () => (hasLabel ? flattenSmoothPath(edgePath) : []),
      [hasLabel, edgePath],
    )
    const searchBounds = useMemo(() => {
      if (pathPoints.length === 0) return null
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const p of pathPoints) {
        minX = Math.min(minX, p.x)
        minY = Math.min(minY, p.y)
        maxX = Math.max(maxX, p.x)
        maxY = Math.max(maxY, p.y)
      }
      const padX = labelBoxWidth / 2 + LABEL_OBSTACLE_MARGIN
      const padY = labelBoxHeight / 2 + LABEL_OBSTACLE_MARGIN
      return {
        left: minX - padX,
        top: minY - padY,
        right: maxX + padX,
        bottom: maxY + padY,
      }
    }, [pathPoints, labelBoxWidth, labelBoxHeight])
    const tableRects = useStore(
      useCallback(
        (s): ReadonlyArray<Rect> => {
          if (!searchBounds) return NO_OBSTACLES
          const out: Array<Rect> = []
          for (const n of s.nodeLookup.values()) {
            const r = nodeObstacleRect(n)
            if (
              r &&
              r.x < searchBounds.right &&
              r.x + r.width > searchBounds.left &&
              r.y < searchBounds.bottom &&
              r.y + r.height > searchBounds.top
            ) {
              out.push(r)
            }
          }
          return out
        },
        [searchBounds],
      ),
      rectsEqual,
    )
    const placement = useMemo(() => {
      if (!hasLabel) return { x: displayLabelX, y: labelY, covered: false }
      return placeEdgeLabel({
        path: edgePath,
        mid: { x: displayLabelX, y: labelY },
        labelWidth: labelBoxWidth,
        labelHeight: labelBoxHeight,
        obstacles: [
          ...tableRects,
          markerRect(sourceX, sourceY + bundleYOff, sourcePosition, srcExt),
          markerRect(targetX, targetY + bundleYOff, targetPosition, tgtExt),
        ],
      })
    }, [
      hasLabel,
      edgePath,
      displayLabelX,
      labelY,
      labelBoxWidth,
      labelBoxHeight,
      tableRects,
      sourceX,
      sourceY,
      targetX,
      targetY,
      bundleYOff,
      sourcePosition,
      targetPosition,
      srcExt,
      tgtExt,
    ])
    // No point on the line is free: draw above the canvas table layer.
    const labelPortalTarget = useStore(
      useCallback(
        (s: ReactFlowState) =>
          placement.covered ? selectEdgeLabelTopLayer(s) : null,
        [placement.covered],
      ),
    )

    const gradientId = `edge-gradient-${id}`
    const glowFilterId = `edge-glow-${id}`

    const cardinalityColor = getCardinalityColor(cardinality)
    const color = isActive ? 'var(--rf-edge-stroke-selected)' : cardinalityColor
    const sw = isActive ? 1.6 : 1.2

    const renderLabel = (node: ReactElement) =>
      labelPortalTarget ? (
        createPortal(node, labelPortalTarget)
      ) : (
        <EdgeLabelRenderer>{node}</EdgeLabelRenderer>
      )

    return (
      <>
        <defs>
          <linearGradient
            id={gradientId}
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
            gradientUnits="userSpaceOnUse"
          >
            <stop
              offset="0%"
              stopColor={
                isActive
                  ? 'var(--rf-edge-gradient-start-active)'
                  : cardinalityColor
              }
              stopOpacity={isActive ? 1 : 0.7}
            />
            <stop
              offset="100%"
              stopColor={
                isActive
                  ? 'var(--rf-edge-gradient-end-active)'
                  : cardinalityColor
              }
            />
          </linearGradient>
          {isActive && (
            <filter
              id={glowFilterId}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="3"
                result="blur"
              />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        {/* Invisible wide hit-area for hover detection — must come before visible path */}
        <path
          d={edgePath}
          fill="none"
          stroke="transparent"
          strokeWidth={20}
          style={{ cursor: 'pointer', pointerEvents: 'visibleStroke' }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        />

        {/* Glow underlay */}
        {isActive && (
          <path
            d={edgePath}
            fill="none"
            stroke="var(--rf-edge-glow)"
            strokeWidth={8}
            strokeLinecap="round"
            style={{ filter: `url(#${glowFilterId})`, opacity: 0.4 }}
          />
        )}

        {/* Main edge path — shortened to stop before icons */}
        <path
          id={id}
          className="react-flow__edge-path"
          d={edgePath}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={isActive ? 2.5 : 1.5}
          strokeLinecap="round"
          style={{ transition: 'stroke-width 0.2s ease' }}
        />

        {/* Source cardinality — shifted by bundle Y offset so indicator tip meets fanned path */}
        <CardinalityIndicator
          x={sourceX}
          y={sourceY + bundleYOff}
          angle={srcAngle}
          isMany={sourceIsMany}
          isOptional={sourceIsOptional}
          color={color}
          sw={sw}
        />

        {/* Target cardinality — shifted by bundle Y offset so indicator tip meets fanned path */}
        <CardinalityIndicator
          x={targetX}
          y={targetY + bundleYOff}
          angle={tgtAngle}
          isMany={targetIsMany}
          isOptional={targetIsOptional}
          color={color}
          sw={sw}
        />

        {/* Animated dots */}
        {isHighlighted && (
          <g>
            <circle r="2.5" fill="var(--rf-edge-stroke-selected)" opacity="0.7">
              <animateMotion
                dur="3s"
                repeatCount="indefinite"
                path={edgePath}
              />
            </circle>
            <circle r="2.5" fill="var(--rf-edge-stroke-selected)" opacity="0.7">
              <animateMotion
                dur="3s"
                repeatCount="indefinite"
                path={edgePath}
                begin="1.5s"
              />
            </circle>
          </g>
        )}

        {/* Label + delete button — flex row, no overlap */}
        {renderLabel(
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${placement.x}px,${placement.y}px)`,
              pointerEvents: 'all',
              zIndex: Z_INDEX.EDGE_LABEL,
              // The top layer has zero width; without this the pill wraps per word.
              whiteSpace: 'nowrap',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {/* Label pill — visible when label exists, editing, or edge is active/hovered */}
            {(isVisible || !!label || isEditing) && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'var(--rf-edge-label-bg)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  borderRadius: '20px',
                  border: isEditing
                    ? '1px solid var(--rf-edge-stroke-selected)'
                    : label
                      ? `1px solid ${isActive ? 'var(--rf-edge-stroke-selected)' : 'var(--rf-edge-label-border)'}`
                      : '1px dashed var(--rf-edge-label-border)',
                  padding: '3px 10px',
                  boxShadow: isEditing
                    ? '0 0 12px var(--rf-edge-glow)'
                    : isActive
                      ? '0 0 8px var(--rf-edge-glow)'
                      : '0 1px 4px rgba(0,0,0,0.06)',
                  fontSize: '11px',
                  fontWeight: 500,
                  letterSpacing: '0.02em',
                  color:
                    isActive || isEditing
                      ? 'var(--rf-edge-stroke-selected)'
                      : 'var(--rf-table-text)',
                  transition: 'border-color 0.2s, box-shadow 0.2s, color 0.2s',
                }}
              >
                {isEditing ? (
                  <input
                    ref={inputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value.slice(0, 255))}
                    onBlur={commitLabel}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitLabel()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEdit()
                      }
                      e.stopPropagation()
                    }}
                    maxLength={255}
                    autoFocus
                    className="nodrag nopan"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontSize: '11px',
                      fontWeight: 500,
                      letterSpacing: '0.02em',
                      color: 'var(--rf-edge-stroke-selected)',
                      minWidth: '60px',
                      width: `${Math.max(60, editValue.length * 7 + 16)}px`,
                      padding: 0,
                    }}
                  />
                ) : label ? (
                  <span
                    onDoubleClick={(e) => {
                      // Measured empirically (2026-08-31, live browser, not
                      // library source): without this stopPropagation, a
                      // double-click here also reaches React Flow's
                      // dblclick-to-zoom handler and zooms the canvas 2x
                      // (151% -> 303% in the measured run). With it, the
                      // zoom level is unchanged (151% -> 151%). The call is
                      // load-bearing, now more consequential since emptying
                      // this text is the only way to clear a label
                      // (2026-08-31 tactical plan, #54). Mirrors the delete
                      // button's own stopPropagation call below, for the
                      // same reason.
                      e.stopPropagation()
                      setIsEditing(true)
                    }}
                    title={t('whiteboard.relationship.editLabel')}
                    style={{ cursor: 'default', userSelect: 'none' }}
                  >
                    {label}
                  </span>
                ) : (
                  <span
                    onClick={() => setIsEditing(true)}
                    style={{
                      fontStyle: 'italic',
                      opacity: 0.55,
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    {t('whiteboard.relationship.addLabel')}
                  </span>
                )}
              </div>
            )}

            {/* Delete button wrapper — always in DOM; opacity/pointerEvents control visibility */}
            <div
              style={{
                opacity: isVisible ? 1 : 0,
                pointerEvents: isVisible ? 'all' : 'none',
                transition: 'opacity 150ms ease, background-color 0.15s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <button
                type="button"
                aria-label={t('whiteboard.relationship.delete')}
                className="nodrag nopan"
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  data?.onDelete?.(id)
                }}
                style={{
                  width: '20px',
                  height: '20px',
                  minWidth: '24px',
                  minHeight: '24px',
                  borderRadius: '50%',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: cardinalityColor,
                  color: '#ffffff',
                  boxShadow:
                    '0 1px 6px rgba(0,0,0,0.3), 0 0 0 2px rgba(0,0,0,0.08)',
                  backdropFilter: 'blur(4px)',
                  WebkitBackdropFilter: 'blur(4px)',
                  padding: 0,
                  outline: 'none',
                }}
              >
                <Trash2 size={12} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          </div>,
        )}
      </>
    )
  },
)

RelationshipEdge.displayName = 'RelationshipEdge'
