// src/components/whiteboard/ShapeDrawOverlay.tsx
// The pointer-event state machine and rubber-band preview for drag-to-draw
// (D-2, FR-002...FR-006). Mounts ONLY while a draw tool is armed, inside
// `.react-flow-wrapper`.
//
// H1 (the fix that must not be re-broken): this overlay is `pointer-events:
// none`. It is never a hit-test target, so `wheel`/`mousedown`/`click` all
// reach whatever is beneath it exactly as if it were not mounted —
// panOnScroll, Ctrl+wheel zoom, pinch-zoom and the <Controls> zoom buttons
// all keep working while a tool is armed. The gesture instead runs from
// CAPTURE-PHASE listeners attached directly to `.react-flow-wrapper`, found
// via `overlayRef.current?.closest('.react-flow-wrapper')` — capture phase
// on the wrapper fires before the pane's own (native) listeners, letting the
// overlay claim the gesture without being in the hit-test path itself.
//
// The `lostpointercapture` trap (M6): it fires after EVERY pointerup, not
// just abnormal endings, because releasing the pointer implicitly releases
// capture. The mis-click row of the termination matrix (below-threshold
// drag stays ARMED) would break if this event disarmed unconditionally.
// Guarded by `gestureRef`, cleared synchronously by the pointerup handler
// before capture is actually released.

import { useLayoutEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { DrawTool } from '@/lib/react-flow/tool-mode'
import { DRAW_DRAG_THRESHOLD_PX } from '@/lib/react-flow/types'

export interface ShapeDrawOverlayProps {
  activeTool: DrawTool
  /**
   * Fires once per completed (>= threshold) drag. `rect` is the normalised
   * top-left bounding box in flow coordinates. `drag` carries the RAW
   * (unsorted) press/release points, also in flow coordinates, so the
   * caller can derive the `arrow` kind's `props.x1/y1/x2/y2` fractions from
   * the actual drag direction rather than always defaulting to horizontal.
   */
  onCommit: (
    kind: DrawTool,
    rect: { x: number; y: number; width: number; height: number },
    drag: { startX: number; startY: number; endX: number; endY: number },
  ) => void
  /** Fires whenever the tool should revert to `select` — every abnormal
   * ending (pointercancel, mid-drag lostpointercapture, window blur) and
   * every idle-armed Escape. NOT called for a below-threshold mis-click
   * (D-2: the tool stays armed) or a normal Escape-mid-drag, which the
   * caller already treats the same way (both revert to select — see
   * ReactFlowWhiteboard's shared handler). */
  onDisarm: () => void
}

interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

export function ShapeDrawOverlay({
  activeTool,
  onCommit,
  onDisarm,
}: ShapeDrawOverlayProps) {
  const reactFlowInstance = useReactFlow()
  const overlayRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<{
    pointerId: number
    startX: number
    startY: number
  } | null>(null)
  const [rect, setRect] = useState<ScreenRect | null>(null)

  // Refs so the effect below never needs activeTool/onCommit/onDisarm in
  // its dependency array (attaching/detaching native listeners on every
  // prop identity change would be wasteful and could drop an in-flight
  // gesture's listeners mid-drag).
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
  const onDisarmRef = useRef(onDisarm)
  onDisarmRef.current = onDisarm

  // useLayoutEffect (not useEffect): attaches the native listeners
  // synchronously after DOM mutation, before the browser paints — a plain
  // useEffect runs after paint, which is a real (if narrow) race: a pointer
  // gesture that starts between paint and effect-commit would be missed
  // entirely (observed empirically in e2e: the overlay was "visible" per
  // Playwright before its listeners were attached).
  useLayoutEffect(() => {
    const wrapper = overlayRef.current?.closest<HTMLElement>(
      '.react-flow-wrapper',
    )
    if (!wrapper) return

    function endGesture() {
      gestureRef.current = null
      setRect(null)
    }

    function onPointerDownCapture(e: PointerEvent) {
      if (e.button !== 0 || !e.isPrimary) return
      const t = e.target as Element
      // React Flow's own panels (Controls/MiniMap) are children of
      // <ReactFlow>, inside the wrapper — clicking them must not draw.
      if (
        t.closest(
          '.react-flow__controls, .react-flow__minimap, .react-flow__panel, .minimap-backdrop',
        )
      ) {
        return
      }
      e.stopPropagation() // the pane never sees this pointerdown at all
      e.preventDefault() // also suppresses compat mousedown/mousemove/mouseup
      wrapper!.setPointerCapture(e.pointerId)
      gestureRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      }
      setRect({ left: e.clientX, top: e.clientY, width: 0, height: 0 })
    }

    function onPointerMoveCapture(e: PointerEvent) {
      const g = gestureRef.current
      if (!g || e.pointerId !== g.pointerId) return
      setRect({
        left: Math.min(g.startX, e.clientX),
        top: Math.min(g.startY, e.clientY),
        width: Math.abs(e.clientX - g.startX),
        height: Math.abs(e.clientY - g.startY),
      })
    }

    function onPointerUpCapture(e: PointerEvent) {
      const g = gestureRef.current
      if (!g || e.pointerId !== g.pointerId) return
      const travel = Math.hypot(e.clientX - g.startX, e.clientY - g.startY)
      // Clear synchronously BEFORE the browser dispatches the implicit
      // lostpointercapture that follows every pointerup — this is what
      // keeps a mis-click from being mistaken for an abnormal ending.
      endGesture()

      if (travel < DRAW_DRAG_THRESHOLD_PX) {
        // Mis-click: nothing created, tool stays armed (D-2's one
        // deliberate non-disarming row).
        return
      }

      const left = Math.min(g.startX, e.clientX)
      const top = Math.min(g.startY, e.clientY)
      const p1 = reactFlowInstance.screenToFlowPosition({ x: left, y: top })
      const p2 = reactFlowInstance.screenToFlowPosition({
        x: left + Math.abs(e.clientX - g.startX),
        y: top + Math.abs(e.clientY - g.startY),
      })
      const flowStart = reactFlowInstance.screenToFlowPosition({
        x: g.startX,
        y: g.startY,
      })
      const flowEnd = reactFlowInstance.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      })
      onCommitRef.current(
        activeToolRef.current,
        { x: p1.x, y: p1.y, width: p2.x - p1.x, height: p2.y - p1.y },
        {
          startX: flowStart.x,
          startY: flowStart.y,
          endX: flowEnd.x,
          endY: flowEnd.y,
        },
      )
    }

    function onPointerCancelCapture() {
      if (gestureRef.current === null) return
      endGesture()
      onDisarmRef.current()
    }

    function onLostPointerCaptureCapture() {
      // Fires after EVERY pointerup — only treat it as an abnormal ending
      // if a gesture is still in progress (not already cleared above).
      if (gestureRef.current === null) return
      endGesture()
      onDisarmRef.current()
    }

    function onWindowBlur() {
      // Disarms unconditionally, gesture in progress or not (D-2: "pointer
      // leaving the window" disarms even if nothing was mid-drag).
      endGesture()
      onDisarmRef.current()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // D-5: preventDefault so cancelling a draw doesn't also close an
      // open table-edit overlay (its Escape listener checks
      // !e.defaultPrevented).
      e.preventDefault()
      endGesture()
      onDisarmRef.current()
    }

    wrapper.addEventListener('pointerdown', onPointerDownCapture, {
      capture: true,
    })
    wrapper.addEventListener('pointermove', onPointerMoveCapture, {
      capture: true,
    })
    wrapper.addEventListener('pointerup', onPointerUpCapture, {
      capture: true,
    })
    wrapper.addEventListener('pointercancel', onPointerCancelCapture, {
      capture: true,
    })
    wrapper.addEventListener(
      'lostpointercapture',
      onLostPointerCaptureCapture,
      { capture: true },
    )
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('keydown', onKeyDown, { capture: true })

    return () => {
      wrapper.removeEventListener('pointerdown', onPointerDownCapture, {
        capture: true,
      })
      wrapper.removeEventListener('pointermove', onPointerMoveCapture, {
        capture: true,
      })
      wrapper.removeEventListener('pointerup', onPointerUpCapture, {
        capture: true,
      })
      wrapper.removeEventListener('pointercancel', onPointerCancelCapture, {
        capture: true,
      })
      wrapper.removeEventListener(
        'lostpointercapture',
        onLostPointerCaptureCapture,
        { capture: true },
      )
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
    // Intentionally re-runs only when the wrapper element itself could
    // change (never, in practice) — activeTool/onCommit/onDisarm are read
    // through refs so an in-flight gesture's listeners are never torn down
    // mid-drag.
  }, [reactFlowInstance])

  return (
    <div
      ref={overlayRef}
      data-testid="shape-draw-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      {rect && <DrawPreview kind={activeTool} rect={rect} />}
    </div>
  )
}

function DrawPreview({ kind, rect }: { kind: DrawTool; rect: ScreenRect }) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }

  if (kind === 'rectangle' || kind === 'text') {
    return (
      <div
        style={{
          ...style,
          border: '1.5px dashed var(--rf-edge-stroke-selected)',
        }}
      />
    )
  }
  if (kind === 'ellipse') {
    return (
      <div
        style={{
          ...style,
          border: '1.5px dashed var(--rf-edge-stroke-selected)',
          borderRadius: '50%',
        }}
      />
    )
  }
  if (kind === 'diamond') {
    const points = `${rect.width / 2},0 ${rect.width},${rect.height / 2} ${rect.width / 2},${rect.height} 0,${rect.height / 2}`
    return (
      <svg style={style} width={rect.width} height={rect.height}>
        <polygon
          points={points}
          fill="none"
          stroke="var(--rf-edge-stroke-selected)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      </svg>
    )
  }
  // arrow
  return (
    <svg style={style} width={rect.width} height={rect.height}>
      <line
        x1={0}
        y1={0}
        x2={rect.width}
        y2={rect.height}
        stroke="var(--rf-edge-stroke-selected)"
        strokeWidth={1.5}
        strokeDasharray="6 4"
      />
    </svg>
  )
}
