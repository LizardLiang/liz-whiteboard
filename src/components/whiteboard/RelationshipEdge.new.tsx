import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EdgeLabelRenderer, Position, getSmoothStepPath } from '@xyflow/react'
import { X } from 'lucide-react'
import type { EdgeProps } from '@xyflow/react'
import type { RelationshipEdgeData } from '@/lib/react-flow/types'
import { Z_INDEX } from '@/lib/react-flow/types'

// ── Layout constants ──
// How far past the handle to push the crow's foot prong tips toward the table
const TABLE_INSET = 10
// Crow's foot convergence point distance outward from handle
const CROW_LENGTH = 2
// Crow's foot half-spread (perpendicular distance of outer prongs)
const CROW_SPREAD = 6
// Curvature of outer prongs (quadratic bezier bow)
const CROW_CURVE = 3
// Multiplicity bar inset toward table from handle
const MULT_BAR_INSET = 2
// Bar half-height (perpendicular extent of a bar symbol)
const BAR_HALF = 6
// Open circle radius (for zero/optional symbol)
const CIRCLE_R = 4
// Gap between the multiplicity symbol outer edge and the optionality symbol center
const OPT_GAP = 7

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
 * Standard crow's foot layout (reading outward from handle toward the edge line):
 *   [table] ← handle ← [multiplicity: crow/bar] ··· [optionality: circle/bar] ← edge line
 *
 * Multiplicity symbol (closest to table, at handle):
 *   - Crow's foot (⋈) = many
 *   - Single perpendicular bar (|) = one
 *
 * Optionality symbol (further out, OPT_GAP from multiplicity):
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

  // ── Multiplicity symbol (at handle, touching the table) ──
  const multSymbol = isMany ? (
    (() => {
      // Crow's foot: prong tips at handle - TABLE_INSET, convergence at handle + CROW_LENGTH
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
  // Position: past multiplicity outer edge + OPT_GAP
  const multExt = isMany ? CROW_LENGTH : 0
  const optX = x + cos * (multExt + OPT_GAP)
  const optY = y + sin * (multExt + OPT_GAP)

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

/** Total extent (outward from handle) that the indicator occupies — used to shorten the edge path */
function indicatorExtent(isMany: boolean): number {
  const multExt = isMany ? CROW_LENGTH : 0
  return multExt + OPT_GAP + CIRCLE_R
}

export const RelationshipEdge = memo(
  ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    data,
    selected,
  }: EdgeProps<RelationshipEdgeData>) => {
    const { cardinality, label, isHighlighted } = data || {}
    const isActive = selected || isHighlighted

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

    const [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX: adjSourceX,
      sourceY: adjSourceY,
      sourcePosition,
      targetX: adjTargetX,
      targetY: adjTargetY,
      targetPosition,
      borderRadius: 16,
    })

    const gradientId = `edge-gradient-${id}`
    const glowFilterId = `edge-glow-${id}`

    const cardinalityColor = getCardinalityColor(cardinality)
    const color = isActive ? 'var(--rf-edge-stroke-selected)' : cardinalityColor
    const sw = isActive ? 1.6 : 1.2

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

        {/* Source cardinality */}
        <CardinalityIndicator
          x={sourceX}
          y={sourceY}
          angle={srcAngle}
          isMany={sourceIsMany}
          isOptional={sourceIsOptional}
          color={color}
          sw={sw}
        />

        {/* Target cardinality */}
        <CardinalityIndicator
          x={targetX}
          y={targetY}
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
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              zIndex: Z_INDEX.EDGE_LABEL,
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
                    onDoubleClick={() => setIsEditing(true)}
                    title="Double-click to edit"
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
                    + Add label
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
                aria-label="Delete relationship"
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
                <X size={12} strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
          </div>
        </EdgeLabelRenderer>
      </>
    )
  },
)

RelationshipEdge.displayName = 'RelationshipEdge'
