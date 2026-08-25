// src/components/canvas/use-canvas-input.ts
// Pointer, wheel and keyboard input for the canvas engine (tactical plan
// Wave 3, step 10).
//
// A canvas has no DOM, so there are no per-element event handlers and no
// `elementFromPoint`: every gesture here is "convert the pointer to world
// space with camera.ts, ask hit-test.ts what is there, mutate the scene".
// EVERY coordinate conversion goes through `screenToWorld`/`worldToScreen`
// — this file never writes the transform by hand, which is the structural
// answer to W1 and W3 (both were a second, divergent transform at a call
// site).
//
// Persistence happens at gesture END, never per frame. That is the rule the
// shape drag path already follows, and it is what keeps a 60Hz drag from
// becoming 60 writes a second. Wave 4 wires the callbacks; Wave 3 leaves
// them undefined and edits stay local.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  SetStateAction,
} from 'react'
import type { Camera, Point } from '@/lib/canvas-engine/camera'
import type { WorldRect } from '@/lib/canvas-engine/hit-test'
import type { CanvasElement, Scene } from '@/lib/canvas-engine/scene'
import type { ResizeHandle, ScreenRect } from '@/lib/canvas-engine/render'
import type { TextMeasurer } from '@/lib/canvas-engine/text-layout'
import {
  panByScreenDelta,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '@/lib/canvas-engine/camera'
import {
  hitTest,
  hitTestRect,
  normaliseRect,
  rectFromPoints,
} from '@/lib/canvas-engine/hit-test'
import {
  DEFAULT_ELEMENT_STYLE,
  addElement,
  nextZIndex,
  removeElement,
  removeElements,
  updateElement,
} from '@/lib/canvas-engine/scene'
import {
  RESIZE_HANDLES,
  handleRects,
  layoutElementText,
  textFrame,
} from '@/lib/canvas-engine/render'
import {
  caretFromPoint,
  clampCaret,
  deleteBackward,
  deleteForward,
  insertAt,
  pointFromCaret,
  stepCaret,
} from '@/lib/canvas-engine/text-layout'
import { uuid } from '@/lib/uuid'

/** The milestone-1 toolset (plan D1). */
export type CanvasTool = 'select' | 'pan' | 'rectangle' | 'text'

/** Default size of an element created by a click rather than a drag. */
const DEFAULT_RECTANGLE_SIZE = { width: 160, height: 100 }
const DEFAULT_TEXT_SIZE = { width: 240, height: 48 }

/** Below this many SCREEN pixels a drag counts as a click. */
const CLICK_SLOP = 4

/** Smallest element a resize may produce, in world units. */
const MIN_ELEMENT_SIZE = 8

/** Caret blink half-period, in milliseconds. */
const CARET_BLINK_MS = 530

/**
 * Wheel-delta normalisation. `WheelEvent.deltaMode` reports pixels (0), lines
 * (1) or pages (2); Firefox uses lines, so without converting, one notch
 * zooms as if the pointer had travelled a single pixel.
 */
const WHEEL_PIXELS_PER_LINE = 16
const WHEEL_PIXELS_PER_PAGE = 400

/**
 * Pixels of wheel travel per e-fold of zoom. Larger is slower; 500 gives
 * roughly 1.2x per notch on a typical mouse.
 */
const WHEEL_ZOOM_DIVISOR = 500

/**
 * Which gesture produced an `onUpdate` call (board-undo tactical plan, Wave
 * 4, step 11's carry-over: `CanvasUndoEntry.label`, downstream in
 * use-canvas-undo.ts, needs to name the SPECIFIC gesture reversed — "moved"
 * and "resized" and "edited the text of" are different toasts, and nothing
 * about the elements' before/after geometry alone can tell them apart
 * reliably (a corner-handle resize also moves x/y).
 */
export type CanvasUpdateGesture = 'move' | 'resize' | 'text-edit'

/**
 * Persistence seam. Every callback fires at gesture END with the element(s)
 * as the client now believes them to be.
 *
 * `onUpdate` and `onDelete` also carry PRE-gesture state (board-undo tactical
 * plan, Wave 3, step 7): `onUpdate`'s second argument is each element as it
 * stood immediately BEFORE the gesture began (drag origin / pre-resize
 * bounds / pre-edit text), and `onDelete` receives the full elements being
 * removed rather than just their ids, since undo's inverse (a create-with-id)
 * needs every persisted property to restore them faithfully. Both arrays are
 * index-aligned by id, not by position — a caller should match on `.id`.
 * `onUpdate`'s third argument is which gesture produced the call (Wave 4).
 *
 * These three callbacks are the ENTIRE recording surface for canvas undo:
 * they already fire once per gesture at commit, never per `pointermove`, so
 * one-gesture-one-entry is structural here, not something the caller has to
 * re-implement.
 */
export interface CanvasEditCallbacks {
  onCreate?: (element: CanvasElement) => void
  onUpdate?: (
    elements: Array<CanvasElement>,
    before: Array<CanvasElement>,
    // Optional at the TYPE level even though every real call site in this
    // file always supplies it: a consumer testing recording/undo mechanics
    // in isolation (use-canvas-undo.test.ts) should not have to pick a
    // gesture kind irrelevant to what it asserts. use-canvas-undo.ts's own
    // `recordUpdate` defaults a missing one to 'move'.
    gesture?: CanvasUpdateGesture,
  ) => void
  onDelete?: (elements: Array<CanvasElement>) => void
}

export interface EditingState {
  elementId: string
  caret: number
  /**
   * In-flight IME composition text. It is NOT part of the element's stored
   * text until `compositionend`, but it must be visible while typing, so the
   * renderer is handed a scene with it spliced in at the caret.
   */
  composition: string
  /** True while the element has never been persisted (created by this edit). */
  isNew: boolean
  /**
   * The element exactly as it stood when this edit began, for `onUpdate`'s
   * pre-state (board-undo tactical plan, Wave 3, step 7). Null when `isNew`
   * — nothing existed before a brand-new element, so there is no "before" to
   * capture.
   */
  before: CanvasElement | null
}

interface UseCanvasInputArgs {
  canvasRef: RefObject<HTMLCanvasElement | null>
  scene: Scene
  setScene: Dispatch<SetStateAction<Scene>>
  camera: Camera
  setCamera: Dispatch<SetStateAction<Camera>>
  tool: CanvasTool
  setTool: (tool: CanvasTool) => void
  readOnly: boolean
  /**
   * Builds a text measurer bound to the live 2D context. Returns null before
   * the canvas has mounted, which is why every caller here bails on null
   * rather than guessing a width.
   */
  getMeasurer: (fontSize: number) => TextMeasurer | null
  callbacks?: CanvasEditCallbacks
}

type Gesture =
  | { kind: 'none' }
  | { kind: 'pan'; lastScreen: Point }
  | {
      kind: 'marquee'
      originWorld: Point
      currentWorld: Point
      baseIds: ReadonlySet<string>
    }
  | { kind: 'draw'; originWorld: Point; currentWorld: Point }
  | {
      kind: 'move'
      lastWorld: Point
      startScreen: Point
      ids: ReadonlyArray<string>
      moved: boolean
      /**
       * Every dragged element exactly as it stood at pointerdown, for
       * `onUpdate`'s pre-state (board-undo tactical plan, Wave 3, step 7).
       * Captured once, at gesture start — never recomputed per frame, for the
       * same drift reason `resize`'s `startBounds` is captured once.
       */
      before: ReadonlyArray<CanvasElement>
    }
  | {
      kind: 'resize'
      handle: ResizeHandle
      elementId: string
      /**
       * Bounds at pointerdown. Every frame recomputes from THESE rather than
       * from the element's current bounds — accumulating deltas frame by
       * frame drifts, because each frame's clamp to MIN_ELEMENT_SIZE would
       * become the next frame's starting point.
       */
      startBounds: WorldRect
      /** The element exactly as it stood at pointerdown, for `onUpdate`'s pre-state. */
      beforeElement: CanvasElement
    }

function screenRectContains(rect: ScreenRect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/** A newly drawn element, ready to go into the scene. */
function makeElement(
  kind: CanvasElement['kind'],
  rect: WorldRect,
  zIndex: number,
): CanvasElement {
  return {
    id: uuid(),
    kind,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    rotation: 0,
    zIndex,
    text: kind === 'text' ? '' : null,
    style: { ...DEFAULT_ELEMENT_STYLE },
  }
}

/**
 * New bounds for a resize, given the grip being dragged and where the
 * pointer is now.
 *
 * Edges are clamped rather than allowed to cross: dragging the east grip
 * past the west edge holds the element at MIN_ELEMENT_SIZE instead of
 * flipping it. Flipping would need negative extents to be normalised
 * everywhere downstream, and milestone 1 has no use for a mirrored element.
 */
function resizedBounds(
  handle: ResizeHandle,
  start: WorldRect,
  world: Point,
): WorldRect {
  const right = start.x + start.width
  const bottom = start.y + start.height
  let { x, y, width, height } = start

  if (handle.includes('w')) {
    x = Math.min(world.x, right - MIN_ELEMENT_SIZE)
    width = right - x
  }
  if (handle.includes('e')) {
    width = Math.max(MIN_ELEMENT_SIZE, world.x - start.x)
  }
  if (handle.includes('n')) {
    y = Math.min(world.y, bottom - MIN_ELEMENT_SIZE)
    height = bottom - y
  }
  if (handle.includes('s')) {
    height = Math.max(MIN_ELEMENT_SIZE, world.y - start.y)
  }
  return { x, y, width, height }
}

export function useCanvasInput({
  canvasRef,
  scene,
  setScene,
  camera,
  setCamera,
  tool,
  setTool,
  readOnly,
  getMeasurer,
  callbacks,
}: UseCanvasInputArgs) {
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  )
  const [gesture, setGestureState] = useState<Gesture>({ kind: 'none' })
  const [editing, setEditingState] = useState<EditingState | null>(null)

  /**
   * Synchronous mirrors of `gesture` and `editing`.
   *
   * Both pieces of state are read by handlers that can fire TWICE inside one
   * synchronous browser event, with no React render in between — so the state
   * variable and the `latest` ref below are both still holding the previous
   * value on the second call. `commitEditing` persisting twice (two rows for
   * one text element) and `lostpointercapture` re-ending an already-ended
   * gesture are the two bugs that produced. These refs are written BEFORE the
   * corresponding setState, so a re-entrant call sees the new value
   * immediately.
   */
  const gestureRef = useRef<Gesture>({ kind: 'none' })
  const editingRef = useRef<EditingState | null>(null)

  const setGesture = useCallback((next: Gesture) => {
    gestureRef.current = next
    setGestureState(next)
  }, [])

  const setEditing = useCallback(
    (next: EditingState | null | ((current: EditingState | null) => EditingState | null)) => {
      const resolved =
        typeof next === 'function' ? next(editingRef.current) : next
      editingRef.current = resolved
      setEditingState(resolved)
    },
    [],
  )
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [caretVisible, setCaretVisible] = useState(true)

  // Latest-value refs. Window-level listeners (wheel, keydown) are attached
  // once and would otherwise close over the first render's scene and camera.
  const latest = useRef({ scene, camera, tool, readOnly, selectedIds, editing })
  useEffect(() => {
    latest.current = { scene, camera, tool, readOnly, selectedIds, editing }
  })

  const screenFromEvent = useCallback(
    (event: { clientX: number; clientY: number }): Point | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    },
    [canvasRef],
  )

  // ── text helpers ─────────────────────────────────────────────────────────

  /**
   * Lay an element's text out with the live canvas metrics. Returns null when
   * the context is not ready — callers must not fall back to a guessed width,
   * because a caret placed against the wrong metrics lands on the wrong
   * character and looks like a hit-testing bug.
   */
  const layoutFor = useCallback(
    (element: CanvasElement) => {
      const measure = getMeasurer(element.style.fontSize)
      if (!measure) return null
      return layoutElementText(element, measure)
    },
    [getMeasurer],
  )

  /**
   * Commit the element being edited.
   *
   * An element created by this edit that still has no text is REMOVED rather
   * than kept: a text element with no text draws nothing, so keeping it would
   * leave an invisible, un-findable box on the board every time someone
   * clicked with the text tool and changed their mind.
   */
  const commitEditing = useCallback(() => {
    // Re-entry guard, FIRST statement. Two triggers fire per commit inside a
    // single synchronous handler — the text proxy's blur and the caller that
    // caused the blur (pointerdown's own `if (editing) commitEditing()`, or
    // the Escape/Tab handler followed by the proxy's own blur effect). React
    // has not re-rendered between them, so a guard reading state or the
    // `latest` ref sees a stale non-null value and persists the element a
    // second time: two `element:create` rows for one text box, or a second
    // `element:delete` whose NOT_FOUND ack resurrects what the user just
    // emptied.
    const current = editingRef.current
    if (!current) return
    editingRef.current = null
    setEditingState(null)

    const element = latest.current.scene.byId.get(current.elementId)
    if (!element) return

    const isEmpty = (element.text ?? '').length === 0
    if (isEmpty && element.kind === 'text') {
      setScene((prev) => removeElement(prev, element.id))
      setSelectedIds(new Set<string>())
      // `element` here is the EMPTIED local element — the emptying was never
      // persisted, so the row this delete removes server-side still holds
      // the ORIGINAL text. Recording `element` would snapshot the empty
      // string, and undo's create-with-id would then restore an invisible,
      // un-findable box with the user's text gone for good (Hermes review,
      // BLOCKER B2). `current.before` is the pre-edit-session snapshot
      // captured in `beginEditing`, before any keystroke touched it — it is
      // guaranteed non-null here because it is null only when `isNew`, which
      // this branch already excludes.
      if (!current.isNew && current.before) {
        callbacks?.onDelete?.([current.before])
      }
      return
    }
    if (current.isNew) callbacks?.onCreate?.(element)
    else callbacks?.onUpdate?.([element], [current.before ?? element], 'text-edit')
  }, [callbacks, setScene])

  const beginEditing = useCallback(
    (element: CanvasElement, caret: number, isNew: boolean) => {
      setEditing({
        elementId: element.id,
        caret,
        composition: '',
        isNew,
        // Nothing existed before a brand-new element — there is no "before"
        // to capture. For an existing element, clone it now: this IS its
        // pre-edit state, since no text mutation has happened yet.
        //
        // `{ ...element }` is a SHALLOW clone — safe here only because
        // `canvas-engine/scene.ts`'s own mutators (`updateElement` et al.)
        // never mutate an element in place; every edit REPLACES the element
        // object (and any nested fields, e.g. `style`) with a new one
        // (`{ ...element, ...patch }`). A later edit therefore cannot reach
        // back through this clone's references and corrupt what it captured
        // (Hermes review, suggestion).
        before: isNew ? null : { ...element },
      })
      setSelectedIds(new Set([element.id]))
      setCaretVisible(true)
    },
    [setEditing],
  )

  /** Caret index nearest a world point inside an element's text block. */
  const caretAtWorldPoint = useCallback(
    (element: CanvasElement, world: Point): number => {
      const layout = layoutFor(element)
      if (!layout) return (element.text ?? '').length
      const frame = textFrame(element)
      return caretFromPoint(layout, {
        x: world.x - frame.x,
        y: world.y - frame.y,
      })
    },
    [layoutFor],
  )

  // ── pointer ──────────────────────────────────────────────────────────────

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      const screen = screenFromEvent(event)
      if (!canvas || !screen) return

      canvas.setPointerCapture(event.pointerId)
      const world = screenToWorld(latest.current.camera, screen)
      const panRequested =
        event.button === 1 || spaceHeld || latest.current.tool === 'pan'

      if (panRequested || latest.current.readOnly) {
        // Read-only boards pan and zoom and nothing else. Allowing selection
        // there would draw resize grips that refuse to resize.
        setGesture({ kind: 'pan', lastScreen: screen })
        return
      }
      if (event.button !== 0) return

      if (editing) commitEditing()

      if (latest.current.tool === 'rectangle') {
        setGesture({ kind: 'draw', originWorld: world, currentWorld: world })
        return
      }

      if (latest.current.tool === 'text') {
        const element = makeElement(
          'text',
          { x: world.x, y: world.y, ...DEFAULT_TEXT_SIZE },
          nextZIndex(latest.current.scene),
        )
        setScene((prev) => addElement(prev, element))
        beginEditing(element, 0, true)
        setTool('select')
        return
      }

      // ── select tool ──
      const currentSelection = latest.current.selectedIds
      if (currentSelection.size === 1) {
        const only = latest.current.scene.byId.get(
          [...currentSelection][0],
        )
        if (only) {
          const grips = handleRects(latest.current.camera, only)
          const grabbed = RESIZE_HANDLES.find((handle) =>
            screenRectContains(grips[handle], screen),
          )
          if (grabbed) {
            setGesture({
              kind: 'resize',
              handle: grabbed,
              elementId: only.id,
              startBounds: {
                x: only.x,
                y: only.y,
                width: only.width,
                height: only.height,
              },
              // Shallow clone — same safety rationale as `beginEditing`'s
              // and the move gesture's own `{ ...element }` clones above.
              beforeElement: { ...only },
            })
            return
          }
        }
      }

      const hit = hitTest(latest.current.scene, world)
      if (!hit) {
        const baseIds = event.shiftKey ? currentSelection : new Set<string>()
        if (!event.shiftKey) setSelectedIds(new Set<string>())
        setGesture({
          kind: 'marquee',
          originWorld: world,
          currentWorld: world,
          baseIds,
        })
        return
      }

      let nextSelection: Set<string>
      if (event.shiftKey) {
        nextSelection = new Set(currentSelection)
        if (nextSelection.has(hit.id)) nextSelection.delete(hit.id)
        else nextSelection.add(hit.id)
      } else if (currentSelection.has(hit.id)) {
        nextSelection = new Set(currentSelection)
      } else {
        nextSelection = new Set([hit.id])
      }
      setSelectedIds(nextSelection)
      setGesture({
        kind: 'move',
        lastWorld: world,
        startScreen: screen,
        ids: [...nextSelection],
        moved: false,
        // Shallow clones — safe for the same reason `beginEditing`'s own
        // `{ ...element }` clone is (see its comment): `canvas-engine`
        // never mutates an element in place, only replaces it, so the drag
        // that follows cannot reach back and corrupt this pre-move snapshot
        // (Hermes review, suggestion).
        before: [...nextSelection]
          .map((id) => latest.current.scene.byId.get(id))
          .filter((element): element is CanvasElement => Boolean(element))
          .map((element) => ({ ...element })),
      })
    },
    [
      beginEditing,
      canvasRef,
      commitEditing,
      editing,
      screenFromEvent,
      setGesture,
      setScene,
      setTool,
      spaceHeld,
    ],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (gesture.kind === 'none') return
      const screen = screenFromEvent(event)
      if (!screen) return
      const world = screenToWorld(latest.current.camera, screen)

      switch (gesture.kind) {
        case 'pan': {
          const delta = {
            x: screen.x - gesture.lastScreen.x,
            y: screen.y - gesture.lastScreen.y,
          }
          setCamera((prev) => panByScreenDelta(prev, delta))
          setGesture({ kind: 'pan', lastScreen: screen })
          break
        }
        case 'marquee': {
          setGesture({ ...gesture, currentWorld: world })
          const rect = rectFromPoints(gesture.originWorld, world)
          const inside = hitTestRect(latest.current.scene, rect)
          const next = new Set(gesture.baseIds)
          for (const element of inside) next.add(element.id)
          setSelectedIds(next)
          break
        }
        case 'draw': {
          setGesture({ ...gesture, currentWorld: world })
          break
        }
        case 'move': {
          const dx = world.x - gesture.lastWorld.x
          const dy = world.y - gesture.lastWorld.y
          const travelled =
            Math.abs(screen.x - gesture.startScreen.x) +
            Math.abs(screen.y - gesture.startScreen.y)
          setScene((prev) => {
            let next = prev
            for (const id of gesture.ids) {
              const element = next.byId.get(id)
              if (!element) continue
              next = updateElement(next, id, {
                x: element.x + dx,
                y: element.y + dy,
              })
            }
            return next
          })
          setGesture({
            ...gesture,
            lastWorld: world,
            moved: gesture.moved || travelled > CLICK_SLOP,
          })
          break
        }
        case 'resize': {
          const bounds = resizedBounds(
            gesture.handle,
            gesture.startBounds,
            world,
          )
          setScene((prev) => updateElement(prev, gesture.elementId, bounds))
          break
        }
      }
    },
    [gesture, screenFromEvent, setCamera, setGesture, setScene],
  )

  const endGesture = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      // Guard the release: a pointercancel can revoke capture before this
      // runs, and releasing capture we no longer hold throws.
      if (canvas?.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      // Read the synchronous mirror, not the render-time closure:
      // `lostpointercapture` fires after EVERY pointerup, so without this the
      // gesture would be ended (and persisted) twice.
      const finished = gestureRef.current
      if (finished.kind === 'none') return
      setGesture({ kind: 'none' })

      switch (finished.kind) {
        case 'draw': {
          const dragged = rectFromPoints(
            finished.originWorld,
            finished.currentWorld,
          )
          // A click (rather than a drag) creates a default-sized element at
          // the click point, which is what every editor does and what makes
          // the tool usable without a precise drag.
          const rect =
            dragged.width < MIN_ELEMENT_SIZE || dragged.height < MIN_ELEMENT_SIZE
              ? { ...finished.originWorld, ...DEFAULT_RECTANGLE_SIZE }
              : dragged
          const element = makeElement(
            'rectangle',
            rect,
            nextZIndex(latest.current.scene),
          )
          setScene((prev) => addElement(prev, element))
          setSelectedIds(new Set([element.id]))
          setTool('select')
          callbacks?.onCreate?.(element)
          break
        }
        case 'move': {
          if (!finished.moved) break
          const moved = finished.ids
            .map((id) => latest.current.scene.byId.get(id))
            .filter((element): element is CanvasElement => Boolean(element))
          if (moved.length > 0) {
            // Pre-state is index-aligned to `moved` by id, not by position: an
            // element present in `finished.before` but removed mid-drag (rare,
            // but not impossible with a collaborator's concurrent delete) must
            // not shift every later entry by one.
            const beforeById = new Map(
              finished.before.map((element) => [element.id, element]),
            )
            const before = moved
              .map((element) => beforeById.get(element.id))
              .filter((element): element is CanvasElement => Boolean(element))
            callbacks?.onUpdate?.(moved, before, 'move')
          }
          break
        }
        case 'resize': {
          const element = latest.current.scene.byId.get(finished.elementId)
          if (element) {
            callbacks?.onUpdate?.([element], [finished.beforeElement], 'resize')
          }
          break
        }
        default:
          break
      }
    },
    [callbacks, canvasRef, setGesture, setScene, setTool],
  )

  const onDoubleClick = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      if (latest.current.readOnly) return
      const screen = screenFromEvent(event)
      if (!screen) return
      const world = screenToWorld(latest.current.camera, screen)
      const hit = hitTest(latest.current.scene, world)
      if (!hit) return
      beginEditing(hit, caretAtWorldPoint(hit, world), false)
    },
    [beginEditing, caretAtWorldPoint, screenFromEvent],
  )

  // ── wheel ────────────────────────────────────────────────────────────────
  //
  // Attached imperatively with `{ passive: false }`: React's onWheel is
  // registered passively, so `preventDefault()` inside it is ignored and the
  // page scrolls behind the board.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const scale =
        event.deltaMode === 1
          ? WHEEL_PIXELS_PER_LINE
          : event.deltaMode === 2
            ? WHEEL_PIXELS_PER_PAGE
            : 1
      const factor = Math.exp(
        (-event.deltaY * scale) / WHEEL_ZOOM_DIVISOR,
      )
      setCamera((prev) => zoomAt(prev, anchor, factor))
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvasRef, setCamera])

  // ── caret blink ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editing) return
    setCaretVisible(true)
    const timer = setInterval(
      () => setCaretVisible((visible) => !visible),
      CARET_BLINK_MS,
    )
    return () => clearInterval(timer)
  }, [editing])

  // ── board-level keyboard (NOT editing) ───────────────────────────────────

  const deleteSelection = useCallback(() => {
    const ids = [...latest.current.selectedIds]
    if (ids.length === 0) return
    // Captured BEFORE the scene update below: undo's inverse (a
    // create-with-id) needs every persisted property to restore these
    // elements faithfully, not just their ids.
    const elements = ids
      .map((id) => latest.current.scene.byId.get(id))
      .filter((element): element is CanvasElement => Boolean(element))
    setScene((prev) => removeElements(prev, ids))
    setSelectedIds(new Set<string>())
    callbacks?.onDelete?.(elements)
  }, [callbacks, setScene])

  const onBoardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      // While text is being edited, EVERY key belongs to the text proxy.
      //
      // This handler sits on the container, and the proxy is its child, so
      // keydown from the focused textarea bubbles straight into here. Without
      // this guard, typing "r" switched to the rectangle tool, "v" to select,
      // Backspace deleted the selected element and space panned the board
      // instead of typing a space. The proxy's own onKeyDown already handles
      // the keys an edit needs.
      if (editingRef.current) return

      if (event.key === ' ') {
        // Space pans. preventDefault stops the page scrolling under the
        // board, which is the default action for space on a focusable div.
        event.preventDefault()
        setSpaceHeld(true)
        return
      }
      if (latest.current.readOnly) return
      if (event.ctrlKey || event.metaKey || event.altKey) return

      switch (event.key) {
        case 'v':
          setTool('select')
          break
        case 'h':
          setTool('pan')
          break
        case 'r':
          setTool('rectangle')
          break
        case 't':
          setTool('text')
          break
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          deleteSelection()
          break
        case 'Escape':
          setSelectedIds(new Set<string>())
          break
        case 'Enter': {
          // The keyboard path into text editing — the living spec's
          // pointerless requirement applies to this surface too, and without
          // this, typing into an element would need a double-click.
          const ids = [...latest.current.selectedIds]
          if (ids.length !== 1) break
          const element = latest.current.scene.byId.get(ids[0])
          if (!element) break
          event.preventDefault()
          beginEditing(element, (element.text ?? '').length, false)
          break
        }
        default:
          break
      }
    },
    [beginEditing, deleteSelection, setTool],
  )

  const onBoardKeyUp = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === ' ') setSpaceHeld(false)
    },
    [],
  )

  // Space released while the board did not have focus (alt-tab, a dialog)
  // would otherwise leave the board stuck in pan mode forever.
  useEffect(() => {
    const clear = () => setSpaceHeld(false)
    window.addEventListener('blur', clear)
    return () => window.removeEventListener('blur', clear)
  }, [])

  // ── text-editing input (from TextInputProxy) ─────────────────────────────

  const applyTextEdit = useCallback(
    (produce: (text: string, caret: number) => { text: string; caret: number }) => {
      const current = latest.current.editing
      if (!current) return
      const element = latest.current.scene.byId.get(current.elementId)
      if (!element) return
      const result = produce(element.text ?? '', current.caret)
      setScene((prev) =>
        updateElement(prev, current.elementId, { text: result.text }),
      )
      setEditing({ ...current, caret: result.caret })
      setCaretVisible(true)
    },
    [setEditing, setScene],
  )

  /** Commit typed or composed text at the caret. */
  const insertText = useCallback(
    (text: string) => {
      if (text.length === 0) return
      applyTextEdit((value, caret) => insertAt(value, caret, text))
    },
    [applyTextEdit],
  )

  /** Live IME composition preview — not yet part of the element's text. */
  const setComposition = useCallback((composition: string) => {
    setEditing((current) => (current ? { ...current, composition } : current))
    setCaretVisible(true)
  }, [setEditing])

  /**
   * Move the caret vertically, which needs the laid-out lines — arrow up on
   * wrapped text must land on the visual line above, not `caret - lineLength`.
   */
  const moveCaretVertically = useCallback(
    (direction: 1 | -1) => {
      const current = latest.current.editing
      if (!current) return
      const element = latest.current.scene.byId.get(current.elementId)
      if (!element) return
      const layout = layoutFor(element)
      if (!layout) return
      const here = pointFromCaret(layout, current.caret)
      const target = caretFromPoint(layout, {
        x: here.x,
        y: here.y + direction * layout.lineHeight,
      })
      setEditing({ ...current, caret: target })
      setCaretVisible(true)
    },
    [layoutFor, setEditing],
  )

  const moveCaretToLineEdge = useCallback(
    (edge: 'start' | 'end') => {
      const current = latest.current.editing
      if (!current) return
      const element = latest.current.scene.byId.get(current.elementId)
      if (!element) return
      const layout = layoutFor(element)
      if (!layout) return
      const here = pointFromCaret(layout, current.caret)
      const target = caretFromPoint(layout, {
        x: edge === 'start' ? 0 : Number.MAX_SAFE_INTEGER,
        y: here.y,
      })
      setEditing({ ...current, caret: target })
      setCaretVisible(true)
    },
    [layoutFor, setEditing],
  )

  /**
   * Keys handled while text editing is active. Returns true when the key was
   * consumed, so the proxy can `preventDefault` only then and let everything
   * else reach the browser's own input handling (which is what keeps IME
   * working).
   */
  const onEditingKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
      const current = latest.current.editing
      if (!current) return false

      switch (event.key) {
        case 'ArrowLeft':
          applyTextEdit((text, caret) => ({
            text,
            caret: stepCaret(text, caret, -1),
          }))
          return true
        case 'ArrowRight':
          applyTextEdit((text, caret) => ({
            text,
            caret: stepCaret(text, caret, 1),
          }))
          return true
        case 'ArrowUp':
          moveCaretVertically(-1)
          return true
        case 'ArrowDown':
          moveCaretVertically(1)
          return true
        case 'Home':
          moveCaretToLineEdge('start')
          return true
        case 'End':
          moveCaretToLineEdge('end')
          return true
        case 'Backspace':
          applyTextEdit(deleteBackward)
          return true
        case 'Delete':
          applyTextEdit(deleteForward)
          return true
        case 'Enter':
          applyTextEdit((text, caret) => insertAt(text, caret, '\n'))
          return true
        case 'Escape':
        case 'Tab':
          commitEditing()
          return event.key === 'Escape'
        default:
          return false
      }
    },
    [applyTextEdit, commitEditing, moveCaretToLineEdge, moveCaretVertically],
  )

  // ── derived render inputs ────────────────────────────────────────────────

  const marquee = useMemo<WorldRect | null>(() => {
    if (gesture.kind !== 'marquee') return null
    return normaliseRect(
      rectFromPoints(gesture.originWorld, gesture.currentWorld),
    )
  }, [gesture])

  const draft = useMemo<CanvasElement | null>(() => {
    if (gesture.kind !== 'draw') return null
    const rect = rectFromPoints(gesture.originWorld, gesture.currentWorld)
    if (rect.width < 1 || rect.height < 1) return null
    return makeElement('rectangle', rect, nextZIndex(scene))
  }, [gesture, scene])

  /**
   * The scene as it should be DRAWN: identical to the real scene except that
   * in-flight IME composition text is spliced in at the caret. It is not
   * committed anywhere, so an abandoned composition leaves no trace.
   */
  const displayScene = useMemo(() => {
    if (!editing || editing.composition.length === 0) return scene
    const element = scene.byId.get(editing.elementId)
    if (!element) return scene
    const spliced = insertAt(
      element.text ?? '',
      editing.caret,
      editing.composition,
    )
    return updateElement(scene, editing.elementId, { text: spliced.text })
  }, [editing, scene])

  const displayCaret = editing
    ? clampCaret(
        (scene.byId.get(editing.elementId)?.text ?? '') + editing.composition,
        editing.caret + editing.composition.length,
      )
    : 0

  /**
   * Where the caret is on screen. The IME candidate window is positioned
   * here, and a candidate list that appears in the page's top-left corner
   * instead of next to the text is unusable for CJK input.
   */
  const caretScreenPoint = useMemo<Point | null>(() => {
    if (!editing) return null
    const element = displayScene.byId.get(editing.elementId)
    if (!element) return null
    const layout = layoutFor(element)
    if (!layout) return null
    const local = pointFromCaret(layout, displayCaret)
    const frame = textFrame(element)
    return worldToScreen(camera, {
      x: frame.x + local.x,
      y: frame.y + local.y + local.height,
    })
  }, [camera, displayCaret, displayScene, editing, layoutFor])

  /**
   * Point every local reference at an element's new id.
   *
   * Wave 4 creates elements optimistically with a client-side uuid and the
   * server answers with its own. Without this remap the just-drawn element
   * silently deselects at ack time, and a text element the user is already
   * typing into stops receiving keystrokes because `editing.elementId` names
   * a row that no longer exists.
   */
  const remapElementId = useCallback((from: string, to: string) => {
    setSelectedIds((current) => {
      if (!current.has(from)) return current
      const next = new Set(current)
      next.delete(from)
      next.add(to)
      return next
    })
    setEditing((current) =>
      current && current.elementId === from
        ? { ...current, elementId: to }
        : current,
    )
  }, [setEditing])

  const cursor = readOnly
    ? gesture.kind === 'pan'
      ? 'grabbing'
      : 'grab'
    : spaceHeld || tool === 'pan'
      ? gesture.kind === 'pan'
        ? 'grabbing'
        : 'grab'
      : tool === 'text'
        ? 'text'
        : tool === 'rectangle'
          ? 'crosshair'
          : 'default'

  return {
    selectedIds,
    setSelectedIds,
    remapElementId,
    editing,
    marquee,
    draft,
    displayScene,
    displayCaret,
    caretVisible,
    caretScreenPoint,
    cursor,
    isPanning: gesture.kind === 'pan',
    canvasHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture,
      // The canvas sets `touch-action: none`, so on touch and pen the OS can
      // take the gesture over and revoke capture WITHOUT a pointercancel.
      // Without this the gesture never resets and the element keeps following
      // the pointer — a ghost drag with no way to stop it. `endGesture` is
      // re-entry-guarded on `gestureRef`, which is what makes this safe to
      // wire to the same function that pointerup already uses (this event
      // fires after every pointerup too). Mirrors ShapeDrawOverlay.tsx's
      // `onLostPointerCaptureCapture` guard.
      onLostPointerCapture: endGesture,
      onDoubleClick,
    },
    boardHandlers: {
      onKeyDown: onBoardKeyDown,
      onKeyUp: onBoardKeyUp,
    },
    textInput: {
      insertText,
      setComposition,
      onEditingKeyDown,
      commitEditing,
    },
  }
}
