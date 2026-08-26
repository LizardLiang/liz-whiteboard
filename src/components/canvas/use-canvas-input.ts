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
import type {
  CanvasElement,
  CanvasShapeKind,
  ConnectorAnchor,
  ConnectorAttach,
  Scene,
} from '@/lib/canvas-engine/scene'
import type {
  ConnectorEnd,
  CreationHandleDirection,
  ResizeHandle,
  ScreenRect,
} from '@/lib/canvas-engine/render'
import type { TextMeasurer } from '@/lib/canvas-engine/text-layout'
import {
  panByScreenDelta,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '@/lib/canvas-engine/camera'
import {
  connectorPathOf,
  hitTest,
  hitTestRect,
  normaliseRect,
  rectFromPoints,
} from '@/lib/canvas-engine/hit-test'
import {
  CANVAS_SHAPE_KINDS,
  DEFAULT_CONNECTOR_ROUTING,
  DEFAULT_ELEMENT_STYLE,
  addElement,
  attachedEndpoint,
  bounds,
  connectorsTouching,
  endpointElementId,
  freeEndpoint,
  nextZIndex,
  remapConnectorEndpoints,
  removeElements,
  updateElement,
  withAttachedConnectors,
} from '@/lib/canvas-engine/scene'
import {
  CONNECTOR_ENDS,
  CREATION_HANDLE_DIRECTIONS,
  RESIZE_HANDLES,
  connectorEndpointRects,
  creationHandleRects,
  creationHandleTarget,
  handleRects,
  layoutElementText,
  textFrame,
} from '@/lib/canvas-engine/render'
import { quickCreatePlacement } from '@/lib/canvas-engine/quick-create'
import {
  ANCHOR_ATTACH,
  anchorPoint,
  nearestAnchor,
  nearestAttach,
} from '@/lib/canvas-engine/connector-geometry'
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

/**
 * The toolset. One tool per shape kind, plus the two non-shape tools and the
 * two navigation tools.
 *
 * A shape tool's id IS its `CanvasShapeKind`, deliberately: that is what lets
 * the draw gesture carry the kind it will create without a lookup table, and
 * it means adding a shape kind to the engine adds its tool for free.
 */
export type CanvasTool = 'select' | 'pan' | CanvasShapeKind | 'text'

/** Is this tool one that draws a shape — and if so, which kind does it draw? */
export function shapeKindForTool(tool: CanvasTool): CanvasShapeKind | null {
  return (CANVAS_SHAPE_KINDS as ReadonlyArray<string>).includes(tool)
    ? (tool as CanvasShapeKind)
    : null
}

/**
 * The keyboard shortcut for each shape tool, and the single source of that
 * mapping — `CanvasBoard.tsx`'s palette labels the buttons from the same
 * table, so a hint can never advertise a key the board does not bind.
 *
 * `t` is text and `v`/`h` are select/pan, so the shapes take the remaining
 * mnemonic letters: `r`ectangle, `o` for ellipse (the Excalidraw/Figma
 * convention), `d`iamond, and `g` for triangle — `t` being unavailable.
 */
export const SHAPE_TOOL_SHORTCUTS: Readonly<Record<CanvasShapeKind, string>> = {
  rectangle: 'r',
  ellipse: 'o',
  diamond: 'd',
  triangle: 'g',
}

/**
 * Reverse of `SHAPE_TOOL_SHORTCUTS`, built once for the keydown handler.
 *
 * The value type is explicitly `| undefined`: this is looked up with an
 * ARBITRARY `event.key`, and a plain `Record<string, ...>` would tell
 * TypeScript every key hits — which is both untrue and enough to make the
 * `if` guarding it read as dead code.
 */
const SHAPE_TOOL_BY_KEY: Readonly<Record<string, CanvasShapeKind | undefined>> =
  Object.fromEntries(
    CANVAS_SHAPE_KINDS.map((kind) => [SHAPE_TOOL_SHORTCUTS[kind], kind]),
  )

/**
 * Default size of an element created by a click rather than a drag. Shared by
 * every shape kind: they are one rect drawn four ways, so a click-created
 * ellipse should occupy exactly the box a click-created rectangle would.
 */
const DEFAULT_SHAPE_SIZE = { width: 160, height: 100 }
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
 *
 * `routing` is the odd one out: it is the only arm NOT produced by this file.
 * A connector's routing is changed from `ConnectorToolbar` (canvas
 * quick-create-handles tactical plan, Wave 5), which reaches the same
 * `onUpdate` recording surface rather than writing through
 * `useCanvasElements` directly — going around it would make the change the
 * one board edit `Ctrl+Z` could not reverse. The arm exists so the toast
 * names what actually happened; without it the call would default to `move`
 * and report "Undid moving an element" for a gesture that moved nothing.
 */
export type CanvasUpdateGesture =
  | 'move'
  | 'resize'
  | 'text-edit'
  | 'routing'
  | 'reconnect'

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
  /**
   * One creation-handle gesture, carrying everything it created (canvas
   * quick-create-handles tactical plan, Wave 4, step 11): `[newElement,
   * connector]`, or `[connector]` alone when the drag ended on an element
   * that already existed.
   *
   * Deliberately NOT two `onCreate` calls. `onCreate`'s consumer
   * (`use-canvas-undo.ts`'s `recordCreate`) pushes one undo entry per call
   * and labels it `{ gesture: 'create' }`, which is documented as
   * single-element — two calls would make one press take two `Ctrl+Z`s to
   * reverse, leaving a connector dangling from an element that no longer
   * exists in between.
   *
   * The elements carry CLIENT-side ids. The consumer must create the
   * non-connector element FIRST and rewrite the connector's endpoints with
   * the id the server answers with, because a connector persisted against a
   * temporary id names a row that never existed.
   */
  onQuickCreate?: (elements: Array<CanvasElement>) => void
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
  | {
      kind: 'draw'
      /**
       * WHICH shape this drag will create, captured at pointerdown rather
       * than read from the live tool at release. The tool can change
       * mid-drag (a keyboard shortcut still fires while the pointer is
       * down), and a drag that started as an ellipse must finish as one.
       */
      shape: CanvasShapeKind
      originWorld: Point
      currentWorld: Point
    }
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
  | {
      /**
       * A press on one of a selected connector's two endpoint grips. The end
       * follows the pointer as a FREE point for the whole drag — the scene is
       * mutated live, exactly as `move` and `resize` do — and the release
       * decides whether it stays free or re-attaches.
       */
      kind: 'connector-endpoint'
      connectorId: string
      end: ConnectorEnd
      /** The connector as it stood at pointerdown, for `onUpdate`'s pre-state. */
      beforeElement: CanvasElement
      currentWorld: Point
      /**
       * What the end would attach to if released right now, or null over empty
       * board. Computed on every move so the renderer can SHOW the answer
       * during the drag instead of leaving it to the release.
       */
      candidate: { elementId: string; attach: ConnectorAttach } | null
    }
  | {
      /**
       * A press on one of the four creation handles (canvas
       * quick-create-handles tactical plan, Wave 4, step 10). Nothing is
       * created until release: which of the three outcomes happens depends
       * entirely on where the pointer ends up.
       */
      kind: 'quick-create'
      sourceId: string
      direction: CreationHandleDirection
      startScreen: Point
      currentWorld: Point
      /**
       * True once the pointer has travelled past `CLICK_SLOP`. Tracked the
       * same way the move gesture tracks it, and for the same reason: the
       * release handler also runs from `lostpointercapture`, whose event
       * coordinates cannot be trusted to describe where the user let go.
       */
      moved: boolean
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
 * A connector joining two elements, ready to go into the scene.
 *
 * Its stored geometry is a DEGENERATE 1x1 placeholder at the source's centre
 * and is never read: a connector's shape is derived from its two endpoints'
 * live bounds every frame (`connectorPath`), so there is nothing meaningful
 * to store. The placeholder exists only because `createCanvasElementSchema`
 * requires a positive width and height of every element — see its own note.
 *
 * Style is inherited from the source element so the line reads as belonging
 * to it, which is also what makes a chain of quick-creates look deliberate
 * rather than assembled from defaults.
 */
function makeConnector(
  source: CanvasElement,
  target: CanvasElement,
  zIndex: number,
  sourceAnchor: ConnectorAnchor,
): CanvasElement {
  // The line leaves the side the user actually grabbed, and joins the target
  // on the face nearest that departure point — so it reads as running between
  // the two shapes rather than aiming at their centres and being clipped
  // wherever that happens to cross the border.
  const from = anchorPoint(bounds(source), sourceAnchor)
  const targetAnchor = nearestAnchor(bounds(target), from)
  return {
    id: uuid(),
    kind: 'connector',
    x: from.x,
    y: from.y,
    width: 1,
    height: 1,
    rotation: 0,
    zIndex,
    text: null,
    style: { ...source.style },
    connector: {
      // A creation handle IS one of the four sides, so a quick-create still
      // lands on that side's midpoint. Dragging the end afterwards is what
      // moves it anywhere else along the border.
      source: attachedEndpoint(source.id, ANCHOR_ATTACH[sourceAnchor]),
      target: attachedEndpoint(target.id, ANCHOR_ATTACH[targetAnchor]),
      routing: DEFAULT_CONNECTOR_ROUTING,
    },
  }
}

/**
 * A quick-created sibling of `source`: same kind, same size, same style,
 * empty text, at `position` (world, top-left).
 *
 * Inheriting rather than defaulting is the whole point of creating from a
 * handle instead of from the toolbar — the user is extending something that
 * already exists, and a new element in a different size or colour would have
 * to be re-styled every single time.
 */
function makeSibling(
  source: CanvasElement,
  position: Point,
  zIndex: number,
): CanvasElement {
  return {
    id: uuid(),
    kind: source.kind,
    x: position.x,
    y: position.y,
    width: source.width,
    height: source.height,
    rotation: 0,
    zIndex,
    text: source.kind === 'text' ? '' : null,
    style: { ...source.style },
  }
}

/**
 * What a connector end being dragged would attach to if released at `world`,
 * or null over empty board.
 *
 * ONE function, consulted by both the live preview and the release, so the
 * highlight a user sees during the drag and the attachment they actually get
 * cannot disagree. Two copies of this rule is the export-what-you-draw defect
 * in a new costume: the marker says one thing and the commit does another.
 */
function attachCandidateAt(
  gesture: {
    connectorId: string
    end: ConnectorEnd
    beforeElement: CanvasElement
  },
  world: Point,
  scene: Scene,
): { elementId: string; attach: ConnectorAttach } | null {
  const link = scene.byId.get(gesture.connectorId)?.connector
  if (!link) return null
  const other = gesture.end === 'source' ? link.target : link.source
  const otherElementId = endpointElementId(other)

  const dropped = hitTest(scene, world)
  // A connector is never an attach target, and neither is the element the
  // OTHER end already holds — that would be a self-connector, which the schema
  // rejects outright.
  if (!dropped || dropped.connector || dropped.id === otherElementId) return null
  return {
    elementId: dropped.id,
    attach: nearestAttach(bounds(dropped), world),
  }
}

/** Which side an arrow key means, for the pointerless quick-create path. */
const ARROW_DIRECTIONS: Readonly<
  Partial<Record<string, CreationHandleDirection>>
> = {
  ArrowUp: 'top',
  ArrowRight: 'right',
  ArrowDown: 'bottom',
  ArrowLeft: 'left',
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

  /**
   * The element the pointer is over, which is what decides where creation
   * handles are drawn when nothing is selected.
   *
   * Mirrored in a ref for the same reason `gesture` is: `onPointerDown` reads
   * it to resolve which element's handles it should test, and on a fast
   * pointer the move that set it and the press that reads it can land in the
   * same tick with no render in between.
   */
  const [hoveredId, setHoveredIdState] = useState<string | null>(null)
  const hoveredIdRef = useRef<string | null>(null)

  const setHoveredId = useCallback((next: string | null) => {
    if (hoveredIdRef.current === next) return
    hoveredIdRef.current = next
    setHoveredIdState(next)
  }, [])

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
      // The SECOND delete site, and the easily-missed one (step 12). A text
      // element quick-created from a handle and then left empty is destroyed
      // right here, and without the cascade its brand-new connector would
      // outlive it as an undrawable, unselectable row.
      //
      // Captured from the CURRENT scene BEFORE `removeElement` below, for the
      // same reason `element` itself is: afterwards there is nothing left for
      // `connectorsTouching` to find (the B2 lesson — pre-state, never post).
      const attached = connectorsTouching(latest.current.scene, element.id)
      setScene((prev) =>
        removeElements(prev, [
          element.id,
          ...attached.map((connector) => connector.id),
        ]),
      )
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
        callbacks?.onDelete?.([current.before, ...attached])
      } else if (attached.length > 0) {
        // `isNew` means nothing was ever persisted for the ELEMENT, so it
        // needs no delete — but a connector attached to it was persisted by
        // whatever created it, and removing it from the scene above without
        // saying so would leave the row behind on the server. Not reachable
        // today (a quick-created element uses `isNew: false` precisely so
        // this branch stays about the element, not the connectors), and
        // written anyway because the alternative failure is silent.
        callbacks?.onDelete?.(attached)
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

  // ── quick create (creation handles) ──────────────────────────────────────

  /**
   * The element currently showing creation handles, resolved EXACTLY the way
   * the renderer resolves it.
   *
   * `creationHandleTarget` is imported from render.ts rather than
   * reimplemented here for the same reason `creationHandleRects` is: handles
   * drawn on one element and hit-tested against another is a marker that does
   * not respond where it looks, which is the W1/W3 class of bug.
   */
  const handleTargetNow = useCallback((): CanvasElement | null => {
    const edit = editingRef.current
    return creationHandleTarget(latest.current.scene, {
      ids: latest.current.selectedIds,
      hoveredId: hoveredIdRef.current,
      // Only its presence is read (it is one of the suppression rules), but
      // the real caret is passed anyway rather than a placeholder — a fake
      // value here would become wrong the day the function reads one.
      editing: edit
        ? { elementId: edit.elementId, caret: edit.caret, caretVisible: true }
        : null,
      // `marquee` and `draft` need no entry: both are derived from `gesture`,
      // and every caller below reaches this only while `gesture` is 'none'.
    })
  }, [])

  /** Which creation handle, if any, a screen point is inside. */
  const creationHandleAt = useCallback(
    (
      element: CanvasElement,
      screen: Point,
    ): CreationHandleDirection | undefined => {
      const rects = creationHandleRects(latest.current.camera, bounds(element))
      return CREATION_HANDLE_DIRECTIONS.find((direction) =>
        screenRectContains(rects[direction], screen),
      )
    },
    [],
  )

  /**
   * Commit one creation-handle gesture: add whatever it created to the scene
   * and hand ALL of it to `onQuickCreate` in a single call.
   *
   * `target` is an element that already exists (the drag-onto-an-element
   * case) or a brand-new sibling. Either way exactly one connector is made,
   * and both writes leave through one callback so one `Ctrl+Z` reverses the
   * whole gesture (step 11).
   */
  const commitQuickCreate = useCallback(
    (
      source: CanvasElement,
      target: CanvasElement,
      targetIsNew: boolean,
      sourceAnchor: ConnectorAnchor,
    ) => {
      const base = nextZIndex(latest.current.scene)
      const connector = makeConnector(
        source,
        target,
        targetIsNew ? base + 1 : base,
        sourceAnchor,
      )
      setScene((prev) =>
        addElement(targetIsNew ? addElement(prev, target) : prev, connector),
      )
      setSelectedIds(new Set([target.id]))
      callbacks?.onQuickCreate?.(
        targetIsNew ? [target, connector] : [connector],
      )
      if (targetIsNew) {
        // Straight into typing, as FigJam does — the point of the gesture is
        // "another one of these, with something written in it".
        //
        // `isNew: false` even though the element IS new. In this file `isNew`
        // means "this edit session is responsible for PERSISTING the
        // element", and it is not: `onQuickCreate` above already did. Passing
        // true would make `commitEditing` call `onCreate` as well, writing
        // the element a second time. The consequence of `false` is the
        // correct one: an empty text element is destroyed on commit (with its
        // connector, see `commitEditing`), and typed text is recorded as its
        // own separate `text-edit` entry, which is what the user's own second
        // gesture deserves.
        beginEditing(target, 0, false)
      }
    },
    [beginEditing, callbacks, setScene],
  )

  /**
   * The click (and `Alt+Arrow`) case: a new sibling one gap away in
   * `direction`, plus the connector joining them.
   *
   * Connectors are excluded from `occupied` because their stored bounds are
   * the 1x1 placeholder — treating that as an obstacle would push new
   * elements away from a point near the source's own centre for no visible
   * reason.
   */
  const quickCreateInDirection = useCallback(
    (source: CanvasElement, direction: CreationHandleDirection) => {
      const current = latest.current.scene
      const occupied = current.elements
        .filter((element) => !element.connector && element.id !== source.id)
        .map(bounds)
      const position = quickCreatePlacement(
        bounds(source),
        direction,
        { width: source.width, height: source.height },
        occupied,
      )
      commitQuickCreate(
        source,
        makeSibling(source, position, nextZIndex(current)),
        true,
        direction,
      )
    },
    [commitQuickCreate],
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

      const drawnShape = shapeKindForTool(latest.current.tool)
      if (drawnShape) {
        setGesture({
          kind: 'draw',
          shape: drawnShape,
          originWorld: world,
          currentWorld: world,
        })
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

      // Creation handles are tested BEFORE the resize grips (step 10). They
      // are the OUTER ring — `CREATION_HANDLE_OFFSET` is chosen so the two
      // hit rectangles cannot overlap at any zoom — so today the order is not
      // load-bearing. It is written this way regardless, because if either
      // constant ever changes the outer, larger, touch-sized affordance is
      // the one the user was aiming at.
      // A selected CONNECTOR's endpoint grips, before anything else. They are
      // the only affordance a connector has — `creationHandleTarget` excludes
      // connectors and the resize-grip block below skips them — so nothing
      // else competes for this press.
      if (currentSelection.size === 1) {
        const only = latest.current.scene.byId.get([...currentSelection][0])
        if (only?.connector) {
          const grips = connectorEndpointRects(
            latest.current.camera,
            connectorPathOf(latest.current.scene, only),
          )
          const grabbed =
            grips &&
            CONNECTOR_ENDS.find((end) =>
              screenRectContains(grips[end], screen),
            )
          if (grabbed) {
            setGesture({
              kind: 'connector-endpoint',
              connectorId: only.id,
              end: grabbed,
              // Shallow clone — same safety rationale as every other
              // pre-gesture snapshot in this file: the engine replaces
              // elements rather than mutating them, so the drag cannot reach
              // back and corrupt what this captured.
              beforeElement: { ...only },
              currentWorld: world,
              candidate: null,
            })
            return
          }
        }
      }

      const handleSource = handleTargetNow()
      if (handleSource) {
        const direction = creationHandleAt(handleSource, screen)
        if (direction) {
          setGesture({
            kind: 'quick-create',
            sourceId: handleSource.id,
            direction,
            startScreen: screen,
            currentWorld: world,
            moved: false,
          })
          return
        }
      }

      if (currentSelection.size === 1) {
        const only = latest.current.scene.byId.get(
          [...currentSelection][0],
        )
        // `!only.connector` mirrors the renderer EXACTLY: `drawScene` gates
        // its own grip block on the same condition, because a connector's
        // stored bounds are a degenerate 1x1 placeholder and grips drawn from
        // them would all pile up on one point. Testing them here anyway was a
        // real, e2e-caught defect — the grips are invisible but their 8px hit
        // rects still swallowed every click landing on that point, so with a
        // connector selected, clicking the element under its placeholder
        // selected nothing and silently began resizing the connector instead.
        // Export-what-you-draw runs in BOTH directions: input must not test
        // what the renderer declined to draw.
        if (only && !only.connector) {
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
      creationHandleAt,
      editing,
      handleTargetNow,
      screenFromEvent,
      setGesture,
      setScene,
      setTool,
      spaceHeld,
    ],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const screen = screenFromEvent(event)
      if (!screen) return
      const world = screenToWorld(latest.current.camera, screen)

      // Idle hover (step 9): what the pointer is over decides where creation
      // handles are drawn when nothing is selected. This branch reuses the
      // SAME `hitTest` scan every other gesture uses — a second traversal per
      // pointermove is a per-frame cost on the one event that fires most.
      if (gesture.kind === 'none') {
        if (latest.current.readOnly || latest.current.tool !== 'select') {
          // A read-only board sends every press to pan and a drawing tool
          // owns the next press, so handles there would be decoration that
          // does nothing.
          setHoveredId(null)
          return
        }
        const hit = hitTest(latest.current.scene, world)
        if (hit) {
          setHoveredId(hit.id)
          return
        }
        // Nothing under the pointer — but the handles sit OUTSIDE their
        // element, so moving from the element towards one of them leaves its
        // bounds. Dropping hover here would make a hover-shown handle
        // impossible to grab: it vanishes exactly as you reach for it.
        const previous = hoveredIdRef.current
          ? latest.current.scene.byId.get(hoveredIdRef.current)
          : undefined
        if (
          previous &&
          !previous.connector &&
          creationHandleAt(previous, screen)
        ) {
          return
        }
        setHoveredId(null)
        return
      }

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
          const next = resizedBounds(
            gesture.handle,
            gesture.startBounds,
            world,
          )
          setScene((prev) => updateElement(prev, gesture.elementId, next))
          break
        }
        case 'connector-endpoint': {
          // The end becomes a FREE point for the duration of the drag, so the
          // line follows the pointer with no extra renderer state — the same
          // "mutate the scene live, persist at gesture end" rule `move` and
          // `resize` already follow. The release decides what it finally is.
          setScene((prev) => {
            const element = prev.byId.get(gesture.connectorId)
            if (!element?.connector) return prev
            return updateElement(prev, gesture.connectorId, {
              connector: {
                ...element.connector,
                [gesture.end]: freeEndpoint(world),
              },
            })
          })
          setGesture({
            ...gesture,
            currentWorld: world,
            candidate: attachCandidateAt(gesture, world, latest.current.scene),
          })
          break
        }
        case 'quick-create': {
          const travelled =
            Math.abs(screen.x - gesture.startScreen.x) +
            Math.abs(screen.y - gesture.startScreen.y)
          setGesture({
            ...gesture,
            currentWorld: world,
            moved: gesture.moved || travelled > CLICK_SLOP,
          })
          break
        }
      }
    },
    [
      creationHandleAt,
      gesture,
      screenFromEvent,
      setCamera,
      setGesture,
      setHoveredId,
      setScene,
    ],
  )

  /**
   * The pointer left the canvas entirely — no element can be under it, and a
   * hover left behind would keep drawing handles around whatever was last
   * touched, including after the board scrolled out from under them.
   */
  const onPointerLeave = useCallback(() => {
    setHoveredId(null)
  }, [setHoveredId])

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
              ? { ...finished.originWorld, ...DEFAULT_SHAPE_SIZE }
              : dragged
          const element = makeElement(
            finished.shape,
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
        case 'connector-endpoint': {
          const element = latest.current.scene.byId.get(finished.connectorId)
          const link = element?.connector
          if (!element || !link) break

          // Where the OTHER end is attached, if it is — used to refuse a drop
          // that would join an element to itself, which the schema rejects
          // outright and which has no drawable path anyway.
          const otherElementId = endpointElementId(
            finished.end === 'source' ? link.target : link.source,
          )

          // The SAME rule the live preview used — see `attachCandidateAt`. The
          // highlight the user was looking at when they let go is by
          // construction the attachment they get.
          const candidate = attachCandidateAt(
            finished,
            finished.currentWorld,
            latest.current.scene,
          )
          const dropped = hitTest(latest.current.scene, finished.currentWorld)

          let resolved
          if (candidate) {
            // Attached at the point on the border NEAREST where it was let
            // go — anywhere along an edge, not one of four midpoints. This
            // covers "onto a different element" and "somewhere else on the
            // element it was already on" with no branch of its own, because
            // the attachment is recomputed from the drop either way.
            resolved = attachedEndpoint(candidate.elementId, candidate.attach)
          } else if (dropped && dropped.id === otherElementId) {
            // Dropped on the element the OTHER end holds. Revert rather than
            // detach: the user aimed at something specific, and silently
            // leaving the end floating where they released would look like the
            // drop was ignored AND move the line.
            setScene((prev) =>
              updateElement(prev, element.id, {
                connector: finished.beforeElement.connector,
              }),
            )
            break
          } else {
            // Empty board — the end stays where it was dropped, attached to
            // nothing.
            resolved = freeEndpoint(finished.currentWorld)
          }

          const updated: CanvasElement = {
            ...element,
            connector: { ...link, [finished.end]: resolved },
          }
          setScene((prev) =>
            updateElement(prev, element.id, { connector: updated.connector }),
          )
          callbacks?.onUpdate?.([updated], [finished.beforeElement], 'reconnect')
          break
        }
        case 'quick-create': {
          const source = latest.current.scene.byId.get(finished.sourceId)
          // Gone mid-gesture (a collaborator's delete) — there is nothing
          // left to connect to, and a connector with one endpoint can never
          // be drawn.
          if (!source) break

          if (!finished.moved) {
            // A click: the direction is the whole instruction, and
            // `quickCreatePlacement` decides where that lands.
            quickCreateInDirection(source, finished.direction)
            break
          }

          const dropped = hitTest(latest.current.scene, finished.currentWorld)
          if (dropped && dropped.id === source.id) {
            // Dragged out and back onto the source. Self-connectors are
            // rejected by the schema, and creating a sibling under the
            // pointer would bury it — doing nothing is what the gesture
            // looks like it did.
            break
          }
          if (dropped && !dropped.connector) {
            // Dropped on something that already exists: join the two, and
            // create nothing else. This is the case the whole drag variant
            // exists for.
            commitQuickCreate(source, dropped, false, finished.direction)
            break
          }
          // Empty board (or a connector, which cannot be an endpoint):
          // a new sibling CENTRED on the release point, because that is
          // where the rubber band has been pointing the whole drag.
          commitQuickCreate(
            source,
            makeSibling(
              source,
              {
                x: finished.currentWorld.x - source.width / 2,
                y: finished.currentWorld.y - source.height / 2,
              },
              nextZIndex(latest.current.scene),
            ),
            true,
            finished.direction,
          )
          break
        }
        default:
          break
      }
    },
    [
      callbacks,
      canvasRef,
      commitQuickCreate,
      quickCreateInDirection,
      setGesture,
      setScene,
      setTool,
    ],
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
    const selected = [...latest.current.selectedIds]
    if (selected.length === 0) return
    // Expanded to include every connector attached to anything doomed (step
    // 12): a connector whose endpoint is gone can never be drawn or clicked
    // again, so leaving it behind means an invisible row nothing can ever
    // remove. `withAttachedConnectors` deduplicates, which matters when BOTH
    // ends of one connector are in the selection.
    //
    // Both this expansion and the snapshot below read the scene BEFORE
    // `removeElements` — afterwards the connectors are gone and there is
    // nothing left to find (the B2 lesson: capture pre-state, never post).
    // Undo's inverse is a create-with-id, so it needs every persisted
    // property of every row, not just the ids.
    const ids = withAttachedConnectors(latest.current.scene, selected)
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

      // The pointerless quick-create (step 13). Checked BEFORE the modifier
      // guard below, which used to swallow every `altKey` press.
      //
      // Plain arrows are untouched: they fall through to this switch's
      // `default` exactly as before, because the board has never bound them.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        const direction = ARROW_DIRECTIONS[event.key]
        if (!direction) return
        const ids = [...latest.current.selectedIds]
        if (ids.length !== 1) return
        const source = latest.current.scene.byId.get(ids[0])
        // A connector has no "same shape one gap to the right" — the same
        // exclusion `creationHandleTarget` applies to the pointer path.
        if (!source || source.connector) return
        event.preventDefault()
        quickCreateInDirection(source, direction)
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return

      // Every shape tool's shortcut, from the one table that also labels the
      // palette buttons — checked before the switch so adding a shape kind
      // needs no new case here.
      const shapeTool = SHAPE_TOOL_BY_KEY[event.key]
      if (shapeTool) {
        setTool(shapeTool)
        return
      }

      switch (event.key) {
        case 'v':
          setTool('select')
          break
        case 'h':
          setTool('pan')
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
    [beginEditing, deleteSelection, quickCreateInDirection, setTool],
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

  /**
   * The in-flight rubber band from a creation handle. Never in the scene —
   * the same contract `draft` has, and for the same reason: nothing exists
   * until the pointer is released.
   */
  const quickCreate = useMemo<{ fromId: string; toWorld: Point } | null>(() => {
    if (gesture.kind !== 'quick-create') return null
    return { fromId: gesture.sourceId, toWorld: gesture.currentWorld }
  }, [gesture])

  /**
   * What a dragged connector end would attach to right now — the renderer
   * highlights it, and its absence is how "releasing here detaches" is shown.
   */
  const connectorAttach = useMemo<
    { elementId: string; attach: ConnectorAttach } | null
  >(() => (gesture.kind === 'connector-endpoint' ? gesture.candidate : null), [
    gesture,
  ])

  const draft = useMemo<CanvasElement | null>(() => {
    if (gesture.kind !== 'draw') return null
    const rect = rectFromPoints(gesture.originWorld, gesture.currentWorld)
    if (rect.width < 1 || rect.height < 1) return null
    return makeElement(gesture.shape, rect, nextZIndex(scene))
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
  const remapElementId = useCallback(
    (from: string, to: string) => {
      setSelectedIds((current) => {
        if (!current.has(from)) return current
        const next = new Set(current)
        next.delete(from)
        next.add(to)
        return next
      })
      setEditing((current) =>
        current && current.elementId === from
          ? {
              ...current,
              elementId: to,
              // `before` carries the element's own id, and `recordUpdate`
              // matches pre-state to post-state BY ID — a `before` still
              // holding the temporary id silently produces no operation, and
              // the text the user just typed becomes un-undoable. Only
              // reachable since quick-create began opening the editor on an
              // element whose create is still in flight (`isNew: false`).
              before: current.before ? { ...current.before, id: to } : null,
            }
          : current,
      )
      // Connector endpoints are local references too, and the ONLY ones that
      // outlive the render they were made in — a quick-created connector is
      // drawn against the new element's temporary id, and would stop
      // resolving (invisible line, no delete cascade) the moment the server
      // renamed it.
      setScene((prev) => remapConnectorEndpoints(prev, from, to))
    },
    [setEditing, setScene],
  )

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
        : shapeKindForTool(tool)
          ? 'crosshair'
          : 'default'

  return {
    selectedIds,
    setSelectedIds,
    remapElementId,
    editing,
    marquee,
    draft,
    hoveredId,
    quickCreate,
    connectorAttach,
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
      onPointerLeave,
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
