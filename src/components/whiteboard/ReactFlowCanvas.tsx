import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '@/styles/react-flow-theme.css'

import { CardinalityMarkerDefs } from './CardinalityMarkerDefs'
import { ConnectorMarkerDefs } from './ConnectorMarkerDefs'
import { ShapeDrawOverlay } from './ShapeDrawOverlay'
import { CanvasNodeLayer } from './CanvasNodeLayer'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type {
  Edge,
  FitViewOptions,
  IsValidConnection,
  Node,
  NodeMouseHandler,
  OnBeforeDelete,
  OnConnect,
  OnConnectStart,
  OnEdgesChange,
  OnEdgesDelete,
  OnNodeDrag,
  OnNodesChange,
  OnNodesDelete,
} from '@xyflow/react'
import type {
  AreaNodeType,
  CommentNodeType,
  ConnectorEdgeType,
  RelationshipEdgeType,
  ShapeNodeType,
  TableNodeType,
} from '@/lib/react-flow/types'
import type { DrawTool, ToolMode } from '@/lib/react-flow/tool-mode'
import type {
  AffordanceRequest,
  InitialEditingField,
} from '@/lib/react-flow/canvas-mode'
import { isDrawTool } from '@/lib/react-flow/tool-mode'
import {
  CanvasEditContext,
  CanvasModeContext,
  DOUBLE_PRESS_WINDOW_MS,
} from '@/lib/react-flow/canvas-mode'
import {
  parseColumnHandleId,
  recalculateEdgesForDraggedNodes,
} from '@/lib/react-flow/edge-routing'
import { perfTracker } from '@/lib/perf/perf-tracker'
import {
  assignLayersBFS,
  computeEdgeBundleOffsets,
} from '@/lib/auto-layout/d3-force-layout'
import { edgeTypes, nodeTypes } from '@/lib/react-flow/node-types'
import {
  calculateEdgeHighlighting,
  calculateHighlighting,
  filterValidEdges,
  getDirectlyRelatedTableIds,
} from '@/lib/react-flow/highlighting'
import { VIEWPORT_CONSTRAINTS } from '@/lib/react-flow/viewport'

/**
 * Stable empty default for the `areaNodes` prop. Using `[]` directly as a
 * default parameter value creates a new array identity on every render when
 * the prop is omitted, which defeats the `areaNodes` dependency in the resync
 * effect below and causes an infinite render loop (GH #112). This module-level
 * constant keeps the identity stable across renders.
 */
const EMPTY_AREA_NODES: Array<AreaNodeType> = []

/**
 * Stable empty edge array for the perf edge-ablation path (GH #142) — a fresh
 * `[]` per render would give `<ReactFlow edges>` a new identity every frame.
 */
const EMPTY_EDGES: Array<RelationshipEdgeType> = []

/**
 * Stable empty default for the `commentNodes` prop (GH #110) — same rationale
 * as EMPTY_AREA_NODES above.
 */
const EMPTY_COMMENT_NODES: Array<CommentNodeType> = []

/**
 * Stable empty defaults for the `shapeNodes`/`connectorEdges` props (Phase 1:
 * shapes-and-connectors) — same rationale as EMPTY_AREA_NODES above.
 */
const EMPTY_SHAPE_NODES: Array<ShapeNodeType> = []
const EMPTY_CONNECTOR_EDGES: Array<ConnectorEdgeType> = []

/**
 * Stable reference for `<ReactFlow defaultEdgeOptions>` (GH #121 perf,
 * stable-reference audit). An inline object literal here would be a new
 * identity every render, one of several unstable props that can defeat
 * React Flow's own internal memoization independent of node count — part of
 * why interaction already stutters well under 30 tables.
 */
const DEFAULT_EDGE_OPTIONS = {
  type: 'relationship' as const,
  animated: false,
}

/**
 * Stable reference for `<ReactFlow deleteKeyCode>` (same rationale as
 * DEFAULT_EDGE_OPTIONS above) — an inline array literal is a new identity
 * every render.
 */
const DELETE_KEY_CODES = ['Delete', 'Backspace']

/**
 * Node-count threshold above which `onlyRenderVisibleElements` (viewport
 * culling) turns on (GH #121 perf, opt #2). Off below this so small/typical
 * boards (including TableFocusOverlay's own nested canvas, which never has
 * more than a handful of nodes) never pay the culling tradeoff — edges whose
 * both endpoints are off-screen are culled with it on. Tunable; set during
 * profiling.
 */
const VIEWPORT_CULLING_NODE_THRESHOLD = 150

/**
 * Pure decision function behind `onBeforeDelete`'s relationship-delete veto
 * (2026-08-31 tactical plan, Part A / D-12). `onBeforeDelete` below delegates
 * to this function rather than reimplementing the same branches, so this is
 * the exact logic that runs in the app — not a parallel copy that could
 * silently drift from it.
 *
 * Exported for direct unit testing: Playwright has no clean seam to sever
 * the whiteboard's live Socket.IO connection mid-test (see the gap noted on
 * relationship-deletion.spec.ts's e2e test), so this predicate is the
 * fallback coverage the tactical plan calls for instead of a live-disconnect
 * e2e.
 *
 * - When `canPersistRelationshipDelete` is true, nothing is vetoed and no
 *   refusal fires.
 * - Otherwise, edges of type 'connector' pass through; every other edge
 *   (relationship edges) is stripped from the batch.
 * - A refusal should be surfaced ONLY when a delete handler was actually
 *   wired (`hasRelationshipDeleteHandler`) AND the batch contained at least
 *   one relationship edge — the no-handler case (TableFocusOverlay's nested
 *   canvas) stays silent, as it does today.
 */
export function computeRelationshipDeleteVeto<T extends { type?: string }>(params: {
  deletedEdges: Array<T>
  canPersistRelationshipDelete: boolean
  hasRelationshipDeleteHandler: boolean
}): { edges: Array<T>; shouldNotifyRefusal: boolean } {
  const {
    deletedEdges,
    canPersistRelationshipDelete,
    hasRelationshipDeleteHandler,
  } = params
  if (canPersistRelationshipDelete) {
    return { edges: deletedEdges, shouldNotifyRefusal: false }
  }
  const hadRelationshipEdge = deletedEdges.some(
    (edge) => edge.type !== 'connector',
  )
  return {
    edges: deletedEdges.filter((edge) => edge.type === 'connector'),
    shouldNotifyRefusal: hadRelationshipEdge && hasRelationshipDeleteHandler,
  }
}

/**
 * ReactFlowCanvas Props
 */
export interface ReactFlowCanvasProps {
  /** Initial nodes (tables) */
  initialNodes?: Array<TableNodeType>
  /** Initial edges (relationships) */
  initialEdges?: Array<RelationshipEdgeType>
  /**
   * Subject-area nodes (GH #106), kept separate from table nodes. Rendered
   * BEHIND tables; their move is persisted via onAreaDragStop and their resize
   * via the node's own `data.onResize`. They never enter the table
   * highlighting / edge-routing pipeline.
   */
  areaNodes?: Array<AreaNodeType>
  /**
   * Persist an area move (drag stop) — receives the area id, its new
   * top-left position, and the member tables that were translated along
   * with it (movable-container grouping, GH #106 bugfix). `movedMembers` is
   * empty when the area has no members.
   */
  onAreaDragStop?: (
    areaId: string,
    positionX: number,
    positionY: number,
    movedMembers: Array<{ id: string; positionX: number; positionY: number }>,
  ) => void
  /**
   * Delete an area (Delete/Backspace on a selected area node, or the ×
   * button). Fired from `onNodesDelete` for deleted nodes of type 'area';
   * table nodes are never included (they are marked `deletable: false` so
   * the native delete flow never bypasses the table confirmation dialog).
   */
  onAreaDelete?: (areaId: string) => void
  /**
   * Free-canvas-point comment pin nodes (GH #110), kept separate from table
   * nodes like areaNodes. Rendered ON TOP of tables (small markers, always
   * clickable); non-draggable/non-deletable — see the node-level flags set
   * where these are built in ReactFlowWhiteboard.
   */
  commentNodes?: Array<CommentNodeType>
  /**
   * Shape nodes (Phase 1: shapes-and-connectors), kept separate from table
   * nodes like areaNodes. Rendered behind tables, above areas (tech-spec §5).
   */
  shapeNodes?: Array<ShapeNodeType>
  /**
   * Connector edges (Phase 1) — merged with the relationship `edges` prop.
   * Geometry is derived at render time, never stored (FR-031a).
   */
  connectorEdges?: Array<ConnectorEdgeType>
  /**
   * Persist a shape (or multi-selected shapes) drag-stop — one entry per
   * dragged shape, so the caller can emit exactly N `shape:update`s at
   * drag-stop, never per-frame (tech-spec §10).
   */
  onShapeDragStop?: (
    shapes: Array<{ id: string; positionX: number; positionY: number }>,
  ) => void
  /**
   * Delete a shape (Delete/Backspace on a selected shape node). Fired from
   * `onNodesDelete` for deleted nodes of type 'shape' — cascades to attached
   * connectors server-side (FR-018).
   */
  onShapeDelete?: (shapeId: string) => void
  /**
   * Delete a connector (M1) — Delete/Backspace on a selected connector edge.
   * Fired from `onEdgesDelete`, filtered on `edge.type === 'connector'` so
   * relationship-edge behaviour is untouched.
   */
  onConnectorDelete?: (connectorId: string) => void
  /**
   * Delete a relationship (GH: "deleted relation line comes back"). Fired
   * from `onEdgesDelete` for edges that are NOT connectors, so pressing
   * Delete/Backspace on a selected relationship edge takes the SAME path as
   * RelationshipEdge's own hover delete button (useRelationshipMutations ->
   * socket `relationship:delete`). Without this the key removed the edge
   * from React Flow's local state only; the row survived in the database and
   * the next `initialNodes` change (any table drag) resurrected the line via
   * the initialEdges resync effect below.
   */
  onRelationshipDelete?: (relationshipId: string) => void
  /**
   * Live connectivity signal for relationship deletes (symptom 1 fix,
   * 2026-08-31 tactical plan). React Flow applies a Delete-key removal to
   * its own store BEFORE `onEdgesDelete` runs, so a handler merely being
   * wired is not enough to prove the removal can actually persist — the
   * whiteboard socket also has to be connected right now. Defaults to
   * `false` so a caller that never passes this prop fails safe instead of
   * silently reproducing the resurrection bug.
   */
  canDeleteRelationships?: boolean
  /**
   * Fired once per vetoed batch (not once per edge) when `onBeforeDelete`
   * refuses a relationship delete because `canDeleteRelationships` is
   * false. NOT fired for the no-handler case (TableFocusOverlay's nested
   * canvas, which passes no `onRelationshipDelete` at all) — that veto
   * stays silent, as it does today.
   */
  onRelationshipDeleteRefused?: () => void
  /**
   * The canvas-wide tool mode (D-1). When a draw tool is armed
   * (`isDrawTool(activeTool)`), mounts `<ShapeDrawOverlay>` inside the
   * wrapper (H1: the overlay is pointer-events:none and runs its gesture
   * from capture-phase listeners on the wrapper — see that component).
   */
  activeTool?: ToolMode
  /** Fires once per completed draw gesture (tech-spec §8). */
  onDrawCommit?: (
    kind: DrawTool,
    rect: { x: number; y: number; width: number; height: number },
    drag: { startX: number; startY: number; endX: number; endY: number },
  ) => void
  /** Fires on every abnormal/idle-armed draw termination that disarms to `select`. */
  onDrawDisarm?: () => void
  /** Callback when nodes change (position, selection, etc.) */
  onNodesChange?: OnNodesChange<TableNodeType>
  /** Callback when edges change */
  onEdgesChange?: OnEdgesChange<RelationshipEdgeType>
  /** Callback when connection is created */
  onConnect?: OnConnect
  /** Callback when node drag stops (position update) */
  onNodeDragStop?: OnNodeDrag<TableNodeType>
  /** Whether nodes are draggable */
  nodesDraggable?: boolean
  /** Whether canvas panning on drag is enabled */
  panOnDrag?: boolean
  /** Whether to show minimap */
  showMinimap?: boolean
  /** Whether to show controls */
  showControls?: boolean
  /** Whether to show background pattern */
  showBackground?: boolean
  /** Fit view options for initial render */
  fitViewOptions?: FitViewOptions
  /** Additional className */
  className?: string
  /**
   * Opt into the perf edge-ablation toggle (GH #142). When true, this canvas
   * drops ALL relationship edges while the tracker's `hideEdges` flag is on,
   * so pan/zoom cost can be attributed to the SVG edge layer. Only the main
   * whiteboard canvas passes this; TableFocusOverlay's nested canvas leaves it
   * false so ablating the main board never blanks the overlay's edges.
   */
  enableEdgeAblation?: boolean
  /** Callback when a node is clicked — receives the node id */
  onNodeClick?: (nodeId: string) => void
  /**
   * ID of the table whose relations panel is currently open (if any) —
   * threaded into calculateHighlighting so that table's node wrapper gets
   * the top z-index tier (its attached panel must render above every other
   * node/edge, regardless of neighbor hover/selection state).
   */
  relationsPreviewTableId?: string | null
  /**
   * Callback fired when the pane (empty canvas) is clicked. Receives the
   * native mouse event so callers can derive a flow position (e.g.
   * `screenToFlowPosition`) — used by the free-point comment placement tool
   * (GH #110).
   */
  onPaneClick?: (event: ReactMouseEvent) => void
  /**
   * External "select this table" entry point for the Cmd/Ctrl+K search
   * palette. When `focusRequestToken` changes to a positive value, the canvas
   * pans/zooms to `focusRequestTableId` and marks it active-highlighted. The
   * token (rather than the id alone) lets the same table be re-selected.
   */
  focusRequestTableId?: string | null
  /** Monotonic token that triggers a focus request when it increments. */
  focusRequestToken?: number
  /**
   * When true, the minimap renders as an enlarged, centered overlay with a
   * focus ring and a dim backdrop — driven by the `m` shortcut wired in the
   * parent (`ReactFlowWhiteboard`). Sizing/positioning come from the
   * `minimap-focused` CSS class.
   */
  minimapExpanded?: boolean
  /**
   * Called when the focused minimap should collapse — fired by clicking the dim
   * backdrop. Keyboard collapse (`m`/`Escape`) is handled by the parent's hook.
   */
  onMinimapCollapse?: () => void
  /**
   * The shape currently holding keyboard-traversal focus (FR-019a), or
   * `null`. Applied as a direct DOM class toggle on the target's own
   * `.react-flow__node-shape` wrapper — same bypass-React-render pattern as
   * the GH #121 hover-highlight and GH #138 jump-pulse mechanisms above,
   * deliberately NOT threaded through `shapeNodes[].data` (that prop is
   * fully resynced into React Flow's controlled node state on every
   * `shapes`/`canEdit`/etc. change, which would silently clear the live
   * mouse/keyboard SELECTION every time focus moves — see
   * ReactFlowWhiteboard's traversal effect comment for the full reasoning).
   */
  keyboardFocusedShapeId?: string | null
}

/**
 * ReactFlowCanvas - Main wrapper component for React Flow-based ER diagram rendering
 * Replaces the Konva Canvas component with React Flow
 *
 * @example
 * ```tsx
 * <ReactFlowCanvas
 *   initialNodes={nodes}
 *   initialEdges={edges}
 *   nodesDraggable={true}
 *   showControls={true}
 *   showMinimap={true}
 * />
 * ```
 */
export function ReactFlowCanvas({
  initialNodes = [],
  initialEdges = [],
  areaNodes = EMPTY_AREA_NODES,
  onAreaDragStop,
  onAreaDelete,
  commentNodes = EMPTY_COMMENT_NODES,
  shapeNodes = EMPTY_SHAPE_NODES,
  connectorEdges = EMPTY_CONNECTOR_EDGES,
  onShapeDragStop,
  onShapeDelete,
  onConnectorDelete,
  onRelationshipDelete,
  canDeleteRelationships = false,
  onRelationshipDeleteRefused,
  activeTool = 'select',
  onDrawCommit,
  onDrawDisarm,
  onNodesChange: onNodesChangeProp,
  onEdgesChange: onEdgesChangeProp,
  onConnect,
  onNodeDragStop: onNodeDragStopProp,
  onNodeClick: onNodeClickProp,
  nodesDraggable = true,
  panOnDrag = true,
  showMinimap = false,
  showControls = true,
  showBackground = true,
  fitViewOptions,
  className = '',
  enableEdgeAblation = false,
  relationsPreviewTableId = null,
  onPaneClick: onPaneClickProp,
  focusRequestTableId = null,
  focusRequestToken = 0,
  minimapExpanded = false,
  onMinimapCollapse,
  keyboardFocusedShapeId = null,
}: ReactFlowCanvasProps) {
  // Perf tracker (GH #121 follow-up): count canvas re-renders during a
  // recording session. First-line `if (!isRecording) return` inside makes this
  // a no-op when the tracker is off (PT-7).
  perfTracker.incRender()

  const [nodes, setNodes, handleNodesChange] =
    useNodesState<TableNodeType>(initialNodes)
  const [edges, setEdges, handleEdgesChange] =
    useEdgesState<RelationshipEdgeType>(initialEdges)

  // Area (subject-area) nodes live in their own state so they never touch the
  // table highlighting / edge-routing pipeline. They are merged into the single
  // <ReactFlow nodes> array (areas FIRST → rendered behind tables).
  const [areaNodesState, setAreaNodesState, handleAreaNodesChange] =
    useNodesState<AreaNodeType>(areaNodes)
  useEffect(() => {
    setAreaNodesState(areaNodes)
  }, [areaNodes, setAreaNodesState])
  const areaIdSet = useMemo(
    () => new Set(areaNodesState.map((a) => a.id)),
    [areaNodesState],
  )

  // Comment pin nodes (GH #110) — same separate-state pattern as areas, but
  // rendered ON TOP of tables (merged last) since they are small clickable
  // markers, not background regions.
  const [commentNodesState, setCommentNodesState, handleCommentNodesChange] =
    useNodesState<CommentNodeType>(commentNodes)
  useEffect(() => {
    setCommentNodesState(commentNodes)
  }, [commentNodes, setCommentNodesState])
  const commentIdSet = useMemo(
    () => new Set(commentNodesState.map((c) => c.id)),
    [commentNodesState],
  )

  // Shape nodes (Phase 1: shapes-and-connectors) — same separate-state
  // pattern as areas. Rendered BEHIND tables, ABOVE areas (tech-spec §5).
  const [shapeNodesState, setShapeNodesState, handleShapeNodesChange] =
    useNodesState<ShapeNodeType>(shapeNodes)
  useEffect(() => {
    // Preserve the live `selected` flag across a resync, UNCONDITIONALLY
    // (B2, Hermes code review — this is the fixed version of a merge that
    // was itself the mechanism of that bug). `shapeNodes` recomputes on
    // every `shapes` data change — a remote edit, a style change, a
    // create/delete elsewhere on the board — and resyncing wholesale from
    // that prop would blow away whatever is actually selected right now.
    // The previous version of this effect tried to have it both ways with
    // `n.selected || !prevSelected.get(n.id) ? n : {...n, selected: true}`
    // — an OR that only ever ADDS selection back in. Since ReactFlowWhite-
    // board's `shapeNodes` memo no longer computes `selected` at all
    // (selection is applied imperatively, once, through the store API —
    // see that memo's comment and the one-shot effect below it), there is
    // now exactly one source of truth for this flag: whatever this
    // effect's own PREVIOUS state said. Every user-driven selection
    // change (click, Escape, pane click, keyboard select) goes through
    // `handleShapeNodesChange` directly and updates `shapeNodesState`
    // before this effect ever runs again, so carrying `prev.selected`
    // forward here can only ever preserve the live truth — it cannot
    // resurrect a cleared selection, and it cannot re-assert a stale one,
    // because there is no second opinion left to disagree with it.
    setShapeNodesState((prev) => {
      const prevSelected = new Map(prev.map((n) => [n.id, n.selected]))
      return shapeNodes.map((n) => ({
        ...n,
        selected: prevSelected.get(n.id) ?? false,
      }))
    })
  }, [shapeNodes, setShapeNodesState])
  const shapeIdSet = useMemo(
    () => new Set(shapeNodesState.map((s) => s.id)),
    [shapeNodesState],
  )

  // Connector edges (Phase 1) — same separate-state pattern as relationship
  // edges, merged into the single <ReactFlow edges> array below.
  const [
    connectorEdgesState,
    setConnectorEdgesState,
    handleConnectorEdgesChange,
  ] = useEdgesState<ConnectorEdgeType>(connectorEdges)
  useEffect(() => {
    setConnectorEdgesState(connectorEdges)
  }, [connectorEdges, setConnectorEdgesState])
  const connectorIdSet = useMemo(
    () => new Set(connectorEdgesState.map((c) => c.id)),
    [connectorEdgesState],
  )

  // Table nodes are never natively deletable (GH #106 Bug 1 fix) — Delete/
  // Backspace must always route through the table confirmation dialog
  // (useTableDeletion), never React Flow's own removal. Area nodes carry
  // their own `deletable` (== canEdit) from the areaNodes prop. Comment pins
  // are always non-deletable (deletion goes through the popover's own
  // delete action) — see the node-level flags set in ReactFlowWhiteboard.
  const mergedNodes = useMemo(
    () => [
      ...areaNodesState,
      // KEEP THIS ORDER (L2): shapes go BEFORE the table `deletable: false`
      // map, never flattened into a bare spread with tables — the map below
      // force-marks table nodes deletable: false (GH #106 Bug 1) so
      // Delete/Backspace always routes through useTableDeletion's
      // confirmation dialog. Shape nodes carry their own `deletable: canEdit`
      // from the shapeNodes prop, so they are not touched by that map.
      ...shapeNodesState,
      ...nodes.map((n) =>
        n.deletable === false ? n : { ...n, deletable: false },
      ),
      ...commentNodesState,
    ],
    [areaNodesState, shapeNodesState, nodes, commentNodesState],
  )

  // Selection and hover state for highlighting
  const [activeTableId, setActiveTableId] = useState<string | null>(null)
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null)

  // Canvas edit overlay (tactical plan Phase 3, "In-place DOM edit
  // overlay") — editingTableId is the one table (if any) whose full-DOM
  // TableNode is mounted in place over the chrome-light canvas render;
  // initialEditingField carries which column/field to open the moment that
  // overlay mounts (double-click-a-column direct-edit), consumed once by
  // the target TableNode instance. Exposed via CanvasEditContext below so
  // TableNode (rendered through nodeTypes, not passed props) can read/act
  // on it — same rationale as CanvasModeContext.
  const [editingTableId, setEditingTableId] = useState<string | null>(null)
  const [initialEditingField, setInitialEditingField] =
    useState<InitialEditingField | null>(null)

  // LizMeter #53 fix: retargeting-immune double-press tracker for
  // `registerEditPress` (see CanvasEditContextValue's doc comment for the
  // full mechanism). Lives on this stable ReactFlowCanvas instance, NOT
  // inside TableNode — a TableNode remount (plausibly part of the churn this
  // bug depends on) must not reset a half-completed double-press.
  const pressTrackerRef = useRef<{ key: string; time: number } | null>(null)

  // requestEdit replaces whatever table was previously overlaid (at most
  // one overlay at a time — locked decision #3) — a double-click on table B
  // while table A is overlaid just calls this again with B, which is the
  // entire "switch" behavior (locked decision #2); TableNode's own
  // commit-on-exit effect (mirroring the LOD blur-commit pattern) notices
  // editingTableId moved away from A and resolves any open edit there
  // before it collapses back to chrome-light.
  const requestEdit = useCallback(
    (tableId: string, columnId?: string, field?: 'name' | 'dataType') => {
      setEditingTableId(tableId)
      setInitialEditingField(
        columnId && field ? { tableId, columnId, field } : { tableId },
      )
    },
    [],
  )

  const exitEdit = useCallback(() => {
    setEditingTableId(null)
    setInitialEditingField(null)
  }, [])

  // LizMeter #53 fix — see CanvasEditContextValue's `registerEditPress` doc
  // comment for the full mechanism (mousedown-based double-press detector,
  // immune to the click/dblclick retargeting a mid-click re-render can
  // cause). Two mousedowns on the same tableId/columnId key within
  // DOUBLE_PRESS_WINDOW_MS call requestEdit directly; anything else just
  // records the press and waits.
  const registerEditPress = useCallback(
    (tableId: string, columnId?: string, field?: 'name' | 'dataType') => {
      const key = columnId ? `${tableId}:${columnId}` : tableId
      const now = Date.now()
      const prev = pressTrackerRef.current
      if (
        prev &&
        prev.key === key &&
        now - prev.time <= DOUBLE_PRESS_WINDOW_MS
      ) {
        pressTrackerRef.current = null
        requestEdit(tableId, columnId, field)
      } else {
        pressTrackerRef.current = { key, time: now }
      }
    },
    [requestEdit],
  )

  // Drag guard (LizMeter #53 premortem finding): clear any in-flight
  // double-press tracking wherever a real node drag or column-reorder drag
  // actually starts, so a mousedown that begins a drag can never later
  // combine with an unrelated double-click elsewhere within the window.
  const cancelEditPress = useCallback(() => {
    pressTrackerRef.current = null
  }, [])

  // Header-icon affordance click (note / comment / relations) → open the
  // in-place popover/panel without the edit overlay. A fresh object each call
  // so clicking the same icon twice re-fires (TableNode consumes by identity).
  const [affordanceRequest, setAffordanceRequest] =
    useState<AffordanceRequest | null>(null)
  const requestAffordance = useCallback(
    (tableId: string, kind: AffordanceRequest['kind'], columnId?: string) => {
      setAffordanceRequest({ tableId, kind, columnId })
    },
    [],
  )

  // Escape closes the overlay (locked decision #2) — listener only active
  // while an overlay is actually open, so it never intercepts Escape
  // elsewhere on the board (e.g. closing an unrelated popover).
  //
  // Guarded on `!e.defaultPrevented` (code review defect 1, BLOCKER): Radix's
  // DismissableLayer (backing DataTypeSelector, DeleteColumnDialog, note/
  // comment popovers) registers a capture-phase Escape handler that calls
  // `preventDefault()` — but NOT `stopPropagation()` — when it dismisses a
  // nested layer. Without this guard, dismissing a nested dropdown/dialog/
  // popover with Escape ALSO bubbles to this document listener (bubble
  // phase runs after capture) and tears down the whole edit overlay in the
  // same keystroke. The guard lets a single Escape close only the topmost
  // nested layer; a second, unconsumed Escape then closes the overlay
  // itself. Any other Escape-cancel handler in the overlaid subtree (e.g.
  // InlineNameEditor, AreaNode's rename input) must likewise call
  // `preventDefault()` on its own cancel to avoid double-closing.
  useEffect(() => {
    if (!editingTableId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        exitEdit()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [editingTableId, exitEdit])

  // Clear the overlay if its target table no longer exists (code review
  // defect 2, WARNING). Table deletion never routes through requestEdit/
  // exitEdit — local delete (ReactFlowWhiteboard.tsx) and remote delete
  // (onTableDeleted) both just filter the node out of `initialNodes`, and
  // table nodes are `deletable: false` so onNodesDelete (below) never sees
  // them either. Without this, deleting the overlaid table (reachable via
  // its full-DOM context menu while the overlay is open) leaves
  // `editingTableId` pointing at a dead id: the Escape listener above stays
  // mounted and CanvasNodeLayer's draw-skip filter permanently excludes a
  // nonexistent id until an unrelated pane-click/Escape/double-click
  // happens to null it. Keyed on `nodes` (not `initialNodes`) so it reacts
  // to the same synced node list the rest of the canvas renders from,
  // covering both the local and remote delete paths.
  useEffect(() => {
    if (!editingTableId) return
    if (nodes.some((n) => n.id === editingTableId)) return
    exitEdit()
  }, [editingTableId, nodes, exitEdit])

  const canvasEditContextValue = useMemo(
    () => ({
      editingTableId,
      initialEditingField,
      affordanceRequest,
      requestEdit,
      requestAffordance,
      exitEdit,
      registerEditPress,
      cancelEditPress,
    }),
    [
      editingTableId,
      initialEditingField,
      affordanceRequest,
      requestEdit,
      requestAffordance,
      exitEdit,
      registerEditPress,
      cancelEditPress,
    ],
  )

  // Root wrapper DOM ref (GH #121 perf) — lets the hover-highlight effect
  // below toggle CSS classes directly on React Flow's own `.react-flow__node`
  // wrapper elements, bypassing setNodes/React re-render entirely on hover.
  const wrapperRef = useRef<HTMLDivElement>(null)

  // GH #138 — pending `jump-pulse` timer, covering both phases: the initial
  // delay before the deferred DOM lookup/class-add (waiting for `fitView` to
  // settle and the target to mount) and, once added, the later removal. A
  // rapid re-jump (same or different table, before the previous pulse
  // finished either phase) clears the prior timeout instead of letting it
  // fire late/early against whichever node or phase is stale by then.
  const jumpPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // React Flow instance — used by the search-palette focus request below to
  // pan/zoom the viewport (shares the store with the container's instance).
  const { fitView, setCenter, getZoom } = useReactFlow()

  // Single-click on the minimap recenters the viewport on that point.
  // `position` is already in flow coordinates; drag-to-pan is handled
  // natively by the `pannable` prop below.
  const onMinimapClick = useCallback(
    (_event: ReactMouseEvent, position: { x: number; y: number }) => {
      setCenter(position.x, position.y, { zoom: getZoom(), duration: 200 })
    },
    [setCenter, getZoom],
  )

  // Track drag in progress — ReactFlow fires mouseLeave/mouseEnter when drag
  // starts/stops, which would trigger unnecessary highlighting recalculations.
  const isDraggingRef = useRef(false)

  // Movable-container grouping (GH #106 Bug 2 fix): while an area node is
  // being dragged, its member tables must translate by the same delta. This
  // ref snapshots the area's start position and each member's start position
  // at drag-start, so onNodeDrag/onNodeDragStop can compute `delta` and apply
  // it without compounding across frames.
  const dragAreaMemberStartRef = useRef<{
    areaId: string
    areaStart: { x: number; y: number }
    members: Map<string, { x: number; y: number }>
  } | null>(null)

  // Track whether React Flow has measured all nodes; used for one-shot
  // post-measure edge re-routing inside the overlay (Enhancement 2).
  const nodesInitialized = useNodesInitialized()
  const hasReRoutedAfterMeasureRef = useRef(false)

  // Keep a ref to the latest edges so the highlighting effect can read current
  // edges without adding them to its dependency array (which would cause an
  // infinite loop via setEdges).
  const edgesRef = useRef(edges)
  useEffect(() => {
    edgesRef.current = edges
  })

  // Keep refs to the latest selection/relations-preview state so the
  // initialNodes-sync effect below can read current values without adding
  // them to its dependency array (see that effect's comment for why: adding
  // them would re-fire the sync on every click/toggle and rebuild the node
  // store from the possibly-stale `initialNodes` prop).
  const activeTableIdRef = useRef(activeTableId)
  useEffect(() => {
    activeTableIdRef.current = activeTableId
  })
  const relationsPreviewTableIdRef = useRef(relationsPreviewTableId)
  useEffect(() => {
    relationsPreviewTableIdRef.current = relationsPreviewTableId
  })

  // Memoize node and edge types for performance
  const memoizedNodeTypes = useMemo(() => nodeTypes, [])
  const memoizedEdgeTypes = useMemo(() => edgeTypes, [])

  // Update nodes when initialNodes changes. Re-apply highlighting on every
  // sync so an unrelated parent re-push (refetch, peer/position update,
  // isConnected toggle, callback re-injection) does NOT clobber
  // isRelationsPreviewOpen / isActiveHighlighted back to false — the parent's
  // source nodes never carry those flags (GH #134; regression exposed by the
  // #121 hover-highlight split that removed the hover-driven re-apply).
  //
  // Deliberately keyed on [initialNodes, setNodes] ONLY — activeTableId and
  // relationsPreviewTableId are read via ref, NOT as deps. Single-table drag
  // (ReactFlowWhiteboard.tsx) is non-optimistic: it only patches local state
  // once the mutation's onSuccess round-trips, and `initialNodes` is not kept
  // in sync via onNodesChange in the meantime. If this effect depended on
  // activeTableId/relationsPreviewTableId, clicking a different table mid-drag
  // (before the save lands) would re-fire it and rebuild every node from that
  // stale `initialNodes` prop — snapping the just-dragged table back to its
  // pre-drag position (GH #134 review BLOCKER). Reading selection/preview via
  // ref makes this effect fire ONLY on a genuine initialNodes re-push, leaving
  // the L464-475 effect below as the sole owner of click/toggle
  // re-highlighting.
  useEffect(() => {
    setNodes(
      calculateHighlighting(
        initialNodes,
        edgesRef.current,
        activeTableIdRef.current,
        null,
        relationsPreviewTableIdRef.current,
      ).nodes,
    )
  }, [initialNodes, setNodes])

  // Search palette focus request — when the container bumps focusRequestToken,
  // pan/zoom to the requested table and mark it active-highlighted. Keyed on
  // the token (not the id) so re-selecting the same table re-fires; token 0 is
  // the initial value and never triggers a jump on mount.
  useEffect(() => {
    if (focusRequestToken <= 0 || !focusRequestTableId) return
    void fitView({
      nodes: [{ id: focusRequestTableId }],
      duration: 300,
      maxZoom: 1.2,
    })
    setActiveTableId(focusRequestTableId)

    // GH #138 — brief one-shot landing-cue pulse on the target node's DOM
    // wrapper, layered on top of the persistent active-highlight above.
    // Mirrors the GH #121 hover-highlight DOM-class pattern (direct
    // classList toggle on React Flow's own `.react-flow__node[data-id]`
    // wrapper, no setNodes/React re-render). Clears any prior pending
    // timer first so rapid re-jumps (even to the same table, where
    // isActiveHighlighted wouldn't otherwise re-toggle) still replay the
    // pulse instead of leaving a stale timer to strip it early/late.
    //
    // The querySelector is deferred (not run synchronously here) because on
    // large boards `onlyRenderVisibleElements` culls off-screen nodes from
    // the DOM — the target node (the common case when jumping to a related
    // table) may not exist yet. We wait ~320ms (the 300ms `fitView`
    // animation duration plus a small margin) so the pan/zoom has settled
    // and the target has been mounted before looking it up. The target id
    // is captured in this closure so a later-firing timer always resolves
    // the table it was scheduled for, not whatever `focusRequestTableId` is
    // by the time it fires.
    if (jumpPulseTimeoutRef.current !== null) {
      clearTimeout(jumpPulseTimeoutRef.current)
      jumpPulseTimeoutRef.current = null
    }
    const pulseTargetId = focusRequestTableId
    jumpPulseTimeoutRef.current = setTimeout(() => {
      const targetEl = wrapperRef.current?.querySelector(
        `.react-flow__node[data-id="${pulseTargetId}"]`,
      )
      if (targetEl) {
        targetEl.classList.remove('jump-pulse')
        // Force reflow so re-adding the class restarts the CSS animation
        // even when it's already present (rapid re-jump to the same table).
        void (targetEl as HTMLElement).offsetWidth
        targetEl.classList.add('jump-pulse')
        jumpPulseTimeoutRef.current = setTimeout(() => {
          targetEl.classList.remove('jump-pulse')
          jumpPulseTimeoutRef.current = null
        }, 1000)
      } else {
        jumpPulseTimeoutRef.current = null
      }
    }, 320)
    // Intentionally keyed on focusRequestToken only — fire on token bump only.
    // `fitView` (stable via useReactFlow) and `focusRequestTableId` are read
    // fresh each time the token bumps; including focusRequestTableId would
    // also refire this effect whenever the id changes without a token bump,
    // defeating the "bump-to-refire" contract (re-selecting the same table
    // must still jump to it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestToken])

  // Clear any pending jump-pulse removal timer on unmount.
  useEffect(() => {
    return () => {
      if (jumpPulseTimeoutRef.current !== null) {
        clearTimeout(jumpPulseTimeoutRef.current)
      }
    }
  }, [])

  // Keyboard traversal focus ring (FR-019a) — direct DOM class toggle on the
  // target shape's own `.react-flow__node-shape` wrapper, mirroring the
  // hover-highlight/jump-pulse pattern above (bypasses setNodes/React
  // re-render entirely, see the prop comment for why that matters here).
  // Deferred one animation frame: `onlyRenderVisibleElements` can cull an
  // off-screen shape from the DOM until the traversal effect's own
  // `setCenter` pan has had a chance to mount it.
  const kbdFocusedElRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (kbdFocusedElRef.current) {
      kbdFocusedElRef.current.classList.remove('kbd-focused')
      kbdFocusedElRef.current = null
    }
    if (!keyboardFocusedShapeId) return
    const raf = requestAnimationFrame(() => {
      const el = wrapperRef.current?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${keyboardFocusedShapeId}"] .react-flow__node-shape`,
      )
      if (el) {
        el.classList.add('kbd-focused')
        kbdFocusedElRef.current = el
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [keyboardFocusedShapeId])

  // Update edges when initialEdges changes — immediately recalculate handles
  // based on the current node positions so edges start pointing the right way.
  useEffect(() => {
    if (initialEdges.length === 0) {
      setEdges(initialEdges)
      return
    }

    // Edges referencing a deleted or stale column are silently excluded to
    // prevent the "[React Flow]: Couldn't create edge for source handle id"
    // warning flood that occurs when handle IDs no longer match any
    // registered handle. Shared with TableFocusOverlay.tsx.
    const validEdges = filterValidEdges(initialNodes, initialEdges)

    const allNodeIds = new Set(initialNodes.map((n) => n.id))
    const recalculated = recalculateEdgesForDraggedNodes(
      validEdges,
      initialNodes,
      allNodeIds,
    )
    // Compute per-edge bundle offsets so parallel edges fan out consistently
    // after a page reload (they are not persisted; derive them from DB data).
    const layoutNodes = initialNodes.map((n) => ({
      id: n.id,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- React Flow's `measured` dimensions are only populated after the node has actually been measured in the DOM; on initial mount (this effect) they are genuinely undefined despite the non-optional type.
      width: n.measured?.width ?? (n.width as number) ?? 250,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see above: `measured` is undefined pre-measurement at runtime.
      height: n.measured?.height ?? (n.height as number) ?? 150,
    }))
    const layoutEdges = recalculated.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
    }))
    const layers = assignLayersBFS(layoutNodes, layoutEdges)
    const bundleOffsets = computeEdgeBundleOffsets(layoutEdges, layers)
    const offsetById = new Map(bundleOffsets.map((o) => [o.id, o]))
    const withOffsets = recalculated.map((e) => {
      const off = offsetById.get(e.id)
      if (!off || (off.handleYOffset === 0 && off.centerXOffset === 0)) return e
      return {
        ...e,
        data: {
          ...e.data!,
          bundleHandleYOffset: off.handleYOffset,
          bundleCenterXOffset: off.centerXOffset,
        },
      }
    })
    setEdges(withOffsets)
  }, [initialEdges, initialNodes, setEdges])

  // Reset the one-shot re-routing guard whenever the node set changes (e.g.
  // overlay re-opened with a different focal table).
  useEffect(() => {
    hasReRoutedAfterMeasureRef.current = false
  }, [initialNodes])

  // One-shot re-route after React Flow measures nodes. The internal `nodes`
  // value carries `measured` widths at this point, giving accurate handle-side
  // choices. On the main canvas this is a harmless no-op (same handles already
  // chosen by drag routing). On the overlay it corrects the initial pass which
  // ran with DEFAULT_NODE_WIDTH fallbacks.
  useEffect(() => {
    if (!nodesInitialized || hasReRoutedAfterMeasureRef.current) return
    hasReRoutedAfterMeasureRef.current = true
    setEdges((prevEdges) => {
      if (prevEdges.length === 0) return prevEdges
      const allIds = new Set(nodes.map((n) => n.id))
      return recalculateEdgesForDraggedNodes(prevEdges, nodes, allIds)
    })
  }, [nodesInitialized, nodes, setEdges])

  // Apply NODE highlighting when selection/relations-preview changes (GH
  // #121 perf, opt #1). Deliberately keyed on [activeTableId,
  // relationsPreviewTableId] only — NOT hoveredTableId — since these are
  // rare, user-initiated events (a click, opening the relations panel), so
  // rebuilding + re-setting the full node array here is cheap relative to
  // how often it fires. hoveredTableId is handled by two SEPARATE,
  // cheaper mechanisms below: a setEdges-only effect (edges are far fewer
  // than nodes) and a DOM-class effect that never touches React state at
  // all — hovering a table on a large board no longer re-renders every
  // other table node.
  //
  // Uses the functional updater form of setNodes so we always operate on the
  // current node list rather than a stale closure snapshot. edgesRef.current
  // provides the latest edges without adding edges to the dependency array
  // (which would cause an infinite loop via setEdges).
  useEffect(() => {
    setNodes((currentNodes) => {
      const highlighted = calculateHighlighting(
        currentNodes,
        edgesRef.current,
        activeTableId,
        null,
        relationsPreviewTableId,
      )
      return highlighted.nodes
    })
  }, [activeTableId, relationsPreviewTableId, setNodes])

  // Apply EDGE highlighting on hover OR active-selection changes (GH #121
  // perf). Edges stay on the setEdges path unconditionally (edges are far
  // fewer than the DOM cost of a full table node, so this doesn't have the
  // same re-render blast radius the node array did) — only the NODE array
  // rebuild moved off the hot hover path above.
  useEffect(() => {
    setEdges((currentEdges) =>
      calculateEdgeHighlighting(currentEdges, activeTableId, hoveredTableId),
    )
  }, [activeTableId, hoveredTableId, setEdges])

  // Hover highlight — DOM-only, no setNodes (GH #121 perf, opt #1's primary
  // win). Hovering a table on a 100-200 table board used to call
  // setNodes(currentNodes => …) on EVERY hover, rebuilding + re-setting the
  // entire node array (an O(N) allocation plus a new `nodes` identity handed
  // to React Flow) just to restyle the hovered table + its 1-hop neighbors.
  // Toggling a CSS class directly on React Flow's own per-node wrapper
  // elements achieves the identical visual (see the `.rf-hover-highlighted`
  // rules in react-flow-theme.css) without any React re-render at all.
  //
  // Skips the node currently holding the relations-preview top z-index tier
  // (NODE_RELATIONS_PREVIEW, set by the node-array effect above) so a hover
  // never downgrades it — `.rf-hover-highlighted`'s `!important` z-index
  // would otherwise clobber that higher tier. relationsPreviewTableId IS in
  // the dependency array (unlike a ref-read) so that toggling the relations
  // panel open/closed on the table currently being hovered (the panel's
  // trigger button lives inside the hovered table's own header — clicking it
  // does not fire mouseleave/mouseenter) re-evaluates this effect and either
  // removes the stale class from that table or re-adds it, instead of
  // leaving a `!important` z-index:1000 in place that would silently
  // override the just-assigned z-index:2000 relations-preview tier.
  useEffect(() => {
    const container = wrapperRef.current
    if (!container || !hoveredTableId) return

    const { relatedTableIds } = getDirectlyRelatedTableIds(
      hoveredTableId,
      edgesRef.current,
    )
    const touched: Array<Element> = []
    relatedTableIds.forEach((id) => {
      if (id === relationsPreviewTableId) return
      const el = container.querySelector(`.react-flow__node[data-id="${id}"]`)
      if (el) {
        el.classList.add('rf-hover-highlighted')
        touched.push(el)
      }
    })

    return () => {
      touched.forEach((el) => el.classList.remove('rf-hover-highlighted'))
    }
  }, [hoveredTableId, relationsPreviewTableId])

  // Handle node click (selection + optional external callback). Comment pins
  // (GH #110) manage their own Popover open state internally and stop
  // propagation on their trigger, so this should rarely fire for them — the
  // commentIdSet guard is defense-in-depth against treating a comment's id
  // as a table selection (which would spuriously clear real highlighting).
  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      if (commentIdSet.has(node.id)) return
      setActiveTableId(node.id)
      onNodeClickProp?.(node.id)
    },
    [commentIdSet, onNodeClickProp],
  )

  // Handle pane click (clear selection). Forwards the native event so
  // callers can derive a flow position (comment placement tool, GH #110).
  const onPaneClick = useCallback(
    (event: ReactMouseEvent) => {
      setActiveTableId(null)
      // Empty-pane click closes the edit overlay (locked decision #2).
      exitEdit()
      onPaneClickProp?.(event)
    },
    [onPaneClickProp, exitEdit],
  )

  // Handle node mouse enter (hover) — skip during drag (ReactFlow fires this on drag end)
  const onNodeMouseEnter = useCallback<NodeMouseHandler>((_event, node) => {
    if (isDraggingRef.current) return
    perfTracker.setGesture('hover') // no-op unless recording
    setHoveredTableId(node.id)
  }, [])

  // Handle node mouse leave (unhover) — skip during drag (ReactFlow fires this on drag start)
  const onNodeMouseLeave = useCallback<NodeMouseHandler>((_event, _node) => {
    if (isDraggingRef.current) return
    perfTracker.clearGesture('hover') // no-op unless recording
    setHoveredTableId(null)
  }, [])

  // Helper: merge dragged node positions into the current nodes array so the
  // recalculation always uses the latest coordinates even if React state is
  // one frame behind.
  const mergeCurrentPositions = useCallback(
    (
      node: TableNodeType,
      draggedNodes: Array<TableNodeType>,
    ): Array<TableNodeType> => {
      // Build a quick lookup of updated positions from the drag event
      const updatedPositions = new Map<string, { x: number; y: number }>()
      updatedPositions.set(node.id, node.position)
      draggedNodes.forEach((n) => updatedPositions.set(n.id, n.position))

      return nodes.map((n) => {
        const updated = updatedPositions.get(n.id)
        return updated ? { ...n, position: updated } : n
      })
    },
    [nodes],
  )

  // rAF-throttle drag-frame edge recalculation (GH #121 perf, opt #5).
  // onNodeDrag can fire more than once per animation frame (e.g. a high
  // poll-rate pointer device), and each firing previously ran a full
  // recalculateEdgesForDraggedNodes + setEdges pass synchronously. Coalescing
  // to at most one pass per frame — NOT a delay-debounce, which would
  // visibly lag the dragged node's edges — cuts redundant work during drag
  // while keeping edges visually attached every frame. Only the continuous
  // onNodeDrag path is throttled; onNodeDragStop's final recalculation stays
  // synchronous so the drop settles immediately and correctly.
  const dragEdgeRecalcRafRef = useRef<number | null>(null)
  const pendingDragEdgeRecalcRef = useRef<{
    currentNodes: Array<TableNodeType>
    draggedIds: Set<string>
  } | null>(null)

  const cancelPendingDragEdgeRecalc = useCallback(() => {
    if (dragEdgeRecalcRafRef.current !== null) {
      cancelAnimationFrame(dragEdgeRecalcRafRef.current)
      dragEdgeRecalcRafRef.current = null
    }
    pendingDragEdgeRecalcRef.current = null
  }, [])

  const scheduleDragEdgeRecalc = useCallback(
    (currentNodes: Array<TableNodeType>, draggedIds: Set<string>) => {
      pendingDragEdgeRecalcRef.current = { currentNodes, draggedIds }
      if (dragEdgeRecalcRafRef.current !== null) return
      dragEdgeRecalcRafRef.current = requestAnimationFrame(() => {
        dragEdgeRecalcRafRef.current = null
        const pending = pendingDragEdgeRecalcRef.current
        pendingDragEdgeRecalcRef.current = null
        if (!pending) return
        setEdges((prevEdges) =>
          recalculateEdgesForDraggedNodes(
            prevEdges,
            pending.currentNodes,
            pending.draggedIds,
          ),
        )
      })
    },
    [setEdges],
  )

  // Cancel any in-flight rAF on unmount so it never calls setEdges after the
  // component is gone.
  useEffect(() => cancelPendingDragEdgeRecalc, [cancelPendingDragEdgeRecalc])

  // Mark drag as started — suppresses hover events that ReactFlow fires on drag begin.
  // When the dragged node is an area, also snapshot its start position and its
  // members' start positions so onNodeDrag/onNodeDragStop can translate them
  // by the live delta (movable-container grouping, GH #106 Bug 2 fix).
  const onNodeDragStart = useCallback<OnNodeDrag<TableNodeType>>(
    (_event, node) => {
      isDraggingRef.current = true
      // LizMeter #53 drag guard — a real node drag starting must never let
      // its own mousedown later combine with an unrelated double-click
      // elsewhere within DOUBLE_PRESS_WINDOW_MS.
      cancelEditPress()
      perfTracker.setGesture('drag') // no-op unless recording
      // Defensive reset — a new drag should never inherit a stale scheduled
      // recalculation from a previous one.
      cancelPendingDragEdgeRecalc()

      if (!areaIdSet.has(node.id)) {
        dragAreaMemberStartRef.current = null
        return
      }
      const areaNode = areaNodesState.find((a) => a.id === node.id)
      const memberIds = new Set(areaNode?.data.area.memberTableIds ?? [])
      const members = new Map<string, { x: number; y: number }>()
      nodes.forEach((n) => {
        if (memberIds.has(n.id))
          members.set(n.id, { x: n.position.x, y: n.position.y })
      })
      dragAreaMemberStartRef.current = {
        areaId: node.id,
        areaStart: { x: node.position.x, y: node.position.y },
        members,
      }
    },
    [
      areaIdSet,
      areaNodesState,
      cancelEditPress,
      cancelPendingDragEdgeRecalc,
      nodes,
    ],
  )

  // Recalculate edge handles whenever a node is dragged (live feedback).
  // We merge the dragged node's latest position into the nodes array so the
  // calculation is always based on current coordinates.
  const onNodeDrag = useCallback<OnNodeDrag<TableNodeType>>(
    (_event, node, draggedNodes) => {
      // Shapes need no relationship-edge recalculation at all (FR-015):
      // ConnectorEdge subscribes to each endpoint's live position directly
      // via useInternalNode(id), so it re-renders every drag frame with
      // zero extra plumbing here.
      if (shapeIdSet.has(node.id)) return
      if (areaIdSet.has(node.id)) {
        // Movable-container grouping: translate member tables live by the
        // same delta the area has moved since drag-start.
        const drag = dragAreaMemberStartRef.current
        if (!drag || drag.areaId !== node.id || drag.members.size === 0) return
        const deltaX = node.position.x - drag.areaStart.x
        const deltaY = node.position.y - drag.areaStart.y
        // Counts app-initiated interaction setNodes only (this area-member-drag
        // path). Regular single-node drags flow through React Flow's internal
        // applyNodeChanges and are NOT counted here — so this counter reads ~0
        // in the common single-node drag case; don't misread it as "no updates".
        perfTracker.incSetNodes() // no-op unless recording; interaction path only
        setNodes((prevNodes) =>
          prevNodes.map((n) => {
            const start = drag.members.get(n.id)
            if (!start) return n
            return {
              ...n,
              position: { x: start.x + deltaX, y: start.y + deltaY },
            }
          }),
        )
        const movedIds = new Set(drag.members.keys())
        const currentNodes = nodes.map((n) => {
          const start = drag.members.get(n.id)
          if (!start) return n
          return {
            ...n,
            position: { x: start.x + deltaX, y: start.y + deltaY },
          }
        })
        scheduleDragEdgeRecalc(currentNodes, movedIds)
        return
      }
      const draggedIds = new Set(draggedNodes.map((n) => n.id))
      draggedIds.add(node.id)
      const currentNodes = mergeCurrentPositions(node, draggedNodes)
      scheduleDragEdgeRecalc(currentNodes, draggedIds)
    },
    [
      areaIdSet,
      shapeIdSet,
      mergeCurrentPositions,
      nodes,
      scheduleDragEdgeRecalc,
      setNodes,
    ],
  )

  // Handle node drag stop (position update)
  const onNodeDragStop = useCallback<OnNodeDrag<TableNodeType>>(
    (event, node, draggedNodes) => {
      isDraggingRef.current = false
      perfTracker.clearGesture('drag') // no-op unless recording

      // Area nodes: persist the new position (+ any moved members), skip
      // edge routing / hover.
      if (areaIdSet.has(node.id)) {
        const drag = dragAreaMemberStartRef.current
        let movedMembers: Array<{
          id: string
          positionX: number
          positionY: number
        }> = []
        if (drag && drag.areaId === node.id) {
          const deltaX = node.position.x - drag.areaStart.x
          const deltaY = node.position.y - drag.areaStart.y
          movedMembers = Array.from(drag.members.entries()).map(
            ([id, start]) => ({
              id,
              positionX: start.x + deltaX,
              positionY: start.y + deltaY,
            }),
          )
        }
        dragAreaMemberStartRef.current = null
        onAreaDragStop?.(
          node.id,
          node.position.x,
          node.position.y,
          movedMembers,
        )
        return
      }

      // Shape nodes: persist the new position(s), skip edge routing/hover
      // entirely (tech-spec §10). React Flow reports the WHOLE multi-drag
      // selection to this callback once, so a multi-select drag of N shapes
      // emits exactly N entries here, never per-frame.
      if (shapeIdSet.has(node.id)) {
        const draggedShapeIds = new Set(
          draggedNodes.filter((n) => shapeIdSet.has(n.id)).map((n) => n.id),
        )
        draggedShapeIds.add(node.id)
        const finalPositions = [node, ...draggedNodes]
          .filter((n) => draggedShapeIds.has(n.id))
          // De-duplicate — `node` may also appear in `draggedNodes`.
          .filter((n, i, arr) => arr.findIndex((o) => o.id === n.id) === i)
          .map((n) => ({
            id: n.id,
            positionX: n.position.x,
            positionY: n.position.y,
          }))
        onShapeDragStop?.(finalPositions)
        return
      }

      // Restore hover on the node we just dropped (ReactFlow fires mouseEnter after
      // dragStop which we suppressed, so manually set it here)
      setHoveredTableId(node.id)

      // Final recalculation with latest positions — synchronous (not
      // rAF-throttled) so the drop settles immediately. Cancel any pending
      // scheduled recalc from the last onNodeDrag frame first, so it can't
      // fire a frame later and clobber this authoritative final result with
      // slightly-stale positions.
      cancelPendingDragEdgeRecalc()
      const draggedIds = new Set(draggedNodes.map((n) => n.id))
      draggedIds.add(node.id)
      const currentNodes = mergeCurrentPositions(node, draggedNodes)
      setEdges((prevEdges) =>
        recalculateEdgesForDraggedNodes(prevEdges, currentNodes, draggedIds),
      )
      // Call the prop callback if provided
      onNodeDragStopProp?.(event, node, draggedNodes)
    },
    [
      areaIdSet,
      shapeIdSet,
      cancelPendingDragEdgeRecalc,
      onAreaDragStop,
      onShapeDragStop,
      onNodeDragStopProp,
      mergeCurrentPositions,
      setEdges,
    ],
  )

  // Handle nodes change with custom callback. React Flow fires a single
  // onNodesChange for ALL nodes (tables + areas + comment pins), so we
  // partition by id: area changes go to the area state, comment changes to
  // the comment state, table changes to the existing pipeline.
  const onNodesChange: OnNodesChange<TableNodeType> = useCallback(
    (changes) => {
      const areaChanges: typeof changes = []
      const shapeChanges: typeof changes = []
      const commentChanges: typeof changes = []
      const tableChanges: typeof changes = []
      for (const change of changes) {
        if ('id' in change && areaIdSet.has(change.id)) areaChanges.push(change)
        else if ('id' in change && shapeIdSet.has(change.id))
          shapeChanges.push(change)
        else if ('id' in change && commentIdSet.has(change.id))
          commentChanges.push(change)
        else tableChanges.push(change)
      }
      if (areaChanges.length > 0) {
        handleAreaNodesChange(areaChanges as any)
      }
      if (shapeChanges.length > 0) {
        handleShapeNodesChange(shapeChanges as any)
      }
      if (commentChanges.length > 0) {
        handleCommentNodesChange(commentChanges as any)
      }
      handleNodesChange(tableChanges)
      onNodesChangeProp?.(tableChanges)
    },
    [
      areaIdSet,
      shapeIdSet,
      commentIdSet,
      handleAreaNodesChange,
      handleShapeNodesChange,
      handleCommentNodesChange,
      handleNodesChange,
      onNodesChangeProp,
    ],
  )

  // Handle edges change with custom callback. Partitions connector changes
  // (selection, removal-from-local-state) into their own state, mirroring
  // the node partitioning above.
  const onEdgesChange: OnEdgesChange<RelationshipEdgeType> = useCallback(
    (changes) => {
      const connectorChanges: typeof changes = []
      const relationshipChanges: typeof changes = []
      for (const change of changes) {
        if ('id' in change && connectorIdSet.has(change.id)) {
          connectorChanges.push(change)
        } else {
          relationshipChanges.push(change)
        }
      }
      if (connectorChanges.length > 0) {
        handleConnectorEdgesChange(connectorChanges as any)
      }
      handleEdgesChange(relationshipChanges)
      onEdgesChangeProp?.(relationshipChanges)
    },
    [
      connectorIdSet,
      handleConnectorEdgesChange,
      handleEdgesChange,
      onEdgesChangeProp,
    ],
  )

  // Edge deletion trigger. Connectors (M1) and relationships both persist
  // from here. The relationship branch closes the Phase 1 gap noted in
  // tech-spec §7: Delete/Backspace used to remove a relationship edge from
  // React Flow's local state and stop there, leaving the row in the database
  // — so the initialEdges resync effect above put the line straight back on
  // the next `initialNodes` change (i.e. as soon as any table was dragged).
  // Routing it to the same mutation as RelationshipEdge's hover delete
  // button gives the key the optimistic parent-state removal, the socket
  // emit, and the rollback-on-error that the button already had.
  const onEdgesDelete = useCallback<OnEdgesDelete>(
    (deletedEdges) => {
      for (const edge of deletedEdges) {
        if (edge.type === 'connector') onConnectorDelete?.(edge.id)
        else onRelationshipDelete?.(edge.id)
      }
    },
    [onConnectorDelete, onRelationshipDelete],
  )

  // Veto a relationship delete when either no delete handler is wired (how
  // TableFocusOverlay mounts us: a read-only preview whose Delete key must
  // be inert, not phantom-remove a line from the dialog) OR the connection
  // that write would need to travel over is not live right now. React Flow
  // applies deletions to its own store BEFORE `onEdgesDelete` runs, so a
  // handler merely being wired never proved the removal could persist — a
  // reconnect blip, backgrounded tab, or sleep/wake between mount and this
  // keypress left the edge vanished locally while the row survived in the
  // database, and the next `initialNodes` change (any table drag)
  // resurrected it via the initialEdges resync effect below. Returning a
  // filtered set keeps other deletions in the batch working.
  //
  // `canDeleteRelationships` reads the WHITEBOARD socket's `connectionState`
  // (threaded down from ReactFlowWhiteboard) — the exact same signal
  // `useRelationshipMutations` gates its own writes on. It is deliberately
  // NOT `isConnected`: that flag belongs to a separate
  // `useColumnCollaboration` socket instance which disagrees with the
  // whiteboard socket for a window after load (reproduced against the real
  // server: the row was deleted while `isConnected` still read false — see
  // the wiring comment in ReactFlowWhiteboard.tsx). Reading the same signal
  // the mutation itself reads means the veto here and the mutation's own
  // refusal can no longer disagree.
  const canPersistRelationshipDelete =
    onRelationshipDelete !== undefined && canDeleteRelationships
  // Typed against the canvas's own generics so it does not widen the node
  // type React Flow infers for the sibling handlers. The connector check
  // reads through `Edge` because RelationshipEdgeType's `type` is narrowed to
  // 'relationship', while the live array is the merged relationship +
  // connector set (same reason the `edges` prop below is cast).
  const onBeforeDelete = useCallback<
    OnBeforeDelete<TableNodeType, RelationshipEdgeType>
  >(
    async ({ nodes: deletedNodes, edges: deletedEdges }) => {
      // Delegates to the exported pure predicate below — kept as the single
      // source of truth for the veto decision so its unit test exercises
      // the exact logic this callback runs (D-12: Playwright has no clean
      // seam to sever the whiteboard Socket.IO connection, so this
      // predicate is the fallback coverage for the disconnected-delete path
      // — see the comment on relationship-deletion.spec.ts's e2e test for
      // that gap).
      const veto = computeRelationshipDeleteVeto({
        deletedEdges: deletedEdges as Array<Edge>,
        canPersistRelationshipDelete,
        hasRelationshipDeleteHandler: onRelationshipDelete !== undefined,
      })
      if (veto.shouldNotifyRefusal) {
        onRelationshipDeleteRefused?.()
      }
      if (canPersistRelationshipDelete) return true
      return {
        nodes: deletedNodes,
        edges: veto.edges as typeof deletedEdges,
      }
    },
    [
      canPersistRelationshipDelete,
      onRelationshipDelete,
      onRelationshipDeleteRefused,
    ],
  )

  // Delete/Backspace on a selected area node (GH #106 Bug 1 fix). Table nodes
  // are marked `deletable: false` above so they never appear here — table
  // deletion always goes through useTableDeletion's confirmation dialog.
  // React Flow's own useKeyPress(deleteKeyCode, { actInsideInputWithModifier:
  // false }) already ignores Delete/Backspace while an input/textarea is
  // focused, so the AreaNode rename field's Backspace keystrokes are safe
  // without an extra guard here.
  const onNodesDelete = useCallback<OnNodesDelete<Node>>(
    (deletedNodes) => {
      for (const deletedNode of deletedNodes) {
        if (areaIdSet.has(deletedNode.id)) {
          onAreaDelete?.(deletedNode.id)
        } else if (shapeIdSet.has(deletedNode.id)) {
          onShapeDelete?.(deletedNode.id)
        }
      }
    },
    [areaIdSet, shapeIdSet, onAreaDelete, onShapeDelete],
  )

  // Track whether a connection drag is in progress to reveal target handles
  const [isConnecting, setIsConnecting] = useState(false)
  // FR-016: whether the IN-PROGRESS drag started from a shape's own handle —
  // narrower than `isConnecting`, and used ONLY to suppress the pre-existing
  // table-column blanket highlight for a shape-originated drag (see the
  // `.is-connecting-from-shape` CSS rule). Never toggled for a table-
  // originated drag, so FR-017's "existing table-to-table flow unaffected"
  // stays exactly as it was — this rule only ever narrows, never widens, the
  // existing highlight.
  const [isConnectingFromShape, setIsConnectingFromShape] = useState(false)

  const onConnectStart = useCallback<OnConnectStart>(
    (_event, params) => {
      setIsConnecting(true)
      setIsConnectingFromShape(!!params.nodeId && shapeIdSet.has(params.nodeId))
    },
    [shapeIdSet],
  )

  const onConnectEnd = useCallback(() => {
    setIsConnecting(false)
    setIsConnectingFromShape(false)
  }, [])

  // Stable callback for MiniMap's nodeColor (GH #121 stable-reference audit)
  // — an inline arrow function literal here is a new identity every render.
  const minimapNodeColor = useCallback(() => 'var(--rf-table-bg)', [])

  // Viewport culling (GH #121 perf, opt #2) — only turn on
  // onlyRenderVisibleElements once the board is large enough that skipping
  // off-screen node/edge rendering is worth React Flow's tradeoff (edges
  // whose both endpoints are off-screen get culled too). Off for small/
  // typical boards and for TableFocusOverlay's own nested canvas instance,
  // which never has more than a handful of nodes.
  const onlyRenderVisibleElements =
    mergedNodes.length > VIEWPORT_CULLING_NODE_THRESHOLD

  // Edge-ablation (GH #142). Subscribe to the tracker's `hideEdges` flag — it
  // flips only on an explicit HUD click (never the gesture hot path), so this
  // re-renders the canvas only on toggle. Honored solely when the caller opted
  // in via `enableEdgeAblation` (the main whiteboard canvas), so ablating the
  // main board leaves TableFocusOverlay's nested canvas untouched.
  const hideEdges = useSyncExternalStore(
    perfTracker.subscribe,
    () => perfTracker.getSnapshot().hideEdges,
    () => false,
  )
  // Merge relationship edges with connector edges (Phase 1) into the single
  // <ReactFlow edges> array. Connectors are additive — the ablation branch
  // is unchanged.
  const mergedEdges = useMemo(
    () => [...edges, ...connectorEdgesState],
    [edges, connectorEdgesState],
  )
  const effectiveEdges =
    enableEdgeAblation && hideEdges ? EMPTY_EDGES : mergedEdges

  // The one predicate that owns BOTH rule sets (tech-spec §4): today's
  // column-handle table-to-table rule, unchanged, and the new shape-to-shape
  // rule (no self-connectors, no line-kind endpoint, no mixed table/shape
  // pair in either direction). connectionMode stays at its default (strict).
  const isValidConnection = useCallback<IsValidConnection>(
    (connection) => {
      const sourceNode = mergedNodes.find((n) => n.id === connection.source)
      const targetNode = mergedNodes.find((n) => n.id === connection.target)
      if (!sourceNode || !targetNode) return false

      if (sourceNode.type === 'table' && targetNode.type === 'table') {
        return (
          parseColumnHandleId(connection.sourceHandle ?? '') !== null &&
          parseColumnHandleId(connection.targetHandle ?? '') !== null
        )
      }
      if (sourceNode.type === 'shape' && targetNode.type === 'shape') {
        if (sourceNode.id === targetNode.id) return false
        const sourceShape = (sourceNode as unknown as ShapeNodeType).data.shape
        const targetShape = (targetNode as unknown as ShapeNodeType).data.shape
        return sourceShape.kind !== 'line' && targetShape.kind !== 'line'
      }
      return false // every mixed pair, both directions
    },
    [mergedNodes],
  )

  // Hybrid canvas rendering (GH #142 → canvas migration) is UNCONDITIONAL on
  // the main board (canvas-unconditional-default: the `?canvas=0` rollback
  // lever has been removed by design — rollback is now code-revert-only).
  // Only the main board is affected (same rationale as edge-ablation) — the
  // focus overlay keeps its DOM render path because it doesn't set
  // `enableEdgeAblation`.
  const canvasMode = enableEdgeAblation

  return (
    // CanvasModeContext wraps the whole nodes subtree (not just
    // <CanvasNodeLayer>) so TableNode — rendered deep inside <ReactFlow> via
    // nodeTypes, not passed props directly — can read `canvasMode` without
    // it being threaded through node `data` (which would force a re-key of
    // TableNode's custom memo comparator). Mirrors ForceFullDetailContext's
    // usage elsewhere in this tree.
    <CanvasModeContext.Provider value={canvasMode}>
      <CanvasEditContext.Provider value={canvasEditContextValue}>
        <div
          ref={wrapperRef}
          className={`react-flow-wrapper ${isConnecting ? 'is-connecting' : ''} ${isConnectingFromShape ? 'is-connecting-from-shape' : ''} ${className}`}
          // W1 (Hermes code review): `position: relative` makes this div
          // the containing block for ShapeDrawOverlay's `position:
          // absolute; inset: 0` child, so that child's box shares this
          // element's own top-left corner in viewport space — which is
          // exactly what lets the overlay convert raw pointer clientX/Y
          // into wrapper-relative CSS coordinates (see ShapeDrawOverlay's
          // gestureRef comment). Without this, the containing block fell
          // through to a `position: relative` ancestor further up
          // (ReactFlowWhiteboard's own wrapper div), whose top-left sits
          // below the route header and Toolbar — so the rubber-band draw
          // preview rendered that many pixels away from the actual cursor.
          style={{ width: '100%', height: '100%', position: 'relative' }}
        >
          {/* Global SVG marker definitions for cardinality indicators */}
          <CardinalityMarkerDefs />
          {/* Static arrowhead marker defs for connectors and line/arrow shapes (D-9) */}
          <ConnectorMarkerDefs />

          <ReactFlow
            // Area/shape nodes are different node types merged behind/around
            // tables; React Flow resolves them at runtime via the `area`/
            // `shape` entries in nodeTypes. The cast keeps the strongly-typed
            // table handlers (onNodesChange<TableNodeType>) without
            // threading a union node type through the whole canvas.
            nodes={mergedNodes as unknown as typeof nodes}
            edges={effectiveEdges as unknown as typeof edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            isValidConnection={isValidConnection}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onNodeMouseEnter={onNodeMouseEnter}
            onNodeMouseLeave={onNodeMouseLeave}
            onNodeDragStart={onNodeDragStart}
            onNodeDrag={onNodeDrag}
            onNodeDragStop={onNodeDragStop}
            // Perf tracker (GH #121 follow-up): pan/zoom gesture tagging. React
            // Flow has no pan/zoom callbacks wired otherwise — these read-only
            // handlers exist solely to tag the current gesture (noteMove disambiguates
            // pan vs zoom by scale change). All writes no-op unless recording.
            onMove={(_event, viewport) => perfTracker.noteMove(viewport.zoom)}
            onMoveEnd={() => perfTracker.clearGesture()}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            onBeforeDelete={onBeforeDelete}
            deleteKeyCode={DELETE_KEY_CODES}
            nodeTypes={memoizedNodeTypes}
            edgeTypes={memoizedEdgeTypes}
            nodesDraggable={nodesDraggable}
            panOnDrag={panOnDrag}
            nodesConnectable={true}
            elementsSelectable={true}
            onlyRenderVisibleElements={onlyRenderVisibleElements}
            fitView
            fitViewOptions={fitViewOptions}
            minZoom={VIEWPORT_CONSTRAINTS.minZoom}
            maxZoom={VIEWPORT_CONSTRAINTS.maxZoom}
            panOnScroll={true}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            // LizMeter #53 fix: a dblclick retargeted to
            // div.react-flow__nodes (see CanvasEditContextValue's
            // registerEditPress doc comment) would otherwise still reach
            // React Flow's own default zoomOnDoubleClick behavior, throwing
            // the previously-overlaid table off-screen with an unwanted 2x
            // zoom+pan ("two tables overlapping"). Disabling it here removes
            // that side effect unconditionally, regardless of *why* a
            // dblclick got retargeted. Trade-off: double-click-to-zoom-in on
            // empty pane space is lost — the Controls zoom buttons remain.
            zoomOnDoubleClick={false}
          >
            <CanvasNodeLayer
              enabled={canvasMode}
              editingTableId={editingTableId}
            />
            {showControls && <Controls />}
            {showBackground && (
              <Background color="var(--rf-background-pattern)" gap={16} />
            )}
            {showMinimap && minimapExpanded && (
              <div className="minimap-backdrop" onClick={onMinimapCollapse} />
            )}
            {showMinimap && (
              <MiniMap
                nodeColor={minimapNodeColor}
                maskColor="rgba(0, 0, 0, 0.1)"
                pannable
                onClick={onMinimapClick}
                className={minimapExpanded ? 'minimap-focused' : undefined}
              />
            )}
          </ReactFlow>
          {/* H1: mounts ONLY while a draw tool is armed. pointer-events:none
              — see ShapeDrawOverlay's own module comment for the full
              wheel/zoom-survival mechanism. */}
          {isDrawTool(activeTool) && (
            <ShapeDrawOverlay
              activeTool={activeTool}
              onCommit={(kind, rect, drag) => onDrawCommit?.(kind, rect, drag)}
              onDisarm={() => onDrawDisarm?.()}
            />
          )}
        </div>
      </CanvasEditContext.Provider>
    </CanvasModeContext.Provider>
  )
}
