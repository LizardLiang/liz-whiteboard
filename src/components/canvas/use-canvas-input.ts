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
  ATTACH_FORGIVENESS,
  connectorPathOf,
  endpointGeometry,
  hitTest,
  hitTestAttachTarget,
  hitTestRect,
  normaliseRect,
  rectFromPoints,
  resolveClickTarget,
  resolveDropTarget,
} from '@/lib/canvas-engine/hit-test'
import { snapPoint, snapRect } from '@/lib/canvas-engine/grid'
import {
  CANVAS_SHAPE_KINDS,
  DEFAULT_CONNECTOR_ROUTING,
  DEFAULT_ELEMENT_STYLE,
  addElement,
  attachedEndpoint,
  bounds,
  boundsOfMany,
  connectorsTouching,
  endpointElementId,
  freeEndpoint,
  groupDescendants,
  groupOwning,
  nextZIndex,
  outermostGroup,
  remapConnectorEndpoints,
  removeElements,
  updateElement,
  withAttachedConnectors,
  withGroupMembers,
} from '@/lib/canvas-engine/scene'
import {
  CONNECTOR_ENDS,
  CREATION_HANDLE_DIRECTIONS,
  RESIZE_HANDLES,
  connectorBendRect,
  connectorEndpointRects,
  creationHandleRects,
  creationHandleTarget,
  handleRects,
  layoutElementText,
  textFrame,
  textOriginY,
  withinCreationHandleReach,
} from '@/lib/canvas-engine/render'
import { quickCreatePlacement } from '@/lib/canvas-engine/quick-create'
import { cloneTargets, planClone } from '@/lib/canvas-engine/clone'
import { Z_MAX, Z_MIN } from '@/lib/canvas-engine/z-order'
import {
  ANCHOR_ATTACH,
  anchorPoint,
  curvatureForPoint,
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
 *
 * Both sizes are whole multiples of `GRID_SIZE`. That is a requirement, not a
 * coincidence: a click snaps the ORIGIN to a dot, so a size that is not a
 * whole number of cells would leave the right and bottom borders hanging
 * between dots. Text is 40 rather than 48 high for exactly this reason — one
 * line of 16px text at 1.4 line height plus `TEXT_PADDING` top and bottom is
 * 38.4, so 40 still holds a line without clipping.
 */
const DEFAULT_SHAPE_SIZE = { width: 160, height: 100 }
const DEFAULT_TEXT_SIZE = { width: 240, height: 40 }

/** Below this many SCREEN pixels a drag counts as a click. */
const CLICK_SLOP = 4

/** Smallest element a resize may produce, in world units. */
const MIN_ELEMENT_SIZE = 8

/** Caret blink half-period, in milliseconds. */
const CARET_BLINK_MS = 530

/**
 * `lastPointerDownRef`'s own repeat-click window and position tolerance
 * (canvas-element-grouping tactical plan, Wave 2/5 — the `PointerEvent.
 * detail` replacement; see that ref's own doc comment for why this exists).
 *
 * 1500ms, NOT the ~500ms a browser's own native double-click timeout uses —
 * deliberately wider, confirmed necessary by a Wave 8 e2e probe: a native
 * `dblclick` DOM event fires ONLY ONCE per rapid click streak (Chromium
 * does not re-fire it for a 3rd/4th click continuing the same streak), so
 * FR-005's "a FURTHER double-click descends one more level" can only ever
 * be reached via a SEPARATE double-click GESTURE — two clicks close
 * together, but with a genuine, if brief, human pause BEFORE them (long
 * enough to exceed the browser's own streak window and let it fire a fresh
 * `dblclick`) — not by clicking rapidly four times without pause. This
 * window has to outlast that pause, or the first click of the SECOND
 * double-click would (correctly, by FR-004's own unconditional rule for a
 * click that turns out to be truly isolated) reset `enteredPath` before its
 * own `onDoubleClick` ever got to use it, undoing the first double-click's
 * progress. 1500ms comfortably covers a natural glance-and-click-again
 * pause without staying open long enough to defeat FR-004's OWN "click
 * elsewhere or wait me out" escape hatch in ordinary use. 6 world units is
 * forgiving enough for a real hand holding still at default zoom while
 * still well inside "the same spot" for any reasonably-sized element this
 * board draws.
 *
 * USED FOR TWO DIFFERENT DECISIONS, deliberately with DIFFERENT tolerances
 * (Hermes review, Major Issue): this window alone used to gate BOTH (a)
 * whether to preserve `enteredPath` across a press, and (b) whether that
 * press should target the raw hit instead of the outermost group. Sharing
 * one 1500ms window made two separate, unhurried single clicks on the same
 * member (FR-004's own unconditional case) about 700ms apart wrongly
 * resolve the SECOND one to the raw leaf, since 700ms is well inside
 * 1500ms. (a) must stay wide — it is what lets a genuinely separate,
 * SECOND double-click gesture build on the first one's already-entered
 * depth. (b) must be much tighter, close to a real double-click's own
 * inter-press gap, so it fires only for the second press of an ACTUAL
 * double-click, never for two independent slow clicks. `onDoubleClick`
 * (which reads `enteredPathRef`, not this decision) is what genuinely
 * descends a level either way — this only decides what a LONE press shows
 * in the moment before it, if anything, fires.
 */
const REPEAT_CLICK_WINDOW_MS = 1500
const REPEAT_CLICK_DISTANCE = 6
/**
 * How close two presses must land for the SECOND one to target the raw hit
 * instead of the outermost group — see `REPEAT_CLICK_WINDOW_MS`'s own
 * header for why this is a separate, tighter window from that one. Close to
 * a real double-click's own inter-press gap (well under a second in every
 * mainstream browser's native double-click detection).
 */
const RAW_HIT_TARGET_WINDOW_MS = 500

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
   * A `curved` connector's BOW was dragged by its midpoint grip. Produced
   * here, unlike `routing`, because it is a real pointer gesture on the
   * canvas rather than a toolbar click.
   *
   * Distinct from BOTH connector arms it sits between, and it has to be:
   * `routing` swaps the line for a different kind of line, `reconnect` moves
   * an end somewhere else, and this moves neither — the ends stay exactly
   * where they were and the routing stays `curved`. One toast covering all
   * three would name the wrong edit two times out of three.
   */
  | 'bend'
  // Like `routing`, NOT produced by this file: fill and stroke are changed
  // from `SelectionToolbar`, which reaches the same `onUpdate` recording
  // surface rather than writing through `useCanvasElements` directly — going
  // around it would make restyling the one board edit `Ctrl+Z` could not
  // reverse. Unlike `routing`, it can span SEVERAL elements: one click
  // restyles the whole selection, which is still one gesture and therefore
  // one undo entry.
  | 'style'
  // Paint ORDER, from the same toolbar. Distinct from `style` because nothing
  // about the element's appearance changed — a toast saying "restyling" after
  // a shape merely moved behind another would describe the wrong edit.
  | 'z-order'

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
  /**
   * One copy gesture — a paste or a duplicate — carrying everything it
   * created (canvas copy-paste-duplicate tactical plan, step 2).
   *
   * Separate from `onQuickCreate` rather than a second use of it, even though
   * both hand over "several elements created by one press". That callback's
   * consumer knows it is looking at exactly one element and one connector and
   * labels the entry `quick-create`; this one may carry any number of either,
   * and must be labelled with the key the user actually pressed.
   *
   * ORDERING IS PART OF THE CONTRACT, and it is `planClone`'s: every
   * non-connector comes first, connectors last. The consumer must create them
   * in that order and rewrite each connector's endpoints from the ids the
   * server answers with, for exactly the reason `onQuickCreate` documents — a
   * connector persisted against a client-side id names a row that never
   * existed.
   */
  onClone?: (
    elements: Array<CanvasElement>,
    source: 'paste' | 'duplicate',
  ) => void
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
  /**
   * `gesture` names WHY the elements are going away (canvas
   * copy-paste-duplicate tactical plan, step 2), mirroring how `onUpdate`
   * carries its `CanvasUpdateGesture`. A cut removes exactly what a delete
   * removes, so nothing about the elements themselves can tell the two apart
   * — but only one of them also filled the clipboard, and the undo toast has
   * to say which happened. Optional, defaulting to `'delete'`, so every
   * existing call site is unchanged.
   *
   * `groupUpdates` (canvas-element-grouping PRD-alignment finding 1, FR-018
   * write-time scenario): the `childIds` patch for every group that SURVIVES
   * this delete but owned one of the doomed ids directly — empty when
   * nothing needs cleaning, e.g. every case where the owning group is ITSELF
   * among the doomed ids (Wave 4's cascade already removes the whole
   * subtree, so there is no surviving owner left to patch). Folded into the
   * SAME write/undo entry the delete itself makes, mirroring how
   * `onUpdate`'s `resolveMembershipUpdates` folds a membership patch into a
   * move. Optional and defaults to `[]` so a consumer testing this callback
   * in isolation is not forced to supply it.
   */
  onDelete?: (
    elements: Array<CanvasElement>,
    gesture?: 'delete' | 'cut',
    groupUpdates?: Array<{ before: CanvasElement; after: CanvasElement }>,
  ) => void
  /**
   * One group-creation gesture (canvas-element-grouping tactical plan, Wave
   * 6/7): the new group element, already carrying its `childIds`. Members
   * themselves are never written — membership lives on the group side only
   * (Wave 1) — so this is closer to `onCreate` than to any multi-element
   * recorder; the consumer's `recordGroup` (use-canvas-undo.ts) persists it
   * with a single `element:create`.
   *
   * `groupUpdates` (Hermes code review BLOCKER 2, FR-018): every OTHER
   * element this same gesture also needs to patch — a prior owner's
   * `childIds` a joining member is detached from, and/or a member's own
   * `zIndex` bump when the new group's zIndex had to renormalize the whole
   * membership up. Folded into the SAME write/undo entry the group's own
   * creation makes, mirroring how `onDelete`'s `groupUpdates` folds a
   * cleanup patch into a delete. Optional and defaults to `[]`.
   */
  onGroup?: (
    groupElement: CanvasElement,
    groupUpdates?: Array<{ before: CanvasElement; after: CanvasElement }>,
  ) => void
  /**
   * One ungroup gesture: the group element being dissolved, exactly as it
   * stood before removal — everything the consumer's `recordUngroup`
   * needs to persist a single `element:delete` and to restore it on undo.
   * Members need no write either: dissolving a group only deletes the
   * group row, and the members were never touched by grouping, so they are
   * already independent the instant it is gone.
   *
   * `groupUpdates` (Hermes code review BLOCKER 1, FR-018): the dissolving
   * group's OWN parent's `childIds` patch, when it is itself nested inside
   * a SURVIVING group — empty when it is not nested, or when the selection
   * even reaches this callback for a top-level group. Folded into the SAME
   * write/undo entry the dissolve itself makes, mirroring `onDelete`'s
   * `groupUpdates`. Optional and defaults to `[]`.
   */
  onUngroup?: (
    groupElement: CanvasElement,
    groupUpdates?: Array<{ before: CanvasElement; after: CanvasElement }>,
  ) => void
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
       * A press on a selected `curved` connector's midpoint grip. The bow
       * follows the pointer for the whole drag — the scene is mutated live,
       * exactly as `move`, `resize` and `connector-endpoint` do — and the
       * release persists whatever it ended at.
       *
       * Carries NO start reference, unlike `resize`'s `startBounds`, and that
       * is deliberate rather than an omission: the curvature is recomputed
       * from the CURRENT pointer against the CURRENT chord on every frame
       * (`curvatureForPoint`), so there is nothing to accumulate and nothing
       * to drift. `beforeElement` is for undo's pre-state only, never read by
       * the drag itself.
       */
      kind: 'connector-bend'
      connectorId: string
      /** The connector as it stood at pointerdown, for `onUpdate`'s pre-state. */
      beforeElement: CanvasElement
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
       * What releasing right now would join to, or null when it would create
       * a new element instead. Recomputed per `pointermove` and read by the
       * renderer — see `quickCreateDropAt`.
       */
      candidate: { elementId: string; attach: ConnectorAttach } | null
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

/**
 * The rectangle a draw gesture produces, with every border on a dot.
 *
 * ONE function, consulted by both the live draft preview and the release, for
 * the same reason `attachCandidateAt` is one function: a preview that shows
 * the unsnapped drag and a release that commits the snapped rect would
 * disagree by up to half a cell on every edge, and the user would watch the
 * shape jump at the moment they let go.
 *
 * A drag shorter than `MIN_ELEMENT_SIZE` on either axis is a click, and a
 * click creates the default size at the nearest dot — the size constants are
 * whole cells, so all four of its borders land on dots too.
 */
function drawnRect(origin: Point, current: Point): WorldRect {
  const dragged = rectFromPoints(origin, current)
  if (dragged.width < MIN_ELEMENT_SIZE || dragged.height < MIN_ELEMENT_SIZE) {
    return { ...snapPoint(origin), ...DEFAULT_SHAPE_SIZE }
  }
  return snapRect(dragged)
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
  pad: number,
): { elementId: string; attach: ConnectorAttach } | null {
  const link = scene.byId.get(gesture.connectorId)?.connector
  if (!link) return null
  const other = gesture.end === 'source' ? link.target : link.source
  const otherElementId = endpointElementId(other)

  const dropped = hitTestAttachTarget(scene, world, pad)
  // The element the OTHER end already holds is not a target — that would be a
  // self-connector, which the schema rejects outright. Connectors are already
  // excluded by `hitTestAttachTarget`.
  if (!dropped || dropped.id === otherElementId) return null
  return {
    elementId: dropped.id,
    attach: nearestAttach(bounds(dropped), world),
  }
}

/**
 * `ATTACH_FORGIVENESS` screen pixels, expressed in world units at the current
 * zoom — so the slack under the cursor is the same physical distance whether
 * the board is at 0.1x or 2x.
 */
function attachForgiveness(camera: Camera): number {
  return ATTACH_FORGIVENESS / camera.zoom
}

/** The three things releasing a creation-handle drag can do. */
type QuickCreateDrop =
  | { outcome: 'attach'; element: CanvasElement; attach: ConnectorAttach }
  | { outcome: 'create' }
  | { outcome: 'none' }

/**
 * What releasing a creation-handle drag at `world` would do.
 *
 * ONE function, consulted by both the live highlight and the release, for the
 * reason `attachCandidateAt` documents — and the stakes are higher here. A
 * connector end that misses simply detaches, but a quick-create that misses
 * CREATES an element under the pointer, so an unhighlighted near-miss costs an
 * undo rather than a second try. The highlight is what makes the difference
 * visible BEFORE the user commits to it.
 *
 * The attach point is `makeConnector`'s rule verbatim: the target's face
 * nearest the DEPARTURE point, not the face nearest the pointer. A
 * quick-create leaves the side whose handle was grabbed and lands on the
 * facing side, and the marked spot has to be the border point the commit
 * actually uses.
 */
function quickCreateDropAt(
  gesture: { sourceId: string; direction: CreationHandleDirection },
  world: Point,
  scene: Scene,
  pad: number,
): QuickCreateDrop {
  const source = scene.byId.get(gesture.sourceId)
  // Gone mid-gesture (a collaborator's delete) — there is nothing left to
  // connect to, and a connector with one endpoint can never be drawn.
  if (!source) return { outcome: 'none' }

  const dropped = hitTestAttachTarget(scene, world, pad)
  if (!dropped) return { outcome: 'create' }
  // Dragged out and back onto the source. Self-connectors are rejected by the
  // schema, and creating a sibling under the pointer would bury it — doing
  // nothing is what the gesture looks like it did.
  if (dropped.id === source.id) return { outcome: 'none' }

  const from = anchorPoint(bounds(source), gesture.direction)
  return {
    outcome: 'attach',
    element: dropped,
    attach: ANCHOR_ATTACH[nearestAnchor(bounds(dropped), from)],
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

/** One element's patch, before and after — for folding into the SAME `onUpdate`/`onGroup`/`onUngroup`/`onDelete` call a gesture already makes. Carries a group's `childIds` patch OR a member's `zIndex` bump (or, in principle, both) — whatever changed, `after` is the element's whole next row. */
interface MembershipUpdate {
  before: CanvasElement
  after: CanvasElement
}

/**
 * Accumulate one owner's running `childIds` patch across a pass over
 * several affected ids, keyed by owner id so a single owner touched twice
 * in the same pass (e.g. both an old and a new owner within one move
 * gesture) ends up with ONE final patch, not two competing ones.
 *
 * Shared by `resolveMembershipUpdates`'s old-owner detach branch,
 * `resolveGroupCleanupUpdates`, and `groupSelection`'s prior-owner detach
 * (Hermes review, Major Issue: "two near-identical 9-line blocks... meets
 * `default.md`'s copy-paste threshold"). `originals` and `patched` are the
 * caller's own running maps — passed in rather than owned here, so several
 * calls across one pass (one per affected id) keep composing into the same
 * two maps.
 */
function patchGroupChildIds(
  originals: Map<string, CanvasElement>,
  patched: Map<string, CanvasElement>,
  owner: CanvasElement,
  updateChildIds: (childIds: ReadonlyArray<string>) => Array<string>,
): void {
  if (!originals.has(owner.id)) originals.set(owner.id, owner)
  const current = patched.get(owner.id) ?? owner
  patched.set(owner.id, {
    ...current,
    group: { childIds: updateChildIds(current.group?.childIds ?? []) },
  })
}

/**
 * Every id in `ids` that is NOT a descendant (via `groupDescendants`) of
 * another id also in `ids` — shared by `resolveMembershipUpdates`'s own
 * top-level filter and `groupSelection`'s descendant filter (Hermes review
 * BLOCKER 2). An id that IS such a descendant is moving/binding WITH that
 * other id, not independently, and must not also be evaluated on its own.
 *
 * O(ids^2) `groupDescendants` calls in the worst case (Cassandra/Hermes
 * Minor Issue) — cheap in the common case, since `groupDescendants`
 * short-circuits for a non-group id, and this only runs once per gesture
 * end, not per frame.
 */
function topLevelIds(
  scene: Scene,
  ids: ReadonlyArray<string>,
): Array<string> {
  const descendantsByOther = new Map(
    ids.map((other) => [other, new Set(groupDescendants(scene, other))]),
  )
  return ids.filter(
    (id) =>
      !ids.some(
        (other) => other !== id && descendantsByOther.get(other)!.has(id),
      ),
  )
}

/**
 * The group membership changes a completed move gesture produced, or an
 * empty array if none (canvas-element-grouping tactical plan, Wave 5) — the
 * one genuinely new gesture this feature adds.
 *
 * Evaluated ONCE, from the scene `onPointerMove` has already shifted to the
 * FINAL dropped positions — never mid-drag (FR-012's commit-on-drop rule).
 * Only TOP-LEVEL dragged ids are checked (`topLevelIds`, above): an id that
 * is itself a descendant of ANOTHER id in `draggedIds` is moving WITH that
 * other id, not independently, so it must not also try to "join" a frame
 * using its own (dragged-along) position.
 *
 * A single group can be BOTH the old owner for one top-level id and the
 * new owner for another within the same gesture — the running patch is
 * accumulated per group id so both edits land in one final `childIds`.
 *
 * Also patches the JOINING element's own `zIndex` when it drops below its
 * new owner's (Hermes review, Major Issue): a group's frame must always
 * paint BELOW every one of its members (see `groupSelection`'s own header),
 * or `hitTest`'s flat reverse-z scan lets the frame occlude a lower-z
 * member permanently the instant it joins. Bumped to one above the owner's
 * current `zIndex`, clamped to `Z_MAX`.
 */
function resolveMembershipUpdates(
  scene: Scene,
  draggedIds: ReadonlyArray<string>,
): Array<MembershipUpdate> {
  const draggedSet = new Set(draggedIds)
  const ids = topLevelIds(scene, draggedIds)

  const patched = new Map<string, CanvasElement>()
  const originals = new Map<string, CanvasElement>()

  for (const id of ids) {
    const oldOwner = groupOwning(scene, id)
    // `excludedIds` is the WHOLE gesture, not just `id` and its
    // descendants: a group being dragged cannot join itself, one of its
    // own members also mid-drag, or a SIBLING also mid-drag alongside it.
    const newOwnerId = resolveDropTarget(scene, id, draggedSet)
    if ((oldOwner?.id ?? null) === newOwnerId) continue // unchanged

    if (oldOwner) {
      patchGroupChildIds(originals, patched, oldOwner, (childIds) =>
        childIds.filter((childId) => childId !== id),
      )
    }
    if (newOwnerId) {
      const newOwner = scene.byId.get(newOwnerId)
      if (newOwner) {
        patchGroupChildIds(originals, patched, newOwner, (childIds) => [
          ...childIds,
          id,
        ])
        const joiningElement = scene.byId.get(id)
        if (joiningElement && joiningElement.zIndex <= newOwner.zIndex) {
          if (!originals.has(id)) originals.set(id, joiningElement)
          patched.set(id, {
            ...(patched.get(id) ?? joiningElement),
            zIndex: Math.min(newOwner.zIndex + 1, Z_MAX),
          })
        }
      }
    }
  }

  return [...patched.entries()].map(([id, after]) => ({
    before: originals.get(id) as CanvasElement,
    after,
  }))
}

/**
 * For every doomed id that is a DIRECT member of a group NOT itself among
 * `doomedIds`, the patch that drops it from that group's `childIds` —
 * folded into the SAME delete/undo entry `deleteSelection` makes (mirrors
 * `resolveMembershipUpdates`'s move-time fold above; canvas-element-grouping
 * PRD-alignment finding 1, FR-018's write-time scenario).
 *
 * A group id that is ITSELF in `doomedIds` needs no patch: Wave 4's cascade
 * (`withGroupMembers`) already means the group's whole row is going away in
 * this same gesture, so its `childIds` no longer matter to anything — this
 * is exactly the "already-correct" whole-group-delete path, kept untouched.
 *
 * Only DIRECT ownership is checked (`groupOwning`, not a transitive walk):
 * deleting a doubly-nested member patches its immediate parent only — an
 * outer ancestor's `childIds` still correctly names that (surviving,
 * merely-smaller) parent and needs no change of its own.
 *
 * Also the fix for BLOCKER 1 (Hermes code review): called with a single
 * dissolving group's own id from `ungroupSelection` — the `doomed.has
 * (owner.id)` guard above does not fire when the PARENT of a nested group
 * survives, so this returns exactly the parent patch that case needs too.
 */
function resolveGroupCleanupUpdates(
  scene: Scene,
  doomedIds: ReadonlyArray<string>,
): Array<MembershipUpdate> {
  const doomed = new Set(doomedIds)
  const originals = new Map<string, CanvasElement>()
  const patched = new Map<string, CanvasElement>()

  for (const id of doomedIds) {
    const owner = groupOwning(scene, id)
    if (!owner || doomed.has(owner.id)) continue
    patchGroupChildIds(originals, patched, owner, (childIds) =>
      childIds.filter((childId) => childId !== id),
    )
  }

  return [...patched.entries()].map(([id, after]) => ({
    before: originals.get(id) as CanvasElement,
    after,
  }))
}

/**
 * Apply a batch of `MembershipUpdate`s to a scene — a `childIds` patch, a
 * `zIndex` bump, or (in principle) both folded onto the same element — one
 * `updateElement` call per entry. The WHOLE `after` object is spread as the
 * patch rather than picking out `group` alone (Hermes review, Major Issue:
 * the earlier per-call-site `{ group: after.group }` patch silently
 * dropped a `zIndex` bump the drag-in z-order fix above now also needs to
 * apply through this same path).
 */
function applyMembershipUpdates(
  scene: Scene,
  updates: ReadonlyArray<MembershipUpdate>,
): Scene {
  return updates.reduce((next, { after }) => {
    const { id, ...patch } = after
    return updateElement(next, id, patch)
  }, scene)
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

  /**
   * Group ids the user has double-clicked INTO, outermost first (canvas-
   * element-grouping tactical plan, Wave 2). Read by `resolveClickTarget`
   * (hit-test.ts) to know how deep the caller already is. Mirrored in a ref
   * for the same reason `hoveredIdRef` is: `onDoubleClick` fires as its own,
   * later browser event, with no React render guaranteed in between it and
   * whatever `onPointerDown` just did in the same click sequence — reading
   * `enteredPathRef.current` always sees the latest value, a plain
   * `enteredPath` closure variable might not.
   */
  const [enteredPath, setEnteredPathState] = useState<Array<string>>([])
  const enteredPathRef = useRef<Array<string>>([])

  /**
   * The last SELECT-TOOL pointerdown's timestamp and WORLD position — this
   * hook's own manually-tracked replacement for `PointerEvent.detail`
   * (canvas-element-grouping tactical plan, Wave 2/5; bug found and fixed
   * during Wave 8 e2e testing).
   *
   * `event.detail` was the ORIGINAL mechanism `onPointerDown` used to tell
   * an isolated click from click 2+ of a rapid sequence — correct for a
   * `MouseEvent` (`click`/`dblclick`), but `onPointerDown` receives a
   * `PointerEvent`, and every real browser tested (confirmed empirically via
   * a throwaway Playwright probe, not assumed) reports `PointerEvent.detail`
   * as a constant `0` on `pointerdown`, REGARDLESS of how many times the
   * user has clicked at that point. `event.detail <= 1` was therefore always
   * true for every real pointerdown, silently making the "click 2+" branch
   * (member-specific drag, Wave 5) unreachable, and resetting `enteredPath`
   * on EVERY click — including the second press of a double-click — which
   * made a FURTHER double-click (FR-005's "descends one more level")
   * unreachable too: by the time `onDoubleClick` ran, this same handler's
   * own second pointerdown had already zeroed `enteredPath` back to `[]`.
   * The unit-test suite never caught this because its own `pointerEvent()`
   * fixture sets `detail` directly on a plain object, which is not what a
   * real `PointerEvent` ever contains.
   *
   * Re-implemented at the app level instead: a pointerdown counts as a
   * "repeat" (the `event.detail > 1` equivalent) when it lands within
   * `REPEAT_CLICK_WINDOW_MS` and `REPEAT_CLICK_DISTANCE` world units of the
   * PRECEDING select-tool pointerdown — the same two signals (time,
   * position) a browser's own native click-counter uses internally.
   */
  const lastPointerDownRef = useRef<{ time: number; world: Point } | null>(
    null,
  )

  const setEnteredPath = useCallback((next: Array<string>) => {
    enteredPathRef.current = next
    setEnteredPathState(next)
  }, [])

  const setGesture = useCallback((next: Gesture) => {
    gestureRef.current = next
    setGestureState(next)
  }, [])

  const setEditing = useCallback(
    (
      next:
        | EditingState
        | null
        | ((current: EditingState | null) => EditingState | null),
    ) => {
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
    if (current.isNew) {
      callbacks?.onCreate?.(element)
      return
    }
    // An edit session that changed NOTHING is not an edit. Reporting one
    // anyway cost the user their next Ctrl+Z: the no-op entry sat on top of
    // the undo stack and was consumed silently, so the gesture they actually
    // meant to reverse needed a second press with nothing to show for the
    // first. It also wrote a pointless revision to the server per aborted
    // edit.
    //
    // The quick-create-by-click path walks straight into this: it opens the
    // new element for typing, and a user who clicks away without typing then
    // has to press Ctrl+Z twice to undo the thing they just created.
    //
    // Text is the whole comparison because text is all an edit session can
    // touch — `applyTextEdit` patches `text` and nothing else.
    const before = current.before ?? element
    if ((before.text ?? '') === (element.text ?? '')) return
    callbacks?.onUpdate?.([element], [before], 'text-edit')
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
      // `textOriginY`, not `frame.y`: the block may be pushed down its box by
      // `verticalAlign`, and subtracting the frame's top instead would map the
      // click onto the wrong line. The x side needs no such adjustment —
      // horizontal alignment is already inside the layout's caret offsets.
      return caretFromPoint(layout, {
        x: world.x - frame.x,
        y: world.y - textOriginY(element, layout),
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
          { ...snapPoint(world), ...DEFAULT_TEXT_SIZE },
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
      // A selected CONNECTOR's own grips, before anything else. They are the
      // only affordances a connector has — `creationHandleTarget` excludes
      // connectors and the resize-grip block below skips them — so nothing
      // else competes for this press.
      if (currentSelection.size === 1) {
        const only = latest.current.scene.byId.get([...currentSelection][0])
        if (only?.connector) {
          const path = connectorPathOf(latest.current.scene, only)
          const grips = connectorEndpointRects(latest.current.camera, path)
          const grabbed =
            grips &&
            CONNECTOR_ENDS.find((end) => screenRectContains(grips[end], screen))
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

          // The bend grip, tested AFTER both ends. On a short connector the
          // three grips crowd together, and the ends are the more precise
          // target: a mis-grabbed end lands the line on the wrong element,
          // a mis-grabbed bend merely bows a curve the user can drag back.
          // `CONNECTOR_BEND_HIT` being the smaller rectangle is the other
          // half of the same decision.
          //
          // Gated on `curved`, mirroring the renderer EXACTLY — `drawScene`
          // draws no diamond for a straight or elbow connector, and testing
          // an undrawn affordance is the defect the resize-grip block below
          // documents at length: an invisible 20px rectangle sitting on the
          // middle of every straight connector would swallow the presses that
          // should have selected whatever lies under it.
          if (only.connector.routing === 'curved') {
            const bend = connectorBendRect(latest.current.camera, path)
            if (bend && screenRectContains(bend, screen)) {
              setGesture({
                kind: 'connector-bend',
                connectorId: only.id,
                // Shallow clone — same safety rationale as every other
                // pre-gesture snapshot in this file: the engine replaces
                // elements rather than mutating them, so the drag cannot
                // reach back and corrupt what this captured.
                beforeElement: { ...only },
              })
              return
            }
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
            candidate: null,
          })
          return
        }
      }

      if (currentSelection.size === 1) {
        const only = latest.current.scene.byId.get([...currentSelection][0])
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
        //
        // The converse is NOT symmetric, and deliberately so: the renderer
        // grips every element of a MULTI-selection too, and this block never
        // sees those because it is gated on a selection of exactly one. There
        // they report "selected" and nothing more — resizing a group is not a
        // gesture this milestone has — so a press on one falls through to the
        // element beneath and starts a move, which is what a press inside a
        // multi-selection should do anyway.
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
        // Leaving the structure entirely — same "exit whatever depth was
        // entered" rule Escape and deleteSelection apply below.
        setEnteredPath([])
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

      // Group-aware target resolution (canvas-element-grouping tactical
      // plan, Wave 2). `resolveClickTarget` is NOT needed here — a single
      // click never consults `enteredPath`, it always resolves to the
      // outermost group (FR-004's wording is unconditional) and exits
      // whatever depth was previously entered.
      //
      // Gated on `isRepeatClick` — see `lastPointerDownRef`'s own doc
      // comment for why this is a manually-tracked time+position check
      // rather than `event.detail` (a real `PointerEvent.detail` does not
      // carry click-count semantics; a prior version of this code read it
      // directly and the bug was invisible to every unit test, only
      // surfacing under real browser input in Wave 8 e2e testing).
      //
      // TWO SEPARATE questions share this same timing sample but need
      // DIFFERENT tolerances (Hermes review, Major Issue — see
      // `RAW_HIT_TARGET_WINDOW_MS`'s own header): whether to PRESERVE
      // `enteredPath` across this press (wide — must survive a genuine
      // pause before a SECOND, separate double-click gesture) versus
      // whether THIS press should target the raw hit instead of the
      // outermost group (tight — must not fire for two truly independent,
      // unhurried single clicks on the same member, FR-004's own
      // unconditional case). `preservesEnteredPath` false is the FR-004
      // "isolated click" case: clears `enteredPath`. `targetsRawHit` true
      // resolves to the RAW hit, which is what lets `onDoubleClick`
      // (firing after this same handler already ran for its own second
      // press) see a meaningful, still-entered `enteredPath` and build on a
      // PREVIOUS descent — the mechanism FR-005's "a further double-click
      // descends one more level" needs to be reachable at all.
      const lastPointerDown = lastPointerDownRef.current
      const withinRepeatDistance =
        lastPointerDown !== null &&
        Math.hypot(
          world.x - lastPointerDown.world.x,
          world.y - lastPointerDown.world.y,
        ) <= REPEAT_CLICK_DISTANCE
      const elapsedSincePointerDown =
        lastPointerDown === null ? Infinity : Date.now() - lastPointerDown.time
      const preservesEnteredPath =
        withinRepeatDistance &&
        elapsedSincePointerDown <= REPEAT_CLICK_WINDOW_MS
      const targetsRawHit =
        withinRepeatDistance &&
        elapsedSincePointerDown <= RAW_HIT_TARGET_WINDOW_MS
      lastPointerDownRef.current = { time: Date.now(), world }

      const target = targetsRawHit
        ? hit
        : (outermostGroup(latest.current.scene, hit.id) ?? hit)
      if (!preservesEnteredPath) setEnteredPath([])

      let nextSelection: Set<string>
      if (event.shiftKey) {
        nextSelection = new Set(currentSelection)
        if (nextSelection.has(target.id)) nextSelection.delete(target.id)
        else nextSelection.add(target.id)
      } else if (currentSelection.has(target.id)) {
        nextSelection = new Set(currentSelection)
      } else {
        nextSelection = new Set([target.id])
      }
      setSelectedIds(nextSelection)
      // Expanded through `withGroupMembers` (canvas-element-grouping
      // tactical plan, Wave 3) so a group in the selection drags every
      // descendant at every nesting depth along with it — the rigid-body
      // move FR-006 requires. `nextSelection` itself (what gets
      // HIGHLIGHTED/selected) stays just the group id; only the GESTURE's
      // own `ids`/`before` — what actually gets shifted by `dx`/`dy` in
      // `onPointerMove`'s `'move'` case below — is expanded. Nothing else
      // about the move gesture changes: the existing per-element shift loop
      // and the existing multi-op `recordUpdate` already handle however
      // many ids land in `gesture.ids`.
      const moveIds = withGroupMembers(latest.current.scene, [...nextSelection])
      setGesture({
        kind: 'move',
        lastWorld: world,
        startScreen: screen,
        ids: moveIds,
        moved: false,
        // Shallow clones — safe for the same reason `beginEditing`'s own
        // `{ ...element }` clone is (see its comment): `canvas-engine`
        // never mutates an element in place, only replaces it, so the drag
        // that follows cannot reach back and corrupt this pre-move snapshot
        // (Hermes review, suggestion).
        before: moveIds
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
      setEnteredPath,
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
        const previous = hoveredIdRef.current
          ? latest.current.scene.byId.get(hoveredIdRef.current)
          : undefined

        const hit = hitTest(latest.current.scene, world)
        // A connector under the pointer does NOT take the hover while another
        // element holds it. Hover exists only to decide where creation
        // handles go, and a connector never gets them (`creationHandleTarget`
        // returns null for one), so moving the hover onto a connector can
        // only ever CLEAR handles. That matters here specifically: a
        // connector attached to a shape leaves its edge exactly where that
        // edge's handle sits, so the pointer crosses one on the way to the
        // handle it is reaching for. `hitTest` already prefers non-connectors,
        // so a connector only wins when no shape is under the point — which
        // is what makes ignoring it safe rather than sticky.
        if (hit && !(hit.connector && previous && !previous.connector)) {
          setHoveredId(hit.id)
          return
        }

        // Nothing under the pointer that takes the hover — but the handles sit
        // OUTSIDE their element, so moving from the element towards one of
        // them leaves its bounds. Hover therefore survives anywhere within the
        // handles' own reach of it. Testing the handle RECTANGLES here instead
        // (which is what this did) left the gap between element and handle
        // owned by nobody, and a hover-shown handle unreachable by any
        // approach that was not perpendicular to an edge midpoint — see
        // `withinCreationHandleReach`.
        if (
          previous &&
          !previous.connector &&
          withinCreationHandleReach(
            latest.current.camera,
            bounds(previous),
            screen,
          )
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
          const next = resizedBounds(gesture.handle, gesture.startBounds, world)
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
            candidate: attachCandidateAt(
              gesture,
              world,
              latest.current.scene,
              attachForgiveness(latest.current.camera),
            ),
          })
          break
        }
        case 'connector-bend': {
          // Same "mutate the scene live, persist at gesture end" rule as
          // `move`, `resize` and `connector-endpoint` — the curve re-bows on
          // the next frame with no extra renderer state, and the release
          // simply persists whatever the last frame left.
          //
          // The curvature is DERIVED FROM THE POINTER, not accumulated from
          // the previous frame: `curvatureForPoint` answers "what bow puts the
          // bend point exactly here" against the current chord, so a drag that
          // is clamped at the limit and dragged back does not come back
          // offset by however long it spent pinned there.
          setScene((prev) => {
            const element = prev.byId.get(gesture.connectorId)
            const link = element?.connector
            if (!link) return prev
            const curvature = curvatureForPoint(
              endpointGeometry(prev, link.source),
              endpointGeometry(prev, link.target),
              world,
            )
            // Null means the pair has no drawable line right now — an endpoint
            // element deleted by a collaborator mid-drag, or two ends landing
            // on the same point. Leaving the bow alone is the honest answer;
            // the connector is not being drawn either way.
            if (curvature === null) return prev
            return updateElement(prev, gesture.connectorId, {
              connector: { ...link, curvature },
            })
          })
          break
        }
        case 'quick-create': {
          const travelled =
            Math.abs(screen.x - gesture.startScreen.x) +
            Math.abs(screen.y - gesture.startScreen.y)
          const drop = quickCreateDropAt(
            gesture,
            world,
            latest.current.scene,
            attachForgiveness(latest.current.camera),
          )
          setGesture({
            ...gesture,
            currentWorld: world,
            moved: gesture.moved || travelled > CLICK_SLOP,
            candidate:
              drop.outcome === 'attach'
                ? { elementId: drop.element.id, attach: drop.attach }
                : null,
          })
          break
        }
      }
    },
    [gesture, screenFromEvent, setCamera, setGesture, setHoveredId, setScene],
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
          // Snapped to the dot grid, and by the same function the draft
          // preview used — see `drawnRect`. A click (rather than a drag)
          // creates a default-sized element at the click point, which is what
          // every editor does and what makes the tool usable without a
          // precise drag.
          const rect = drawnRect(finished.originWorld, finished.currentWorld)
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
          // Not `scene` — that name is already the hook's own `scene` prop
          // one scope up, and shadowing it here would make every OTHER
          // reference inside this block ambiguous to a reader.
          const currentScene = latest.current.scene
          const moved = finished.ids
            .map((id) => currentScene.byId.get(id))
            .filter((element): element is CanvasElement => Boolean(element))
          if (moved.length === 0) break

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

          // Membership editing on drop (canvas-element-grouping tactical
          // plan, Wave 5): resolved HERE, once, from the final dropped
          // positions `onPointerMove` already applied to the scene —
          // never mid-drag (FR-012).
          const membershipUpdates = resolveMembershipUpdates(
            currentScene,
            finished.ids,
          )
          if (membershipUpdates.length > 0) {
            setScene((prev) => applyMembershipUpdates(prev, membershipUpdates))
          }

          // Folded into the SAME `onUpdate` call the position update
          // already makes, so position change + membership change stays
          // ONE undo entry (FR-016) — not a new undo primitive, just a
          // bigger element list handed to the existing one.
          const movedIds = new Set(moved.map((element) => element.id))
          const after = [...moved]
          const beforeAll = [...before]
          for (const update of membershipUpdates) {
            if (movedIds.has(update.after.id)) {
              // The affected element was ALSO dragged in this same gesture
              // — merge every changed field from `update.after` into its
              // already-captured after-element in place, rather than adding
              // a duplicate entry; its `before` entry is already the
              // correct pre-drag snapshot. Every field, not just `group`
              // (Hermes review, Major Issue): a joining element's own
              // `zIndex` bump (see `resolveMembershipUpdates`'s z-order
              // invariant fix) must survive this fold too, and both objects
              // derive from the SAME post-drop `currentScene`, so merging
              // the whole thing is safe — no other field actually differs.
              const idx = after.findIndex(
                (element) => element.id === update.after.id,
              )
              after[idx] = { ...after[idx], ...update.after }
            } else {
              after.push(update.after)
              beforeAll.push(update.before)
            }
          }

          callbacks?.onUpdate?.(after, beforeAll, 'move')
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
            attachForgiveness(latest.current.camera),
          )
          const dropped = hitTestAttachTarget(
            latest.current.scene,
            finished.currentWorld,
            attachForgiveness(latest.current.camera),
          )

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
          callbacks?.onUpdate?.(
            [updated],
            [finished.beforeElement],
            'reconnect',
          )
          break
        }
        case 'connector-bend': {
          const element = latest.current.scene.byId.get(finished.connectorId)
          // Gone mid-gesture (a collaborator's delete, or its own endpoint
          // element removed and the cascade taking it) — there is nothing left
          // to persist, and writing the pre-gesture snapshot back would
          // resurrect a row the board has already agreed is deleted.
          if (!element) break
          // A press that never moved leaves the curvature exactly as it was,
          // and persisting that would push an undo entry whose undo is a
          // no-op — "Undid bending a connector" for a connector nobody bent.
          // Compared on the VALUE rather than on a `moved` flag (which is what
          // `move` uses) because a drag out and back to the same spot is also
          // a non-edit, and the value is the thing that actually decides.
          if (
            element.connector?.curvature ===
            finished.beforeElement.connector?.curvature
          ) {
            break
          }
          callbacks?.onUpdate?.([element], [finished.beforeElement], 'bend')
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

          // The SAME rule the live highlight used — see `quickCreateDropAt`.
          // A shape the user was shown as a target is the shape they get.
          const drop = quickCreateDropAt(
            finished,
            finished.currentWorld,
            latest.current.scene,
            attachForgiveness(latest.current.camera),
          )
          if (drop.outcome === 'none') break
          if (drop.outcome === 'attach') {
            // Dropped on something that already exists: join the two, and
            // create nothing else. This is the case the whole drag variant
            // exists for.
            commitQuickCreate(source, drop.element, false, finished.direction)
            break
          }
          // Empty board: a new sibling CENTRED on the release point, because
          // that is where the rubber band has been pointing the whole drag.
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

      // Group-aware descent (canvas-element-grouping tactical plan, Wave 2).
      // `enteredPathRef` (not the `enteredPath` closure variable) because
      // this handler fires as its own, later browser event — the
      // `onPointerDown` that just ran for this same click's second press
      // may have updated it moments ago, with no React render guaranteed in
      // between (see `enteredPathRef`'s own comment).
      const resolution = resolveClickTarget(
        latest.current.scene,
        hit.id,
        enteredPathRef.current,
      )
      if (resolution.editable) {
        // A group is never `editable` by construction (it has no text), so
        // this is unchanged from today: `hit` here is always a genuine leaf.
        beginEditing(hit, caretAtWorldPoint(hit, world), false)
        return
      }
      const target = latest.current.scene.byId.get(resolution.targetId)
      if (!target) return
      setEnteredPath(resolution.enteredPath)
      setSelectedIds(new Set([target.id]))
    },
    [beginEditing, caretAtWorldPoint, screenFromEvent, setEnteredPath],
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
      const factor = Math.exp((-event.deltaY * scale) / WHEEL_ZOOM_DIVISOR)
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

  const deleteSelection = useCallback(
    (gesture: 'delete' | 'cut' = 'delete') => {
      const selected = [...latest.current.selectedIds]
      if (selected.length === 0) return
      // Expanded to include every connector attached to anything doomed (step
      // 12): a connector whose endpoint is gone can never be drawn or clicked
      // again, so leaving it behind means an invisible row nothing can ever
      // remove. `withAttachedConnectors` deduplicates, which matters when BOTH
      // ends of one connector are in the selection.
      //
      // GROUP-EXPANDED FIRST (canvas-element-grouping tactical plan, Wave 4):
      // deleting a group must remove every descendant at every nesting depth
      // (FR-013), and the order matters — expanding groups before connectors
      // is what sweeps a MEMBER's own attached connectors too, not just the
      // group's. Doing it the other way round would only catch connectors
      // touching the group's own frame.
      //
      // Both this expansion and the snapshot below read the scene BEFORE
      // `removeElements` — afterwards the connectors are gone and there is
      // nothing left to find (the B2 lesson: capture pre-state, never post).
      // Undo's inverse is a create-with-id, so it needs every persisted
      // property of every row, not just the ids.
      const ids = withAttachedConnectors(
        latest.current.scene,
        withGroupMembers(latest.current.scene, selected),
      )
      const elements = ids
        .map((id) => latest.current.scene.byId.get(id))
        .filter((element): element is CanvasElement => Boolean(element))

      // Referential integrity on write (FR-018, canvas-element-grouping
      // PRD-alignment finding 1): a member deleted on its own — not via the
      // whole-group cascade `withGroupMembers` already expanded above — must
      // not leave a SURVIVING group's `childIds` naming a row that is about
      // to vanish. Resolved from the SAME pre-delete scene `elements` was
      // captured from, for the same B2-lesson reason.
      const groupCleanup = resolveGroupCleanupUpdates(latest.current.scene, ids)

      setScene((prev) =>
        removeElements(applyMembershipUpdates(prev, groupCleanup), ids),
      )
      setSelectedIds(new Set<string>())
      // Leaving the structure, the same "exit whatever depth was entered"
      // rule the pointerdown `!hit` branch and Escape apply.
      setEnteredPath([])
      callbacks?.onDelete?.(elements, gesture, groupCleanup)
    },
    [callbacks, setEnteredPath, setScene],
  )

  // ── copy, cut, paste, duplicate ──────────────────────────────────────────

  /**
   * The copy buffer (canvas copy-paste-duplicate tactical plan, step 2).
   *
   * A ref, not state: nothing renders from it, and a re-render on copy would
   * be pure waste. Board-local and component-lifetime by design — the
   * tactical plan's chosen mechanism — so a reload clears it and there is no
   * cross-board or cross-tab paste. Nothing untrusted is ever parsed as a
   * result, which is what keeps the paste path free of a validation layer.
   *
   * `pasteCount` is how many times THIS buffer has been pasted, and it is
   * what makes a repeated Ctrl+V fan out instead of stacking every copy on
   * one spot. A fresh copy resets it.
   */
  const clipboardRef = useRef<{
    elements: Array<CanvasElement>
    pasteCount: number
  } | null>(null)

  /** Snapshot the selection into the buffer. Returns what it captured. */
  const captureSelection = useCallback((): Array<CanvasElement> => {
    const targets = cloneTargets(
      latest.current.scene,
      latest.current.selectedIds,
    )
    if (targets.length === 0) return []
    clipboardRef.current = { elements: targets, pasteCount: 0 }
    return targets
  }, [])

  /**
   * Create copies of `targets` and hand them to the recording surface.
   *
   * Shared by paste and duplicate because they differ in exactly two things —
   * where the source elements come from, and what the undo entry is called —
   * and in nothing about what lands on the board.
   *
   * The copies become the selection. That is not a nicety: without it a
   * second Ctrl+D would duplicate the ORIGINAL again and stack a second copy
   * at the same offset, and the cascade the offset exists for would never
   * happen.
   */
  const cloneInto = useCallback(
    (
      targets: ReadonlyArray<CanvasElement>,
      source: 'paste' | 'duplicate',
      offsetIndex: number,
    ) => {
      if (targets.length === 0) return
      const plan = planClone(targets, {
        offsetIndex,
        topZIndex: nextZIndex(latest.current.scene) - 1,
        nextId: uuid,
      })
      if (plan.elements.length === 0) return

      setScene((prev) =>
        plan.elements.reduce(
          (scene, element) => addElement(scene, element),
          prev,
        ),
      )
      setSelectedIds(new Set(plan.elements.map((element) => element.id)))
      callbacks?.onClone?.(plan.elements, source)
    },
    [callbacks, setScene],
  )

  const copySelection = useCallback(() => {
    if (latest.current.readOnly) return
    captureSelection()
  }, [captureSelection])

  /**
   * Fill the buffer, then remove what was copied.
   *
   * Reuses `deleteSelection` wholesale rather than removing the rows itself,
   * so the connector cascade, the pre-state snapshot and the recording all
   * behave exactly as a Delete does. Only the gesture NAME differs.
   */
  const cutSelection = useCallback(() => {
    if (latest.current.readOnly) return
    if (captureSelection().length === 0) return
    deleteSelection('cut')
  }, [captureSelection, deleteSelection])

  const pasteClipboard = useCallback(() => {
    if (latest.current.readOnly) return
    const buffer = clipboardRef.current
    if (!buffer) return
    cloneInto(buffer.elements, 'paste', buffer.pasteCount)
    buffer.pasteCount += 1
  }, [cloneInto])

  /**
   * Copy the LIVE selection in place, without touching the buffer.
   *
   * Reading the clipboard here would make Ctrl+D paste whatever was last
   * copied rather than duplicate what is selected; writing it would silently
   * discard a copy the user was still holding on to.
   */
  const duplicateSelection = useCallback(() => {
    if (latest.current.readOnly) return
    cloneInto(
      cloneTargets(latest.current.scene, latest.current.selectedIds),
      'duplicate',
      0,
    )
  }, [cloneInto])

  // ── group / ungroup ──────────────────────────────────────────────────────

  /**
   * Bind the CURRENT selection into a new group (canvas-element-grouping
   * tactical plan, Wave 6). No-op below 2 selected elements (FR-030/A1) —
   * `SelectionToolbar`'s own Group button is already disabled then, and
   * Ctrl+G must be an equally honest no-op, not a silent single-element
   * group.
   *
   * The frame is the tightest bounding box of the selection at this moment
   * (A8, `boundsOfMany`) — explicit and stored, never re-derived from
   * members afterwards (FR-003). `childIds` is the selection AS GIVEN: a
   * selection that already contains one or more groups nests them with no
   * extra work (FR-009), since a group is just an element whose id can
   * appear in another group's `childIds`.
   *
   * The new group's OWN `zIndex` is placed ONE BELOW the lowest member's,
   * not on top via `nextZIndex` the way every other new element on this
   * board is created. A group whose frame sits ABOVE its own members would
   * shadow them in `hitTest`'s reverse-z scan (`elementContainsPoint` for a
   * `'group'` kind is a plain rect test over the WHOLE frame, not just its
   * border) — clicking a member would hit the group's own frame first and
   * never reach the member underneath, breaking Wave 2's click resolution
   * for every member the instant the group existed. When `minMemberZ - 1`
   * would run past `Z_MIN`, every member is renormalized one step up
   * instead of tying the group at the floor (Hermes review, Major Issue):
   * an exact tie is resolved by `ordered`'s id tie-break, not by "the group
   * is always below its members", so it silently broke the invariant for a
   * board already at the floor roughly half the time.
   *
   * Selected ids are first collapsed to TOP-LEVEL ones only (Hermes review
   * BLOCKER 2, via the shared `topLevelIds`): a selection containing both a
   * group and one of its own members would otherwise list that member
   * twice — once directly, once via the group it is already inside. Each
   * remaining member is also detached from any group it ALREADY belongs to
   * before joining this new one — without that, a marquee that also sweeps
   * up an existing group's frame would leave one element listed in TWO
   * groups' `childIds` at once, a corruption `repairGroupMembership`
   * cannot heal (both references legitimately name something).
   */
  const groupSelection = useCallback(() => {
    if (latest.current.readOnly) return
    const selected = [...latest.current.selectedIds]
    if (selected.length < 2) return
    const currentScene = latest.current.scene
    const ids = topLevelIds(currentScene, selected)
    const members = ids
      .map((id) => currentScene.byId.get(id))
      .filter((element): element is CanvasElement => Boolean(element))
    if (members.length < 2) return
    const frame = boundsOfMany(members)
    if (!frame) return

    const minMemberZ = Math.min(...members.map((element) => element.zIndex))
    const atFloor = minMemberZ - 1 < Z_MIN
    const zIndex = atFloor ? Z_MIN : minMemberZ - 1
    const zIndexBumps: Array<MembershipUpdate> = atFloor
      ? members.map((element) => ({
          before: element,
          after: { ...element, zIndex: Math.min(element.zIndex + 1, Z_MAX) },
        }))
      : []

    const group: CanvasElement = {
      id: uuid(),
      kind: 'group',
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      rotation: 0,
      zIndex,
      text: null,
      style: { ...DEFAULT_ELEMENT_STYLE },
      group: { childIds: members.map((element) => element.id) },
    }

    const detachOriginals = new Map<string, CanvasElement>()
    const detachPatched = new Map<string, CanvasElement>()
    for (const member of members) {
      const oldOwner = groupOwning(currentScene, member.id)
      if (!oldOwner) continue
      patchGroupChildIds(
        detachOriginals,
        detachPatched,
        oldOwner,
        (childIds) => childIds.filter((childId) => childId !== member.id),
      )
    }
    const detachUpdates: Array<MembershipUpdate> = [
      ...detachPatched.entries(),
    ].map(([id, after]) => ({
      before: detachOriginals.get(id) as CanvasElement,
      after,
    }))

    // Every element this gesture also needs to patch besides the new group
    // itself — folded into the SAME `setScene` call and the SAME undo entry
    // `onGroup`/`recordGroup` makes (mirrors how `onDelete`'s `groupUpdates`
    // already fold a cleanup patch into the delete entry).
    const groupUpdates = [...detachUpdates, ...zIndexBumps]

    setScene((prev) =>
      addElement(applyMembershipUpdates(prev, groupUpdates), group),
    )
    setSelectedIds(new Set([group.id]))
    // Leaving whatever depth was entered, the same rule every other
    // selection-replacing gesture applies (Escape, delete, click-empty).
    setEnteredPath([])
    callbacks?.onGroup?.(group, groupUpdates)
  }, [callbacks, setEnteredPath, setScene])

  /**
   * Dissolve the CURRENT selection's single group, one level only (FR-008).
   * No-op unless the selection is EXACTLY one group element — mirrors
   * `groupSelection`'s own honesty rule for Ctrl+Shift+G.
   *
   * The group's direct `childIds` become the new selection — not its whole
   * subtree, and not re-resolved through `withGroupMembers`: a member that
   * is itself a group stays a group, un-entered, exactly as FR-008
   * requires. Filtered through the CURRENT scene before becoming the
   * selection (Hermes review, Major Issue): a collaborator may have
   * deleted a member while this group was selected, and an unfiltered
   * `childIds` would select a now-nonexistent id. Members receive no write
   * of their own either way; membership lived only on the dissolved
   * group's own row (Wave 1).
   *
   * The dissolving group's OWN parent, if any, DOES need a write (Hermes
   * review BLOCKER 1, FR-018): dissolving a NESTED group must not leave the
   * parent's `childIds` naming a row that is about to vanish.
   * `resolveGroupCleanupUpdates`'s `doomed.has(owner.id)` guard does not
   * fire for a parent that survives this dissolve, so it returns exactly
   * that patch — the same helper `deleteSelection` already uses for the
   * structurally identical "an owned id is about to disappear" case.
   */
  const ungroupSelection = useCallback(() => {
    if (latest.current.readOnly) return
    const selected = [...latest.current.selectedIds]
    if (selected.length !== 1) return
    const currentScene = latest.current.scene
    const group = currentScene.byId.get(selected[0])
    if (!group?.group) return
    const groupUpdates = resolveGroupCleanupUpdates(currentScene, [group.id])
    setScene((prev) =>
      removeElements(applyMembershipUpdates(prev, groupUpdates), [group.id]),
    )
    setSelectedIds(
      new Set(
        group.group.childIds.filter((id) => currentScene.byId.has(id)),
      ),
    )
    setEnteredPath([])
    callbacks?.onUngroup?.(group, groupUpdates)
  }, [callbacks, setEnteredPath, setScene])

  /**
   * The four clipboard shortcuts, by key.
   *
   * Consulted from `onBoardKeyDown` ABOVE its modifier guard: that guard
   * returns on any ctrl/meta press before the key switch is reached, so a
   * case added down there would never run.
   */
  const CLIPBOARD_ACTIONS: Readonly<Record<string, (() => void) | undefined>> =
    useMemo(
      () => ({
        c: copySelection,
        x: cutSelection,
        v: pasteClipboard,
        d: duplicateSelection,
      }),
      [copySelection, cutSelection, duplicateSelection, pasteClipboard],
    )

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
      // Copy, cut, paste and duplicate (canvas copy-paste-duplicate tactical
      // plan, step 2). Checked BEFORE the modifier guard below, which returns
      // on any ctrl/meta press — the same reason the quick-create arrows sit
      // above it.
      //
      // `event.repeat` is ignored deliberately: a held Ctrl+V would otherwise
      // issue a paste per key-repeat tick, each one a fresh round-trip of
      // creates, and the board would fill with copies nobody asked for.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.repeat) {
        // Ctrl+G / Ctrl+Shift+G (FR-020), checked BEFORE the
        // `CLIPBOARD_ACTIONS` table below: that table is keyed by
        // `event.key.toLowerCase()`, which collapses `g` and `G` to the
        // same key and so cannot tell Ctrl+G from Ctrl+Shift+G apart —
        // `event.shiftKey` is what makes the distinction, and this branch
        // reads it directly rather than trying to add a second `g` entry
        // the table has no way to disambiguate.
        if (event.key.toLowerCase() === 'g') {
          event.preventDefault()
          if (event.shiftKey) ungroupSelection()
          else groupSelection()
          return
        }
        const action = CLIPBOARD_ACTIONS[event.key.toLowerCase()]
        if (action) {
          event.preventDefault()
          action()
          return
        }
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return

      // Every shape tool's shortcut, from the one table that also labels the
      // palette buttons — checked before the switch so adding a shape kind
      // needs no new case here.
      const shapeTool = SHAPE_TOOL_BY_KEY[event.key]
      if (shapeTool) {
        setTool(shapeTool)
        // Switching tools abandons whatever group depth was entered — the
        // same "leaving the structure" rule Escape/delete/click-empty apply.
        setEnteredPath([])
        return
      }

      switch (event.key) {
        case 'v':
          setTool('select')
          setEnteredPath([])
          break
        case 'h':
          setTool('pan')
          setEnteredPath([])
          break
        case 't':
          setTool('text')
          setEnteredPath([])
          break
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          deleteSelection()
          break
        case 'Escape':
          setSelectedIds(new Set<string>())
          setEnteredPath([])
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
    [
      CLIPBOARD_ACTIONS,
      beginEditing,
      deleteSelection,
      groupSelection,
      quickCreateInDirection,
      setEnteredPath,
      setTool,
      ungroupSelection,
    ],
  )

  const onBoardKeyUp = useCallback((event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === ' ') setSpaceHeld(false)
  }, [])

  // Space released while the board did not have focus (alt-tab, a dialog)
  // would otherwise leave the board stuck in pan mode forever.
  useEffect(() => {
    const clear = () => setSpaceHeld(false)
    window.addEventListener('blur', clear)
    return () => window.removeEventListener('blur', clear)
  }, [])

  // ── text-editing input (from TextInputProxy) ─────────────────────────────

  const applyTextEdit = useCallback(
    (
      produce: (text: string, caret: number) => { text: string; caret: number },
    ) => {
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
  const setComposition = useCallback(
    (composition: string) => {
      setEditing((current) => (current ? { ...current, composition } : current))
      setCaretVisible(true)
    },
    [setEditing],
  )

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
   * What the connector being dragged right now would attach to — the renderer
   * highlights it, and its absence is meaningful too.
   *
   * Both drags that produce a connector feed this, and they read the absence
   * differently: for a connector END, no highlight means releasing here
   * DETACHES; for a creation-handle drag, it means releasing here CREATES a
   * new element instead of joining an existing one.
   */
  const connectorAttach = useMemo<{
    elementId: string
    attach: ConnectorAttach
  } | null>(
    () =>
      gesture.kind === 'connector-endpoint' || gesture.kind === 'quick-create'
        ? gesture.candidate
        : null,
    [gesture],
  )

  const draft = useMemo<CanvasElement | null>(() => {
    if (gesture.kind !== 'draw') return null
    // `drawnRect`, not the raw drag: the ghost has to show the snapped
    // rectangle the release will actually commit, including the default-sized
    // one a press-without-drag would produce.
    return makeElement(
      gesture.shape,
      drawnRect(gesture.originWorld, gesture.currentWorld),
      nextZIndex(scene),
    )
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
    const originY = textOriginY(element, layout)
    return worldToScreen(camera, {
      x: frame.x + local.x,
      y: originY + local.y + local.height,
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
    // Exposed so the selection toolbar's Duplicate button reaches the SAME
    // gesture the keyboard does. A second implementation on the button would
    // be a second chance to get the offset, the selection hand-off or the
    // undo label wrong.
    duplicateSelection,
    // Exposed for the same reason: `SelectionToolbar`'s Group/Ungroup
    // buttons reach the SAME gestures Ctrl+G/Ctrl+Shift+G do (canvas-
    // element-grouping tactical plan, Wave 6).
    groupSelection,
    ungroupSelection,
    editing,
    marquee,
    draft,
    hoveredId,
    // Exposed for tests to observe descent depth directly (no production
    // consumer reads this yet — `CanvasBoard.tsx` does not, unlike
    // `hoveredId` above, which IS genuinely consumed for rendering; Hermes
    // review, Major Issue). Kept rather than dropped because the test
    // suite's own descent-depth assertions read it directly; a breadcrumb
    // UI that would give it a real production consumer is real, tracked
    // follow-up work, not pre-shipped here — see implementation-notes.md.
    enteredPath,
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
