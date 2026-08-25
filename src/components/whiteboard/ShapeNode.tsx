// src/components/whiteboard/ShapeNode.tsx
// The `shape` React Flow node — SVG geometry layer + HTML label layer
// (tech-spec §5). No <foreignObject> anywhere: FR-040's export path
// (getNodesBounds + html-to-image's toPng) rasterises HTML text reliably and
// foreignObject text does not.
//
// The node wrapper is `pointer-events: none` via CSS
// (.react-flow .react-flow__node-shape) — painted SVG and the label
// re-enable it selectively (src/styles/react-flow-theme.css). This fixes the
// transparent-fill click-swallowing pitfall AND the diamond/ellipse
// bounding-box-corner pitfall in one rule.

import { useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import { connectorArrowMarkerId } from './ConnectorMarkerDefs'
import { ShapeLabelEditor } from './ShapeLabelEditor'
import { ShapeStyleControls } from './ShapeStyleControls'
import type { NodeProps } from '@xyflow/react'
import type {
  QuickCreateDirection,
  ShapeNodeType,
} from '@/lib/react-flow/types'
import {
  CONNECT_HIT_STROKE_WIDTH,
  DASHED_STROKE_PATTERN,
  DRAW_DRAG_THRESHOLD_PX,
  DRAW_PLACEHOLDER_BORDER,
  MIN_SHAPE_HEIGHT,
  MIN_SHAPE_WIDTH,
  SHAPE_HANDLE_IDS,
} from '@/lib/react-flow/types'
import { resolveAreaColor } from '@/lib/area-colors'

/** Per-kind SVG geometry — rectangle/text share the same rect painter. */
function ShapeGeometry({
  kind,
  width,
  height,
  props,
  fill,
  isUnfilled,
  stroke,
  strokeWidth,
  dash,
  markerId,
}: {
  kind: ShapeNodeType['data']['shape']['kind']
  width: number
  height: number
  props: ShapeNodeType['data']['shape']['props']
  fill: string
  isUnfilled: boolean
  stroke: string
  strokeWidth: number
  dash: string | undefined
  markerId: string
}) {
  const hitStrokeWidth = Math.max(strokeWidth, CONNECT_HIT_STROKE_WIDTH)
  const paintedClass = `shape-painted${isUnfilled ? ' shape-painted--unfilled' : ''}`

  switch (kind) {
    case 'rectangle':
      return (
        <>
          <rect
            x={1}
            y={1}
            width={Math.max(width - 2, 0)}
            height={Math.max(height - 2, 0)}
            rx={4}
            fill="none"
            stroke="transparent"
            strokeWidth={hitStrokeWidth}
            className="shape-hit-stroke"
          />
          <rect
            x={1}
            y={1}
            width={Math.max(width - 2, 0)}
            height={Math.max(height - 2, 0)}
            rx={4}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            className={paintedClass}
          />
        </>
      )
    case 'ellipse': {
      const cx = width / 2
      const cy = height / 2
      const rx = Math.max(width / 2 - 1, 0)
      const ry = Math.max(height / 2 - 1, 0)
      return (
        <>
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill="none"
            stroke="transparent"
            strokeWidth={hitStrokeWidth}
            className="shape-hit-stroke"
          />
          <ellipse
            cx={cx}
            cy={cy}
            rx={rx}
            ry={ry}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            className={paintedClass}
          />
        </>
      )
    }
    case 'diamond': {
      const points = `${width / 2},1 ${width - 1},${height / 2} ${width / 2},${height - 1} 1,${height / 2}`
      return (
        <>
          <polygon
            points={points}
            fill="none"
            stroke="transparent"
            strokeWidth={hitStrokeWidth}
            className="shape-hit-stroke"
          />
          <polygon
            points={points}
            fill={fill}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            className={paintedClass}
          />
        </>
      )
    }
    case 'line': {
      if (props.kind !== 'line') return null
      const x1 = props.x1 * width
      const y1 = props.y1 * height
      const x2 = props.x2 * width
      const y2 = props.y2 * height
      return (
        <>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="transparent"
            strokeWidth={hitStrokeWidth}
            className="shape-hit-stroke"
          />
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={stroke}
            strokeWidth={strokeWidth}
            strokeDasharray={dash}
            className="shape-painted shape-painted--unfilled"
            markerStart={props.arrowStart ? `url(#${markerId})` : undefined}
            markerEnd={props.arrowEnd ? `url(#${markerId})` : undefined}
          />
        </>
      )
    }
    case 'text':
      return null
  }
}

export function ShapeNode({
  id,
  data,
  width,
  height,
  selected,
}: NodeProps<ShapeNodeType>) {
  const {
    shape,
    canEdit,
    isKeyboardFocused,
    isDraft,
    editRequestToken,
    onResizeEnd,
    onStyleChange,
    onLabelCommit,
    onDraftCommit,
    onDraftCancel,
    onDelete,
    onQuickCreate,
  } = data

  const w = width ?? shape.width
  const h = height ?? shape.height

  const [editing, setEditing] = useState(isDraft === true)
  const lastTokenRef = useRef(editRequestToken)

  // Quick-create (click a marker) vs connect (drag a marker). React Flow
  // starts its connection on pointerdown, so this NEVER calls
  // preventDefault/stopPropagation — swallowing that event would break the
  // shipped drag-to-connect path. It only measures how far the pointer
  // travelled and, under the same threshold a draw gesture uses, treats the
  // release as a click. A click-release over nothing ends React Flow's
  // connection with no connector, which is its existing behaviour.
  const markerPressRef = useRef<{ x: number; y: number } | null>(null)

  function handleMarkerPointerDown(event: React.PointerEvent) {
    if (!canEdit || isDraft) return
    markerPressRef.current = { x: event.clientX, y: event.clientY }
  }

  function handleMarkerPointerUp(
    event: React.PointerEvent,
    direction: QuickCreateDirection,
  ) {
    const press = markerPressRef.current
    markerPressRef.current = null
    if (!press || !canEdit || isDraft) return
    const travelled = Math.hypot(
      event.clientX - press.x,
      event.clientY - press.y,
    )
    if (travelled > DRAW_DRAG_THRESHOLD_PX) return
    onQuickCreate?.(id, direction)
  }

  useEffect(() => {
    if (
      editRequestToken !== undefined &&
      editRequestToken !== lastTokenRef.current
    ) {
      lastTokenRef.current = editRequestToken
      setEditing(true)
    }
  }, [editRequestToken])

  const strokeColor = resolveAreaColor(shape.style.stroke).solid
  const isUnfilled = shape.style.fill === 'none'
  const fillColor = isUnfilled
    ? 'none'
    : resolveAreaColor(shape.style.fill).solid
  const dash =
    shape.style.strokeStyle === 'dashed' ? DASHED_STROKE_PATTERN : undefined
  const markerId = connectorArrowMarkerId(shape.style.stroke, !!selected)

  function commitLabel(text: string) {
    setEditing(false)
    const trimmed = text.trim()
    if (isDraft) {
      if (trimmed.length === 0) {
        onDraftCancel?.(id)
      } else {
        onDraftCommit?.(shape, text)
      }
      return
    }
    if (shape.kind === 'text' && trimmed.length === 0) {
      // Clearing an existing text shape's label deletes it through the same
      // shape:delete path, so FR-018's connector cascade applies (FR-012).
      onDelete?.(id)
      return
    }
    onLabelCommit?.(id, text)
  }

  // Dashed placeholder outline (FR-012): shown for an uncommitted draft, or
  // for a persisted empty text shape while selected (so it stays grabbable).
  const showDashedPlaceholder =
    isDraft || (shape.kind === 'text' && selected && !shape.text && !editing)

  const wrapperClassName = [
    'react-flow__node-shape',
    selected ? 'selected' : '',
    isKeyboardFocused ? 'kbd-focused' : '',
    // N1 (Apollo): fully suppresses handle interactivity — hover-reveal
    // included, not just the connection-start gate — for a read-only
    // viewer (public share link OR an authenticated VIEWER). Handles stay
    // MOUNTED regardless (read-only.css only zeroes pointer-events): React
    // Flow's own edge-position resolver needs at least one registered
    // handle bound per side to render a connector at all — unmounting them
    // entirely would silently blank every connector for every read-only
    // viewer, which contradicts §6a.
    canEdit ? '' : 'read-only',
  ]
    .filter(Boolean)
    .join(' ')

  const textColor =
    shape.style.textColor === 'auto'
      ? undefined
      : resolveAreaColor(shape.style.textColor).solid

  return (
    <>
      {canEdit && !isDraft && (
        <NodeResizer
          isVisible={!!selected}
          minWidth={MIN_SHAPE_WIDTH}
          minHeight={MIN_SHAPE_HEIGHT}
          onResizeEnd={(_event, params) => {
            onResizeEnd?.(id, {
              positionX: params.x,
              positionY: params.y,
              width: params.width,
              height: params.height,
            })
          }}
        />
      )}
      {canEdit && !isDraft && (
        <ShapeStyleControls
          style={shape.style}
          visible={!!selected}
          onChange={(patch) => onStyleChange?.(id, patch)}
        />
      )}
      <div
        className={wrapperClassName}
        style={{ width: w, height: h, position: 'relative' }}
        onDoubleClick={() => {
          if (canEdit && !isDraft) setEditing(true)
        }}
      >
        <svg
          width={w}
          height={h}
          style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
        >
          <ShapeGeometry
            kind={shape.kind}
            width={w}
            height={h}
            props={shape.props}
            fill={fillColor}
            isUnfilled={isUnfilled}
            stroke={strokeColor}
            strokeWidth={shape.style.strokeWidth}
            dash={dash}
            markerId={markerId}
          />
        </svg>

        {showDashedPlaceholder && (
          <div
            aria-hidden
            style={{
              position: 'absolute',
              inset: 0,
              border: DRAW_PLACEHOLDER_BORDER,
              pointerEvents: 'none',
            }}
          />
        )}

        <div
          style={{
            position: 'absolute',
            inset: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          {editing ? (
            <div
              className="shape-label"
              style={{ width: '100%', height: '100%' }}
            >
              <ShapeLabelEditor
                initialText={shape.text ?? ''}
                onCommit={commitLabel}
              />
            </div>
          ) : (
            shape.text && (
              <div
                className="shape-label"
                style={{
                  fontSize: shape.style.fontSize,
                  color: textColor,
                  textAlign: 'center',
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                  cursor: canEdit ? 'text' : undefined,
                }}
              >
                {shape.text}
              </div>
            )
          )}
        </div>

        {/*
          Always mounted for non-draft, non-line shapes — REGARDLESS of
          canEdit. React Flow's own edge-position resolver
          (getEdgePosition/getHandle in @xyflow/system) needs at least one
          REGISTERED handle bound per side to compute a connector's
          position at all; if zero handles are rendered, it returns null
          and BaseEdge never mounts — every connector would silently vanish
          for every read-only viewer, contradicting §6a's "shapes and
          connectors DO render, read-only" requirement.

          `isConnectable={canEdit}` is the actual N1 gate: React Flow's own
          handle mousedown/touchstart listener checks isConnectableStart
          before starting a drag, so a read-only viewer cannot start a
          connection from a mounted-but-inert handle. The `.read-only`
          wrapper class (above) additionally zeroes pointer-events on every
          handle via CSS, so there is no hover affordance either.
        */}
        {!isDraft && shape.kind !== 'line' && (
          <>
            <Handle
              type="source"
              position={Position.Top}
              id={SHAPE_HANDLE_IDS.sourceTop}
              className="shape-src"
              isConnectable={canEdit}
              onPointerDown={handleMarkerPointerDown}
              onPointerUp={(event) => handleMarkerPointerUp(event, 'top')}
            />
            <Handle
              type="source"
              position={Position.Right}
              id={SHAPE_HANDLE_IDS.sourceRight}
              className="shape-src"
              isConnectable={canEdit}
              onPointerDown={handleMarkerPointerDown}
              onPointerUp={(event) => handleMarkerPointerUp(event, 'right')}
            />
            <Handle
              type="source"
              position={Position.Bottom}
              id={SHAPE_HANDLE_IDS.sourceBottom}
              className="shape-src"
              isConnectable={canEdit}
              onPointerDown={handleMarkerPointerDown}
              onPointerUp={(event) => handleMarkerPointerUp(event, 'bottom')}
            />
            <Handle
              type="source"
              position={Position.Left}
              id={SHAPE_HANDLE_IDS.sourceLeft}
              className="shape-src"
              isConnectable={canEdit}
              onPointerDown={handleMarkerPointerDown}
              onPointerUp={(event) => handleMarkerPointerUp(event, 'left')}
            />
            <Handle
              type="target"
              position={Position.Top}
              id={SHAPE_HANDLE_IDS.target}
              className="shape-tgt"
              isConnectable={canEdit}
            />
          </>
        )}
      </div>
    </>
  )
}
