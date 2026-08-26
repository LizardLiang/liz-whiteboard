// src/components/canvas/CanvasBoard.tsx
// The canvas surface (tactical plan Wave 3, step 9).
//
// One `<canvas>`, one draw loop, and a dirty flag. The loop schedules a frame
// ONLY when something changed — it is not a permanently running rAF that
// redraws 60 times a second whether or not the board moved. The plan's
// boundary analysis names a hidden tab burning CPU forever as a specific
// failure, so the loop is also torn down on `visibilitychange` and restarted
// when the tab comes back.
//
// This component owns every browser-supplied value the engine refuses to
// look up for itself: the 2D context, the viewport size, the device pixel
// ratio and the theme. `src/lib/canvas-engine/` stays free of React and DOM
// globals because they all arrive here and are passed down as arguments.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  Diamond,
  Hand,
  MousePointer2,
  Square,
  Triangle,
  Type,
} from 'lucide-react'
import { TextInputProxy } from './TextInputProxy'
import { ConnectorToolbar } from './ConnectorToolbar'
import { SHAPE_TOOL_SHORTCUTS, useCanvasInput } from './use-canvas-input'
import { useFrameLoop } from './use-frame-loop'
import { useCanvasHighlight } from './use-canvas-highlight'
import { useCanvasTestHook } from './canvas-test-hook'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { Camera } from '@/lib/canvas-engine/camera'
import type { WorldRect } from '@/lib/canvas-engine/hit-test'
import type {
  CanvasConnectorRouting,
  CanvasElement,
  CanvasShapeKind,
  Scene,
} from '@/lib/canvas-engine/scene'
import type { CanvasElementRecord } from '@/data/models'
import type { CanvasTool } from './use-canvas-input'
import { toEngineScene } from '@/lib/canvas-element-adapter'
import { drawScene, measurerFor } from '@/lib/canvas-engine/render'
import { CANVAS_SHAPE_KINDS, updateElement } from '@/lib/canvas-engine/scene'
import { DEFAULT_CAMERA } from '@/lib/canvas-engine/camera'
import { focusOnRect } from '@/lib/canvas-engine/camera-focus'
import { useTheme } from '@/hooks/use-theme'
import { useCollaboration } from '@/hooks/use-collaboration'
import { useCanvasElements } from '@/hooks/use-canvas-elements'
import { useCanvasUndo } from '@/hooks/use-canvas-undo'
import { useAuthContext } from '@/components/auth/AuthContext'
import { Button } from '@/components/ui/button'

interface CanvasBoardProps {
  /** Board this canvas belongs to — also the Socket.IO namespace segment. */
  boardId: string
  /** Authenticated user id, for the collaboration handshake. */
  userId: string
  /** The board's elements as loaded from the server, in paint order. */
  initialElements: Array<CanvasElementRecord>
  /**
   * Viewers and public visitors get pan and zoom and nothing else. This is a
   * UI affordance only — the server re-checks the role on every mutation.
   *
   * Read-only does NOT mean disconnected: a viewer still joins the board and
   * still sees collaborators' edits arrive live. Only the tools are withheld.
   */
  readOnly?: boolean
  /**
   * Public share-link render path: no account, no session, and — the point —
   * NO Socket.IO connection is ever opened. The canvas namespace's handshake
   * authenticates a real session, so a public visitor could not join it
   * anyway; connecting would just retry and fail in a loop behind a
   * permanently red badge.
   *
   * Implies `readOnly`. It is a separate prop rather than a mode of it
   * because an authenticated VIEWER is read-only AND still live-syncs, which
   * is exactly the distinction that would be lost by merging the two.
   */
  isPublic?: boolean
}

/** Engine element -> the world rect `focusOnRect` speaks, or `null` if absent (element already gone). */
function toElementRect(element: CanvasElement | undefined): WorldRect | null {
  if (!element) return null
  return { x: element.x, y: element.y, width: element.width, height: element.height }
}

interface ToolButton {
  id: CanvasTool
  label: string
  shortcut: string
  Icon: typeof MousePointer2
}

/**
 * The icon and the human name for each shape kind. The SHORTCUT is not here:
 * it comes from `SHAPE_TOOL_SHORTCUTS`, which is also what the keydown
 * handler binds, so a button can never advertise a key the board ignores.
 */
const SHAPE_TOOL_META: Readonly<
  Record<CanvasShapeKind, { label: string; Icon: typeof MousePointer2 }>
> = {
  rectangle: { label: 'Rectangle', Icon: Square },
  ellipse: { label: 'Ellipse', Icon: Circle },
  diamond: { label: 'Diamond', Icon: Diamond },
  triangle: { label: 'Triangle', Icon: Triangle },
}

/**
 * The palette, in order: the two navigation tools, then every shape kind the
 * engine knows about, then text.
 *
 * Derived from `CANVAS_SHAPE_KINDS` rather than listed by hand — the engine's
 * kind list is the one place a shape is declared, and a palette that had to
 * be edited separately is exactly how a kind ends up renderable but
 * unreachable.
 */
const TOOLS: ReadonlyArray<ToolButton> = [
  { id: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2 },
  { id: 'pan', label: 'Pan', shortcut: 'H', Icon: Hand },
  ...CANVAS_SHAPE_KINDS.map(
    (kind): ToolButton => ({
      id: kind,
      label: SHAPE_TOOL_META[kind].label,
      shortcut: SHAPE_TOOL_SHORTCUTS[kind].toUpperCase(),
      Icon: SHAPE_TOOL_META[kind].Icon,
    }),
  ),
  { id: 'text', label: 'Text', shortcut: 'T', Icon: Type },
]

export function CanvasBoard({
  boardId,
  userId,
  initialElements,
  readOnly = false,
  isPublic = false,
}: CanvasBoardProps) {
  // A public visitor is always read-only. Derived here rather than trusted
  // from the caller so no future call site can pass `isPublic` and forget
  // `readOnly` and hand an anonymous visitor a working toolbar.
  const effectiveReadOnly = readOnly || isPublic
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

  const { resolvedTheme } = useTheme()

  // Seeded once. The route remounts this component on board change (`key`),
  // so there is no stale-board case to resync from; every subsequent change
  // arrives through useCanvasElements — locally, by ack, or by broadcast.
  const [scene, setScene] = useState<Scene>(() => toEngineScene(initialElements))
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA)
  const [tool, setTool] = useState<CanvasTool>('select')
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [devicePixelRatio, setDevicePixelRatio] = useState(1)

  const getMeasurer = useCallback((fontSize: number) => {
    const ctx = ctxRef.current
    return ctx ? measurerFor(ctx, fontSize) : null
  }, [])

  // ── collaboration ────────────────────────────────────────────────────────
  //
  // The socket-connected hook lives HERE and not in the route, matching how
  // useWhiteboardShapes sits inside ReactFlowWhiteboard. It has to: the scene
  // is this component's state, and optimistic apply, ack reconciliation and
  // rollback all write to it. Routing every pointermove through the route to
  // reach it would buy nothing and cost a render hop per frame.
  const { triggerSessionExpired } = useAuthContext()
  const { emit, on, off, connectionState } = useCollaboration(
    boardId,
    userId,
    triggerSessionExpired,
    !isPublic,
    'canvas',
  )

  // Declared before useCanvasInput so the element-id remap can be handed to
  // useCanvasElements; the ref is filled immediately below.
  const remapRef = useRef<((from: string, to: string) => void) | null>(null)
  const handleIdReconciled = useCallback((from: string, to: string) => {
    remapRef.current?.(from, to)
  }, [])

  const { createElement, updateElements, deleteElements, getRevision } =
    useCanvasElements({
      boardId,
      enabled: true,
      initialElements,
      setScene,
      on,
      off,
      emit,
      onElementIdReconciled: handleIdReconciled,
    })

  // ── undo/redo reporting: focus + highlight (board-undo tactical plan,
  // Wave 4, step 12) ──────────────────────────────────────────────────────
  //
  // `sceneRef` reads the CURRENT scene inside `focusOnElement` without
  // making that callback (and everything downstream of it, including
  // `useCanvasUndo`'s own dependency array) unstable on every scene change —
  // the same ref-mirror pattern `use-canvas-input.ts`'s `latest` ref already
  // uses for the same reason.
  const sceneRef = useRef(scene)
  useEffect(() => {
    sceneRef.current = scene
  })

  const { highlight, trigger: triggerHighlight } = useCanvasHighlight()

  const focusOnElement = useCallback(
    (elementId: string, rect?: WorldRect | null) => {
      // `rect` is supplied by `useCanvasUndo` on every SUCCESS (headed-
      // browser BUG-2): it is the element's state AFTER the write this call
      // reports on, known authoritatively and immediately by the hook that
      // just issued that write. Reading `sceneRef` here instead — as this
      // callback used to do unconditionally — raced the scene's own
      // `setScene` call: `sceneRef` only catches up on the NEXT render's
      // `useEffect`, so it still held the PRE-write position at the exact
      // moment this callback ran, and the camera panned there instead.
      // `rect === undefined` (a REFUSAL — nothing was written) is the one
      // case with no authoritative post-write value to hand over; the live
      // scene is the correct, and only available, source for it.
      const target = rect === undefined
        ? toElementRect(sceneRef.current.byId.get(elementId))
        : rect
      // Nothing to bring into view or highlight — either a refusal whose
      // target was deleted, or a successful undo/redo that left no element
      // behind (undoing a create; redoing a delete).
      if (!target) return
      setCamera((prev) => focusOnRect(prev, viewportSize, target))
      triggerHighlight(elementId)
    },
    [triggerHighlight, viewportSize],
  )

  // Owns the undo/redo stack (board-undo tactical plan, Wave 3). Its
  // `callbacks` IS the recording surface: it wraps createElement/
  // updateElements/deleteElements, so wiring it in place of those three
  // directly is what turns "gesture committed" into "gesture undoable".
  const { callbacks: undoCallbacks, undo, redo } = useCanvasUndo({
    boardId,
    readOnly: effectiveReadOnly,
    createElement,
    updateElements,
    deleteElements,
    getRevision,
    onAffectedElement: focusOnElement,
  })

  // Persist on gesture END. `useCanvasInput` calls these on pointerup and on
  // text commit and nowhere else, which is what keeps a drag from writing
  // sixty times a second.
  const callbacks = effectiveReadOnly ? undefined : undoCallbacks

  const input = useCanvasInput({
    canvasRef,
    scene,
    setScene,
    camera,
    setCamera,
    tool,
    setTool,
    readOnly: effectiveReadOnly,
    getMeasurer,
    callbacks,
  })

  remapRef.current = input.remapElementId

  /**
   * Change a connector's routing (tactical plan, Wave 5, step 15).
   *
   * Two writes, in the order every other gesture uses: the LOCAL scene first
   * so the line re-routes on the next frame, then the recording surface.
   * `updateElements` (in `useCanvasElements`) deliberately applies nothing
   * optimistically — it only reconciles on ack and rolls back on refusal —
   * so without the `setScene` here the picker would appear to do nothing for
   * a whole round trip.
   *
   * It goes through `callbacks.onUpdate`, NOT `updateElements` directly. Both
   * end at the same emit, but only the recording surface pushes an undo
   * entry, and a routing change that `Ctrl+Z` could not reverse would be the
   * one board edit that behaves differently from the rest. No new undo
   * machinery is needed for it — it is an ordinary single-element `update`.
   */
  const handleRoutingChange = useCallback(
    (element: CanvasElement, routing: CanvasConnectorRouting) => {
      if (!element.connector) return
      const updated: CanvasElement = {
        ...element,
        connector: { ...element.connector, routing },
      }
      setScene((prev) =>
        prev.byId.has(element.id)
          ? updateElement(prev, element.id, { connector: updated.connector })
          : prev,
      )
      // `before` is the element as it stood BEFORE the change — undo's
      // inverse writes it back, and capturing it here (rather than re-reading
      // the scene after `setScene`) is the same pre-state rule every gesture
      // in use-canvas-input.ts follows.
      callbacks?.onUpdate?.([updated], [element], 'routing')
    },
    [callbacks],
  )

  // ── context ──────────────────────────────────────────────────────────────
  useEffect(() => {
    ctxRef.current = canvasRef.current?.getContext('2d') ?? null
  }, [])

  // ── viewport size ────────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0].contentRect
      setViewportSize({ width: rect.width, height: rect.height })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // ── device pixel ratio ───────────────────────────────────────────────────
  //
  // Read here and passed to the renderer, not read inside it. It also has to
  // be WATCHED: dragging the window to a display with a different ratio (or
  // changing the OS zoom) fires this and nothing else, and without it the
  // board turns blurry until the next resize.
  useEffect(() => {
    const update = () => setDevicePixelRatio(window.devicePixelRatio || 1)
    update()
    const query = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    )
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [devicePixelRatio])

  // ── the draw loop ────────────────────────────────────────────────────────

  const viewport = useMemo(
    () => ({ ...viewportSize, devicePixelRatio }),
    [devicePixelRatio, viewportSize],
  )

  const selection = useMemo(
    () => ({
      ids: input.selectedIds,
      marquee: input.marquee,
      draft: input.draft,
      // Creation-handle affordances (canvas quick-create-handles tactical
      // plan, Wave 4). `hoveredId` is what puts handles on an element nobody
      // has selected; `quickCreate` is the in-flight rubber band. Both are
      // pure render inputs — `use-canvas-input` owns the gesture, this only
      // hands the renderer what it already decided.
      hoveredId: input.hoveredId,
      quickCreate: input.quickCreate,
      // What a dragged connector end would attach to, so the renderer can
      // answer "will this connect, and where?" during the drag.
      connectorAttach: input.connectorAttach,
      editing: input.editing
        ? {
            elementId: input.editing.elementId,
            caret: input.displayCaret,
            caretVisible: input.caretVisible,
          }
        : null,
      // Post-undo/redo highlight pulse (Wave 4, step 12). Folded into
      // `selection` rather than passed to `drawScene` separately: this
      // object already drives the dirty-flag `useEffect` below, so a new
      // `intensity` value on every animation tick re-fires it and keeps the
      // pulse redrawing — no direct call into `useFrameLoop` needed here.
      highlight,
    }),
    [
      highlight,
      input.caretVisible,
      input.displayCaret,
      input.draft,
      input.editing,
      input.connectorAttach,
      input.hoveredId,
      input.marquee,
      input.quickCreate,
      input.selectedIds,
    ],
  )

  const draw = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || viewport.width === 0 || viewport.height === 0) return
    drawScene(ctx, input.displayScene, camera, viewport, selection, {
      theme: resolvedTheme,
    })
  }, [camera, input.displayScene, resolvedTheme, selection, viewport])

  // The loop lives in its own hook so its LIFECYCLE is testable without a 2D
  // context — see use-frame-loop.test.ts. A stale frame id surviving a
  // cleanup used to wedge it shut permanently, and nothing below e2e caught
  // that until the board was opened in a real browser.
  const { requestRedraw } = useFrameLoop(draw)

  // The dirty flag itself: a frame is requested when — and only when — one of
  // the inputs to `drawScene` actually changed.
  useEffect(() => {
    requestRedraw()
  }, [
    camera,
    input.displayScene,
    requestRedraw,
    resolvedTheme,
    selection,
    viewport,
  ])

  // Development / e2e only. Canvas content has no DOM, so this is what makes
  // an end-to-end assertion about a specific element possible at all. Absent
  // from production builds — see canvas-test-hook.ts.
  useCanvasTestHook({
    boardId,
    scene: input.displayScene,
    camera,
    // The SAME object `drawScene` was just handed, so the hook can resolve
    // the creation-handle target with the renderer's own rules rather than a
    // second copy of them.
    selection,
    tool,
    readOnly: effectiveReadOnly,
  })

  // ── interaction plumbing ─────────────────────────────────────────────────

  const { onPointerDown, ...restCanvasHandlers } = input.canvasHandlers

  const handleCanvasPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      // Move keyboard focus to the board so shortcuts and the space-pan
      // modifier work after a click. When an edit is in flight this also
      // blurs the text proxy, which is what commits it.
      containerRef.current?.focus({ preventScroll: true })
      onPointerDown(event)
    },
    [onPointerDown],
  )

  // Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo (board-undo tactical
  // plan, Wave 3, step 10). Gated on `effectiveReadOnly` so a viewer or an
  // anonymous share-link visitor gets nothing — matching every other
  // mutation gate on this board.
  //
  // Gated on `input.editing === null` for the SAME reason the container's
  // own `onBoardKeyDown` early-returns while editing (use-canvas-input.ts):
  // the container is an ANCESTOR of the text proxy, so a keydown from the
  // focused textarea bubbles into here. Text editing keeps its own NATIVE
  // undo (the browser's own Ctrl+Z on a focused textarea) — checking
  // `input.editing` before calling `preventDefault()`/`undo()`/`redo()`
  // means that native behaviour is never suppressed, and a board-level undo
  // entry is never consumed by a keystroke meant for the text being typed.
  const handleBoardKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (
        !effectiveReadOnly &&
        input.editing === null &&
        (event.ctrlKey || event.metaKey)
      ) {
        const key = event.key.toLowerCase()
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault()
          undo()
          return
        }
        if ((key === 'z' && event.shiftKey) || key === 'y') {
          event.preventDefault()
          redo()
          return
        }
      }
      input.boardHandlers.onKeyDown(event)
    },
    [effectiveReadOnly, input.boardHandlers, input.editing, redo, undo],
  )

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden outline-none"
      tabIndex={0}
      role="application"
      aria-label="Canvas board"
      {...input.boardHandlers}
      onKeyDown={handleBoardKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full bg-background"
        // `touch-action: none` is what makes pointer capture work on touch
        // and pen: without it the browser claims the gesture for scrolling
        // and the board never sees a pointermove.
        style={{ cursor: input.cursor, touchAction: 'none' }}
        // Suppress the browser's native focus-on-mousedown. The canvas is not
        // focusable, so the browser walks up and focuses the nearest focusable
        // ancestor — this component's container, which carries `tabIndex={0}`
        // for keyboard shortcuts. That happened AFTER the text tool had
        // already focused the off-screen proxy, blurring it, committing an
        // empty element and discarding it: the text tool could never create
        // anything, and every later keystroke hit the container and fired
        // tool shortcuts instead of typing.
        //
        // preventDefault on `mousedown` suppresses focus and text selection
        // only. `click` and `dblclick` still fire (double-click-to-edit keeps
        // working), pointer events and pointer capture are untouched. Focus is
        // now entirely ours to place: the container on a plain click, the
        // proxy while an edit is open.
        onMouseDown={(event) => event.preventDefault()}
        onPointerDown={handleCanvasPointerDown}
        {...restCanvasHandlers}
      />

      {/* The routing picker (tactical plan, Wave 5). Rendered
          unconditionally — it decides for itself whether there is a single
          selected, drawable connector to be about, so the condition lives in
          one testable place rather than as a chain of `&&` here. */}
      <ConnectorToolbar
        scene={input.displayScene}
        selectedIds={input.selectedIds}
        camera={camera}
        readOnly={effectiveReadOnly}
        onRoutingChange={handleRoutingChange}
      />

      <TextInputProxy
        active={input.editing !== null}
        caretScreenPoint={input.caretScreenPoint}
        onInsertText={input.textInput.insertText}
        onCompositionChange={input.textInput.setComposition}
        onKeyDown={input.textInput.onEditingKeyDown}
        onBlur={input.textInput.commitEditing}
      />

      {/* Live-sync state. Shown for authenticated viewers too: a read-only
          member still receives collaborators' edits, so "am I connected?" is
          as relevant to them as it is to an editor.

          Hidden on the public share path, where no socket is opened at all —
          the badge would sit permanently on "Disconnected" and read as a
          fault rather than as the intended design. */}
      {!isPublic && (
        <div
          className="absolute right-4 top-4 rounded-md border bg-background/90 px-2 py-1 text-xs font-medium shadow-sm backdrop-blur-sm"
          role="status"
          aria-live="polite"
        >
          <span
            className={
              connectionState === 'connected'
                ? 'text-green-600 dark:text-green-400'
                : connectionState === 'connecting'
                  ? 'text-yellow-600 dark:text-yellow-400'
                  : 'text-red-600 dark:text-red-400'
            }
          >
            {connectionState === 'connected'
              ? 'Connected'
              : connectionState === 'connecting'
                ? 'Connecting...'
                : 'Disconnected'}
          </span>
        </div>
      )}

      {!effectiveReadOnly && (
        <div
          className="absolute left-4 top-4 flex gap-1 rounded-md border bg-background/90 p-1 shadow-sm backdrop-blur-sm"
          role="toolbar"
          aria-label="Canvas tools"
        >
          {TOOLS.map(({ id, label, shortcut, Icon }) => (
            <Button
              key={id}
              type="button"
              size="icon"
              variant={tool === id ? 'default' : 'ghost'}
              aria-label={`${label} (${shortcut})`}
              aria-pressed={tool === id}
              title={`${label} (${shortcut})`}
              onClick={() => setTool(id)}
            >
              <Icon className="h-4 w-4" />
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
